import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Editor from '../components/Editor/Editor'
import VersionHistory from '../components/VersionHistory'
import { documentsApi } from '../api/documents'
import { extractError } from '../api/errors'
import { useAutoSave } from '../hooks/useAutoSave'
import { useAuthStore } from '../store/authStore'
import type { Document, DocumentRole } from '../types'

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)

  const [doc, setDoc] = useState<Document | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  // A version counter bumped when we reload the doc (e.g. after a restore).
  // Used to remount the editor so Tiptap picks up fresh initial content.
  const [reloadKey, setReloadKey] = useState(0)

  const role: DocumentRole = doc?.collaborators.find(c => c.user_id === user?.id)?.role
    ?? (doc?.owner_id === user?.id ? 'owner' : 'viewer')
  const canEdit = role === 'owner' || role === 'editor'

  // Load document on mount / id change / reload.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    documentsApi
      .get(id)
      .then(data => {
        if (cancelled) return
        setDoc(data)
        setTitle(data.title)
        setContent(data.content)
      })
      .catch(err => {
        if (!cancelled) setLoadError(extractError(err, 'Failed to load document'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [id, reloadKey])

  const save = useCallback(
    async (value: unknown) => {
      if (!id) return
      const payload = value as { title: string; content: string }
      await documentsApi.update(id, payload)
    },
    [id],
  )

  const autoSave = useAutoSave(save, { delay: 1000 })

  // Guard the first trigger — don't auto-save the data we just loaded.
  const loadedOnceRef = useRef(false)
  useEffect(() => {
    if (isLoading || !doc) return
    if (!loadedOnceRef.current) {
      loadedOnceRef.current = true
      return
    }
    if (!canEdit) return
    autoSave.trigger({ title, content })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content])

  // Reset the loaded guard when the doc id changes or we reload.
  useEffect(() => { loadedOnceRef.current = false }, [id, reloadKey])

  // Flush pending saves on tab close.
  useEffect(() => {
    const handler = () => { autoSave.flush() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [autoSave])

  if (isLoading) {
    return <div className="page-loading">Loading document…</div>
  }

  if (loadError || !doc) {
    return (
      <div className="doc-error">
        <p className="form-error">{loadError ?? 'Document not found'}</p>
        <Link to="/">← Back to dashboard</Link>
      </div>
    )
  }

  return (
    <div className="doc-page">
      <div className="doc-page-header">
        <Link to="/" className="doc-back-link">← Back</Link>

        <input
          className="doc-title-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Untitled"
          disabled={!canEdit}
          aria-label="Document title"
        />

        <div className="doc-page-actions">
          <SaveIndicator status={autoSave.status} error={autoSave.error} />
          <span className={`role-badge role-${role}`}>{role}</span>
          <button className="btn btn-ghost" onClick={() => setHistoryOpen(true)}>
            History
          </button>
          {role === 'owner' && (
            <button
              className="btn btn-ghost"
              onClick={async () => {
                if (!confirm('Delete this document?')) return
                await documentsApi.delete(doc.id)
                navigate('/')
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="doc-page-editor">
        <Editor
          key={reloadKey}
          content={content}
          onChange={setContent}
          editable={canEdit}
          placeholder={canEdit ? 'Start writing…' : 'This document is read-only'}
        />
      </div>

      <VersionHistory
        documentId={doc.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        canRestore={canEdit}
        onRestored={() => setReloadKey(k => k + 1)}
      />
    </div>
  )
}

function SaveIndicator({ status, error }: { status: string; error: string | null }) {
  const label =
    status === 'saving' ? 'Saving…' :
    status === 'saved'  ? 'Saved' :
    status === 'error'  ? (error ? `Save failed: ${error}` : 'Save failed') :
    ''
  return (
    <span className={`save-indicator save-indicator-${status}`} aria-live="polite">
      {label}
    </span>
  )
}
