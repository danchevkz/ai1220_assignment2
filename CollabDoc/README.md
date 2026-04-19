# CollabDoc — Collaborative Document Editor with AI Writing Assistant

Assignment 2 · AI1220 Software Engineering · MBZUAI · April 2026

Team: Alexander Danchev (Frontend & Collaboration) · Anel Murat (AI Assistant) · Yintong Wang (Backend & Core Services).

---

## Stack (per layer)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18 + TypeScript + Vite | Zustand for auth/document state |
| Editor | Tiptap 2 (ProseMirror) + StarterKit | `@tiptap/extension-collaboration` + `CollaborationCursor` |
| CRDT | Yjs via `y-websocket` client | `y-indexeddb` for offline editing |
| Backend | FastAPI + Uvicorn | In-memory stores (per spec) |
| Auth | `python-jose` (JWT, HS256) + `passlib[bcrypt]` | 20 min access · 7 day refresh |
| Collab server | `ypy-websocket` (ASGI mount under `/ws`) | File-backed `FileYStore` for room persistence |
| AI streaming | FastAPI `StreamingResponse` (Server-Sent Events) | `MockLLMProvider` ships in-tree; swap via `app/services/ai/provider.py` |
| Tests | `pytest` (backend) · `vitest` + React Testing Library (frontend) · `@playwright/test` (E2E) | 76 backend + 138 frontend unit + 8 E2E specs |

The system is split into three FastAPI routers mounted under `/api/v1` (`auth`, `documents`, `ai`) plus a Yjs WebSocket ASGI app at `/ws/:docId`. The frontend talks REST over axios and WS through the native `y-websocket` client.

---

## Quick start

```bash
# 1. Copy the env template — defaults are fine for local dev.
cp .env.example backend/.env

# 2. Install both halves.
make install

# 3. Run backend (:8000) and frontend (:5173) in parallel.
make dev
```

Open http://localhost:5173 and register a user. The default `MockLLMProvider` deterministically capitalises sentence starts and extracts leading sentences for summaries, so the full AI flow works offline without any API key.

### Running tests

```bash
make test          # backend pytest + frontend vitest
make test-backend  # pytest only
make test-frontend # vitest only
make test-e2e      # Playwright (requires backend on :8000)
```

---

## Architecture

```
┌──────────────┐  axios + Bearer JWT   ┌────────────────────────┐
│              │ ────────────────────▶│ /api/v1/auth           │
│   React +    │                       │ /api/v1/documents      │
│   Tiptap     │                       │ /api/v1/ai  (SSE)      │
│              │ ◀──── SSE / JSON ──── │                        │
│              │                       ├────────────────────────┤
│ y-websocket  │ ◀── binary Yjs ─────▶ │ /ws/:docId?token=      │
│   client     │                       │ (ypy-websocket + Yjs)  │
└──────────────┘                       └────────────────────────┘
```

- REST handles identity, document CRUD, sharing, share-links, AI requests and version history.
- The WebSocket channel carries only CRDT document state and awareness (presence + cursors). It never duplicates REST semantics.
- The frontend's `YjsProvider` ([`src/collab/YjsProvider.ts`](frontend/src/collab/YjsProvider.ts)) wraps the `y-websocket` client, layers `y-indexeddb` on top, and surfaces a status machine (`offline → connecting → connected → disconnected`).

### Auth lifecycle (REST + WS)

```
register ──▶ POST /api/v1/auth/register                  (no auth)
login   ──▶ POST /api/v1/auth/login            ──▶ { access_token, refresh_token }

REST calls:
  Authorization: Bearer <access>  ──▶ FastAPI dependency `get_current_user`
                                      ├─ 200 OK with user-scoped response
                                      └─ 401 ──▶ axios interceptor calls
                                                 POST /api/v1/auth/refresh
                                                 ├─ success: retry original request
                                                 └─ failure: purge tokens → /login

WebSocket:
  new WebSocket(`${WS_URL}/${docId}?token=${access}`)
       │
       ▼
  on_connect (websocket/collaboration.py):
    decode_token → must be type=access, user must exist,
    user must be in document.collaborators.
    ──▶ accept  → join Yjs room
    ──▶ reject  → close with code 1008
```

Tokens live in memory on the client (Zustand `authStore`) except for the refresh token, which is kept in `localStorage` so a page reload can re-mint an access token without re-prompting for credentials. The WS endpoint reuses the same access token passed as a query-string parameter because the browser's WebSocket API cannot set custom headers.

### WebSocket message protocol

We speak the standard **`y-websocket` binary protocol** — we did not invent a custom wire format. Each frame is a length-prefixed binary message whose first byte is the message type:

