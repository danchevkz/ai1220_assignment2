import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock y-websocket + y-indexeddb the same way yjsProvider.test.ts does, so
// constructing a YjsProvider inside the hook doesn't try to open a real WS.
interface FakeHandler { (payload: unknown): void }
class FakeWebsocketProvider {
  listeners: Record<string, FakeHandler[]> = {}
  awareness = { setLocalState: vi.fn(), getStates: vi.fn(() => new Map()) }
  destroyed = false
  constructor(public url: string, public room: string, public doc: unknown, public opts: unknown) {}
  on(event: string, handler: FakeHandler) { (this.listeners[event] ??= []).push(handler) }
  destroy() { this.destroyed = true }
}

vi.mock('y-websocket', () => ({
  WebsocketProvider: vi.fn().mockImplementation((...args: ConstructorParameters<typeof FakeWebsocketProvider>) => {
    return new FakeWebsocketProvider(...args)
  }),
}))

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}))

import { useCollaborativeDoc } from '../hooks/useCollaborativeDoc'
import { setAccessToken } from '../api/client'

describe('useCollaborativeDoc — bootstrap race', () => {
  beforeEach(() => { setAccessToken(null) })
  afterEach(() => { setAccessToken(null) })

  it('returns a null provider when no access token is available at mount', () => {
    const { result } = renderHook(() => useCollaborativeDoc('doc-1'))
    expect(result.current.provider).toBeNull()
  })

  it('materializes the provider once auth:tokenRefreshed fires with a token', () => {
    const { result } = renderHook(() => useCollaborativeDoc('doc-1'))
    expect(result.current.provider).toBeNull()

    act(() => {
      setAccessToken('fresh-token')
      window.dispatchEvent(
        new CustomEvent('auth:tokenRefreshed', { detail: { accessToken: 'fresh-token' } }),
      )
    })

    expect(result.current.provider).not.toBeNull()
  })

  it('does not materialize a provider if the refresh event carries no token', () => {
    const { result } = renderHook(() => useCollaborativeDoc('doc-1'))
    act(() => {
      // Token still absent — event without token is a no-op.
      window.dispatchEvent(new CustomEvent('auth:tokenRefreshed', { detail: {} }))
    })
    expect(result.current.provider).toBeNull()
  })
})
