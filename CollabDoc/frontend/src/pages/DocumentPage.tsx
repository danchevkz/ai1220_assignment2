import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AISidePanel from '../components/AI/AISidePanel'
import Editor from '../components/Editor/Editor'
import type {
  EditorSelectionState,
  ReplaceSelectionText,
} from '../components/Editor/Editor'
import VersionHistory from '../components/VersionHistory'
import ShareModal from '../components/ShareModal'
import ConnectionStatus from '../components/ConnectionStatus'
import PresenceStack from '../components/PresenceStack'
import TypingIndicator from '../components/TypingIndicator'
import { documentsApi } from '../api/documents'
import { extractError } from '../api/errors'
import { useAutoSave } from '../hooks/useAutoSave'
import { useCollaborativeDoc } from '../hooks/useCollaborativeDoc'
import { useAwareness } from '../hooks/useAwareness'
import { useAuthStore } from '../store/authStore'
import { identityFor } from '../collab/identity'
import type { Document, DocumentRole } from '../types'

interface LastAIApply {
  from: number
  previousText: string
  appliedText: string
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)

  const [doc, setDoc] = useState<Document | null>(null)
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [selection, setSelection] = useState<EditorSelectionState>({
    text: '',
    hasSelection: false,
    from: 0,
    to: 0,
  })
  const [lastAIApply, setLastAIApply] = useState<LastAIApply | null>(null)

  // Bumped after restore to force a full Y.Doc rebuild from the server.
  const [reloadKey, setReloadKey] = useState(0)
  const replaceSelectionRef = useRef<ReplaceSelectionText | null>(null)

  // Content is owned by Yjs — the editor binds to provider.doc directly.
  // Title is still REST-managed (it's metadata, not in the Y.Doc).
  const { provider, status: connStatus, synced } = useCollaborativeDoc(id, reloadKey)

  const me = useMemo(() => (user ? identityFor(user) : null), [user])
  const { users: remoteUsers, markActive } = useAwareness(provider, me)

  const role: DocumentRole = doc?.collaborators.find(c => c.user_id === user?.id)?.role
    ?? (doc?.owner_id === user?.id ? 'owner' : 'viewer')
  const canEdit = role === 'owner' || role === 'editor'

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
      })
      .catch(err => {
        if (!cancelled) setLoadError(extractError(err, 'Failed to load document'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [id, reloadKey])

  // --- Title-only auto-save (REST). Content is saved via Yjs/WS. ---
  const saveTitle = useCallback(
    async (value: unknown) => {
      if (!id) return
      await documentsApi.update(id, { title: value as string })
    },
    [id],
  )
  const titleSave = useAutoSave(saveTitle, { delay: 1000 })

  const loadedOnceRef = useRef(false)
  useEffect(() => {
    if (isLoading || !doc) return
    if (!loadedOnceRef.current) {
      loadedOnceRef.current = true
      return
    }
    if (!canEdit) return
    titleSave.trigger(title)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  useEffect(() => { loadedOnceRef.current = false }, [id, reloadKey])

  useEffect(() => {
    setSelection({
      text: '',
      hasSelection: false,
      from: 0,
      to: 0,
    })
    replaceSelectionRef.current = null
    setLastAIApply(null)
  }, [id, reloadKey])

  useEffect(() => {
    const handler = () => { titleSave.flush() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [titleSave])

  const handleAcceptAIText = useCallback((nextText: string) => {
    if (!selection.hasSelection) return false
    const applied = replaceSelectionRef.current?.(nextText, selection) ?? false
    if (applied) {
      setLastAIApply({
        from: selection.from,
        previousText: selection.text,
        appliedText: nextText,
      })
    }
    return applied
  }, [selection])

  const handleUndoAIText = useCallback(() => {
    if (!lastAIApply) return false

    const undone = replaceSelectionRef.current?.(lastAIApply.previousText, {
      from: lastAIApply.from,
      to: lastAIApply.from + lastAIApply.appliedText.length,
    }) ?? false

    if (undone) {
      setLastAIApply(null)
    }

    return undone
  }, [lastAIApply])

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
          <PresenceStack me={me} remote={remoteUsers} />
          <ConnectionStatus status={connStatus} synced={synced} titleSave={titleSave.status} />
          <span className={`role-badge role-${role}`}>{role}</span>
          <button className="btn btn-ghost" onClick={() => setHistoryOpen(true)}>
            History
          </button>
          <button className="btn btn-ghost" onClick={() => setShareOpen(true)}>
            Share
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
        <div className="doc-editor-column">
          <Editor
            key={reloadKey}
            ydoc={provider?.doc}
            awarenessProvider={provider?.wsProvider}
            user={me ? { name: me.name, color: me.color } : undefined}
            onActivity={markActive}
            onSelectionChange={setSelection}
            onReplaceSelectionReady={replace => { replaceSelectionRef.current = replace }}
            editable={canEdit}
            placeholder={canEdit ? 'Start writing…' : 'This document is read-only'}
          />
          <TypingIndicator users={remoteUsers} />
        </div>

        {user && (selection.hasSelection || Boolean(lastAIApply)) && (
          <AISidePanel
            documentId={doc.id}
            userId={user.id}
            selectedText={selection.text}
            hasSelection={selection.hasSelection}
            canEdit={canEdit}
            canUndo={Boolean(lastAIApply)}
            onAccept={handleAcceptAIText}
            onUndo={handleUndoAIText}
          />
        )}
      </div>

      <VersionHistory
        documentId={doc.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        canRestore={canEdit}
        onRestored={() => setReloadKey(k => k + 1)}
      />

      {user && (
        <ShareModal
          document={doc}
          currentUserId={user.id}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          onChanged={next => setDoc(next)}
        />
      )}
    </div>
  )
}
