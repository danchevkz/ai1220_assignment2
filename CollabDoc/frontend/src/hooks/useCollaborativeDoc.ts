import { useEffect, useRef, useState } from 'react'
import { YjsProvider, type ConnectionStatus } from '../collab/YjsProvider'
import { getAccessToken } from '../api/client'

// Match the vite proxy target — dev proxy forwards /ws to the backend,
// so we always connect to the same origin in the browser.
const WS_URL = buildWsUrl()

function buildWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:8000/ws'
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

interface Result {
  provider: YjsProvider | null
  status: ConnectionStatus
  synced: boolean
}

// Creates (and later tears down) a YjsProvider for the given document id.
// Returns the provider once it's been constructed, plus reactive status.
// `reloadKey` lets the caller force a fresh Y.Doc (e.g. after a version restore).
export function useCollaborativeDoc(
  documentId: string | undefined,
  reloadKey: number = 0,
): Result {
  const [provider, setProvider] = useState<YjsProvider | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('offline')
  const [synced, setSynced] = useState(false)

  // Keep the live ref so StrictMode double-invoke doesn't leak two providers.
  const currentRef = useRef<YjsProvider | null>(null)

  useEffect(() => {
    if (!documentId) return

    const token = getAccessToken()
    if (!token) {
      // No token yet — the axios bootstrap probably hasn't finished.
      // Bail; the caller will re-render when auth is ready.
      return
    }

    const p = new YjsProvider({ documentId, wsUrl: WS_URL, token })
    currentRef.current = p
    setProvider(p)
    setStatus(p.getStatus())
    setSynced(p.isSynced())

    const unsub = p.subscribe({
      onStatusChange: setStatus,
      onSynced: () => setSynced(true),
    })

    // Swap the WS connection to use the fresh token rather than keep using
    // a stale one after silent refresh. Preserves Y.Doc state across the swap.
    const onTokenRefreshed = (e: Event) => {
      const detail = (e as CustomEvent<{ accessToken?: string }>).detail
      const newToken = detail?.accessToken ?? getAccessToken()
      if (newToken) p.updateToken(newToken)
    }
    // On logout, tear the provider down immediately — don't wait for the
    // router unmount, since a dead connection can keep retrying with a
    // cleared token.
    const onLogout = () => { p.destroy() }

    window.addEventListener('auth:tokenRefreshed', onTokenRefreshed)
    window.addEventListener('auth:logout', onLogout)

    return () => {
      window.removeEventListener('auth:tokenRefreshed', onTokenRefreshed)
      window.removeEventListener('auth:logout', onLogout)
      unsub()
      p.destroy()
      if (currentRef.current === p) {
        currentRef.current = null
        setProvider(null)
        setSynced(false)
        setStatus('offline')
      }
    }
  }, [documentId, reloadKey])

  return { provider, status, synced }
}
