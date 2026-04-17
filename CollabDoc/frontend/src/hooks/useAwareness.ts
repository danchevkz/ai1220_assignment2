import { useCallback, useEffect, useRef, useState } from 'react'
import type { YjsProvider } from '../collab/YjsProvider'
import type { UserIdentity } from '../collab/identity'
import { collectRemoteUsers, type AwarenessUser } from '../collab/awarenessState'

interface Result {
  // Remote users currently in the doc (excludes self).
  users: AwarenessUser[]
  // Record a local activity tick — the `lastActive` field is what remote
  // clients use to render "X is typing…".
  markActive: () => void
}

// Publishes our identity into the Yjs awareness channel and mirrors the
// remote-user list back into React state.
export function useAwareness(
  provider: YjsProvider | null,
  me: UserIdentity | null,
): Result {
  const [users, setUsers] = useState<AwarenessUser[]>([])

  // Publish local identity. Re-runs if the user logs in/out mid-session.
  useEffect(() => {
    if (!provider || !me) return
    provider.awareness.setLocalStateField('user', me)
  }, [provider, me])

  // Subscribe to awareness changes → derive remote-user list.
  useEffect(() => {
    if (!provider) {
      setUsers([])
      return
    }
    const awareness = provider.awareness
    const localClientId = provider.doc.clientID

    const recompute = () => {
      setUsers(collectRemoteUsers(awareness.getStates() as never, localClientId))
    }

    recompute()
    awareness.on('change', recompute)
    return () => {
      awareness.off('change', recompute)
    }
  }, [provider])

  // Typing tick: update `lastActive` but throttle to at most every 500ms so
  // every keystroke doesn't flood awareness updates to every peer. The ref
  // keeps the throttle state across renders.
  const lastSentRef = useRef(0)
  const markActive = useCallback(() => {
    if (!provider) return
    const now = Date.now()
    if (now - lastSentRef.current < 500) return
    lastSentRef.current = now
    provider.awareness.setLocalStateField('lastActive', now)
  }, [provider])

  return { users, markActive }
}
