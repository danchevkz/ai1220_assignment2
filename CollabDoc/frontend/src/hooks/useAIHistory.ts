import { useCallback, useEffect, useState } from 'react'
import { aiApi, type AIInteractionHistoryItem } from '../api/ai'
import { extractError } from '../api/errors'

interface Result {
  items: AIInteractionHistoryItem[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

export function useAIHistory(documentId: string | undefined): Result {
  const [items, setItems] = useState<AIInteractionHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!documentId) {
      setItems([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await aiApi.history(documentId)
      setItems(data)
    } catch (err: unknown) {
      setError(extractError(err, 'Failed to load AI history'))
    } finally {
      setLoading(false)
    }
  }, [documentId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { items, loading, error, reload }
}
