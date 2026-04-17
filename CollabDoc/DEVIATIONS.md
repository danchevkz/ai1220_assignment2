# Architecture Deviations from Assignment 1

This document records every deviation between the Assignment 1 design and the final implementation,
per the submission requirements. Each entry states what changed, why, and whether it is an improvement
or a compromise.

| # | Area | A1 Design | Final Implementation | Reason | Assessment |
|---|------|-----------|----------------------|--------|------------|
| 1 | Storage | PostgreSQL / relational DB | In-memory dicts | Assignment spec explicitly permits it; removes setup friction for reviewers | Compromise — not production-safe; data lost on restart |
| 2 | Collab transport | (unspecified / assumed JSON ops) | Binary Yjs frames via `y-websocket` protocol, with `y-indexeddb` offline persistence on the client | Using the standard y-websocket client removes an entire class of sync bugs and gives us offline editing for free; matches the Yjs choice from A1 | Improvement — bonus #1 (character-level CRDT) is satisfied end-to-end |

---

_Add rows here as the implementation diverges further from the A1 design._
