# `app/core/`

Cross-cutting primitives shared by every router.

| File | Purpose |
|------|---------|
| `config.py` | Pydantic `Settings` (reads `backend/.env`). JWT secret/algorithm, token TTLs, CORS origins, on-disk `ystore` path. |
| `security.py` | Password hashing (`passlib[bcrypt]`), JWT issue/decode (`python-jose`, HS256), access vs refresh token types. |

Dependencies (e.g. `get_current_user`) live one level up in `app/api/deps.py` to keep this layer import-cycle-free.
