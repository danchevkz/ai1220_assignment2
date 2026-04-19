import { useEffect, useState } from 'react'
import type { ConnectionStatus } from '../collab/YjsProvider'

interface Props {
  status: ConnectionStatus
  // How long (ms) the disconnect must persist before we escalate to the banner.
  // Short blips on initial handshake shouldn't flash a scary warning.
  delayMs?: number
}

// Full-width banner that appears only after the WS stays disconnected for a
// sustained period. The header pill in `ConnectionStatus` handles the normal
// transient states; this is for "the backend is clearly down" scenarios where
// the user needs to know their edits aren't syncing.
export default function OfflineBanner({ status, delayMs = 5000 }: Props) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (status === 'disconnected') {
      const t = setTimeout(() => setShow(true), delayMs)
      return () => clearTimeout(t)
    }
    setShow(false)
  }, [status, delayMs])

  if (!show) return null

  return (
    <div className="offline-banner" role="status" aria-live="assertive">
      <strong>Connection lost.</strong> Your edits are saved locally and will
      sync when the connection returns.
    </div>
  )
}