| Type | Byte | Direction | Purpose |
|------|------|-----------|---------|
| `sync` | `0` | ↔ | Initial state vector exchange + incremental updates |
| `awareness` | `1` | ↔ | Presence payload: user id, name, color, cursor range, `lastActive` |
| `auth` | `2` | ← | Not used — auth happens via the `?token=` query param at connect |
| `queryAwareness` | `3` | → | Client can explicitly request the current awareness set |

On the server side `ypy-websocket` handles the `sync` protocol and broadcasts awareness verbatim to every peer in the room. Documents persist to disk via `FileYStore` (see [`backend/app/websocket/collaboration.py`](backend/app/websocket/collaboration.py)), so a room can be reloaded after a server restart and snapshotted for version history.

### Collaboration strategy

- **CRDT, not LWW.** Concurrent edits are merged by Yjs at the character level, so two users typing simultaneously produces a deterministic, intention-preserving interleaving without any server-side conflict resolution.
- **Offline-first on the client.** `y-indexeddb` persists every `Y.Doc` locally so edits made while disconnected are queued and reconciled on reconnect. The connection status is surfaced in the UI so users know when they're offline.
- **Awareness is separate from content.** Cursors, colours (derived from a stable hash of user id — see [`src/collab/identity.ts`](frontend/src/collab/identity.ts)) and "is typing" signals flow through the awareness channel and never touch the Y.Doc, so they can't pollute version history.
- **Snapshots for versions.** When a client opens the Version History drawer, the REST endpoint `GET /documents/:id/versions` asks the live Yjs room for its current state vector, compares it with the latest stored version, and only appends a snapshot if the document has actually changed.

### AI concurrent-edit strategy

AI writing suggestions run alongside live collaboration, which introduces two edge cases that the UI and backend handle explicitly:

1. **The source text can change while the model is generating.** The client captures the selection range at request time and streams the suggestion into a *side panel*, never directly into the Y.Doc. The user's ongoing edits are applied normally to the document; the suggestion lands only when the user clicks *Apply* / *Apply selected*. If the range no longer exists (e.g. the text was deleted), the insertion falls back to the current selection or the document end, rather than overwriting unrelated content.
2. **Multiple users might request a suggestion on overlapping text.** Interaction logging is keyed on `(document_id, user_id)`, so each user sees their own history and cancellations (`POST /ai/generations/:id/cancel`) affect only their own in-flight generation. The accepted insertion is a standard Yjs edit, so it merges with any concurrent edits as if a human had typed it.

