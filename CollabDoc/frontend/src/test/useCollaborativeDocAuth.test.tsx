import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

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

import { useCollaborativeDoc } from '../hooks/useCollaborativeDoc'
import { setAccessToken } from '../api/client'

describe('useCollaborativeDoc auth-event wiring', () => {
  beforeEach(() => {
    createdProviders.length = 0
    setAccessToken('initial-token')
  })

  afterEach(() => {
    setAccessToken(null)
  })

  it('rebuilds the WS connection with the fresh token on auth:tokenRefreshed', () => {
    const { unmount } = renderHook(() => useCollaborativeDoc('doc-1'))
    expect(createdProviders).toHaveLength(1)
    expect((createdProviders[0].lastOpts as { params: { token: string } }).params.token).toBe('initial-token')

    act(() => {
      window.dispatchEvent(
        new CustomEvent('auth:tokenRefreshed', { detail: { accessToken: 'rotated-token' } }),
      )
    })

    expect(createdProviders).toHaveLength(2)
    expect(createdProviders[0].destroyed).toBe(true)
    expect((createdProviders[1].lastOpts as { params: { token: string } }).params.token).toBe('rotated-token')
    unmount()
  })

  it('tears down the provider on auth:logout', () => {
    const { unmount } = renderHook(() => useCollaborativeDoc('doc-1'))
    expect(createdProviders).toHaveLength(1)

    act(() => { window.dispatchEvent(new Event('auth:logout')) })

    expect(createdProviders[0].destroyed).toBe(true)
    unmount()
  })

  it('unsubscribes from auth events on unmount', () => {
    const { unmount } = renderHook(() => useCollaborativeDoc('doc-1'))
    expect(createdProviders).toHaveLength(1)
    unmount()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('auth:tokenRefreshed', { detail: { accessToken: 'x' } }),
      )
    })

    // No new provider was built after unmount.
    expect(createdProviders).toHaveLength(1)
  })
})
