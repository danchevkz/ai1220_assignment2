import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

export const BASE_URL = '/api/v1'

const REFRESH_TOKEN_KEY = 'refresh_token'

// Access token lives in memory only — never in localStorage
let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

export function setRefreshToken(token: string) {
  localStorage.setItem(REFRESH_TOKEN_KEY, token)
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function clearTokens() {
  accessToken = null
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Attach access token to every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// Flag to prevent infinite refresh loops
let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

function processQueue(newToken: string) {
  refreshQueue.forEach(cb => cb(newToken))
  refreshQueue = []
}

// On 401: try silent refresh, then replay the original request
apiClient.interceptors.response.use(
  response => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error)
    }

    // Don't loop on the refresh endpoint itself
    if (original.url?.includes('/auth/refresh')) {
      clearTokens()
      window.dispatchEvent(new Event('auth:logout'))
      return Promise.reject(error)
    }

    if (isRefreshing) {
      // Queue the request until the in-flight refresh resolves
      return new Promise(resolve => {
        refreshQueue.push((token: string) => {
          original.headers.Authorization = `Bearer ${token}`
          resolve(apiClient(original))
        })
      })
    }

    original._retry = true
    isRefreshing = true

    try {
      const refreshToken = getRefreshToken()
      if (!refreshToken) throw new Error('No refresh token')

      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
        refresh_token: refreshToken,
      })

      setAccessToken(data.access_token)
      if (data.refresh_token) setRefreshToken(data.refresh_token)

      processQueue(data.access_token)
      original.headers.Authorization = `Bearer ${data.access_token}`
      return apiClient(original)
    } catch {
      clearTokens()
      refreshQueue = []
      window.dispatchEvent(new Event('auth:logout'))
      return Promise.reject(error)
    } finally {
      isRefreshing = false
    }
  },
)
