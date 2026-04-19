# `src/api/`

Axios client + per-domain REST helpers.

| File | Purpose |
|------|---------|
| `client.ts` | Configured axios instance. Attaches `Authorization: Bearer <access>`, handles 401 by calling `POST /auth/refresh` and retrying the original request once. On refresh failure purges tokens and bounces to `/login`. |
| `auth.ts` | Register / login / refresh / me. |
| `documents.ts` | Document CRUD, collaborator PATCH/DELETE, share-links CRUD, share-link redeem (unwraps the `{ document, role }` envelope), versions list + restore. |
| `ai.ts` | `fetch`-based SSE consumer (axios can't stream). Reads the y-websocket-style `data: {...}` frames, adapts `{ delta, done }` into internal `delta` / `done` events, wires an `AbortController` so the UI's Cancel button can drop the stream without waiting for the server. |

REST helpers never touch React state directly — they return promises and the
hooks in `src/hooks/` do the dispatching.
