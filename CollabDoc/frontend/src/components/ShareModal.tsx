import { useEffect, useState } from 'react'
import { documentsApi } from '../api/documents'
import { extractError } from '../api/errors'
import ShareLinksPanel from './ShareLinksPanel'
import type { Document, DocumentCollaborator, DocumentRole } from '../types'

interface Props {
  document: Document
  currentUserId: string
  open: boolean
  onClose: () => void
  onChanged: (next: Document) => void
}

const ASSIGNABLE_ROLES: DocumentRole[] = ['editor', 'viewer']

export default function ShareModal({ document, currentUserId, open, onClose, onChanged }: Props) {
  const [inviteValue, setInviteValue] = useState('')
  const [inviteRole, setInviteRole] = useState<DocumentRole>('editor')
  const [isInviting, setIsInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setInviteValue('')
      setInviteRole('editor')
      setError(null)
    }
  }, [open])

  if (!open) return null

  const isOwner = document.owner_id === currentUserId

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteValue.trim()) return
    setError(null)
    setIsInviting(true)
    try {
      const next = await documentsApi.share(document.id, {
        username_or_email: inviteValue.trim(),
        role: inviteRole,
      })
      onChanged(next)
      setInviteValue('')
    } catch (err) {
      setError(extractError(err, 'Failed to invite collaborator'))
    } finally {
      setIsInviting(false)
    }
  }

  async function handleRoleChange(c: DocumentCollaborator, role: DocumentRole) {
    setError(null)
    setPendingUserId(c.user_id)
    try {
      const next = await documentsApi.updateCollaborator(document.id, c.user_id, { role })
      onChanged(next)
    } catch (err) {
      setError(extractError(err, 'Failed to update role'))
    } finally {
      setPendingUserId(null)
    }
  }

  async function handleRemove(c: DocumentCollaborator) {
    if (!confirm(`Remove ${c.username} from this document?`)) return
    setError(null)
    setPendingUserId(c.user_id)
    try {
      const next = await documentsApi.removeCollaborator(document.id, c.user_id)
      onChanged(next)
    } catch (err) {
      setError(extractError(err, 'Failed to remove collaborator'))
    } finally {
      setPendingUserId(null)
    }
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-label="Share document" aria-modal="true">
        <header className="modal-header">
          <h2>Share "{document.title || 'Untitled'}"</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          {isOwner ? (
            <form className="share-invite" onSubmit={handleInvite}>
              <label htmlFor="share-invite-input" className="share-section-label">
                Invite people
              </label>
              <div className="share-invite-row">
                <input
                  id="share-invite-input"
                  className="share-invite-input"
                  type="text"
                  placeholder="Username or email"
                  value={inviteValue}
                  onChange={e => setInviteValue(e.target.value)}
                  disabled={isInviting}
                  autoComplete="off"
                />
                <select
                  className="share-role-select"
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as DocumentRole)}
                  disabled={isInviting}
                  aria-label="Role for new collaborator"
                >
                  {ASSIGNABLE_ROLES.map(r => (
                    <option key={r} value={r}>{capitalize(r)}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="btn btn-primary share-invite-btn"
                  disabled={isInviting || !inviteValue.trim()}
                >
                  {isInviting ? 'Inviting…' : 'Invite'}
                </button>
              </div>
            </form>
          ) : (
            <p className="share-readonly-note">Only the owner can change sharing settings.</p>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}

          <section className="share-section">
            <h3 className="share-section-label">People with access</h3>
            <ul className="share-people-list">
              <li className="share-person">
                <div className="share-person-info">
                  <span className="share-person-name">
                    {ownerName(document, currentUserId)}
                  </span>
                  <span className="share-person-meta">Owner</span>
                </div>
                <span className="role-badge role-owner">owner</span>
              </li>

              {document.collaborators
                .filter(c => c.user_id !== document.owner_id)
                .map(c => (
                  <li key={c.user_id} className="share-person">
                    <div className="share-person-info">
                      <span className="share-person-name">{c.username}</span>
                      <span className="share-person-meta">{c.email}</span>
                    </div>

                    {isOwner ? (
                      <div className="share-person-actions">
                        <select
                          className="share-role-select"
                          value={c.role}
                          onChange={e => handleRoleChange(c, e.target.value as DocumentRole)}
                          disabled={pendingUserId === c.user_id}
                          aria-label={`Role for ${c.username}`}
                        >
                          {ASSIGNABLE_ROLES.map(r => (
                            <option key={r} value={r}>{capitalize(r)}</option>
                          ))}
                        </select>
                        <button
                          className="btn btn-ghost share-remove-btn"
                          onClick={() => handleRemove(c)}
                          disabled={pendingUserId === c.user_id}
                          aria-label={`Remove ${c.username}`}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <span className={`role-badge role-${c.role}`}>{c.role}</span>
                    )}
                  </li>
                ))}
            </ul>
          </section>

          {isOwner && <ShareLinksPanel documentId={document.id} />}
        </div>
      </div>
    </>
  )
}

function ownerName(doc: Document, currentUserId: string): string {
  const owner = doc.collaborators.find(c => c.user_id === doc.owner_id)
  if (owner) {
    return owner.user_id === currentUserId ? `${owner.username} (you)` : owner.username
  }
  return doc.owner_id === currentUserId ? 'You' : 'Owner'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
