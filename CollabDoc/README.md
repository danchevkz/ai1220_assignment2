# CollabDoc — Collaborative Document Editor with AI Writing Assistant

Assignment 2 · AI1220 Software Engineering · MBZUAI · April 2026

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite, Tiptap rich-text editor, Zustand |
| Backend | FastAPI, python-jose (JWT), passlib (bcrypt), Anthropic SDK |
| Auth | JWT access tokens (20 min) + refresh tokens (7 days) |
| Real-time | WebSocket (FastAPI native) |
| AI Streaming | SSE via FastAPI `StreamingResponse` |
| Storage | In-memory (no database required per spec) |

## Quick start

```bash
# 1. Copy env and fill in your Anthropic key
cp .env.example backend/.env

# 2. Install all dependencies
make install

# 3. Start both servers (runs on :8000 and :5173)
make dev
```

Then open http://localhost:5173.

## Environment variables

See [.env.example](.env.example) for all required variables. The only secret you must set is `ANTHROPIC_API_KEY`.

## AI-related environment variables

The current AI writing flow in this repository does not require any extra frontend environment variables.

Backend AI generation currently uses the in-repo `EchoAIProvider` (`backend/app/ai/provider.py`) for Assignment 2 development and testing, so there is no additional AI model endpoint or API key required for the implemented `/ai/*` routes.

## Running tests

```bash
make test          # all tests
make test-backend  # pytest (unit + integration)
make test-frontend # vitest
```

## Project structure

```
.
├── backend/
│   ├── app/
│   │   ├── api/routes/      # auth, documents, ai endpoints
│   │   ├── core/            # config, security, dependencies
│   │   ├── models/          # in-memory stores (user, document, ai_history)
│   │   ├── schemas/         # Pydantic request/response models
│   │   ├── services/ai/     # provider abstraction + prompt templates
│   │   ├── websocket/       # WS connection manager + router
│   │   └── main.py
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── api/             # axios client + per-domain helpers
│       ├── components/      # auth forms, editor, AI panel, layout
│       ├── hooks/           # useWebSocket, useAutoSave
│       ├── pages/           # Login, Register, Dashboard, Document
│       ├── store/           # Zustand: authStore, documentStore
│       └── types/           # shared TypeScript types
├── .env.example
├── Makefile
└── README.md
```

## API overview

FastAPI auto-generates interactive docs at http://localhost:8000/docs.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | — | Register |
| POST | `/api/v1/auth/login` | — | Login → tokens |
| POST | `/api/v1/auth/refresh` | — | Refresh access token |
| GET | `/api/v1/auth/me` | ✓ | Current user |
| GET | `/api/v1/documents` | ✓ | List accessible docs |
| POST | `/api/v1/documents` | ✓ | Create doc |
| GET | `/api/v1/documents/:id` | ✓ | Get doc (viewer+) |
| PATCH | `/api/v1/documents/:id` | ✓ | Update doc (editor+) |
| DELETE | `/api/v1/documents/:id` | ✓ | Delete doc (owner) |
| POST | `/api/v1/documents/:id/share` | ✓ | Share with role (owner) |
| GET | `/api/v1/documents/:id/versions` | ✓ | Version history |
| POST | `/api/v1/documents/:id/versions/:v/restore` | ✓ | Restore version |
| POST | `/api/v1/ai/stream` | ✓ | Stream AI suggestion (SSE) |
| GET | `/api/v1/ai/history/:docId` | ✓ | AI interaction history |
| POST | `/api/v1/ai/history/:id/accept` | ✓ | Accept/reject suggestion |
| WS | `/ws/:docId?token=` | JWT | Real-time collaboration |

## End-to-end AI flow

1. In the document page, the user selects text in the Tiptap editor.
2. The frontend `DocumentPage` captures the current selection text and range, then shows the AI side panel.
3. The AI panel sends either `POST /api/v1/ai/rewrite/stream` or `POST /api/v1/ai/summarize/stream`.
4. The backend streams `text/event-stream` chunks and returns `X-Request-ID` so the frontend can track and cancel the generation.
5. The frontend accumulates the streamed output in panel-local state; the document is not changed during generation.
6. On **Accept**, the current selection range is replaced in the editor. On **Reject**, the suggestion is discarded. On **Undo**, the pre-accept text is restored.
7. Completed AI interactions are available through `GET /api/v1/ai/history/{document_id}` and shown in the per-document AI history panel.

