# CollabDoc — Plan & Progress Tracker

Shared working document for the team. Update checkboxes as work lands. Add notes under a task rather than deleting it — the history is useful for the deviation report.

Last updated: 2026-04-17

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

- [ ] Confirm backend will accept **binary Yjs frames** on the WS (or agree on JSON envelope fallback).
- [ ] Agree on **awareness channel** — same WS, separate message type.
- [ ] Agree on **share-by-link** endpoint shape: `POST /documents/:id/share-links` → `{ token, role, expiresAt }`; `DELETE /documents/:id/share-links/:token`.
- [ ] Agree on **AI SSE chunk format** — must include stable chunk/paragraph IDs so we can build per-chunk accept/reject UI for bonus #4.
- [ ] Branch/PR strategy: feature branches + PRs with reviews. Rubric flags "single final commit" as a red flag.

---

## Our build order (Frontend & Collaboration)

Sequencing is dependency-driven. Tests land with the feature, not after.

### Phase 1 — Foundations (unblocks everything else)

- [x] **App shell**: router, layout, 404.
- [x] **Auth UI**: Login, Register pages.
- [x] **Auth state**: Zustand `authStore`; persist refresh token in localStorage; access token in memory.
- [x] **axios client** with refresh interceptor (no raw 401s during editing — spec 1.1).
- [x] **`ProtectedRoute`** wrapper.
- [x] Tests: login form happy path + error path. (6/6 passing)

### Phase 2 — Document surface

- [x] **Dashboard**: list of accessible docs, create button, navigate.
- [x] **Document page scaffold**: title edit, back link.
- [x] **Tiptap editor** (StarterKit: headings, bold, italic, lists, code-block) + placeholder + toolbar.
- [x] **Auto-save**: debounced PATCH, status indicator ("Saving…" / "Saved" / "Error").
- [x] **Version history drawer**: list snapshots, preview, restore.
- [ ] Tests: toolbar commands, auto-save debounce.

### Phase 3 — Real-time collaboration (highest risk, tackle early)

- [ ] **Yjs integration**: `Y.Doc` per document, `@tiptap/extension-collaboration`.
- [ ] **WS provider**: custom adapter or `y-websocket` client, wires token into URL.
- [ ] **Two-tab sync proof**: character-level edits propagate < 500ms locally. Demo-ready.
- [ ] **Connection lifecycle**: initial load, join active session, disconnect/reconnect, state reconciliation.
- [ ] **Offline editing**: `y-indexeddb` persistence; queue survives reload; reconciles on reconnect.
- [ ] Tests: WS provider unit test with mock socket; reconnection logic.

### Phase 4 — Presence & awareness

- [ ] **Awareness state**: per-user `{ name, color }` derived from user id hash (stable colors).
- [ ] **Online users** avatar stack in the header.
- [ ] **Typing indicator** / activity status.
- [ ] **Remote cursors & selections** via `@tiptap/extension-collaboration-cursor` (bonus #2).
- [ ] Tests: awareness state reducer; color derivation stable.

### Phase 5 — Sharing UI

- [ ] **Share modal**: invite by email/username with role picker (owner/editor/viewer).
- [ ] **Access list**: current collaborators + role change + remove.
- [ ] **Share-by-link** (bonus #3): generate link, copy, configure role, revoke.
- [ ] Tests: modal role picker, link revoke optimistic update.

### Phase 6 — AI suggestion UI

- [ ] **AI side panel**: triggered from selection; "Rewrite" and "Summarize" at minimum.
- [ ] **Streaming render**: consume SSE via `fetch` + `ReadableStream`; progressive text.
- [ ] **Cancel** in-progress generation.
- [ ] **Accept / Reject / Edit** suggestion, with Undo after acceptance.
- [ ] **Partial acceptance** (bonus #4): per-chunk/paragraph accept/reject in diff view.
- [ ] **History UI**: per-doc list of past interactions with accept/reject status.
- [ ] **Strategy note** in README: how AI suggestions behave during concurrent edits (spec 3.3).
- [ ] Tests: streaming reducer, accept applies to doc, cancel aborts fetch.

### Phase 7 — Quality & docs

- [ ] **Component tests** (Vitest + RTL): auth form, editor toolbar, AI suggestion panel, presence list.
- [ ] **E2E tests** (Playwright, bonus #5): login → create doc → edit → AI rewrite → accept.
- [ ] **README**: auth lifecycle diagram (REST + WS), WS message protocol, collab strategy, AI concurrent-edit strategy.
- [ ] **Module READMEs**: short purpose note in each `src/` folder.
- [ ] **DEVIATIONS.md**: update as we diverge from A1. Remove the "LWW instead of CRDT" row once Yjs is in.
- [ ] **.env.example**: documented.

### Phase 8 — Demo prep

- [ ] Rehearse the 5-minute demo in the exact spec order: register → create → rich-text + auto-save → share with role enforcement → two-window collab → AI streaming (two features, suggestion UX, cancel) → version restore.
- [ ] Prepare Q&A answers: JWT refresh, end-to-end AI flow, concurrent edit handling, LLM failure scenarios, test coverage, A1 deviations.

---

## Risks

- **Yjs + Tiptap + custom WS provider**: happy path documented, but auth on provider needs care. Mitigation: JSON-envelope fallback.
- **Remote cursors**: stable color per user; derive from id hash, not random.
- **Backend blocking us**: if WS + doc endpoints slip, we stub with a mock server so we can keep building.

---

## Open questions for the team

- [ ] Do we have a shared Gemini API key, or one key per dev in `.env`? We'll use env. variables
- [ ] Who owns the run-script / Makefile updates as features land?
- [ ] Who writes the final deviation report rollup before submission?
