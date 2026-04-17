import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConnectionStatus from '../components/ConnectionStatus'

describe('ConnectionStatus', () => {
  it('shows "Synced" when connected and sync completed', () => {
    render(<ConnectionStatus status="connected" synced={true} />)
    expect(screen.getByText(/synced/i)).toBeInTheDocument()
  })

  it('shows "Syncing…" when connected but not yet synced', () => {
    render(<ConnectionStatus status="connected" synced={false} />)
    expect(screen.getByText(/syncing/i)).toBeInTheDocument()
  })

  it('shows "Connecting…" while handshake is in progress', () => {
    render(<ConnectionStatus status="connecting" synced={false} />)
    expect(screen.getByText(/connecting/i)).toBeInTheDocument()
  })

  it('shows "Offline — reconnecting" when connection drops', () => {
    render(<ConnectionStatus status="disconnected" synced={true} />)
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument()
  })

  it('prioritizes title save errors over connection status', () => {
    render(<ConnectionStatus status="connected" synced={true} titleSave="error" />)
    expect(screen.getByText(/title save failed/i)).toBeInTheDocument()
  })

  it('shows "Saving…" when title save is in progress (and connection is healthy)', () => {
    render(<ConnectionStatus status="connected" synced={true} titleSave="saving" />)
    expect(screen.getByText(/saving/i)).toBeInTheDocument()
  })
})
