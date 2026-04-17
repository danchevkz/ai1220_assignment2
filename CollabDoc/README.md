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

## Architecture deviations from Assignment 1

_Document this section as you deviate from your A1 design._

| Deviation | Reason | Assessment |
|-----------|--------|------------|
| In-memory storage instead of database | Assignment spec explicitly allows it; simpler setup | Compromise — not production-safe |
| Last-write-wins for concurrent edits | Baseline requirement; full CRDT is bonus | Compromise — acceptable for baseline |