Partial acceptance (bonus #4) is implemented by splitting the streamed output into paragraph-sized chunks when the server emits `done: true`. The UI renders per-chunk Accept/Reject buttons so a user can keep the parts they like and leave the rest of the document untouched. The reducer lives in [`src/ai/aiState.ts`](frontend/src/ai/aiState.ts); the SSE consumer is [`src/api/ai.ts`](frontend/src/api/ai.ts).

### AI history scope

AI history is **per-user within a document**, not shared across collaborators. A record carries both `document_id` and `user_id`, and `GET /api/v1/ai/history/:docId` rejects requests for any `user_id` other than the caller's (see [`backend/app/api/routes/ai.py`](backend/app/api/routes/ai.py) — the `user_id != current_user.id` check). The rationale: prompts and rejected drafts are personal — two collaborators editing the same document each keep their own experimentation log, and neither sees the other's unshipped ideas. Only accepted suggestions land in the Y.Doc (via normal Yjs edits), which is the shared surface.

The active AI implementation lives under [`backend/app/api/routes/ai.py`](backend/app/api/routes/ai.py) (router) and [`backend/app/services/ai/provider.py`](backend/app/services/ai/provider.py) (LLM abstraction). There is no other AI code path in the backend.

---

## API overview

FastAPI's auto-generated docs are at http://localhost:8000/docs (OpenAPI JSON at `/openapi.json`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | — | Register user |
| POST | `/api/v1/auth/login` | — | Exchange credentials for tokens |
| POST | `/api/v1/auth/refresh` | — | Refresh access token |
| GET | `/api/v1/auth/me` | ✓ | Current user |
| GET | `/api/v1/documents` | ✓ | List docs caller can access |
| POST | `/api/v1/documents` | ✓ | Create doc |
| GET | `/api/v1/documents/:id` | viewer+ | Read doc |
| PATCH | `/api/v1/documents/:id` | editor+ | Update title / content |
| DELETE | `/api/v1/documents/:id` | owner | Delete doc |
| POST | `/api/v1/documents/:id/share` | owner | Invite by username/email |
| PATCH | `/api/v1/documents/:id/collaborators/:userId` | owner | Change collaborator role |
| DELETE | `/api/v1/documents/:id/collaborators/:userId` | owner | Remove collaborator |
| GET | `/api/v1/documents/:id/share-links` | owner | List active share links |
| POST | `/api/v1/documents/:id/share-links` | owner | Mint share link |
| DELETE | `/api/v1/documents/:id/share-links/:token` | owner | Revoke share link |
| POST | `/api/v1/documents/share-links/:token/redeem` | ✓ | Join a document via share link |
| GET | `/api/v1/documents/:id/versions` | viewer+ | Version history (triggers snapshot) |
| POST | `/api/v1/documents/:id/versions/:v/restore` | editor+ | Restore to a version |
| POST | `/api/v1/ai/rewrite/stream` | ✓ | SSE stream: rewrite text |
| POST | `/api/v1/ai/summarize/stream` | ✓ | SSE stream: summarize text |
| POST | `/api/v1/ai/generations/:id/cancel` | ✓ | Cancel in-flight generation |
| PATCH | `/api/v1/ai/generations/:id/outcome` | ✓ | Record accept / reject / partial / cancelled for a generation |
| GET | `/api/v1/ai/history/:docId?user_id=` | ✓ | Per-user AI history (caller can only read their own — see AI history scope) |
| WS | `/ws/:docId?token=` | JWT | Yjs real-time collaboration |

---

## Project structure

```
.
├── backend/
│   ├── app/
│   │   ├── api/routes/      # auth, documents, ai (FastAPI routers)
│   │   ├── core/            # settings, JWT helpers, dependencies
│   │   ├── models/          # in-memory store (users, docs, versions, share links, AI history)
│   │   ├── schemas/         # Pydantic request/response models
│   │   ├── services/ai/     # LLM provider abstraction + MockLLMProvider
│   │   ├── websocket/       # ypy-websocket ASGI app + Yjs room persistence
│   │   └── main.py
│   └── tests/               # pytest: unit + integration
├── frontend/
│   ├── e2e/                 # Playwright specs (auth, golden-path, collaboration)
│   └── src/
│       ├── ai/              # AI reducer (aiState.ts) — shared by panel + tests
│       ├── api/             # axios client + per-domain helpers (auth, documents, ai)
│       ├── collab/          # YjsProvider, awareness state, stable user colours
│       ├── components/      # Editor, AI panel, ShareModal, presence UI, etc.
│       ├── hooks/           # useCollaborativeDoc, useAISuggestion, useAutoSave, useAwareness
│       ├── pages/           # Login, Register, Dashboard, Document, ShareRedeem
│       ├── store/           # Zustand stores
│       └── types/           # shared TypeScript types
├── DEVIATIONS.md            # A1 → A2 design deltas
├── PLAN.md                  # team-shared tracker
├── Makefile
└── README.md
```

Module-level READMEs live alongside the code (e.g. [`frontend/src/collab/README.md`](frontend/src/collab/README.md), [`backend/app/websocket/README.md`](backend/app/websocket/README.md)).

---

## Testing matrix

| Layer | Tooling | Coverage focus |
|-------|---------|----------------|
| Backend unit | `pytest` | Auth, document CRUD, sharing, versions, AI stream adapter |
| Frontend unit | `vitest` + RTL | Auth forms, editor toolbar, YjsProvider state machine, awareness reducer, AI reducer + SSE consumer, AI side panel (accept / reject / partial → `recordOutcome`), SSE 401 refresh/retry + logout, axios 401 interceptor, ShareModal, ShareLinksPanel |
| E2E | `@playwright/test` | Register → dashboard, protected routes, golden path (rich text + AI rewrite + version history), two-browser-context CRDT sync via share link |

E2E runs with a single worker because the in-memory backend store is process-global.

---

## Bonus items (all five targeted)

1. **Character-level CRDT** — Yjs + `y-websocket` end-to-end, proved by `e2e/collaboration.spec.ts`.
2. **Remote cursors & selections** — Tiptap `CollaborationCursor` wired through `YjsProvider`.
3. **Share-by-link** — Create/list/revoke links with optional expiry; `/share/:token` landing page with auth round-trip.
4. **Partial AI acceptance** — Per-paragraph Accept/Reject in the AI side panel.
5. **Automated E2E tests** — Playwright suite of 8 specs covering the demo flow plus the cross-client collaboration case.

See [DEVIATIONS.md](DEVIATIONS.md) for differences from the Assignment 1 design.
