import type { ConnectionStatus as Status } from '../collab/YjsProvider'
import type { SaveStatus } from '../hooks/useAutoSave'

interface Props {
  status: Status
  synced: boolean
  // Title save runs separately over REST; we surface errors/saving state here too.
  titleSave?: SaveStatus
}

// Combined indicator for the document header.
// Prioritizes offline/error states — those matter more than the quiet "saved".
export default function ConnectionStatus({ status, synced, titleSave }: Props) {
  const { label, tone } = computeState(status, synced, titleSave)
  return (
    <span className={`conn-status conn-${tone}`} aria-live="polite">
      <span className={`conn-dot conn-dot-${tone}`} />
      {label}
    </span>
  )
}

function computeState(
  status: Status,
  synced: boolean,
  titleSave?: SaveStatus,
): { label: string; tone: 'connected' | 'connecting' | 'offline' | 'error' | 'saving' | 'saved' } {
  if (titleSave === 'error') return { label: 'Title save failed', tone: 'error' }

  switch (status) {
    case 'connecting':
      return { label: 'Connecting…', tone: 'connecting' }
    case 'disconnected':
      return { label: 'Offline — reconnecting', tone: 'offline' }
    case 'offline':
      return { label: 'Offline', tone: 'offline' }
    case 'connected':
      if (!synced) return { label: 'Syncing…', tone: 'connecting' }
      if (titleSave === 'saving') return { label: 'Saving…', tone: 'saving' }
      return { label: 'Synced', tone: 'connected' }
  }
}
