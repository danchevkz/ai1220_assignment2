import type { UserIdentity } from '../collab/identity'
import { initialsFor } from '../collab/identity'
import type { AwarenessUser } from '../collab/awarenessState'

interface Props {
  me: UserIdentity | null
  remote: AwarenessUser[]
  // Maximum avatars to render inline before collapsing to a "+N" chip.
  max?: number
}

type Entry = { key: string; name: string; color: string; isMe: boolean }

// Avatar stack of everyone currently in the doc. Renders `me` first, then
// distinct remote users by `id` (a single user opening two tabs shouldn't
// render twice). Collapses to a "+N" chip past `max`.
export default function PresenceStack({ me, remote, max = 5 }: Props) {
  const entries: Entry[] = []
  if (me) entries.push({ key: `me:${me.id}`, name: me.name, color: me.color, isMe: true })

  const seenIds = new Set<string>(me ? [me.id] : [])
  for (const u of remote) {
    if (seenIds.has(u.id)) continue
    seenIds.add(u.id)
    entries.push({ key: `r:${u.clientId}`, name: u.name, color: u.color, isMe: false })
  }

  if (entries.length === 0) return null

  const visible = entries.slice(0, max)
  const overflow = entries.length - visible.length

  return (
    <div className="presence-stack" aria-label="Users in document">
      {visible.map(e => (
        <span
          key={e.key}
          className={`presence-avatar${e.isMe ? ' presence-avatar-me' : ''}`}
          style={{ backgroundColor: e.color }}
          title={e.isMe ? `${e.name} (you)` : e.name}
          aria-label={e.isMe ? `${e.name} (you)` : e.name}
        >
          {initialsFor(e.name)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="presence-overflow" title={`${overflow} more`}>
          +{overflow}
        </span>
      )}
    </div>
  )
}
