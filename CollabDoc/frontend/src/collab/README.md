# `src/collab/`

Client-side Yjs integration. Everything CRDT-related is isolated here so the
rest of the app can talk to an ordinary `Y.Doc` without importing
`y-websocket` details.

| File | Purpose |
|------|---------|
| `YjsProvider.ts` | Thin wrapper around `y-websocket` + `y-indexeddb`. Exposes a status machine (`offline → connecting → connected → disconnected`) and a `synced` flag, passes the access token via `params.token`, lets the upstream provider handle reconnects. |
| `awarenessState.ts` | Reducer over the awareness map — derives the active-user list, dedupes multiple tabs from the same user by user id, and exposes `markActive` (throttled, used by `TypingIndicator`). |
| `identity.ts` | Stable per-user colour derived from a hash of the user id, so a given user has the same avatar/cursor colour on every peer and across reloads. |

`hooks/useCollaborativeDoc.ts` and `hooks/useAwareness.ts` are the consumer
surface — components don't import from `src/collab/` directly.
