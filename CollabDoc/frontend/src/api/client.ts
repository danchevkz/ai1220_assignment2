import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

const BASE_URL = '/api/v1'

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

// Shared in-flight refresh so concurrent 401s (axios and SSE) coalesce
// into a single /auth/refresh call.
let refreshInFlight: Promise<string> | null = null

// Perform a token refresh using the stored refresh token, update in-memory
// state, and broadcast `auth:tokenRefreshed` so non-axios consumers (SSE,
// WebSocket) can pick up the new token. Throws when no refresh token is
// available or the endpoint rejects.
export function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight
  const p = (async () => {
    const rt = getRefreshToken()
    if (!rt) throw new Error('No refresh token')
    const { data } = await axios.post<{ access_token: string; refresh_token?: string }>(
      `${BASE_URL}/auth/refresh`,
      { refresh_token: rt },
    )
    setAccessToken(data.access_token)
    if (data.refresh_token) setRefreshToken(data.refresh_token)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('auth:tokenRefreshed', {
          detail: { accessToken: data.access_token },
        }),
      )
    }
    return data.access_token
  })()
  refreshInFlight = p
  // Clear the in-flight slot once settled so the next expiry can refresh again.
  // Swallow rejection on the derived handle so it doesn't surface as an
  // unhandled rejection; the original promise is what callers await.
  p.catch(() => { /* surfaced via awaited promise */ }).finally(() => {
    if (refreshInFlight === p) refreshInFlight = null
  })
  return p
}

// Fire-and-clear the logout signal so axios, SSE and the collaboration
// provider all react identically on unrecoverable auth failures.
export function triggerLogout() {
  clearTokens()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('auth:logout'))
  }
}

// Queue of axios requests waiting on the in-flight refresh.
type QueueEntry = { resolve: (token: string) => void; reject: (err: unknown) => void }
let refreshQueue: QueueEntry[] = []

function processQueue(newToken: string) {
  refreshQueue.forEach(e => e.resolve(newToken))
  refreshQueue = []
}

function rejectQueue(err: unknown) {
  refreshQueue.forEach(e => e.reject(err))
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
      triggerLogout()
      return Promise.reject(error)
    }

    if (refreshInFlight) {
      // Queue the request until the in-flight refresh resolves
      return new Promise((resolve, reject) => {
        refreshQueue.push({
          resolve: (token: string) => {
            original.headers.Authorization = `Bearer ${token}`
            resolve(apiClient(original))
          },
          reject,
        })
      })
    }

    original._retry = true

    try {
      const newToken = await refreshAccessToken()
      processQueue(newToken)
      original.headers.Authorization = `Bearer ${newToken}`
      return apiClient(original)
    } catch (refreshErr) {
      rejectQueue(refreshErr)
      triggerLogout()
      return Promise.reject(error)
    }
  },
)
