# `src/ai/`

Pure state logic for the AI writing assistant, independent of React.

`aiState.ts` is a reducer keyed by `request_id` with actions for
`start`, `append_delta`, `replace_chunks` (fired on `done: true` — splits
the accumulated text into paragraph chunks so each can be accepted or
rejected individually, bonus #4), `accept`, `reject`, `cancel`, and
`error`. The reducer is imported by `hooks/useAISuggestion.ts` and tested
directly in `src/test/aiState.test.ts`.

Keeping this layer framework-free makes the reducer trivially testable and
lets the same state machine back both the side panel and any future inline
presentation.
