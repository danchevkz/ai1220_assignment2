// Stable per-user identity derived from the server-issued user id.
// Same id → same color on every client, so a user keeps the same cursor/avatar
// color across sessions and devices.

// Tailwind-600s. Chosen for adequate contrast on the white editor background
// AND on the #f8f9fa app background.
const PALETTE = [
  '#dc2626', // red
  '#ea580c', // orange
  '#ca8a04', // yellow
  '#16a34a', // green
  '#0d9488', // teal
  '#0284c7', // sky
  '#4f46e5', // indigo
  '#9333ea', // purple
  '#db2777', // pink
  '#475569', // slate
] as const

export interface UserIdentity {
  id: string
  name: string
  color: string
}

// Deterministic 32-bit hash. Not cryptographic — we only need the same id to
// land on the same palette slot on every machine.
export function colorForId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function identityFor(user: { id: string; username: string }): UserIdentity {
  return { id: user.id, name: user.username, color: colorForId(user.id) }
}
