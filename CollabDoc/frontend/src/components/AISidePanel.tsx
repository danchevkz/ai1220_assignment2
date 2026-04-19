import { useCallback, useEffect, useRef, useState } from 'react'
import { useAISuggestion } from '../hooks/useAISuggestion'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { acceptedText, combinedText, isStreaming, isTerminal } from '../ai/aiState'
import type { AIAction } from '../types'

interface Props {
  documentId: string
  selectionText: string
  documentText: string
  open: boolean
  onClose: () => void
  onApply: (text: string, hasSelection: boolean) => void
  disabled?: boolean
}

const ACTIONS: { value: AIAction; label: string; needsSelection: boolean; hint: string }[] = [
  { value: 'rewrite', label: 'Rewrite', needsSelection: true, hint: 'Improve clarity and tone of the selected text.' },
  { value: 'summarize', label: 'Summarize', needsSelection: false, hint: 'Summarize the selection, or the whole document if nothing is selected.' },
]

export default function AISidePanel({
  documentId,
  selectionText,
  documentText,
  open,
  onClose,
  onApply,
  disabled,
}: Props) {
  const documentContext = useCallback(() => documentText, [documentText])
  const ai = useAISuggestion({ documentId, documentContext })
  const [editingId, setEditingId] = useState<string | null>(null)

  // Keep a ref so the close effect can read streaming state without re-running on every status change.
  const streamingRef = useRef(false)

  // Reset transient panel state whenever the panel closes.
  useEffect(() => {
    if (!open) {
      if (streamingRef.current) {
        ai.cancel()
      } else {
        ai.reset()
      }
      setEditingId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEscapeKey(onClose, open)

  if (!open) return null

  const { state } = ai
  const hasSelection = selectionText.trim().length > 0
  const sourceForRequest = hasSelection ? selectionText : documentText
  const streaming = isStreaming(state.status)
  streamingRef.current = streaming
  const terminal = isTerminal(state.status)
  const anyAccepted = state.chunks.some(c => c.status === 'accepted')
  const allDecided = state.chunks.length > 0 && state.chunks.every(c => c.status === 'accepted' || c.status === 'rejected')

  function handleAction(action: AIAction, needsSelection: boolean) {
    if (needsSelection && !hasSelection) return
    ai.start(action, sourceForRequest)
  }

  function applyAccepted() {
    const text = anyAccepted ? acceptedText(state) : combinedText(state)
    if (!text) return
    onApply(text, hasSelection)
    const notAllAccepted = state.chunks.some(c => c.status !== 'accepted')
    ai.reportOutcome(anyAccepted && notAllAccepted ? 'partial' : 'accepted', text)
    ai.reset()
  }

  function rejectAll() {
    ai.setAllChunksStatus('rejected')
    ai.reportOutcome('rejected')
    ai.reset()
  }

  return (
    <aside className="ai-panel" role="complementary" aria-label="AI assistant">
      <header className="ai-panel-header">
        <h2>AI assistant</h2>
        <button
          type="button"
          className="ai-panel-close"
          onClick={onClose}
          aria-label="Close AI panel"
        >
          ×
        </button>
      </header>

      <section className="ai-panel-section">
        <div className="ai-source">
          <div className="ai-source-label">
            {hasSelection ? 'Selected text' : 'No selection — using whole document'}
          </div>
          <div className="ai-source-preview">
            {hasSelection
              ? truncate(selectionText, 240)
              : truncate(documentText, 240) || <em>(empty document)</em>}
          </div>
        </div>

        <div className="ai-actions">
          {ACTIONS.map(a => {
            const blocked = disabled || streaming || (a.needsSelection && !hasSelection)
            return (
              <button
                key={a.value}
                type="button"
                className="btn btn-secondary"
                disabled={blocked}
                onClick={() => handleAction(a.value, a.needsSelection)}
                title={a.needsSelection && !hasSelection ? 'Select text first' : a.hint}
              >
                {a.label}
              </button>
            )
          })}
          {streaming && (
            <button type="button" className="btn btn-ghost" onClick={ai.cancel}>
              Cancel
            </button>
          )}
        </div>
      </section>

      {state.status === 'error' && state.error && (
        <p className="form-error" role="alert">{state.error}</p>
      )}

      {state.chunks.length > 0 && (
        <section className="ai-panel-section">
          <div className="ai-result-header">
            <span className="ai-result-title">
              {state.action === 'summarize' ? 'Summary' : 'Suggestion'}
              {streaming && <span className="ai-streaming-dot" aria-label="Streaming…" />}
            </span>
            {state.status === 'cancelled' && (
              <span className="ai-tag ai-tag-cancelled">Cancelled</span>
            )}
          </div>

          <ol className="ai-chunks">
            {state.chunks.map(chunk => (
              <li key={chunk.id} className={`ai-chunk ai-chunk-${chunk.status}`}>
                {editingId === chunk.id ? (
                  <textarea
                    className="ai-chunk-edit"
                    aria-label={`Edit chunk ${chunk.id}`}
                    value={chunk.text}
                    onChange={e => ai.editChunk(chunk.id, e.target.value)}
                    rows={Math.min(8, Math.max(2, chunk.text.split('\n').length + 1))}
                  />
                ) : (
                  <p className="ai-chunk-text">{chunk.text}</p>
                )}

                <div className="ai-chunk-actions">
                  {chunk.status === 'accepted' && <span className="ai-tag ai-tag-accepted">Accepted</span>}
                  {chunk.status === 'rejected' && <span className="ai-tag ai-tag-rejected">Rejected</span>}

                  {!streaming && chunk.status !== 'accepted' && (
                    <button
                      type="button"
                      className="ai-chunk-btn ai-chunk-accept"
                      onClick={() => ai.setChunkStatus(chunk.id, 'accepted')}
                      aria-label={`Accept chunk ${chunk.id}`}
                    >
                      Accept
                    </button>
                  )}
                  {!streaming && chunk.status !== 'rejected' && (
                    <button
                      type="button"
                      className="ai-chunk-btn ai-chunk-reject"
                      onClick={() => ai.setChunkStatus(chunk.id, 'rejected')}
                      aria-label={`Reject chunk ${chunk.id}`}
                    >
                      Reject
                    </button>
                  )}
                  {!streaming && (
                    <button
                      type="button"
                      className="ai-chunk-btn"
                      onClick={() => setEditingId(editingId === chunk.id ? null : chunk.id)}
                      aria-label={editingId === chunk.id ? `Done editing chunk ${chunk.id}` : `Edit chunk ${chunk.id}`}
                    >
                      {editingId === chunk.id ? 'Done' : 'Edit'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {terminal && state.status !== 'error' && (
            <div className="ai-final-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={applyAccepted}
                disabled={!state.chunks.length || (allDecided && !anyAccepted)}
              >
                {anyAccepted ? 'Apply selected' : 'Apply all'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={rejectAll}>
                Reject all
              </button>
            </div>
          )}
        </section>
      )}
    </aside>
  )
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}
