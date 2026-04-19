import { useCallback, useReducer, useRef } from 'react'
import { aiReducer, initialAIState } from '../ai/aiState'
import { aiApi, streamSuggestion } from '../api/ai'
import { extractError } from '../api/errors'
import { useAuthStore } from '../store/authStore'
import type { AIAction, AIChunkStatus, AIInteractionOutcome } from '../types'

type ReportableOutcome = Exclude<AIInteractionOutcome, 'pending'>

interface Options {
  documentId: string
  documentContext?: () => string | null
}

export function useAISuggestion({ documentId, documentContext }: Options) {
  const [state, dispatch] = useReducer(aiReducer, initialAIState)
  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const userId = useAuthStore(s => s.user?.id)

  const start = useCallback(
    (action: AIAction, sourceText: string) => {
      // Tear down any in-flight request before starting a new one.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      requestIdRef.current = null

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
          onRequestId: id => { requestIdRef.current = id },
        },
        controller.signal,
        userId,
      )
    },
    [documentId, documentContext, userId],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    const id = requestIdRef.current
    dispatch({ type: 'cancel' })
    if (id) {
      void aiApi.cancelGeneration(id).catch(() => { /* best effort */ })
    }
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    requestIdRef.current = null
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

  // Persist the user's accept/reject/partial decision to the backend so
  // AI history reflects what actually happened after the stream ended.
  const reportOutcome = useCallback(
    (outcome: ReportableOutcome, appliedText?: string) => {
      const id = requestIdRef.current ?? state.interactionId
      if (!id) return
      void aiApi
        .recordOutcome(id, { outcome, applied_text: appliedText ?? null })
        .catch(() => { /* best effort */ })
    },
    [state.interactionId],
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
