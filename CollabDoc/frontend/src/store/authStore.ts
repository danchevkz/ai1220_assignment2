import { create } from 'zustand'
import { authApi } from '../api/auth'
import {
  setAccessToken,
  setRefreshToken,
  clearTokens,
  getRefreshToken,
} from '../api/client'
import type { User } from '../types'

export interface AuthState {
  user: User | null
  isLoading: boolean
  error: string | null

  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
  bootstrap: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  error: null,

  login: async (username, password) => {
    set({ isLoading: true, error: null })
    try {
      const tokens = await authApi.login({ username, password })
      setAccessToken(tokens.access_token)
      setRefreshToken(tokens.refresh_token)
      const user = await authApi.me()
      set({ user, isLoading: false })
    } catch (err: unknown) {
      const msg = extractError(err)
      set({ error: msg, isLoading: false })
      throw new Error(msg)
    }
  },

  register: async (username, email, password) => {
    set({ isLoading: true, error: null })
    try {
      await authApi.register({ username, email, password })
      // Auto-login after registration
      const tokens = await authApi.login({ username, password })
      setAccessToken(tokens.access_token)
      setRefreshToken(tokens.refresh_token)
      const user = await authApi.me()
      set({ user, isLoading: false })
    } catch (err: unknown) {
      const msg = extractError(err)
      set({ error: msg, isLoading: false })
      throw new Error(msg)
    }
  },

  logout: () => {
    clearTokens()
    set({ user: null, error: null })
  },

  // Called once on app mount — restore session from stored refresh token
  bootstrap: async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return

    set({ isLoading: true })
    try {
      const tokens = await authApi.refresh(refreshToken)
      setAccessToken(tokens.access_token)
      setRefreshToken(tokens.refresh_token)
      const user = await authApi.me()
      set({ user, isLoading: false })
    } catch {
      clearTokens()
      set({ isLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))

function extractError(err: unknown): string {
  console.error('[extractError]', err)
  if (err && typeof err === 'object') {
    if ('code' in err && (err as { code: string }).code === 'ERR_NETWORK') {
      return 'Cannot reach the server. Is the backend running?'
    }
    if ('response' in err) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
      const status = axiosErr.response?.status
      const detail = axiosErr.response?.data?.detail
      if (status === 502 || status === 503 || status === 504) {
        return 'Cannot reach the server. Is the backend running?'
      }
      return detail ?? 'An error occurred'
    }
  }
  if (err instanceof Error) return err.message
  return 'An error occurred'
}
