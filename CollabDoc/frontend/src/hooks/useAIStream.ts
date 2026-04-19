import { useCallback, useRef, useState } from 'react'
import { BASE_URL, getAccessToken } from '../api/client'
import { aiApi, type WritingOperation } from '../api/ai'
import { extractError } from '../api/errors'

export type AIStreamStatus =
  | 'idle'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled'

interface AIRequestContext {
  document_id?: string | null
  user_id: string
  session_id?: string | null
  metadata?: Record<string, unknown>
}

interface BaseWritingRequest {
  text: string
  instructions?: string | null
  context: AIRequestContext
}

interface RewriteRequest extends BaseWritingRequest {
  tone?: string | null
  preserve_meaning?: boolean
}

interface SummarizeRequest extends BaseWritingRequest {
  max_sentences?: number
  format?: string
}

type AIStreamRequest = RewriteRequest | SummarizeRequest

interface StreamChunk {
  request_id: string
  operation: WritingOperation
  delta: string
  done: boolean
}

interface StartStreamArgs {
  operation: WritingOperation
  payload: AIStreamRequest
}

interface Result {
  streamedText: string
  status: AIStreamStatus
  error: string | null
  requestId: string | null
  startStream: (args: StartStreamArgs) => Promise<void>
  cancelStream: () => Promise<void>
  reset: () => void
}

export function useAIStream(): Result {
  const [streamedText, setStreamedText] = useState('')
  const [status, setStatus] = useState<AIStreamStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef<string | null>(null)

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    requestIdRef.current = null
    setStreamedText('')
    setStatus('idle')
    setError(null)
    setRequestId(null)
  }, [])

  const cancelStream = useCallback(async () => {
    const activeRequestId = requestIdRef.current
    setStatus('cancelling')
    controllerRef.current?.abort()
    controllerRef.current = null

    if (!activeRequestId) {
      setStatus('cancelled')
      return
    }

    try {
      await aiApi.cancelGeneration(activeRequestId)
      setStatus('cancelled')
    } catch (err: unknown) {
      setError(extractError(err, 'Failed to cancel AI generation'))
      setStatus('failed')
    }
  }, [])

  const startStream = useCallback(async ({ operation, payload }: StartStreamArgs) => {
    controllerRef.current?.abort()

    const token = getAccessToken()
    if (!token) {
      setError('Authentication required')
      setStatus('failed')
      return
    }

    const controller = new AbortController()
    controllerRef.current = controller
    requestIdRef.current = null
    setStreamedText('')
    setError(null)
    setRequestId(null)
    setStatus('streaming')

    try {
      const response = await fetch(`${BASE_URL}/ai/${operation}/stream`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || `AI ${operation} request failed`)
      }

      const nextRequestId = response.headers.get('X-Request-ID')
      requestIdRef.current = nextRequestId
      setRequestId(nextRequestId)

      if (!response.body) {
        throw new Error('Streaming response body is unavailable')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          applyStreamChunk(event, {
            appendText: delta => setStreamedText(prev => prev + delta),
            setRequestId: nextId => {
              requestIdRef.current = nextId
              setRequestId(nextId)
            },
            markCompleted: () => {
              controllerRef.current = null
              setStatus('completed')
            },
          })
        }
      }

      const trailing = decoder.decode()
      if (trailing) {
        buffer += trailing
      }

      if (buffer.trim()) {
        applyStreamChunk(buffer, {
          appendText: delta => setStreamedText(prev => prev + delta),
          setRequestId: nextId => {
            requestIdRef.current = nextId
            setRequestId(nextId)
          },
          markCompleted: () => setStatus('completed'),
        })
      }

      if (!controller.signal.aborted) {
        setStatus(current => (current === 'streaming' ? 'completed' : current))
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        setStatus(current => (current === 'cancelling' ? current : 'cancelled'))
        return
      }

      setError(extractError(err, `Failed to stream AI ${operation}`))
      setStatus('failed')
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [])

  return {
    streamedText,
    status,
    error,
    requestId,
    startStream,
    cancelStream,
    reset,
  }
}

interface StreamChunkHandlers {
  appendText: (delta: string) => void
  setRequestId: (requestId: string) => void
  markCompleted: () => void
}

function applyStreamChunk(event: string, handlers: StreamChunkHandlers) {
  const data = parseSseData(event)
  if (!data) return

  const chunk = JSON.parse(data) as StreamChunk
  handlers.setRequestId(chunk.request_id)
  handlers.appendText(chunk.delta)

  if (chunk.done) {
    handlers.markCompleted()
  }
}

function parseSseData(event: string): string | null {
  const lines = event
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('data:'))

  if (lines.length === 0) return null

  return lines
    .map(line => line.slice(5).trim())
    .join('\n')
}
