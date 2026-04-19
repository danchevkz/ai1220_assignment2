# Architecture Deviations from Assignment 1

This document records every deviation between the Assignment 1 design and the final implementation,
per the submission requirements. Each entry states what changed, why, and whether it is an improvement
or a compromise.

| # | Area | A1 Design | Final Implementation | Reason | Assessment |
|---|------|-----------|----------------------|--------|------------|
| 1 | Storage | PostgreSQL / relational DB | In-memory dicts | Assignment spec explicitly permits it; removes setup friction for reviewers | Compromise — not production-safe; data lost on restart |
| 2 | Collab transport | (unspecified / assumed JSON ops) | Binary Yjs frames via `y-websocket` protocol, with `y-indexeddb` offline persistence on the client | Using the standard y-websocket client removes an entire class of sync bugs and gives us offline editing for free; matches the Yjs choice from A1 | Improvement — bonus #1 (character-level CRDT) is satisfied end-to-end |
| 3 | AI streaming transport | Not fixed in A1 / could have been synchronous REST or WebSocket | Server-Sent Events via FastAPI `StreamingResponse`, consumed with `fetch` + `ReadableStream` on the frontend | SSE gives simple one-way progressive output without adding a second real-time protocol beyond collaboration WebSockets | Improvement — straightforward streaming implementation |
| 4 | AI prompt scope | AI assistant could have used broad document context | Requests are built from the user’s selected text plus bounded request context (`document_id`, `user_id`, instructions, operation options) | Keeps prompts aligned with explicit user intent and avoids blindly sending the full document | Improvement — tighter and more predictable prompting |
| 5 | AI suggestion application UX | AI output could have been inserted directly into the document | Suggestions remain pending in the side panel until explicit **Accept**; users can **Cancel**, **Reject**, edit before apply, and **Undo** after accept | Safer for collaborative editing because generated text is not committed automatically | Improvement — better human control over AI edits |
| 6 | AI cancellation support | A1 did not require a cancel path for in-flight generation | Frontend aborts the active stream with `AbortController` and calls `POST /ai/generations/{request_id}/cancel` when a request id exists | Lets users stop unwanted generations without waiting for stream completion | Improvement — better control for long-running requests |
| 7 | Concurrent edit handling for AI suggestions | A stronger design could rebase pending suggestions against later document changes | Pending AI suggestions are not rebased; if the selected text changes before acceptance, the user must review, regenerate, reject, or undo | Avoids a much larger conflict-resolution layer for Assignment 2 scope | Compromise — understandable but not fully conflict-aware |
| 8 | Partial AI acceptance bonus | A richer AI workflow could support accepting only part of a suggestion | Current flow applies or undoes the whole accepted suggestion for the selected range; partial acceptance/merge tooling is not implemented | Kept the AI workflow smaller and more testable for Assignment 2 scope | Compromise — bonus-level refinement remains unfinished |
| 9 | AI provider integration | A1 likely assumed a real external model provider | Current backend uses the in-repo `EchoAIProvider` / `mock-writing-model` for deterministic development and testing | Removes external setup and cost dependencies for grading, but the generated quality is not representative of a production LLM | Compromise — real provider integration remains unfinished |

---

_Add rows here as the implementation diverges further from the A1 design._
