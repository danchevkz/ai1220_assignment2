import { apiClient } from './client'
import type {
  Document,
  DocumentSummary,
  DocumentVersion,
  DocumentRole,
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

  versions: (id: string) =>
    apiClient.get<DocumentVersion[]>(`/documents/${id}/versions`).then(r => r.data),

  restoreVersion: (id: string, version: number) =>
    apiClient
      .post<Document>(`/documents/${id}/versions/${version}/restore`)
      .then(r => r.data),
}
