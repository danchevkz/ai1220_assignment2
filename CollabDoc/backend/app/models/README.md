# `app/models/`

In-memory persistence. The assignment spec explicitly allows skipping a real
database, so all state lives in a single process-global `store` object.

`store.py` defines dataclass records (`UserRecord`, `DocumentRecord`,
`VersionRecord`, `ShareLinkRecord`, `AIInteractionRecord`) and a `Store`
facade exposing create / find / touch / list operations. Yjs document state
is **not** held here — it lives on disk under `.data/ystore/` via
`FileYStore` (see `app/websocket/`). Only the REST-facing view (title,
collaborator roles, version list) is kept in this store.

Tests reset the module-level `store` between cases; production usage is
single-process.
