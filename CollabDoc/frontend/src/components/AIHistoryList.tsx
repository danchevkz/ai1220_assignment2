import { useEffect, useState } from 'react'
import { aiApi } from '../api/ai'
import type { AIHistoryItem } from '../api/ai'
import { extractError } from '../api/errors'
import { useAuthStore } from '../store/authStore'

interface Props {
  documentId: string
  // Bumped by the parent after a new interaction is recorded so we refetch.
  refreshKey?: number
}

export default function AIHistoryList({ documentId, refreshKey = 0 }: Props) {
  const userId = useAuthStore(s => s.user?.id)
  const [items, setItems] = useState<AIHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    aiApi
      .listHistory(documentId, userId)
      .then(data => { if (!cancelled) setItems(data) })
      .catch(err => { if (!cancelled) setError(extractError(err, 'Failed to load history')) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [documentId, userId, refreshKey])

  if (isLoading) return <p className="ai-history-empty">Loading history…</p>
  if (error) return <p className="form-error" role="alert">{error}</p>
  if (items.length === 0) return <p className="ai-history-empty">No AI interactions yet.</p>

  return (
    <ul className="ai-history">
      {items.map((item, idx) => (
        <li key={idx} className="ai-history-item">
          <div className="ai-history-row">
            <span className="ai-history-action">{item.operation}</span>
            <span className={`ai-tag ai-tag-${item.status}`}>{item.status}</span>
            <span className="ai-history-date">{formatDate(item.timestamp)}</span>
          </div>
          <p className="ai-history-source">
            Input: {item.input_text_length} chars → Output: {item.output_text_length} chars
          </p>
        </li>
      ))}
    </ul>
  )
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString() } catch { return iso }
}
