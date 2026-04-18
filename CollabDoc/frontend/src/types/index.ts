export interface User {
  id: string
  username: string
  email: string
  created_at: string
}

export interface AuthTokens {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
}

export type DocumentRole = 'owner' | 'editor' | 'viewer'

export interface DocumentCollaborator {
  user_id: string
  username: string
  email: string
  role: DocumentRole
}

export interface ShareLink {
  token: string
  role: DocumentRole
  created_at: string
  expires_at: string | null
  created_by: string
}

export interface DocumentVersion {
  version: number
  content: string
  saved_at: string
  saved_by: string
}

export interface Document {
  id: string
  title: string
  content: string
  owner_id: string
  created_at: string
  updated_at: string
  version: number
  collaborators: DocumentCollaborator[]
}

export interface DocumentSummary {
  id: string
  title: string
  owner_id: string
  created_at: string
  updated_at: string
  role: DocumentRole
}

export interface ApiError {
  detail: string
}

// ---------- AI suggestions ----------

export type AIAction = 'rewrite' | 'summarize'

// One chunk = one paragraph / logical unit of the suggestion. The backend
// streams text fragments tagged with a stable chunk id so the UI can show
// progressive output and allow per-chunk accept/reject (bonus #4).
export type AIChunkStatus =
  | 'streaming'
  | 'complete'
  | 'accepted'
  | 'rejected'

export interface AIChunk {
  id: string
  text: string
  status: AIChunkStatus
}

export type AIStatus =
  | 'idle'
  | 'streaming'
  | 'done'
  | 'cancelled'
  | 'error'

export interface AISuggestionState {
  action: AIAction | null
  sourceText: string
  chunks: AIChunk[]
  status: AIStatus
  error: string | null
  interactionId: string | null
}

// SSE event payloads. Each `data:` line on the wire is one of these,
// JSON-encoded. The discriminator is `type`.
// `replace_chunks` is an internal synthetic event emitted by the frontend
// adapter after the stream completes — it replaces the single accumulator
// chunk with paragraph-split chunks so partial accept has stable IDs.
export type AIStreamEvent =
  | { type: 'chunk'; id: string; text: string }
  | { type: 'chunk_end'; id: string }
  | { type: 'done'; interaction_id: string }
  | { type: 'error'; detail: string }
  | { type: 'replace_chunks'; chunks: Array<{ id: string; text: string }> }

export type AIInteractionOutcome =
  | 'accepted'
  | 'rejected'
  | 'partial'
  | 'cancelled'
  | 'pending'

export interface AIInteraction {
  id: string
  document_id: string
  user_id: string
  action: AIAction
  source_text: string
  result_text: string
  outcome: AIInteractionOutcome
  created_at: string
}
