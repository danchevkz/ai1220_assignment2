# `src/hooks/`

Thin React hooks that glue the pure logic layer (`src/ai/`, `src/collab/`,
`src/api/`) to components.

| Hook | Purpose |
|------|---------|
| `useCollaborativeDoc.ts` | Creates a `Y.Doc` + `YjsProvider` for a document id, tears them down on unmount, and returns the status / synced flag for the UI. |
| `useAwareness.ts` | Subscribes to the provider's awareness map, exposes the active-user list and a throttled `markActive` for typing indicators. |
| `useAutoSave.ts` | Debounced PATCH of title / content changes; surfaces `Saving...` / `Saved` / `Error` status. |
| `useAISuggestion.ts` | Drives the `aiState` reducer from the SSE consumer in `api/ai.ts`, including cancel + error handling. |
