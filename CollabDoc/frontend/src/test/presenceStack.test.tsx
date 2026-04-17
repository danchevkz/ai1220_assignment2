import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PresenceStack from '../components/PresenceStack'
import type { AwarenessUser } from '../collab/awarenessState'

const me = { id: 'me', name: 'Alex Danchev', color: '#111' }

function remote(overrides: Partial<AwarenessUser> & { clientId: number; id: string }): AwarenessUser {
  return { name: 'Peer', color: '#222', ...overrides }
}

describe('PresenceStack', () => {
  it('renders nothing when there is no me and no remote', () => {
    const { container } = render(<PresenceStack me={null} remote={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders me first with a "(you)" label', () => {
    render(<PresenceStack me={me} remote={[]} />)
    expect(screen.getByLabelText(/alex danchev \(you\)/i)).toBeInTheDocument()
  })

  it('renders remote users after me', () => {
    render(
      <PresenceStack
        me={me}
        remote={[remote({ clientId: 2, id: 'u2', name: 'Anel Murat' })]}
      />,
    )
    expect(screen.getByLabelText(/anel murat/i)).toBeInTheDocument()
  })

  it('de-duplicates by user id — two tabs from the same user show once', () => {
    render(
      <PresenceStack
        me={me}
        remote={[
          remote({ clientId: 2, id: 'me', name: 'Alex Danchev' }),
          remote({ clientId: 3, id: 'u3', name: 'Yintong Wang' }),
        ]}
      />,
    )
    expect(screen.getAllByLabelText(/alex danchev/i)).toHaveLength(1)
    expect(screen.getByLabelText(/yintong wang/i)).toBeInTheDocument()
  })

  it('collapses to +N chip past max', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      remote({ clientId: i + 2, id: `u${i}`, name: `User ${i}` }),
    )
    render(<PresenceStack me={me} remote={many} max={4} />)
    // me (1) + 3 remote = 4 shown; remaining 5 collapse into +5
    expect(screen.getByText(/\+5/)).toBeInTheDocument()
  })
})
