import { getAccessToken } from './client'
import { apiClient } from './client'
import type { AIAction, AIInteractionOutcome, AIStreamEvent } from '../types'

const BASE_URL = '/api/v1'

export interface AISuggestRequest {
  action: AIAction
  source_text: string
  document_context?: string | null
}

export interface RecordOutcomeRequest {
  outcome: AIInteractionOutcome
  applied_text?: string | null
}

// Shape returned by GET /ai/history/:documentId
export interface AIHistoryItem {
  operation: 'rewrite' | 'summarize'
  timestamp: string
  status: 'pending' | 'completed' | 'failed' | 'cancelled'
  input_text_length: number
  output_text_length: number
}

export interface StreamHandlers {
  onEvent: (event: AIStreamEvent) => void
  onError?: (err: Error) => void
}

// Anel's SSE wire format (translated from backend StreamChunk schema).
interface BackendStreamChunk {
  request_id: string
  operation: string
  delta: string
  done: boolean
}

// Consumes Anel's SSE stream and translates it into our internal AIStreamEvent
// format. Paragraph-splits the completed text so the partial-accept UI (bonus
// #4) gets stable per-paragraph chunk IDs even though the backend streams at
// word granularity.
export async function streamSuggestion(
  documentId: string,
  request: AISuggestRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  userId?: string,
): Promise<void> {
  const token = getAccessToken()
  const uid = userId ?? 'anonymous'

  const endpoint =
    request.action === 'rewrite' ? '/ai/rewrite/stream' : '/ai/summarize/stream'

  const body =
    request.action === 'rewrite'
      ? {
          text: request.source_text,
          context: { user_id: uid, document_id: documentId },
        }
      : {
          text: request.source_text,
          context: { user_id: uid, document_id: documentId },
          max_sentences: 3,
          format: 'paragraph',
        }

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    handlers.onError?.(err as Error)
    return
  }

  if (!response.ok || !response.body) {
    let detail = `AI request failed (${response.status})`
    try {
      const b = await response.json()
      if (b?.detail) detail = b.detail
    } catch {
      // keep default
    }
    handlers.onEvent({ type: 'error', detail })
    return
  }

  // Read request_id from header so we have it before the first chunk fires.
  const requestId = response.headers.get('X-Request-ID') ?? 'r0'

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const chunk = parseFrame(frame)
        if (!chunk) continue

        if (!chunk.done) {
          // Stream text into a single accumulator chunk while generating.
          accumulated += chunk.delta
          handlers.onEvent({
            type: 'chunk',
            id: requestId,
            text: chunk.delta,
          })
        } else {
          // Generation complete. Re-split the accumulated text into paragraphs
          // so the partial-accept UI has stable, per-paragraph chunk IDs.
          // Discard the single accumulator chunk and replace with paragraph chunks.
          handlers.onEvent({ type: 'replace_chunks', chunks: splitParagraphs(accumulated, requestId) } as unknown as AIStreamEvent)
          handlers.onEvent({ type: 'done', interaction_id: chunk.request_id })
        }
      }
    }

    if (buffer.trim()) {
      const chunk = parseFrame(buffer)
      if (chunk?.done) {
        handlers.onEvent({ type: 'replace_chunks', chunks: splitParagraphs(accumulated, requestId) } as unknown as AIStreamEvent)
        handlers.onEvent({ type: 'done', interaction_id: chunk.request_id })
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    handlers.onError?.(err as Error)
  } finally {
    try { reader.releaseLock() } catch { /* noop */ }
  }
}

function parseFrame(frame: string): BackendStreamChunk | null {
  const dataLines = frame
    .split('\n')
    .filter(l => l.startsWith('data:'))
    .map(l => l.slice(5).trimStart())
  if (!dataLines.length) return null
  try {
    return JSON.parse(dataLines.join('\n')) as BackendStreamChunk
  } catch {
    return null
  }
}

// Split the fully-accumulated text into paragraph-level chunks.
// Each paragraph becomes one AIChunk with a stable id (c0, c1, ...).
function splitParagraphs(text: string, _requestId: string): Array<{ id: string; text: string }> {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return [{ id: 'c0', text: text.trim() }]
  return paragraphs.map((p, i) => ({ id: `c${i}`, text: p }))
}

export const aiApi = {
  listHistory: (documentId: string, userId: string) =>
    apiClient
      .get<AIHistoryItem[]>(`/ai/history/${documentId}`, { params: { user_id: userId } })
      .then(r => r.data),

  cancelGeneration: (requestId: string) =>
    apiClient
      .post<void>(`/ai/generations/${requestId}/cancel`)
      .then(r => r.data),
}
