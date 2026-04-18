import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { streamSuggestion } from '../api/ai'
import type { AIStreamEvent } from '../types'

// Anel's backend SSE wire format (backend StreamChunk schema).
interface BackendChunk {
  request_id: string
  operation: string
  delta: string
  done: boolean
}

const encoder = new TextEncoder()

function sseFrame(chunk: BackendChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
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
    headers: {
      'Content-Type': 'text/event-stream',
      'X-Request-ID': reqId,
    },
  })
}

describe('streamSuggestion (SSE consumer — Anel wire format)', () => {
  const realFetch = global.fetch

  beforeEach(() => { global.fetch = vi.fn() as unknown as typeof fetch })
  afterEach(() => { global.fetch = realFetch })

  it('translates delta frames into chunk events and emits done on completion', async () => {
    const frames = [
      sseFrame({ request_id: 'r1', operation: 'rewrite', delta: 'Hello', done: false }),
      sseFrame({ request_id: 'r1', operation: 'rewrite', delta: ' world', done: false }),
      sseFrame({ request_id: 'r1', operation: 'rewrite', delta: '', done: true }),
    ]
    global.fetch = vi.fn().mockResolvedValueOnce(makeStreamResponse(frames, 'r1'))

    const events: AIStreamEvent[] = []
    await streamSuggestion(
      'doc-1',
      { action: 'rewrite', source_text: 'x' },
      { onEvent: e => events.push(e) },
    )

    // Delta frames → chunk events accumulating text into one chunk (id = r1).
    const chunkEvents = events.filter(e => e.type === 'chunk') as Array<{ type: 'chunk'; id: string; text: string }>
    expect(chunkEvents[0]).toEqual({ type: 'chunk', id: 'r1', text: 'Hello' })
    expect(chunkEvents[1]).toEqual({ type: 'chunk', id: 'r1', text: ' world' })

    // done: true → replace_chunks splits accumulated text, then emits done
    const replaceEvent = events.find(e => e.type === 'replace_chunks') as
      | { type: 'replace_chunks'; chunks: Array<{ id: string; text: string }> }
      | undefined
    expect(replaceEvent).toBeDefined()
    expect(replaceEvent!.chunks[0].text).toBe('Hello world')

    const doneEvent = events.find(e => e.type === 'done') as { type: 'done'; interaction_id: string } | undefined
    expect(doneEvent).toBeDefined()
    expect(doneEvent!.interaction_id).toBe('r1')
  })

  it('splits multi-paragraph text into separate chunks on done', async () => {
    const frames = [
      sseFrame({ request_id: 'r2', operation: 'rewrite', delta: 'Para one.\n\nPara two.', done: false }),
      sseFrame({ request_id: 'r2', operation: 'rewrite', delta: '', done: true }),
    ]
    global.fetch = vi.fn().mockResolvedValueOnce(makeStreamResponse(frames, 'r2'))

    const events: AIStreamEvent[] = []
    await streamSuggestion(
      'doc-1',
      { action: 'rewrite', source_text: 'x' },
      { onEvent: e => events.push(e) },
    )

    const replaceEvent = events.find(e => e.type === 'replace_chunks') as
      | { type: 'replace_chunks'; chunks: Array<{ id: string; text: string }> }
      | undefined
    expect(replaceEvent!.chunks).toHaveLength(2)
    expect(replaceEvent!.chunks[0]).toEqual({ id: 'c0', text: 'Para one.' })
    expect(replaceEvent!.chunks[1]).toEqual({ id: 'c1', text: 'Para two.' })
  })

  it('handles frames split across reads', async () => {
    const full = sseFrame({ request_id: 'r3', operation: 'rewrite', delta: 'split', done: false }) +
      sseFrame({ request_id: 'r3', operation: 'rewrite', delta: '', done: true })
    const mid = Math.floor(full.length / 2)
    const frames = [full.slice(0, mid), full.slice(mid)]
    global.fetch = vi.fn().mockResolvedValueOnce(makeStreamResponse(frames, 'r3'))

    const events: AIStreamEvent[] = []
    await streamSuggestion(
      'doc-1',
      { action: 'rewrite', source_text: 'x' },
      { onEvent: e => events.push(e) },
    )

    expect(events.some(e => e.type === 'chunk')).toBe(true)
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('emits an error event when the response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Quota exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const events: AIStreamEvent[] = []
    await streamSuggestion(
      'doc-1',
      { action: 'rewrite', source_text: 'x' },
      { onEvent: e => events.push(e) },
    )

    expect(events).toEqual([{ type: 'error', detail: 'Quota exceeded' }])
  })

  it('aborts cleanly and does not surface an error when fetch throws AbortError', async () => {
    const controller = new AbortController()
    const onError = vi.fn()

    // Simulate the browser aborting an in-flight fetch — the promise rejects
    // with an AbortError when the signal fires.
    global.fetch = vi.fn().mockImplementationOnce((_url, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => {
          const err = new Error('The user aborted a request.')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })

    const events: AIStreamEvent[] = []
    const promise = streamSuggestion(
      'doc-1',
      { action: 'rewrite', source_text: 'x' },
      { onEvent: e => events.push(e), onError },
      controller.signal,
    )

    controller.abort()
    await promise

    // AbortError must be swallowed — no error event, no onError call.
    expect(onError).not.toHaveBeenCalled()
    expect(events.filter(e => e.type === 'error')).toHaveLength(0)
  })

  it('passes Authorization header when access token is set', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(makeStreamResponse([], 'r5'))
    global.fetch = fetchSpy
    const { setAccessToken } = await import('../api/client')
    setAccessToken('tok-xyz')

    await streamSuggestion(
      'doc-1',
      { action: 'rewrite', source_text: 'x' },
      { onEvent: () => {} },
    )

    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-xyz')
    setAccessToken(null)
  })
})
