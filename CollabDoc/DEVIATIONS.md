# Architecture Deviations from Assignment 1

This document records every deviation between the Assignment 1 design and the final implementation,
per the submission requirements. Each entry states what changed, why, and whether it is an improvement
or a compromise.

| # | Area | A1 Design | Final Implementation | Reason | Assessment |
|---|------|-----------|----------------------|--------|------------|
| 1 | Storage | PostgreSQL / relational DB | In-memory dicts | Assignment spec explicitly permits it; removes setup friction for reviewers | Compromise — not production-safe; data lost on restart |
| 2 | Conflict resolution | CRDT (Yjs) | Last-write-wins | CRDT is bonus-tier per spec; baseline is acceptable | Compromise — acceptable for baseline; CRDT tracked as bonus |

---

_Add rows here as the implementation diverges further from the A1 design._
