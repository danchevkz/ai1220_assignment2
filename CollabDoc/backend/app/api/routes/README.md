# `app/api/routes/`

FastAPI routers mounted under `/api/v1` by `app/main.py`.

| File | Prefix | Purpose |
|------|--------|---------|
| `auth.py` | `/auth` | Register, login, refresh, `/me`. Issues and decodes JWTs via `app.core.security`. |
| `documents.py` | `/documents` | Document CRUD, collaborator management, share-by-link (create/list/revoke/redeem), version history and restore. Version reads pull a live snapshot from the Yjs room via `app/websocket/collaboration.py`. |
| `ai.py` | `/ai` | SSE streaming endpoints for rewrite/summarize, generation cancel, per-user interaction history. Uses the provider from `app/services/ai/provider.py`. |

Auth is enforced by the `get_current_user` dependency in `app/api/deps.py`; role checks live next to each handler in `documents.py`.
