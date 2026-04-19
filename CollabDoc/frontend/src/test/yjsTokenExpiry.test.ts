import { describe, it, expect, vi, beforeEach } from 'vitest'

interface FakeHandler { (payload: unknown): void }

class FakeWebsocketProvider {
  listeners: Record<string, FakeHandler[]> = {}
  awareness = { setLocalState: vi.fn(), getStates: vi.fn(() => new Map()) }
  destroyed = false
  lastOpts: unknown

  constructor(public url: string, public room: string, public doc: unknown, opts: unknown) {
    this.lastOpts = opts
  }
  on(event: string, handler: FakeHandler) { (this.listeners[event] ??= []).push(handler) }
  destroy() { this.destroyed = true }
}

const createdProviders: FakeWebsocketProvider[] = []

vi.mock('y-websocket', () => ({
  WebsocketProvider: vi.fn().mockImplementation((...args: ConstructorParameters<typeof FakeWebsocketProvider>) => {
    const p = new FakeWebsocketProvider(...args)
    createdProviders.push(p)
    return p
  }),
}))

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}))

import { YjsProvider } from '../collab/YjsProvider'

describe('YjsProvider.updateToken', () => {
  beforeEach(() => { createdProviders.length = 0 })

  it('rebuilds the WebsocketProvider with the new token and destroys the old one', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 'old', persist: false })
    expect(createdProviders).toHaveLength(1)
    const first = createdProviders[0]
    expect((first.lastOpts as { params: { token: string } }).params.token).toBe('old')

    p.updateToken('new')

    expect(createdProviders).toHaveLength(2)
    expect(first.destroyed).toBe(true)
    const second = createdProviders[1]
    expect((second.lastOpts as { params: { token: string } }).params.token).toBe('new')

    p.destroy()
  })

  it('is a no-op when the token is unchanged', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 'same', persist: false })
    p.updateToken('same')
    expect(createdProviders).toHaveLength(1)
    p.destroy()
  })

  it('is a no-op after destroy', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 't', persist: false })
    p.destroy()
    p.updateToken('new')
    expect(createdProviders).toHaveLength(1)
  })

  it('preserves the Y.Doc across token rebuilds', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 'old', persist: false })
    const docBefore = p.doc
    p.updateToken('new')
    expect(p.doc).toBe(docBefore)
    p.destroy()
  })
})
