import type { UserIdentity } from './identity'

// Shape of the local state we publish to awareness. CollaborationCursor reads
// `user` directly, so we keep that key exactly as the extension expects it.
export interface LocalAwarenessState {
  user: UserIdentity
  // epoch ms of the last local edit — drives the typing indicator
  lastActive?: number
}

export interface AwarenessUser {
  clientId: number
  id: string
  name: string
  color: string
  lastActive?: number
}

// Pure reducer from y-protocol awareness state map → UI-friendly list.
// Extracted so the mapping logic is unit-testable without a real provider.
export function collectRemoteUsers(
  states: Map<number, Partial<LocalAwarenessState> | undefined>,
  localClientId: number,
): AwarenessUser[] {
  const out: AwarenessUser[] = []
  states.forEach((state, clientId) => {
    if (clientId === localClientId) return
    const u = state?.user
    if (!u || typeof u.id !== 'string') return
    out.push({
      clientId,
      id: u.id,
      name: u.name,
      color: u.color,
      lastActive: state?.lastActive,
    })
  })
  // Stable order so the avatar stack doesn't jitter on every awareness tick.
  out.sort((a, b) => a.clientId - b.clientId)
  return out
}

// How recently a user must have emitted a keystroke to count as "typing".
export const TYPING_WINDOW_MS = 2500

export function isTyping(user: AwarenessUser, now: number = Date.now()): boolean {
  return user.lastActive != null && now - user.lastActive < TYPING_WINDOW_MS
}
