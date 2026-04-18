import { useEffect, useState } from 'react'
import { documentsApi } from '../api/documents'
import { extractError } from '../api/errors'
import type { DocumentRole, ShareLink } from '../types'

interface Props {
  documentId: string
}

const LINK_ROLES: DocumentRole[] = ['editor', 'viewer']

const EXPIRY_OPTIONS: Array<{ label: string; hours: number | null }> = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
  { label: 'Never', hours: null },
]

export default function ShareLinksPanel({ documentId }: Props) {
  const [links, setLinks] = useState<ShareLink[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  const [newRole, setNewRole] = useState<DocumentRole>('editor')
  const [newExpiryHours, setNewExpiryHours] = useState<number | null>(24 * 7)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    documentsApi
      .listShareLinks(documentId)
      .then(data => { if (!cancelled) setLinks(data) })
      .catch(err => { if (!cancelled) setError(extractError(err, 'Failed to load share links')) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [documentId])

  async function handleCreate() {
    setError(null)
    setIsCreating(true)
    try {
      const link = await documentsApi.createShareLink(documentId, {
        role: newRole,
        expires_in_hours: newExpiryHours,
      })
      setLinks(prev => [link, ...prev])
    } catch (err) {
      setError(extractError(err, 'Failed to create share link'))
    } finally {
      setIsCreating(false)
    }
  }

  async function handleRevoke(token: string) {
    if (!confirm('Revoke this link? Anyone holding it will lose access.')) return
    setError(null)
    // Optimistic: remove immediately, restore on failure.
    const snapshot = links
    setLinks(prev => prev.filter(l => l.token !== token))
    try {
      await documentsApi.revokeShareLink(documentId, token)
    } catch (err) {
      setLinks(snapshot)
      setError(extractError(err, 'Failed to revoke link'))
    }
  }

  async function handleCopy(token: string) {
    try {
      await navigator.clipboard.writeText(linkUrl(token))
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(c => (c === token ? null : c)), 1500)
    } catch {
      setError('Could not copy to clipboard')
    }
  }

  return (
    <section className="share-section share-links">
      <h3 className="share-section-label">Share-by-link</h3>

      <div className="share-link-create">
        <select
          className="share-role-select"
          value={newRole}
          onChange={e => setNewRole(e.target.value as DocumentRole)}
          disabled={isCreating}
          aria-label="Role for new link"
        >
          {LINK_ROLES.map(r => (
            <option key={r} value={r}>{capitalize(r)}</option>
          ))}
        </select>
        <select
          className="share-role-select"
          value={newExpiryHours ?? 'never'}
          onChange={e => {
            const v = e.target.value
            setNewExpiryHours(v === 'never' ? null : Number(v))
          }}
          disabled={isCreating}
          aria-label="Link expiry"
        >
          {EXPIRY_OPTIONS.map(opt => (
            <option key={opt.label} value={opt.hours ?? 'never'}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary share-link-create-btn"
          onClick={handleCreate}
          disabled={isCreating}
        >
          {isCreating ? 'Creating…' : 'Create link'}
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {isLoading ? (
        <p className="share-loading">Loading links…</p>
      ) : links.length === 0 ? (
        <p className="share-empty">No active share links.</p>
      ) : (
        <ul className="share-link-list">
          {links.map(link => (
            <li key={link.token} className="share-link-row">
              <div className="share-link-info">
                <code className="share-link-url">{linkUrl(link.token)}</code>
                <span className="share-link-meta">
                  <span className={`role-badge role-${link.role}`}>{link.role}</span>
                  <span className="share-link-expiry">{describeExpiry(link.expires_at)}</span>
                </span>
              </div>
              <div className="share-link-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => handleCopy(link.token)}
                  aria-label="Copy link"
                >
                  {copiedToken === link.token ? 'Copied!' : 'Copy'}
                </button>
                <button
                  className="btn btn-ghost share-remove-btn"
                  onClick={() => handleRevoke(link.token)}
                  aria-label="Revoke link"
                >
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function linkUrl(token: string): string {
  return `${window.location.origin}/share/${token}`
}

function describeExpiry(iso: string | null): string {
  if (!iso) return 'Never expires'
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return iso
  const now = Date.now()
  if (ts < now) return 'Expired'
  const days = Math.round((ts - now) / (1000 * 60 * 60 * 24))
  if (days <= 0) return 'Expires today'
  if (days === 1) return 'Expires in 1 day'
  return `Expires in ${days} days`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
