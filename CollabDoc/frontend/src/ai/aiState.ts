import type {
  AIAction,
  AIChunk,
  AIStatus,
  AIStreamEvent,
  AISuggestionState,
} from '../types'

export const initialAIState: AISuggestionState = {
  action: null,
  sourceText: '',
  chunks: [],
  status: 'idle',
  error: null,
  interactionId: null,
}

export type AIAction_Reducer =
  | { type: 'start'; action: AIAction; sourceText: string }
  | { type: 'event'; event: AIStreamEvent }
  | { type: 'cancel' }
  | { type: 'fail'; error: string }
  | { type: 'reset' }
  | { type: 'set_chunk_status'; chunkId: string; status: AIChunk['status'] }
  | { type: 'set_all_chunks_status'; status: AIChunk['status'] }
  | { type: 'edit_chunk'; chunkId: string; text: string }

export function aiReducer(
  state: AISuggestionState,
  action: AIAction_Reducer,
): AISuggestionState {
  switch (action.type) {
    case 'start':
      return {
        action: action.action,
        sourceText: action.sourceText,
        chunks: [],
        status: 'streaming',
        error: null,
        interactionId: null,
      }

    case 'event':
      return applyEvent(state, action.event)

    case 'cancel':
      if (state.status !== 'streaming') return state
      return {
        ...state,
        status: 'cancelled',
        chunks: state.chunks.map(c =>
          c.status === 'streaming' ? { ...c, status: 'complete' } : c,
        ),
      }

    case 'fail':
      return { ...state, status: 'error', error: action.error }

    case 'reset':
      return initialAIState

    case 'set_chunk_status':
      return {
        ...state,
        chunks: state.chunks.map(c =>
          c.id === action.chunkId ? { ...c, status: action.status } : c,
        ),
      }

    case 'set_all_chunks_status':
      return {
        ...state,
        chunks: state.chunks.map(c =>
          c.status === 'accepted' || c.status === 'rejected'
            ? c
            : { ...c, status: action.status },
        ),
      }

    case 'edit_chunk':
      return {
        ...state,
        chunks: state.chunks.map(c =>
          c.id === action.chunkId ? { ...c, text: action.text } : c,
        ),
      }

    default:
      return state
  }
}

function applyEvent(
  state: AISuggestionState,
  event: AIStreamEvent,
): AISuggestionState {
  switch (event.type) {
    case 'chunk': {
      const existing = state.chunks.find(c => c.id === event.id)
      if (existing) {
        return {
          ...state,
          chunks: state.chunks.map(c =>
            c.id === event.id ? { ...c, text: c.text + event.text } : c,
          ),
        }
      }
      return {
        ...state,
        chunks: [
          ...state.chunks,
          { id: event.id, text: event.text, status: 'streaming' },
        ],
      }
    }

    case 'chunk_end':
      return {
        ...state,
        chunks: state.chunks.map(c =>
          c.id === event.id && c.status === 'streaming'
            ? { ...c, status: 'complete' }
            : c,
        ),
      }

    case 'done':
      return {
        ...state,
        status: 'done',
        interactionId: event.interaction_id,
        chunks: state.chunks.map(c =>
          c.status === 'streaming' ? { ...c, status: 'complete' } : c,
        ),
      }

    case 'error':
      return { ...state, status: 'error', error: event.detail }

    case 'replace_chunks':
      // Replaces the single streaming accumulator with paragraph-split chunks.
      return {
        ...state,
        chunks: event.chunks.map(c => ({ ...c, status: 'complete' as const })),
      }

    default:
      return state
  }
}

// Helpers used by the panel UI / hook callers.

export function combinedText(state: AISuggestionState): string {
  return state.chunks.map(c => c.text).join('\n\n')
}

export function acceptedText(state: AISuggestionState): string {
  return state.chunks
    .filter(c => c.status === 'accepted')
    .map(c => c.text)
    .join('\n\n')
}

export function isStreaming(status: AIStatus): boolean {
  return status === 'streaming'
}

export function isTerminal(status: AIStatus): boolean {
  return status === 'done' || status === 'cancelled' || status === 'error'
}

export function outcomeFromChunks(
  chunks: AIChunk[],
): 'accepted' | 'rejected' | 'partial' | 'pending' {
  if (chunks.length === 0) return 'pending'
  const accepted = chunks.filter(c => c.status === 'accepted').length
  const rejected = chunks.filter(c => c.status === 'rejected').length
  if (accepted === chunks.length) return 'accepted'
  if (rejected === chunks.length) return 'rejected'
  if (accepted === 0 && rejected === 0) return 'pending'
  return 'partial'
}
