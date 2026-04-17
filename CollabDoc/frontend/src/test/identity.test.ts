import { describe, it, expect } from 'vitest'
import { colorForId, initialsFor, identityFor } from '../collab/identity'

describe('colorForId', () => {
  it('returns the same color for the same id', () => {
    expect(colorForId('user-42')).toBe(colorForId('user-42'))
  })

  it('is a CSS hex color', () => {
    expect(colorForId('whatever')).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('distributes across multiple distinct ids', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `user-${i}`)
    const colors = new Set(ids.map(colorForId))
    // At least 3 distinct palette slots used across 50 ids — if the hash
    // collapses to one bucket, the stack will look broken.
    expect(colors.size).toBeGreaterThanOrEqual(3)
  })

  it('handles empty string without crashing', () => {
    expect(colorForId('')).toMatch(/^#/)
  })
})

describe('initialsFor', () => {
  it('returns first two letters for single word', () => {
    expect(initialsFor('alex')).toBe('AL')
  })

  it('returns first + last initial for multi-word names', () => {
    expect(initialsFor('Alexander Danchev')).toBe('AD')
    expect(initialsFor('Anel Murat')).toBe('AM')
  })

  it('falls back to ? for blank input', () => {
    expect(initialsFor('   ')).toBe('?')
  })
})

describe('identityFor', () => {
  it('maps a user to { id, name, color }', () => {
    const u = identityFor({ id: 'u1', username: 'alex' })
    expect(u).toEqual({ id: 'u1', name: 'alex', color: colorForId('u1') })
  })
})
