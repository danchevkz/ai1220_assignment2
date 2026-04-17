// Normalize axios errors into user-facing messages.
// Handles: backend-provided `detail`, network errors, and Vite-proxy 502/503/504
// (which surface as real responses when the upstream is down).
export function extractError(err: unknown, fallback = 'An error occurred'): string {
  if (err && typeof err === 'object') {
    if ('code' in err && (err as { code: string }).code === 'ERR_NETWORK') {
      return 'Cannot reach the server. Is the backend running?'
    }
    if ('response' in err) {
      const res = (err as { response?: { status?: number; data?: { detail?: string } } }).response
      if (res?.status && res.status >= 502 && res.status <= 504) {
        return 'Cannot reach the server. Is the backend running?'
      }
      return res?.data?.detail ?? fallback
    }
  }
  if (err instanceof Error) return err.message
  return fallback
}
