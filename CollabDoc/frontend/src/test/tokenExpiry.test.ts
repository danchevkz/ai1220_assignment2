import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import axios from 'axios'
import { streamSuggestion } from '../api/ai'
import {
  setAccessToken,
  setRefreshToken,
  getAccessToken,
  getRefreshToken,
  refreshAccessToken,
} from '../api/client'
import type { AIStreamEvent } from '../types'

const encoder = new TextEncoder()

interface BackendChunk {
  request_id: string
  operation: string
  delta: string
  done: boolean
}

function sseFrame(c: BackendChunk): string {
  return `data: ${JSON.stringify(c)}\n\n`
}

function makeStreamResponse(frames: string[], reqId = 'req-1'): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'X-Request-ID': reqId },
  })
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ detail: 'Token expired' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SSE token expiry handling', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
    setAccessToken('stale-access')
    setRefreshToken('valid-refresh')
    global.fetch = vi.fn() as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = realFetch
    setAccessToken(null)
    localStorage.clear()
  })

  it('on 401, refreshes the access token and retries the stream once with the new token', async () => {
    // First fetch (SSE) → 401. Refresh call (axios.post) → new tokens.
    // Second fetch (SSE retry) → success.
    const doneFrames = [
      sseFrame({ request_id: 'r1', operation: 'rewrite', delta: 'ok', done: false }),
      sseFrame({ request_id: 'r1', operation: 'rewrite', delta: '', done: true }),
    ]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorizedResponse())
      .mockResolvedValueOnce(makeStreamResponse(doneFrames, 'r1'))
    global.fetch = fetchMock

    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { access_token: 'fresh-access', refresh_token: 'fresh-refresh' } })

    const events: AIStreamEvent[] = []
    await streamSuggestion(
      'doc-1',
      { action: 'rewrite', source_text: 'x' },
      { onEvent: e => events.push(e) },
    )

    // exactly one refresh
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(postSpy.mock.calls[0][0]).toContain('/auth/refresh')
    // exactly one retry fetch after the initial 401
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Retry used the new token
    const retryInit = fetchMock.mock.calls[1][1] as RequestInit
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer fresh-access')

    // Token state updated in memory + storage
    expect(getAccessToken()).toBe('fresh-access')
    expect(getRefreshToken()).toBe('fresh-refresh')

    // Stream completed normally after retry
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('on refresh failure, clears tokens, dispatches auth:logout, emits an error event, and does not retry again', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(unauthorizedResponse())
    global.fetch = fetchMock
    vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('refresh denied'))

    const logoutSpy = vi.fn()
    window.addEventListener('auth:logout', logoutSpy)

    const events: AIStreamEvent[] = []
    await streamSuggestion(
      'doc-1',
      { action: 'rewrite', source_text: 'x' },
      { onEvent: e => events.push(e) },
    )

    window.removeEventListener('auth:logout', logoutSpy)

    // Exactly one fetch — no retry after failed refresh.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()

    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeDefined()
  })

  it('does not loop on repeated 401 — only one refresh + one retry attempt', async () => {
    // Both SSE calls return 401 (server is still rejecting even after refresh).
    // The handler must NOT keep retrying.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorizedResponse())
      .mockResolvedValueOnce(unauthorizedResponse())
    global.fetch = fetchMock
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { access_token: 'fresh', refresh_token: 'fresh-r' },
    })

    const events: AIStreamEvent[] = []
    await streamSuggestion(
      'doc-1',
      { action: 'rewrite', source_text: 'x' },
      { onEvent: e => events.push(e) },
    )

    // One initial + one retry. No third attempt.
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Second 401 falls through to the normal error path, not another refresh.
    const errorEvent = events.find(e => e.type === 'error') as
      | { type: 'error'; detail: string }
      | undefined
    expect(errorEvent).toBeDefined()
    expect(errorEvent!.detail).toBe('Token expired')
  })
})

describe('refreshAccessToken', () => {
  beforeEach(() => {
    setAccessToken(null)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('dispatches auth:tokenRefreshed with the new access token on success', async () => {
    setRefreshToken('rt')
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { access_token: 'new-at', refresh_token: 'new-rt' },
    })

    const handler = vi.fn()
    window.addEventListener('auth:tokenRefreshed', handler as EventListener)

    const token = await refreshAccessToken()

    window.removeEventListener('auth:tokenRefreshed', handler as EventListener)
    expect(token).toBe('new-at')
    expect(handler).toHaveBeenCalledTimes(1)
    const evt = handler.mock.calls[0][0] as CustomEvent<{ accessToken: string }>
    expect(evt.detail.accessToken).toBe('new-at')
  })

  it('coalesces concurrent callers into a single refresh HTTP call', async () => {
    setRefreshToken('rt')
    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { access_token: 'x', refresh_token: 'y' } })

    const [a, b, c] = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ])
    expect(a).toBe('x')
    expect(b).toBe('x')
    expect(c).toBe('x')
    expect(postSpy).toHaveBeenCalledTimes(1)
  })

  it('throws when no refresh token is stored', async () => {
    await expect(refreshAccessToken()).rejects.toThrow(/No refresh token/)
  })
})
