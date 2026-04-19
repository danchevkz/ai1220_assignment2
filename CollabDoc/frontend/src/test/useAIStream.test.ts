import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAIStream } from '../hooks/useAIStream'

const cancelGenerationMock = vi.fn()
const getAccessTokenMock = vi.fn(() => 'token-123')

vi.mock('../api/client', () => ({
  BASE_URL: '/api/v1',
  getAccessToken: () => getAccessTokenMock(),
}))

vi.mock('../api/ai', () => ({
  aiApi: {
    cancelGeneration: (...args: unknown[]) => cancelGenerationMock(...args),
  },
}))

describe('useAIStream', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    cancelGenerationMock.mockReset()
    getAccessTokenMock.mockReset()
    getAccessTokenMock.mockReturnValue('token-123')
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('accumulates streamed chunks progressively', async () => {
    const stream = createControlledSseResponse([
      'data: {"request_id":"req-1","operation":"rewrite","delta":"Hello ","done":false}\n\n',
      'data: {"request_id":"req-1","operation":"rewrite","delta":"world","done":true}\n\n',
    ])

    mockFetchWithStream(stream)

    const { result } = renderHook(() => useAIStream())

    let run!: Promise<void>
    act(() => {
      run = result.current.startStream({
        operation: 'rewrite',
        payload: {
          text: 'Original',
          context: { user_id: 'user-1' },
        },
      })
    })

    await act(async () => {
      stream.pushNext()
      await Promise.resolve()
    })

    expect(result.current.streamedText).toBe('Hello ')
    expect(result.current.status).toBe('streaming')
    expect(result.current.requestId).toBe('req-1')

    await act(async () => {
      stream.pushNext()
      stream.close()
      await run
    })

    expect(result.current.streamedText).toBe('Hello world')
    expect(result.current.status).toBe('completed')
  })

  it('cancelStream aborts the in-flight request and updates status correctly', async () => {
    cancelGenerationMock.mockResolvedValue({ cancelled: true })
    const stream = createControlledSseResponse([], 'req-cancel')
    mockFetchWithStream(stream)

    const { result } = renderHook(() => useAIStream())

    let run!: Promise<void>
    act(() => {
      run = result.current.startStream({
        operation: 'summarize',
        payload: {
          text: 'Original',
          context: { user_id: 'user-1' },
        },
      })
    })

    await waitFor(() => expect(result.current.requestId).toBe('req-cancel'))

    await act(async () => {
      await result.current.cancelStream()
      await run
    })

    expect(stream.abortSpy).toHaveBeenCalled()
    expect(cancelGenerationMock).toHaveBeenCalledWith('req-cancel')
    expect(result.current.status).toBe('cancelled')
  })
})

function createControlledSseResponse(events: string[], requestId = 'req-1') {
  const encoder = new TextEncoder()
  const queue = [...events]
  let pending:
    | {
        resolve: (value: ReadableStreamReadResult<Uint8Array>) => void
        reject: (reason?: unknown) => void
      }
    | null = null
  const abortSpy = vi.fn()

  const reader = {
    read: vi.fn(
      () =>
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
          pending = { resolve, reject }
        }),
    ),
  }

  const response = {
    ok: true,
    headers: new Headers({ 'X-Request-ID': requestId }),
    body: {
      getReader() {
        return reader
      },
    },
  }

  return {
    response,
    abortSpy,
    pushNext() {
      if (!pending) return
      const next = queue.shift()
      if (!next) return
      const current = pending
      pending = null
      current.resolve({ done: false, value: encoder.encode(next) })
    },
    close() {
      if (!pending) return
      const current = pending
      pending = null
      current.resolve({ done: true, value: undefined })
    },
    attachSignal(signal: AbortSignal) {
      signal.addEventListener('abort', () => {
        abortSpy()
        if (!pending) return
        const current = pending
        pending = null
        current.reject(new DOMException('Aborted', 'AbortError'))
      })
    },
  }
}

function mockFetchWithStream(stream: ReturnType<typeof createControlledSseResponse>) {
  global.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) {
      stream.attachSignal(init.signal)
    }
    return Promise.resolve(stream.response as Response)
  }) as typeof fetch
}
