# Architecture Deviations from Assignment 1

This document records every deviation between the Assignment 1 design and the
final implementation, per the submission requirements. Each entry states what
changed, why, and whether it is an improvement or a compromise.

| # | Area | A1 design | Final implementation | Reason | Assessment |
|---|------|-----------|----------------------|--------|------------|
| 1 | Storage | PostgreSQL / relational DB | In-memory dicts in `app/models/store.py` | Assignment spec explicitly permits it; removes setup friction for reviewers | Compromise — not production-safe; data lost on restart. Yjs rooms persist to disk via `FileYStore` so live document content survives a restart even though users/AI history do not. |
| 2 | Concurrent edits | Last-write-wins on full document PATCH | Character-level CRDT via Yjs + `y-websocket`, `y-indexeddb` offline persistence on the client | Using the standard y-websocket client removes an entire class of sync bugs, gives us offline editing for free, and satisfies bonus #1 end-to-end | Improvement — replaces the planned LWW compromise with a real CRDT. |
| 3 | WS wire format | Custom JSON envelope over a FastAPI WebSocket route | Standard binary Yjs protocol served by `ypy-websocket` mounted as an ASGI app at `/ws/:docId` | Reuses the y-websocket client on the frontend verbatim — no hand-rolled diffing or awareness protocol | Improvement — interoperable with stock Yjs tooling and far less code. |
| 4 | Presence / cursors | Out of scope in A1 | Tiptap `CollaborationCursor` + awareness channel with stable per-user colour derived from user id hash | Cheap once Yjs is in place; covers bonus #2 | Improvement — was a bonus, landed it. |
| 5 | Share semantics | Role-based ACL by invite only | Invite **and** share-by-link with optional expiry (24h / 7d / 30d / never) + public `/share/:token` redeem landing page | Link sharing is a common UX and the baseline ACL still governs access, so the token only grants the role it was minted with | Improvement — adds bonus #3 without weakening the base auth model. |
| 6 | AI provider | Anthropic / external LLM | `MockLLMProvider` behind a provider interface in `app/services/ai/provider.py` | Deterministic provider lets the whole AI flow (streaming, cancel, partial accept, history) be exercised by tests and demoed offline without an API key. Swappable in one file. | Compromise on realism, improvement on testability. Swap is a single-file change if an API key is added later. |
| 7 | AI delivery | Single response JSON | SSE stream (`POST /ai/{op}/stream`) with `{ request_id, operation, delta, done }` frames; per-paragraph partial acceptance on the client | Streaming is required by the spec and paragraph-level chunking enables bonus #4 | Improvement — meets spec + bonus in one design. |
| 8 | AI insertion flow | Replace selection inline while streaming | Suggestion streams into a side panel; insertion into the Y.Doc only happens on explicit Accept / Apply | Keeps concurrent edits safe (the source text can change while the model is generating); merges as a normal Yjs edit so it coexists with other users' changes | Improvement — removes a concurrent-edit race we would otherwise have had to fight. |
| 9 | Auth for WebSocket | TBD in A1 (note: "decide before build") | `?token=<access_jwt>` query param, validated on connect against user + document ACL; rejected connections close with code 1008 | Browsers can't set custom headers on WS; the same access token the REST layer accepts is reused so there is no second credential to manage | Compromise on form (query param tokens show up in access logs) — acceptable given in-memory, short-lived dev tokens; documented in README. |
| 10 | Frontend state | Redux | Zustand (`authStore`, `documentStore`) | Smaller footprint, no boilerplate, same capabilities for what we need | Improvement — strictly less code. |
| 11 | Testing | Manual | Three-layer automated suite: pytest (backend), vitest + RTL (frontend unit, 106 tests), Playwright (8 E2E specs including two-browser-context CRDT) | A1 feedback docked us for having no automated tests; tests land with each feature | Improvement — covers Assignment 1 feedback item 4 and bonus #5. |
| 12 | Documentation surface | Single top-level README | Top-level README with per-layer tech + auth/WS/collab/AI sections, plus module READMEs under `backend/app/**` and `frontend/src/**`, plus this DEVIATIONS.md and PLAN.md | A1 feedback docked us for missing tech-per-container responsibilities | Improvement — directly addresses Assignment 1 feedback items 1 and 3. |

---

_Add rows here as the implementation diverges further._
