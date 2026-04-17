import { useEffect, useState } from 'react'
import { documentsApi } from '../api/documents'
import { extractError } from '../api/errors'
import type { DocumentVersion } from '../types'

interface Props {
  documentId: string
  open: boolean
  onClose: () => void
  onRestored: () => void
  canRestore: boolean
}

export default function VersionHistory({
  documentId,
  open,
  onClose,
  onRestored,
  canRestore,
}: Props) {
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [preview, setPreview] = useState<DocumentVersion | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    documentsApi
      .versions(documentId)
      .then(data => {
        if (cancelled) return
        // newest first
        const sorted = [...data].sort((a, b) => b.version - a.version)
        setVersions(sorted)
        setPreview(sorted[0] ?? null)
      })
      .catch(err => {
        if (!cancelled) setError(extractError(err, 'Failed to load versions'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [documentId, open])

  async function handleRestore() {
    if (!preview) return
    if (!confirm(`Restore version ${preview.version}? Current content will be replaced (but saved as a new version first).`)) return
    setIsRestoring(true)
    setError(null)
    try {
      await documentsApi.restoreVersion(documentId, preview.version)
      onRestored()
      onClose()
    } catch (err) {
      setError(extractError(err, 'Failed to restore version'))
    } finally {
      setIsRestoring(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Version history">
        <header className="drawer-header">
          <h2>Version history</h2>
          <button className="drawer-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        {isLoading && <p className="drawer-loading">Loading versions…</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        {!isLoading && versions.length === 0 && !error && (
          <p className="drawer-empty">No versions yet.</p>
        )}

        <div className="drawer-body">
          <ul className="version-list">
            {versions.map(v => (
              <li key={v.version}>
                <button
                  className={`version-item ${preview?.version === v.version ? 'version-item-active' : ''}`}
                  onClick={() => setPreview(v)}
                >
                  <span className="version-num">v{v.version}</span>
                  <span className="version-date">{formatDate(v.saved_at)}</span>
                  <span className="version-author">{v.saved_by}</span>
                </button>
              </li>
            ))}
          </ul>

          {preview && (
            <div className="version-preview">
              <div className="version-preview-header">
                <strong>Preview — v{preview.version}</strong>
                {canRestore && (
                  <button
                    className="btn btn-primary"
                    onClick={handleRestore}
                    disabled={isRestoring}
                  >
                    {isRestoring ? 'Restoring…' : 'Restore this version'}
                  </button>
                )}
              </div>
              <div
                className="version-preview-content"
                dangerouslySetInnerHTML={{ __html: preview.content }}
              />
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
