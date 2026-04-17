import { describe, it, expect } from 'vitest'
import {
  collectRemoteUsers,
  isTyping,
  TYPING_WINDOW_MS,
  type LocalAwarenessState,
} from '../collab/awarenessState'

function state(user: { id: string; name: string; color: string }, lastActive?: number): LocalAwarenessState {
  return { user, lastActive }
}

describe('collectRemoteUsers', () => {
  it('excludes the local client', () => {
    const states = new Map<number, LocalAwarenessState>([
      [1, state({ id: 'u1', name: 'Me', color: '#000' })],
      [2, state({ id: 'u2', name: 'You', color: '#fff' })],
    ])
    const out = collectRemoteUsers(states, 1)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('u2')
  })

  it('skips states without a user field', () => {
    const states = new Map<number, Partial<LocalAwarenessState>>([
      [1, state({ id: 'u1', name: 'Me', color: '#000' })],
      [2, {}], // e.g. a peer that only published a cursor and no identity yet
    ])
    const out = collectRemoteUsers(states, 99)
    expect(out.map(u => u.id)).toEqual(['u1'])
  })

  it('orders users deterministically by clientId', () => {
    const states = new Map<number, LocalAwarenessState>([
      [7, state({ id: 'u7', name: 'G', color: '#0' })],
      [3, state({ id: 'u3', name: 'C', color: '#0' })],
      [5, state({ id: 'u5', name: 'E', color: '#0' })],
    ])
    const out = collectRemoteUsers(states, 99)
    expect(out.map(u => u.clientId)).toEqual([3, 5, 7])
  })

  it('propagates lastActive for typing indicator', () => {
    const states = new Map<number, LocalAwarenessState>([
      [2, state({ id: 'u2', name: 'You', color: '#0' }, 1000)],
    ])
    const out = collectRemoteUsers(states, 1)
    expect(out[0].lastActive).toBe(1000)
  })
})

describe('isTyping', () => {
  const base = { clientId: 1, id: 'u', name: 'x', color: '#0' }

  it('returns false when lastActive is missing', () => {
    expect(isTyping(base, 999999)).toBe(false)
  })

  it('returns true within the typing window', () => {
    expect(isTyping({ ...base, lastActive: 1000 }, 1000 + TYPING_WINDOW_MS - 1)).toBe(true)
  })

  it('returns false once the typing window elapses', () => {
    expect(isTyping({ ...base, lastActive: 1000 }, 1000 + TYPING_WINDOW_MS + 1)).toBe(false)
  })
})
