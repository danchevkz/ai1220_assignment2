import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AISidePanel from '../components/AI/AISidePanel'
import type { AIInteractionHistoryItem } from '../api/ai'

const useAIStreamMock = vi.fn()
const useAIHistoryMock = vi.fn()
const startStreamMock = vi.fn()
const cancelStreamMock = vi.fn()
const resetMock = vi.fn()
const onAcceptMock = vi.fn(() => true)
const onUndoMock = vi.fn(() => true)

vi.mock('../hooks/useAIStream', () => ({
  useAIStream: () => useAIStreamMock(),
}))

vi.mock('../hooks/useAIHistory', () => ({
  useAIHistory: () => useAIHistoryMock(),
}))

describe('AISidePanel', () => {
  beforeEach(() => {
    useAIStreamMock.mockReset()
    useAIHistoryMock.mockReset()
    startStreamMock.mockReset()
    cancelStreamMock.mockReset()
    resetMock.mockReset()
    onAcceptMock.mockClear()
    onUndoMock.mockClear()

    useAIStreamMock.mockReturnValue({
      streamedText: '',
      status: 'idle',
      error: null,
      requestId: null,
      startStream: startStreamMock,
      cancelStream: cancelStreamMock,
      reset: resetMock,
    })

    useAIHistoryMock.mockReturnValue({
      items: [],
      loading: false,
      error: null,
      reload: vi.fn(),
    })
  })

  it('renders idle state without suggestion controls', () => {
    renderPanel()

    expect(screen.getByText(/selected text/i)).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Rewrite')
    expect(screen.getByRole('button', { name: /rewrite selection/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/suggestion/i)).not.toBeInTheDocument()
  })

  it('lets the user switch between rewrite and summarize controls', async () => {
    renderPanel()

    const actionSelect = screen.getByRole('combobox')
    expect(screen.getByRole('button', { name: /rewrite selection/i })).toBeInTheDocument()

    await userEvent.selectOptions(actionSelect, 'summarize')

    expect(actionSelect).toHaveDisplayValue('Summarize')
    expect(screen.getByRole('button', { name: /summarize selection/i })).toBeInTheDocument()
  })

  it('renders streaming state with progressive output and cancel action', () => {
    useAIStreamMock.mockReturnValue({
      streamedText: 'Partial suggestion',
      status: 'streaming',
      error: null,
      requestId: 'req-1',
      startStream: startStreamMock,
      cancelStream: cancelStreamMock,
      reset: resetMock,
    })

    renderPanel()

    expect(screen.getByText(/suggestion/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Partial suggestion')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(cancelStreamMock).toHaveBeenCalledTimes(1)
  })

  it('renders finished state with editable suggestion and accept/reject actions', () => {
    useAIStreamMock.mockReturnValue({
      streamedText: 'Completed suggestion',
      status: 'completed',
      error: null,
      requestId: 'req-2',
      startStream: startStreamMock,
      cancelStream: cancelStreamMock,
      reset: resetMock,
    })

    renderPanel()

    const suggestion = screen.getByDisplayValue('Completed suggestion') as HTMLTextAreaElement
    expect(suggestion).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
    expect(screen.getByText(/edit suggestion before accepting/i)).toBeInTheDocument()

    fireEvent.change(suggestion, { target: { value: 'Edited suggestion' } })
    expect(suggestion.value).toBe('Edited suggestion')
  })

  it('calls onAccept with the edited suggestion text', async () => {
    useAIStreamMock.mockReturnValue({
      streamedText: 'Completed suggestion',
      status: 'completed',
      error: null,
      requestId: 'req-2',
      startStream: startStreamMock,
      cancelStream: cancelStreamMock,
      reset: resetMock,
    })

    renderPanel()

    const suggestion = screen.getByDisplayValue('Completed suggestion')
    await userEvent.clear(suggestion)
    await userEvent.type(suggestion, 'Edited suggestion')
    await userEvent.click(screen.getByRole('button', { name: /accept/i }))

    expect(onAcceptMock).toHaveBeenCalledWith('Edited suggestion')
  })

  it('reject clears the visible suggestion without calling onAccept', async () => {
    useAIStreamMock.mockReturnValue({
      streamedText: 'Completed suggestion',
      status: 'completed',
      error: null,
      requestId: 'req-2',
      startStream: startStreamMock,
      cancelStream: cancelStreamMock,
      reset: resetMock,
    })

    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: /reject/i }))

    expect(onAcceptMock).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('Completed suggestion')).not.toBeInTheDocument()
    expect(resetMock).toHaveBeenCalled()
  })

  it('renders fetched per-document history items', () => {
    useAIHistoryMock.mockReturnValue({
      items: [
        historyItem(),
        historyItem({
          operation: 'summarize',
          status: 'completed',
          timestamp: '2026-04-19T09:15:00Z',
          input_text_length: 90,
          output_text_length: 35,
        }),
      ],
      loading: false,
      error: null,
      reload: vi.fn(),
    })

    renderPanel()

    expect(screen.getByText(/ai history/i)).toBeInTheDocument()
    expect(screen.getByText(/rewrite/i)).toBeInTheDocument()
    expect(screen.getByText(/summarize/i)).toBeInTheDocument()
    expect(screen.getAllByText(/completed/i)).toHaveLength(2)
    expect(screen.getByText(/in 120 chars/i)).toBeInTheDocument()
    expect(screen.getByText(/out 48 chars/i)).toBeInTheDocument()
    expect(screen.getByText(/in 90 chars/i)).toBeInTheDocument()
    expect(screen.getByText(/out 35 chars/i)).toBeInTheDocument()
  })
})

function renderPanel() {
  return render(
    <AISidePanel
      documentId="doc-1"
      userId="user-1"
      selectedText="Selected text"
      hasSelection
      canEdit
      canUndo={false}
      onAccept={onAcceptMock}
      onUndo={onUndoMock}
    />,
  )
}

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
