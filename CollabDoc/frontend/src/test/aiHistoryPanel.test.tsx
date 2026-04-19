import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AIHistoryPanel from '../components/AI/AIHistoryPanel'
import type { AIInteractionHistoryItem } from '../api/ai'

describe('AIHistoryPanel', () => {
  it('renders fetched history items', () => {
    render(
      <AIHistoryPanel
        items={[
          historyItem(),
          historyItem({
            operation: 'summarize',
            status: 'failed',
            timestamp: '2026-04-19T09:15:00Z',
            input_text_length: 90,
            output_text_length: 0,
          }),
        ]}
        loading={false}
        error={null}
        onReload={vi.fn()}
      />,
    )

    expect(screen.getByText(/ai history/i)).toBeInTheDocument()
    expect(screen.getByText(/rewrite/i)).toBeInTheDocument()
    expect(screen.getByText(/summarize/i)).toBeInTheDocument()
    expect(screen.getByText(/in 120 chars/i)).toBeInTheDocument()
    expect(screen.getByText(/out 48 chars/i)).toBeInTheDocument()
    expect(screen.getByText(/in 90 chars/i)).toBeInTheDocument()
    expect(screen.getByText(/out 0 chars/i)).toBeInTheDocument()
  })

  it('renders the empty state when there are no history items', () => {
    render(
      <AIHistoryPanel
        items={[]}
        loading={false}
        error={null}
        onReload={vi.fn()}
      />,
    )

    expect(screen.getByText(/no ai actions for this document yet/i)).toBeInTheDocument()
  })
})

function historyItem(overrides: Partial<AIInteractionHistoryItem> = {}): AIInteractionHistoryItem {
  return {
    operation: 'rewrite',
    timestamp: '2026-04-19T09:00:00Z',
    status: 'completed',
    input_text_length: 120,
    output_text_length: 48,
    ...overrides,
  }
}
