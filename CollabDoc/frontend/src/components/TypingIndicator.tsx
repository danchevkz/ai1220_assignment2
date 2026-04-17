import { useEffect, useState } from 'react'
import type { AwarenessUser } from '../collab/awarenessState'
import { TYPING_WINDOW_MS, isTyping } from '../collab/awarenessState'

interface Props {
  users: AwarenessUser[]
}

// Renders "Alice is typing…" / "Alice and Bob are typing…" based on the
// freshness of each remote user's `lastActive` stamp. We re-tick locally
// so the banner fades out even if no awareness update arrives.
export default function TypingIndicator({ users }: Props) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const hasAny = users.some(u => u.lastActive != null)
    if (!hasAny) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [users])

  const typers = users.filter(u => isTyping(u, now))
  if (typers.length === 0) return null

  const names = dedupeByName(typers.map(u => u.name))
  return (
    <div className="typing-indicator" aria-live="polite">
      {formatTypers(names)}
      <span className="typing-dots"><span /><span /><span /></span>
    </div>
  )
}

function dedupeByName(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

function formatTypers(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
  return `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing`
}

// Re-exported for tests that need the window constant.
export { TYPING_WINDOW_MS }
