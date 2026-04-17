import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock y-websocket BEFORE importing YjsProvider. We simulate the event-emitter
// surface so we can drive status transitions from the test.
interface FakeHandler { (payload: unknown): void }

class FakeWebsocketProvider {
  listeners: Record<string, FakeHandler[]> = {}
  awareness = { setLocalState: vi.fn(), getStates: vi.fn(() => new Map()) }
  destroyed = false
  lastOpts: unknown

  constructor(public url: string, public room: string, public doc: unknown, opts: unknown) {
    this.lastOpts = opts
  }

  on(event: string, handler: FakeHandler) {
    ;(this.listeners[event] ??= []).push(handler)
  }

  emit(event: string, payload: unknown) {
    ;(this.listeners[event] ?? []).forEach(h => h(payload))
  }

  destroy() { this.destroyed = true }
}

let lastProvider: FakeWebsocketProvider | null = null

vi.mock('y-websocket', () => ({
  WebsocketProvider: vi.fn().mockImplementation((...args: ConstructorParameters<typeof FakeWebsocketProvider>) => {
    lastProvider = new FakeWebsocketProvider(...args)
    return lastProvider
  }),
}))

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}))

import { YjsProvider } from '../collab/YjsProvider'

describe('YjsProvider', () => {
  beforeEach(() => { lastProvider = null })

  it('constructs a Y.Doc and WebsocketProvider with the given document id and token', () => {
    const p = new YjsProvider({ documentId: 'doc1', wsUrl: 'ws://x/ws', token: 'abc' })
    expect(lastProvider).not.toBeNull()
    expect(lastProvider!.url).toBe('ws://x/ws')
    expect(lastProvider!.room).toBe('doc1')
    expect((lastProvider!.lastOpts as { params: { token: string } }).params.token).toBe('abc')
    p.destroy()
  })

  it('starts in "offline" status', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 't', persist: false })
    expect(p.getStatus()).toBe('offline')
    p.destroy()
  })

  it('transitions status on WS status events', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 't', persist: false })
    const statuses: string[] = []
    p.subscribe({ onStatusChange: s => statuses.push(s) })

    lastProvider!.emit('status', { status: 'connecting' })
    lastProvider!.emit('status', { status: 'connected' })
    lastProvider!.emit('status', { status: 'disconnected' })

    // First entry is the immediate 'offline' push on subscribe.
    expect(statuses).toEqual(['offline', 'connecting', 'connected', 'disconnected'])
    expect(p.getStatus()).toBe('disconnected')
    p.destroy()
  })

  it('deduplicates identical status transitions', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 't', persist: false })
    const statuses: string[] = []
    p.subscribe({ onStatusChange: s => statuses.push(s) })

    lastProvider!.emit('status', { status: 'connecting' })
    lastProvider!.emit('status', { status: 'connecting' })

    expect(statuses).toEqual(['offline', 'connecting'])
    p.destroy()
  })

  it('fires onSynced once on first sync:true event', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 't', persist: false })
    const onSynced = vi.fn()
    p.subscribe({ onSynced })

    lastProvider!.emit('sync', true)
    lastProvider!.emit('sync', true) // second should be ignored

    expect(onSynced).toHaveBeenCalledTimes(1)
    expect(p.isSynced()).toBe(true)
    p.destroy()
  })

  it('delivers current state to new subscribers immediately', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 't', persist: false })
    lastProvider!.emit('status', { status: 'connected' })
    lastProvider!.emit('sync', true)

    const onStatusChange = vi.fn()
    const onSynced = vi.fn()
    p.subscribe({ onStatusChange, onSynced })

    expect(onStatusChange).toHaveBeenCalledWith('connected')
    expect(onSynced).toHaveBeenCalled()
    p.destroy()
  })

  it('unsubscribe stops future status callbacks', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 't', persist: false })
    const onStatusChange = vi.fn()
    const unsub = p.subscribe({ onStatusChange })
    onStatusChange.mockClear() // ignore the initial push

    unsub()
    lastProvider!.emit('status', { status: 'connected' })

    expect(onStatusChange).not.toHaveBeenCalled()
    p.destroy()
  })

  it('destroy() tears down the ws provider and is idempotent', () => {
    const p = new YjsProvider({ documentId: 'd', wsUrl: 'ws://x', token: 't', persist: false })
    p.destroy()
    p.destroy() // should not throw
    expect(lastProvider!.destroyed).toBe(true)
  })
})
