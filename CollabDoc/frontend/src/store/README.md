# `src/store/`

Zustand stores for global state that doesn't belong to a single component.

| Store | Purpose |
|-------|---------|
| `authStore` | Current user + access token (in-memory) + refresh token (mirrored to `localStorage` so reloads can re-mint). Exposes `login`, `logout`, `setTokens`. |
| `documentStore` | Cached document summaries for the dashboard + the currently open document's metadata (title, collaborators, role). Yjs content lives on the `Y.Doc`, not here. |

Components subscribe to narrow selectors (`useAuthStore(s => s.user)`) so
store updates don't cascade into unrelated re-renders.
