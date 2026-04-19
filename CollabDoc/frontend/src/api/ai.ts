import { apiClient } from './client'

export type WritingOperation = 'rewrite' | 'summarize'
export type InteractionStatus = 'pending' | 'completed' | 'failed' | 'cancelled'

export interface AIInteractionHistoryItem {
  operation: WritingOperation
  timestamp: string
  status: InteractionStatus
  input_text_length: number
  output_text_length: number
}

export interface CancelGenerationResponse {
  request_id: string
  cancelled: boolean
  status: InteractionStatus
}

export const aiApi = {
  history: (documentId: string) =>
    apiClient.get<AIInteractionHistoryItem[]>(`/ai/history/${documentId}`).then(r => r.data),

  cancelGeneration: (requestId: string) =>
    apiClient
      .post<CancelGenerationResponse>(`/ai/generations/${requestId}/cancel`)
      .then(r => r.data),
}
