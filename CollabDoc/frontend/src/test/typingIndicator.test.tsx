import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import TypingIndicator from '../components/TypingIndicator'
import type { AwarenessUser } from '../collab/awarenessState'

function user(name: string, lastActive?: number): AwarenessUser {
  return { clientId: Math.random(), id: name, name, color: '#000', lastActive }
}

describe('TypingIndicator', () => {
  beforeEach(() => { vi.useFakeTimers({ now: 1_000_000 }) })
  afterEach(() => { vi.useRealTimers() })

  it('renders nothing when no one has recent activity', () => {
    const { container } = render(<TypingIndicator users={[user('Alice')]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows "X is typing" for one active user', () => {
    render(<TypingIndicator users={[user('Alice', 1_000_000 - 500)]} />)
    expect(screen.getByText(/alice is typing/i)).toBeInTheDocument()
  })

  it('shows "X and Y are typing" for two active users', () => {
    render(
      <TypingIndicator
        users={[
          user('Alice', 1_000_000 - 500),
          user('Bob', 1_000_000 - 800),
        ]}
      />,
    )
    expect(screen.getByText(/alice and bob are typing/i)).toBeInTheDocument()
  })

  it('summarizes three or more typers with "and N others"', () => {
    render(
      <TypingIndicator
        users={[
          user('Alice', 1_000_000 - 100),
          user('Bob', 1_000_000 - 100),
          user('Carol', 1_000_000 - 100),
          user('Dave', 1_000_000 - 100),
        ]}
      />,
    )
    expect(screen.getByText(/alice, bob, and 2 others are typing/i)).toBeInTheDocument()
  })

  it('ignores stale lastActive timestamps', () => {
    const { container } = render(
      <TypingIndicator users={[user('Alice', 1_000_000 - 10_000)]} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
