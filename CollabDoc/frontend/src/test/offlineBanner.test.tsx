import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import OfflineBanner from '../components/OfflineBanner'

describe('OfflineBanner', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('stays hidden while connected', () => {
    render(<OfflineBanner status="connected" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays hidden during a short disconnect blip (<delay)', () => {
    render(<OfflineBanner status="disconnected" delayMs={5000} />)
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows after the disconnect persists past the delay', () => {
    render(<OfflineBanner status="disconnected" delayMs={5000} />)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByRole('status')).toHaveTextContent(/connection lost/i)
  })

  it('clears the banner when the connection returns', () => {
    const { rerender } = render(<OfflineBanner status="disconnected" delayMs={5000} />)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByRole('status')).toBeInTheDocument()

    rerender(<OfflineBanner status="connected" delayMs={5000} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('cancels the pending timer if the status flips before the delay expires', () => {
    const { rerender } = render(<OfflineBanner status="disconnected" delayMs={5000} />)
    act(() => { vi.advanceTimersByTime(2000) })
    rerender(<OfflineBanner status="connected" delayMs={5000} />)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
