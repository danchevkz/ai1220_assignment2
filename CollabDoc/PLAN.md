# CollabDoc — Plan & Progress Tracker

Shared working document for the team. Update checkboxes as work lands. Add notes under a task rather than deleting it — the history is useful for the deviation report.

Last updated: 2026-04-18 (Phase 6 frontend complete; Anel's AI backend PR #1 reviewed — coordination items updated. Phase 7 kickoff: `/share/:token` landing page + frontend `.env.example` in.)

---

## Team split

| Area | Owner | Responsibilities |
|------|-------|------------------|
| Frontend & Collaboration | Alexander Danchev | Rich-text editor UI, frontend state management, presence indicators, real-time user experience (Yjs, remote cursors) |
| AI Assistant | Anel Murat | AI service, prompt construction, quota management, interaction logging |
| Backend & Core Services | Yintong Wang | API layer, document service, authentication, database, overall system integration |

Cross-cutting (tests, docs, demo) is shared.

---

## Targets

- **Baseline**: every Part 1–5 requirement in `assignment2_brief.pdf`.
- **All 5 bonus items** for +10 pts: CRDT (Yjs), remote cursors, share-by-link, partial AI acceptance, E2E tests.
- Address Assignment 1 feedback (−7.5 pts lost on):
  1. Auth design unclear for REST + WS → document explicitly.
  2. Collab PoC didn't demo end-to-end → get two-tab sync working early and keep exercising it.
  3. Diagrams missing tech choices + per-container responsibilities → module-level READMEs + tech-per-layer in main README.
  4. No automated tests → tests land with each feature, not at the end.

---

## Key architectural decisions

- **LLM provider**: Gemini (`gemini-3.1-flash` default — newest as of 2026-04) via `google-generativeai`. Abstracted behind `LLMProvider` so swap is one-file.
- **Collab**: Yjs from day one (skip the LWW → CRDT migration). Tiptap `Collaboration` + `CollaborationCursor` extensions. `y-indexeddb` for offline persistence.
- **WS transport**: binary Yjs frames preferred; fall back to JSON-wrapped base64 if backend can't accommodate.
- **Storage**: in-memory per spec. Yjs doc state persisted as binary blob keyed by doc id.
- **Auth**: JWT access (20 min) + refresh (7 days). WS auth via `?token=` query param validated on connect.

---

## Coordination items (raise with other teams)

- [ ] Confirm backend implements the **`y-websocket` wire protocol** — a Python option is [`ypy-websocket`](https://github.com/y-crdt/ypy-websocket). Client uses `y-websocket@^3` against `ws://<host>/ws/<docId>?token=<jwt>`.
- [ ] Agree on **awareness channel** — same WS, separate message type.
- [x] Agree on **share-by-link** endpoint shape: client now expects `GET /documents/:id/share-links` (list), `POST /documents/:id/share-links` body `{ role, expires_in_hours: number | null }` → `ShareLink { token, role, created_at, expires_at: string | null, created_by }`, and `DELETE /documents/:id/share-links/:token`. Public landing route at `/share/:token` is wired (`pages/ShareRedeem.tsx`) — unauthed users bounce to `/login` with `from` state and come back automatically. **Action for Yintong**: confirm / implement `POST /share-links/:token/redeem` → `Document` (adds caller as collaborator with the token's role, 404 if expired/revoked). Frontend currently calls this shape.
- [ ] Confirm backend exposes **`PATCH /documents/:id/collaborators/:userId`** (body `{ role }`) and **`DELETE /documents/:id/collaborators/:userId`** — both return the updated `Document`. Used by ShareModal access list.
- [x] **AI SSE format agreed** (Anel PR #1): backend streams `{ request_id, operation, delta, done }`. Frontend adapter in `api/ai.ts` translates to internal events; paragraph-splits on `done: true` for per-paragraph partial accept (bonus #4). Endpoints: `POST /ai/rewrite/stream`, `POST /ai/summarize/stream`, `GET /ai/history/:docId?user_id=`, `POST /ai/generations/:id/cancel`. **Action for Yintong**: mount `app.ai.router` in `main.py` at `/api/v1`.
- [ ] Branch/PR strategy: feature branches + PRs with reviews. Rubric flags "single final commit" as a red flag.

---

## Our build order (Frontend & Collaboration)

Sequencing is dependency-driven. Tests land with the feature, not after.
Each item has one primary owner. Add a partner only when cross-team coordination is expected.

### Phase 1 — Foundations (unblocks everything else)

- [x] **App shell**: router, layout, 404. Owner: Alexander.
- [x] **Auth UI**: Login, Register pages. Owner: Alexander.
- [x] **Auth state**: Zustand `authStore`; persist refresh token in localStorage; access token in memory. Owner: Alexander. Partner: Yintong.
- [x] **axios client** with refresh interceptor (no raw 401s during editing — spec 1.1). Owner: Alexander. Partner: Yintong.
- [x] **`ProtectedRoute`** wrapper. Owner: Alexander.
- [x] Tests: login form happy path + error path. (6/6 passing) Owner: Alexander.

### Phase 2 — Document surface

- [x] **Dashboard**: list of accessible docs, create button, navigate. Owner: Alexander.
- [x] **Document page scaffold**: title edit, back link. Owner: Alexander.
- [x] **Tiptap editor** (StarterKit: headings, bold, italic, lists, code-block) + placeholder + toolbar. Owner: Alexander.
- [x] **Auto-save**: debounced PATCH, status indicator ("Saving..." / "Saved" / "Error"). Owner: Alexander.
- [x] **Version history drawer**: list snapshots, preview, restore. Owner: Alexander.
- [x] Tests: toolbar commands, auto-save debounce. (12 new tests, 18/18 total passing) Owner: Alexander.

### Phase 3 — Real-time collaboration (highest risk, tackle early)

- [x] **Yjs integration**: `Y.Doc` per document, `@tiptap/extension-collaboration`. Owner: Alexander.
- [x] **WS provider**: `y-websocket` client, token passed via `params` → `?token=`. Owner: Alexander. Partner: Yintong.
- [ ] **Two-tab sync proof**: character-level edits propagate < 500ms locally. _Blocked on backend WS endpoint._ Owner: Alexander. Partner: Yintong.
- [x] **Connection lifecycle** (client side): `YjsProvider` status machine `offline → connecting → connected → disconnected`, surfaced to UI; `y-websocket` handles reconnect. Owner: Yintong. Partner: Alexander.
- [x] **Offline editing**: `y-indexeddb` persistence; queue survives reload; reconciles on reconnect. Owner: Alexander. Partner: Yintong.
- [x] Tests: YjsProvider unit tests (mocked WS) + ConnectionStatus component. (14 new tests, 32/32 total passing) Owner: Alexander. Partner: Yintong.

### Phase 4 — Presence & awareness

- [x] **Awareness state**: per-user `{ name, color }` derived from user id hash (stable colors) — `collab/identity.ts` + `collab/awarenessState.ts`. Owner: Alexander. Partner: Yintong.
- [x] **Online users** avatar stack in the document header (`PresenceStack`, dedupes by user id so multiple tabs from one user render once). Owner: Alexander.
- [x] **Typing indicator** / activity status — `useAwareness.markActive` (throttled to 500ms) → `lastActive` field → `TypingIndicator` with 2.5s window. Owner: Alexander. Partner: Yintong.
- [x] **Remote cursors & selections** via `@tiptap/extension-collaboration-cursor` (bonus #2) — wired through `Editor` with local user `{ name, color }`. _Visual verification blocked on backend WS endpoint, but the extension is configured end-to-end._ Owner: Alexander. Partner: Yintong.
- [x] Tests: awareness state reducer, color derivation stable, presence stack dedupe/overflow, typing indicator copy + window. (25 new tests, 57/57 total passing) Owner: Alexander.

### Phase 5 — Sharing UI

- [x] **Share modal**: invite by username/email with role picker (editor/viewer). Owner-only invite controls; non-owners see a read-only access list. `components/ShareModal.tsx`. Owner: Alexander. Partner: Yintong.
- [x] **Access list**: owner row first labeled "(you)"; per-collaborator role select + Remove button (owner-only). Calls new `PATCH /documents/:id/collaborators/:userId` and `DELETE /documents/:id/collaborators/:userId`. _Backend endpoints need to be implemented by Yintong._ Owner: Alexander. Partner: Yintong.
- [x] **Share-by-link** (bonus #3): `components/ShareLinksPanel.tsx`. Create with role + expiry (24h/7d/30d/never), copy with `navigator.clipboard`, optimistic revoke (link disappears immediately, restores on failure). Hits `GET/POST/DELETE /documents/:id/share-links[/:token]`. _Backend endpoints need to be implemented by Yintong._ Owner: Alexander. Partner: Yintong.
- [x] Tests: 10 ShareModal tests (invite + role picker + role change + remove + non-owner read-only + invite error) and 7 ShareLinksPanel tests (empty state, render, create, optimistic revoke, restore-on-failure, copy affordance, cancel-confirm). (17 new tests, 74/74 total passing) Owner: Alexander.
- [x] **Share-link redeem landing page** (completes bonus #3): `pages/ShareRedeem.tsx` at `/share/:token`. Unauthed users are redirected to `/login` with `from` state (Login + Register both propagate `from` so register-then-come-back works). Authed users call `POST /share-links/:token/redeem` and are navigated to the document; invalid/expired tokens show an error card with a link back to dashboard. 4 new tests (unauthed redirect, success navigate, error card, loading state). Owner: Alexander. Partner: Yintong.

### Phase 6 — AI suggestion UI

- [x] **AI side panel**: triggered from editor selection; "Rewrite" + "Summarize". `components/AISidePanel.tsx`. Owner: Alexander. Partner: Anel.
- [x] **Streaming render**: SSE consumer in `api/ai.ts` (fetch + ReadableStream); adapts Anel's `{ delta, done }` format to internal events; progressive text display. Owner: Alexander. Partner: Anel.
- [x] **Cancel** in-progress generation: AbortController passed to `fetch`; dispatches `cancel` reducer action; Cancel button shown during streaming. Owner: Alexander. Partner: Anel.
- [x] **Accept / Reject / Edit** suggestion: per-chunk buttons + "Apply all"/"Reject all"; accepted text inserted via `editor.chain().insertContent()`; Tiptap history handles Undo natively. Owner: Alexander. Partner: Anel.
- [x] **Partial acceptance** (bonus #4): backend streams word-level deltas → frontend splits completed text into paragraph chunks on `done`; per-chunk Accept/Reject in UI. `ai/aiState.ts` `replace_chunks` event. Owner: Alexander. Partner: Anel.
- [x] **History UI**: `components/AIHistoryList.tsx`; `GET /ai/history/:docId?user_id=`; shows operation, status, char counts. Owner: Alexander. Partner: Anel.
- [ ] **Strategy note** in README: how AI suggestions behave during concurrent edits (spec 3.3). Owner: Anel. Partner: Alexander.
- [x] Tests: 16 aiState reducer tests, 6 aiStream SSE consumer tests (including abort), 10 aiSidePanel UI tests (partial accept, edit, cancel, error). (32 new tests, 106/106 total passing) Owner: Alexander. Partner: Anel.

### Phase 7 — Quality & docs

- [ ] **Component tests** (Vitest + RTL): auth form, editor toolbar, AI suggestion panel, presence list. Owner: Alexander. Partner: Anel.
- [ ] **E2E tests** (Playwright, bonus #5): login → create doc → edit → AI rewrite → accept. Owner: Alexander. Partner: Yintong.
- [ ] **README**: auth lifecycle diagram (REST + WS), WS message protocol, collab strategy, AI concurrent-edit strategy. Owner: Yintong. Partners: Alexander, Anel.
- [ ] **Module READMEs**: short purpose note in each `src/` folder. Owner: Yintong.
- [ ] **DEVIATIONS.md**: update as we diverge from A1. Remove the "LWW instead of CRDT" row once Yjs is in. Owner: Yintong.
- [ ] **.env.example**: documented. Owner: Yintong. Partner: Anel.
  - [x] Frontend `.env.example` added at `frontend/.env.example` (`VITE_API_URL`, `VITE_WS_URL`; optional — dev proxy covers the default case). Owner: Alexander.

### Phase 8 — Demo prep

- [ ] Rehearse the 5-minute demo in the exact spec order: register → create → rich-text + auto-save → share with role enforcement → two-window collab → AI streaming (two features, suggestion UX, cancel) → version restore. Owner: Alexander. Partners: Yintong, Anel.
- [ ] Prepare Q&A answers: JWT refresh, end-to-end AI flow, concurrent edit handling, LLM failure scenarios, test coverage, A1 deviations. Owner: Yintong. Partners: Alexander, Anel.

---

## Risks

- **Yjs + Tiptap + custom WS provider**: happy path documented, but auth on provider needs care. Mitigation: JSON-envelope fallback.
- **Remote cursors**: stable color per user; derive from id hash, not random.
- **Backend blocking us**: if WS + doc endpoints slip, we stub with a mock server so we can keep building.

---

## Open questions for the team

- [x] Do we have a shared Gemini API key, or one key per dev in `.env`? We'll use env. variables
- [ ] Who owns the run-script / Makefile updates as features land?
- [ ] Who writes the final deviation report rollup before submission?
