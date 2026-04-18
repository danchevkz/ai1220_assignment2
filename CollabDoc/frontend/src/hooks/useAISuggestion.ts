import { useCallback, useReducer, useRef } from 'react'
import {
  aiReducer,
  initialAIState,
  outcomeFromChunks,
} from '../ai/aiState'
import { streamSuggestion } from '../api/ai'
import { extractError } from '../api/errors'
import { useAuthStore } from '../store/authStore'
import type { AIAction, AIChunkStatus } from '../types'

interface Options {
  documentId: string
  documentContext?: () => string | null
}

export function useAISuggestion({ documentId, documentContext }: Options) {
  const [state, dispatch] = useReducer(aiReducer, initialAIState)
  const abortRef = useRef<AbortController | null>(null)
  const userId = useAuthStore(s => s.user?.id)

  const start = useCallback(
    (action: AIAction, sourceText: string) => {
      // Tear down any in-flight request before starting a new one.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      dispatch({ type: 'start', action, sourceText })

      streamSuggestion(
        documentId,
        {
          action,
          source_text: sourceText,
          document_context: documentContext?.() ?? null,
        },
        {
          onEvent: event => dispatch({ type: 'event', event }),
          onError: err => dispatch({ type: 'fail', error: extractError(err, 'AI request failed') }),
        },
        controller.signal,
        userId,
      )
    },
    [documentId, documentContext],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'cancel' })
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'reset' })
  }, [])

  const setChunkStatus = useCallback((chunkId: string, status: AIChunkStatus) => {
    dispatch({ type: 'set_chunk_status', chunkId, status })
  }, [])

  const setAllChunksStatus = useCallback((status: AIChunkStatus) => {
    dispatch({ type: 'set_all_chunks_status', status })
  }, [])

  const editChunk = useCallback((chunkId: string, text: string) => {
    dispatch({ type: 'edit_chunk', chunkId, text })
  }, [])

  // Best-effort outcome reporting — history logging is non-critical.
  // Anel's backend doesn't yet expose a PATCH outcome endpoint so this
  // is a no-op until the endpoint is added. The interactionId is still
  // tracked so we can add it later without changing the UI contract.
  const reportOutcome = useCallback(
    (_appliedText?: string) => {
      void outcomeFromChunks(state.chunks) // keep reference alive
    },
    [state.chunks],
  )

  return {
    state,
    start,
    cancel,
    reset,
    setChunkStatus,
    setAllChunksStatus,
    editChunk,
    reportOutcome,
  }
}
