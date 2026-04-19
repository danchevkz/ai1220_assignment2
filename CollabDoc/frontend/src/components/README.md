# `src/components/`

Presentational React components. Each component is responsible for its own
subtree only — data comes from Zustand stores or hooks in `src/hooks/`, not
from API calls made directly in the component.

Notable groups:

- `Editor/` — Tiptap editor instance + `Collaboration` / `CollaborationCursor`
  extensions, toolbar, connection status badge.
- `AISidePanel.tsx` + `AIHistoryList.tsx` — AI suggestion panel with
  per-paragraph Accept / Reject (bonus #4) and the per-user interaction log.
- `ShareModal.tsx` + `ShareLinksPanel.tsx` — invite-by-username, access list
  with role changes / removals, share-by-link create / copy / revoke
  (bonus #3).
- `PresenceStack.tsx` + `TypingIndicator.tsx` — awareness UI backed by
  `useAwareness`.
- `ConnectionStatus.tsx` — surfaces the `YjsProvider` status machine so the
  user can tell when they're editing offline.
