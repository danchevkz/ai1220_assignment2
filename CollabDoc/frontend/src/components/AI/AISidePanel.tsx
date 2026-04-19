import { useEffect, useMemo, useState } from 'react'
import AIHistoryPanel from './AIHistoryPanel'
import { useAIHistory } from '../../hooks/useAIHistory'
import { useAIStream } from '../../hooks/useAIStream'
import type { WritingOperation } from '../../api/ai'

interface Props {
  documentId: string
  userId: string
  selectedText: string
  hasSelection: boolean
  canEdit: boolean
  canUndo: boolean
  onAccept: (text: string) => boolean
  onUndo: () => boolean
}

export default function AISidePanel({
  documentId,
  userId,
  selectedText,
  hasSelection,
  canEdit,
  canUndo,
  onAccept,
  onUndo,
}: Props) {
  const [operation, setOperation] = useState<WritingOperation>('rewrite')
  const [instructions, setInstructions] = useState('')
  const [draftText, setDraftText] = useState('')
  const { streamedText, status, error, requestId, startStream, cancelStream, reset } = useAIStream()
  const { items, loading, error: historyError, reload } = useAIHistory(documentId)

  const isStreaming = status === 'streaming' || status === 'cancelling'
  const hasSuggestion = draftText.trim().length > 0
  const sourceText = selectedText.trim()

  useEffect(() => {
    setDraftText('')
    setInstructions('')
    reset()
  }, [documentId, selectedText, reset])

  useEffect(() => {
    if (status === 'completed') {
      void reload()
    }
  }, [reload, status])

  useEffect(() => {
    if (status === 'streaming' || status === 'completed') {
      setDraftText(streamedText)
    }
  }, [status, streamedText])

  const placeholder = useMemo(() => {
    return operation === 'rewrite'
      ? 'Optional tone or style guidance'
      : 'Optional summary guidance'
  }, [operation])

  async function handleGenerate() {
    if (!sourceText || !canEdit || isStreaming) return

    await startStream({
      operation,
      payload: {
        text: sourceText,
        instructions: instructions.trim() || null,
        context: {
          document_id: documentId,
          user_id: userId,
        },
        ...(operation === 'rewrite'
          ? { preserve_meaning: true }
          : { max_sentences: 3, format: 'paragraph' }),
      },
    })
  }

  function handleReject() {
    setDraftText('')
    setInstructions('')
    reset()
  }

  function handleAccept() {
    if (!hasSuggestion) return
    const applied = onAccept(draftText)
    if (applied) {
      handleReject()
    }
  }

  return (
    <aside className="ai-side-panel" aria-label="AI writing assistant">
      <div className="ai-side-panel-card">
        <div className="ai-side-panel-header">
          <div>
            <h2>AI assistant</h2>
            <p className="ai-side-panel-subtitle">
              Select text in the editor to generate a suggestion.
            </p>
          </div>
          <div className="ai-side-panel-header-actions">
            {canUndo && (
              <button type="button" className="btn btn-ghost ai-undo-btn" onClick={onUndo}>
                Undo last apply
              </button>
            )}
            {requestId && <span className="ai-request-id">Req {requestId.slice(0, 8)}</span>}
          </div>
        </div>

        <div className="ai-selection-preview">
          <div className="ai-section-title-row">
            <h3>Selected text</h3>
            <span className={`role-badge ${hasSelection ? 'role-editor' : 'role-viewer'}`}>
              {hasSelection ? 'ready' : 'select text'}
            </span>
          </div>
          <p className={`ai-selection-text ${hasSelection ? '' : 'ai-selection-text-empty'}`}>
            {hasSelection ? selectedText : 'Highlight a passage in the document to enable AI actions.'}
          </p>
        </div>

        <div className="ai-control-group">
          <label className="form-group">
            <span>Action</span>
            <select
              className="ai-select"
              value={operation}
              onChange={e => setOperation(e.target.value as WritingOperation)}
              disabled={!hasSelection || isStreaming}
            >
              <option value="rewrite">Rewrite</option>
              <option value="summarize">Summarize</option>
            </select>
          </label>

          <label className="form-group">
            <span>Instructions</span>
            <textarea
              className="ai-textarea"
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder={placeholder}
              disabled={!hasSelection || isStreaming}
              rows={3}
            />
          </label>

          <div className="ai-action-row">
            <button
              type="button"
              className="btn btn-primary ai-generate-btn"
              onClick={() => { void handleGenerate() }}
              disabled={!hasSelection || !canEdit || isStreaming}
            >
              {isStreaming ? 'Generating…' : operation === 'rewrite' ? 'Rewrite selection' : 'Summarize selection'}
            </button>
            {isStreaming && (
              <button type="button" className="btn btn-ghost" onClick={() => { void cancelStream() }}>
                Cancel
              </button>
            )}
          </div>
        </div>

        {(error || hasSuggestion || isStreaming) && (
          <div className="ai-suggestion-panel">
            <div className="ai-section-title-row">
              <h3>Suggestion</h3>
              <span className={`role-badge ai-status-badge ai-status-${status}`}>{status}</span>
            </div>

            {error && <p className="form-error">{error}</p>}

            <textarea
              className="ai-suggestion-editor"
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              placeholder="AI output will appear here."
              disabled={isStreaming}
              rows={10}
            />

            <div className="ai-action-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAccept}
                disabled={!hasSuggestion || isStreaming || !canEdit}
              >
                Accept
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleReject}
                disabled={isStreaming || (!hasSuggestion && status === 'idle')}
              >
                Reject
              </button>
              <span className="ai-edit-hint">Edit suggestion before accepting</span>
            </div>
          </div>
        )}

        <AIHistoryPanel
          items={items}
          loading={loading}
          error={historyError}
          onReload={() => { void reload() }}
        />
      </div>
    </aside>
  )
}
