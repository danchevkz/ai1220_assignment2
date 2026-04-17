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
