import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import axios, { AxiosAdapter, AxiosError, AxiosResponse } from 'axios'
import {
  apiClient,
  setAccessToken,
  setRefreshToken,
  getAccessToken,
  getRefreshToken,
} from '../api/client'

// Direct coverage for the axios response interceptor in `src/api/client.ts`.
// The SSE path is exercised by tokenExpiry.test.ts; this file pins down the
// axios-layer 401 → refresh → retry contract that `apiApi` helpers rely on.

function resp(status: number, data: unknown, url: string): AxiosResponse {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    headers: {},
    config: { url } as any,
  }
}

describe('apiClient response interceptor — axios 401 handling', () => {
  const originalAdapter = apiClient.defaults.adapter

  beforeEach(() => {
    vi.restoreAllMocks()
    setAccessToken('stale-access')
    setRefreshToken('valid-refresh')
  })

  afterEach(() => {
    apiClient.defaults.adapter = originalAdapter
    setAccessToken(null)
    localStorage.clear()
  })

  it('on 401, refreshes the access token and replays the original request with the new Bearer', async () => {
    const calls: Array<{ url?: string; auth?: string }> = []
    const adapter: AxiosAdapter = async config => {
      calls.push({
        url: config.url,
        auth: (config.headers?.Authorization as string) ?? undefined,
      })
      if (calls.length === 1) {
        const err = new AxiosError('Unauthorized', '401', config, null, resp(401, { detail: 'expired' }, config.url ?? ''))
        err.response = resp(401, { detail: 'expired' }, config.url ?? '')
        throw err
      }
      return resp(200, { ok: true }, config.url ?? '')
    }
    apiClient.defaults.adapter = adapter

    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { access_token: 'fresh-access', refresh_token: 'fresh-refresh' } })

    const res = await apiClient.get('/documents')

    expect(res.status).toBe(200)
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(postSpy.mock.calls[0][0]).toContain('/auth/refresh')
    expect(calls).toHaveLength(2)
    expect(calls[0].auth).toBe('Bearer stale-access')
    expect(calls[1].auth).toBe('Bearer fresh-access')
    expect(getAccessToken()).toBe('fresh-access')
    expect(getRefreshToken()).toBe('fresh-refresh')
  })

  it('on refresh failure, clears tokens, dispatches auth:logout, and rejects the original 401', async () => {
    const adapter: AxiosAdapter = async config => {
      const err = new AxiosError('Unauthorized', '401', config, null, resp(401, { detail: 'expired' }, config.url ?? ''))
      err.response = resp(401, { detail: 'expired' }, config.url ?? '')
      throw err
    }
    apiClient.defaults.adapter = adapter

    vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('refresh denied'))

    const logoutSpy = vi.fn()
    window.addEventListener('auth:logout', logoutSpy)

    await expect(apiClient.get('/documents')).rejects.toMatchObject({
      response: { status: 401 },
    })

    window.removeEventListener('auth:logout', logoutSpy)
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('does not retry the refresh endpoint itself — triggers logout instead', async () => {
    // A 401 from /auth/refresh means the refresh token is bad; looping would
    // just hammer the server. The interceptor must bail out to logout.
    const adapter: AxiosAdapter = async config => {
      const err = new AxiosError('Unauthorized', '401', config, null, resp(401, { detail: 'bad refresh' }, config.url ?? ''))
      err.response = resp(401, { detail: 'bad refresh' }, config.url ?? '')
      throw err
    }
    apiClient.defaults.adapter = adapter

    const postSpy = vi.spyOn(axios, 'post')
    const logoutSpy = vi.fn()
    window.addEventListener('auth:logout', logoutSpy)

    await expect(apiClient.post('/auth/refresh', { refresh_token: 'x' })).rejects.toMatchObject({
      response: { status: 401 },
    })

    window.removeEventListener('auth:logout', logoutSpy)
    // Interceptor must not have tried to refresh while refreshing.
    expect(postSpy).not.toHaveBeenCalled()
    expect(logoutSpy).toHaveBeenCalledTimes(1)
  })

  it('coalesces two concurrent 401s into a single refresh HTTP call', async () => {
    let n = 0
    const adapter: AxiosAdapter = async config => {
      n += 1
      const seq = n
      // First two calls (the two originals) → 401; their retries (3rd, 4th) → 200.
      if (seq <= 2) {
        const err = new AxiosError('Unauthorized', '401', config, null, resp(401, { detail: 'expired' }, config.url ?? ''))
        err.response = resp(401, { detail: 'expired' }, config.url ?? '')
        throw err
      }
      return resp(200, { seq }, config.url ?? '')
    }
    apiClient.defaults.adapter = adapter

    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { access_token: 'fresh', refresh_token: 'fresh-r' } })

    const [a, b] = await Promise.all([apiClient.get('/documents'), apiClient.get('/ai/history/doc-1?user_id=u')])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    // Exactly one refresh despite two concurrent 401s.
    expect(postSpy).toHaveBeenCalledTimes(1)
  })
})
