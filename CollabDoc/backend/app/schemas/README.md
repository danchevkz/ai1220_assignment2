# `app/schemas/`

Pydantic models describing the REST wire format — request bodies and response
payloads. Split by domain (`auth.py`, `documents.py`, `ai.py`) to match the
routers.

Schemas never reference the in-memory records directly. Handlers read
`*Record` objects from `app.models.store` and serialize them into `*Read`
schemas before returning, so the wire shape is independent of how state is
stored.
