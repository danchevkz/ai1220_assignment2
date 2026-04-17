import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { documentsApi } from '../api/documents'
import { extractError } from '../api/errors'
import type { DocumentSummary } from '../types'

export default function Dashboard() {
  const [docs, setDocs] = useState<DocumentSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    documentsApi
      .list()
      .then(data => {
        if (!cancelled) setDocs(data)
      })
      .catch(err => {
        if (!cancelled) setError(extractError(err, 'Failed to load documents'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate() {
    setIsCreating(true)
    try {
      const doc = await documentsApi.create({ title: 'Untitled' })
      navigate(`/documents/${doc.id}`)
    } catch (err) {
      setError(extractError(err, 'Failed to create document'))
      setIsCreating(false)
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Delete this document? This cannot be undone.')) return
    try {
      await documentsApi.delete(id)
      setDocs(prev => prev.filter(d => d.id !== id))
    } catch (err) {
      setError(extractError(err, 'Failed to delete document'))
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Your documents</h1>
        <button
          className="btn btn-primary dashboard-create"
          onClick={handleCreate}
          disabled={isCreating}
        >
          {isCreating ? 'Creating…' : 'New document'}
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {isLoading && <p className="page-loading">Loading…</p>}

      {!isLoading && docs.length === 0 && !error && (
        <div className="empty-state">
          <p>No documents yet. Create your first one to get started.</p>
        </div>
      )}

      {!isLoading && docs.length > 0 && (
        <ul className="doc-list">
          {docs.map(doc => (
            <li key={doc.id} className="doc-card">
              <Link to={`/documents/${doc.id}`} className="doc-card-link">
                <div className="doc-card-title">{doc.title || 'Untitled'}</div>
                <div className="doc-card-meta">
                  <span className={`role-badge role-${doc.role}`}>{doc.role}</span>
                  <span className="doc-card-date">
                    Updated {formatDate(doc.updated_at)}
                  </span>
                </div>
              </Link>
              {doc.role === 'owner' && (
                <button
                  className="doc-card-delete"
                  onClick={e => handleDelete(doc.id, e)}
                  aria-label={`Delete ${doc.title}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

