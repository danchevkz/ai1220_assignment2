import { apiClient } from './client'
import type { AuthTokens, User } from '../types'

export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
}

export const authApi = {
  login: (data: LoginRequest) =>
    apiClient.post<AuthTokens>('/auth/login', data).then(r => r.data),

  register: (data: RegisterRequest) =>
    apiClient.post<User>('/auth/register', data).then(r => r.data),

  refresh: (refresh_token: string) =>
    apiClient.post<AuthTokens>('/auth/refresh', { refresh_token }).then(r => r.data),

  me: () =>
    apiClient.get<User>('/auth/me').then(r => r.data),
}