## AI suggestions during concurrent edits

AI output stays pending in the side panel until the user clicks **Accept**, so suggestions do not automatically overwrite collaborative content.

The request is built from the user’s selected text plus bounded request context (`document_id`, `user_id`, optional instructions, and operation-specific options). It does not blindly send the full document.

If the selected range changes before acceptance because of local or remote edits, the pending suggestion may no longer match the latest document exactly. The user can **Cancel** while streaming, **Reject** after generation, **Edit** the suggestion before applying it, or use **Undo** after acceptance to restore the previous text.

## AI frontend test coverage

Frontend AI coverage is implemented with Vitest + React Testing Library and focuses on the concrete workflow:

- `useAIStream.test.ts`: progressive SSE chunk accumulation and cancel/abort behavior
- `aiIntegration.test.tsx`: accepting a suggestion applies the replacement callback; rejecting does not modify the document
- `aiSidePanel.test.tsx`: AI side panel idle, streaming, finished, cancel-button, Accept, Reject, and action-selection states
- `aiHistoryPanel.test.tsx`: per-document AI history item rendering and empty-state behavior

## AI streaming + cancellation behavior

The frontend starts AI generation with `fetch` against `POST /api/v1/ai/rewrite/stream` or `POST /api/v1/ai/summarize/stream` and reads `text/event-stream` chunks progressively with `ReadableStream`. Each response also returns `X-Request-ID`, which the frontend stores for follow-up cancellation.

While streaming, partial output is shown in the AI side panel and stays separate from the document. Clicking **Cancel** aborts the active fetch with `AbortController` and then calls `POST /api/v1/ai/generations/{request_id}/cancel` if a request id was issued. The user can also **Reject** the completed suggestion, or edit it before applying it.

## AI history behavior per document

AI history is fetched per document with `GET /api/v1/ai/history/{document_id}` and shown in the side panel for the currently open document only.

History entries are document-scoped summaries of previous AI actions, including operation type, status, timestamp, and input/output lengths. Accepting or rejecting a pending suggestion does not directly mutate the history UI state; the panel reloads history after completed generations, and the accepted text is only written into the document when the user clicks **Accept**.

## Architecture deviations from Assignment 1

_Document this section as you deviate from your A1 design._

| Deviation | Reason | Assessment |
|-----------|--------|------------|
| In-memory storage instead of database | Assignment spec explicitly allows it; simpler setup | Compromise — not production-safe |
| Last-write-wins for concurrent edits | Baseline requirement; full CRDT is bonus | Compromise — acceptable for baseline |
| AI streaming transport uses SSE (`StreamingResponse`) | Simpler one-way token streaming over standard HTTP; fits the current FastAPI + fetch implementation | Improvement — lower integration complexity for streaming suggestions |
| AI prompting uses selected text plus bounded request context | Reduces accidental over-sharing and keeps the request aligned with the user’s explicit selection | Improvement — more controllable than sending the whole document blindly |
| AI suggestions stay in the side panel until Accept | Keeps generated text out of the shared document until the user explicitly applies it | Improvement — safer UX for collaborative editing |
| AI generation supports explicit cancellation | Frontend aborts the active SSE fetch and calls the backend cancel endpoint using `X-Request-ID` | Improvement — users are not forced to wait for an unwanted generation to finish |
| Pending AI suggestions are not rebased across concurrent edits | The current implementation stores and reapplies the last known selection range; users may need to review, reject, or regenerate after remote edits | Compromise — simple and understandable, but not fully conflict-aware |
| Partial acceptance of AI output is not implemented | The current flow applies or undoes the whole accepted suggestion for the selected range rather than merging accepted subranges | Compromise — bonus-level refinement remains unfinished |
| AI backend currently uses the in-repo `EchoAIProvider` | Keeps Assignment 2 setup lightweight and deterministic for demo/testing, but does not provide real model quality | Compromise — real external LLM integration is still unfinished |
