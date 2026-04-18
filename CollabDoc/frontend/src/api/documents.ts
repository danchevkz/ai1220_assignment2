import { apiClient } from './client'
import type {
  Document,
  DocumentSummary,
  DocumentVersion,
  DocumentRole,
  ShareLink,
} from '../types'

export interface CreateDocumentRequest {
  title?: string
}

export interface UpdateDocumentRequest {
  title?: string
  content?: string
}

export interface ShareRequest {
  username_or_email: string
  role: DocumentRole
}

export interface UpdateCollaboratorRequest {
  role: DocumentRole
}

export interface CreateShareLinkRequest {
  role: DocumentRole
  expires_in_hours?: number | null
}

export const documentsApi = {
  list: () =>
    apiClient.get<DocumentSummary[]>('/documents').then(r => r.data),

  create: (data: CreateDocumentRequest = {}) =>
    apiClient.post<Document>('/documents', data).then(r => r.data),

  get: (id: string) =>
    apiClient.get<Document>(`/documents/${id}`).then(r => r.data),

  update: (id: string, data: UpdateDocumentRequest) =>
    apiClient.patch<Document>(`/documents/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    apiClient.delete<void>(`/documents/${id}`).then(r => r.data),

  share: (id: string, data: ShareRequest) =>
    apiClient.post<Document>(`/documents/${id}/share`, data).then(r => r.data),

  updateCollaborator: (id: string, userId: string, data: UpdateCollaboratorRequest) =>
    apiClient
      .patch<Document>(`/documents/${id}/collaborators/${userId}`, data)
      .then(r => r.data),

  removeCollaborator: (id: string, userId: string) =>
    apiClient
      .delete<Document>(`/documents/${id}/collaborators/${userId}`)
      .then(r => r.data),

  listShareLinks: (id: string) =>
    apiClient.get<ShareLink[]>(`/documents/${id}/share-links`).then(r => r.data),

  createShareLink: (id: string, data: CreateShareLinkRequest) =>
    apiClient.post<ShareLink>(`/documents/${id}/share-links`, data).then(r => r.data),

  revokeShareLink: (id: string, token: string) =>
    apiClient
      .delete<void>(`/documents/${id}/share-links/${token}`)
      .then(r => r.data),

  versions: (id: string) =>
    apiClient.get<DocumentVersion[]>(`/documents/${id}/versions`).then(r => r.data),

  restoreVersion: (id: string, version: number) =>
    apiClient
      .post<Document>(`/documents/${id}/versions/${version}/restore`)
      .then(r => r.data),
}
