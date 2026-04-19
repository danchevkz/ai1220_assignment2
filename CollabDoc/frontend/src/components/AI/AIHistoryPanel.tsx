import type { AIInteractionHistoryItem } from '../../api/ai'

interface Props {
  items: AIInteractionHistoryItem[]
  loading: boolean
  error: string | null
  onReload: () => void
}

export default function AIHistoryPanel({ items, loading, error, onReload }: Props) {
  return (
    <section className="ai-history-panel">
      <div className="ai-history-header">
        <h3>AI history</h3>
        <button className="btn btn-ghost ai-history-reload" onClick={onReload} type="button">
          Refresh
        </button>
      </div>

      {loading && <p className="ai-history-empty">Loading history…</p>}
      {!loading && error && <p className="form-error">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="ai-history-empty">No AI actions for this document yet.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="ai-history-list">
          {items.map((item, index) => (
            <li key={`${item.timestamp}-${item.operation}-${index}`} className="ai-history-item">
              <div className="ai-history-item-main">
                <span className="ai-history-operation">{capitalize(item.operation)}</span>
                <span className={`role-badge ai-history-status ai-history-status-${item.status}`}>
                  {item.status}
                </span>
              </div>
              <div className="ai-history-item-meta">
                <span>{formatDate(item.timestamp)}</span>
                <span>In {item.input_text_length} chars</span>
                <span>Out {item.output_text_length} chars</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}
