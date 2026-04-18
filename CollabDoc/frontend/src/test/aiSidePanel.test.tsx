import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AISidePanel from '../components/AISidePanel'
import * as aiApi from '../api/ai'
import type { AIStreamEvent } from '../types'

vi.mock('../api/ai', async () => {
  const actual = await vi.importActual<typeof import('../api/ai')>('../api/ai')
  return {
    ...actual,
    streamSuggestion: vi.fn(),
    aiApi: {
      listHistory: vi.fn().mockResolvedValue([]),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
    },
  }
})

vi.mock('../store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) =>
    sel({ user: { id: 'user-1' } }),
}))

// Emit events synchronously from a mock call so React can batch them.
// Wrap the whole invocation in a single act() so state settles before
// the test's waitFor assertions start.
function emitStream(events: AIStreamEvent[]) {
  vi.mocked(aiApi.streamSuggestion).mockImplementationOnce(
    (_docId, _req, handlers) => {
      events.forEach(e => handlers.onEvent(e))
      return Promise.resolve()
    },
  )
}

function renderPanel(opts: {
  selectionText?: string
  documentText?: string
  open?: boolean
} = {}) {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(
    <AISidePanel
      documentId="doc-1"
      selectionText={opts.selectionText ?? ''}
      documentText={opts.documentText ?? ''}
      open={opts.open ?? true}
      onClose={onClose}
      onApply={onApply}
    />,
  )
  return { onApply, onClose }
}

describe('AISidePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(aiApi.aiApi.listHistory).mockResolvedValue([])
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <AISidePanel
        documentId="doc-1"
        selectionText=""
        documentText=""
        open={false}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders action buttons and no-selection notice', () => {
    renderPanel({ documentText: 'Some doc text' })
    expect(screen.getByRole('complementary', { name: /ai assistant/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^rewrite$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^summarize$/i })).toBeInTheDocument()
    expect(screen.getByText(/no selection/i)).toBeInTheDocument()
  })

  it('disables Rewrite when there is no selection but allows Summarize', () => {
    renderPanel({ documentText: 'doc' })
    expect(screen.getByRole('button', { name: /^rewrite$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^summarize$/i })).toBeEnabled()
  })

  it('streams chunks into the panel and shows them', async () => {
    emitStream([
      { type: 'chunk', id: 'c1', text: 'First paragraph.' },
      { type: 'chunk', id: 'c2', text: 'Second paragraph.' },
      { type: 'chunk_end', id: 'c1' },
      { type: 'chunk_end', id: 'c2' },
      { type: 'done', interaction_id: 'int-1' },
    ])
    renderPanel({ selectionText: 'rewrite me' })

    await userEvent.click(screen.getByRole('button', { name: /^rewrite$/i }))

    await waitFor(() => {
      expect(screen.getByText('First paragraph.')).toBeInTheDocument()
      expect(screen.getByText('Second paragraph.')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /apply all/i })).toBeInTheDocument()
  })

  it('applies combined chunk text when "Apply all" is clicked', async () => {
    emitStream([
      { type: 'chunk', id: 'c1', text: 'A' },
      { type: 'chunk', id: 'c2', text: 'B' },
      { type: 'done', interaction_id: 'int-1' },
    ])
    const { onApply } = renderPanel({ selectionText: 'pick me' })

    await userEvent.click(screen.getByRole('button', { name: /^rewrite$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /apply all/i })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /apply all/i }))
    expect(onApply).toHaveBeenCalledWith('A\n\nB', true)
  })

  it('partial accept: only accepted chunks are applied', async () => {
    emitStream([
      { type: 'chunk', id: 'c1', text: 'Keep this' },
      { type: 'chunk', id: 'c2', text: 'Drop this' },
      { type: 'done', interaction_id: 'int-9' },
    ])
    const { onApply } = renderPanel({ selectionText: 'pick me' })

    await userEvent.click(screen.getByRole('button', { name: /^rewrite$/i }))
    await waitFor(() => expect(screen.getByText('Keep this')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /accept chunk c1/i }))
    await userEvent.click(screen.getByRole('button', { name: /reject chunk c2/i }))

    await userEvent.click(screen.getByRole('button', { name: /apply selected/i }))
    expect(onApply).toHaveBeenCalledWith('Keep this', true)
  })

  it('Cancel during streaming aborts and shows the cancelled tag', async () => {
    // A stream that emits one chunk then waits until aborted.
    let cancelStream!: () => void
    vi.mocked(aiApi.streamSuggestion).mockImplementationOnce(
      async (_docId, _req, handlers, signal) => {
        handlers.onEvent({ type: 'chunk', id: 'c1', text: 'partial' })
        await new Promise<void>(resolve => {
          cancelStream = resolve
          signal?.addEventListener('abort', resolve)
        })
      },
    )

    renderPanel({ selectionText: 'go' })
    await userEvent.click(screen.getByRole('button', { name: /^rewrite$/i }))
    await waitFor(() => expect(screen.getByText('partial')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.getByText(/cancelled/i)).toBeInTheDocument())
    await act(async () => { cancelStream() })
  })

  it('reject all resets the panel', async () => {
    emitStream([
      { type: 'chunk', id: 'c1', text: 'nope' },
      { type: 'done', interaction_id: 'int-r' },
    ])
    renderPanel({ selectionText: 'src' })
    await userEvent.click(screen.getByRole('button', { name: /^rewrite$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /reject all/i })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /reject all/i }))

    expect(screen.queryByText('nope')).not.toBeInTheDocument()
  })

  it('surfaces an error event from the stream', async () => {
    emitStream([{ type: 'error', detail: 'Model unavailable' }])
    renderPanel({ selectionText: 'src' })

    await userEvent.click(screen.getByRole('button', { name: /^rewrite$/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/model unavailable/i)
    })
  })

  it('Edit toggles a textarea and persists edited text on apply', async () => {
    emitStream([
      { type: 'chunk', id: 'c1', text: 'original' },
      { type: 'done', interaction_id: 'int-e' },
    ])
    const { onApply } = renderPanel({ selectionText: 'src' })
    await userEvent.click(screen.getByRole('button', { name: /^rewrite$/i }))
    await waitFor(() => expect(screen.getByText('original')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /edit chunk c1/i }))
    const textarea = screen.getByLabelText(/edit chunk c1/i)
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'edited')

    await userEvent.click(screen.getByRole('button', { name: /apply all/i }))
    expect(onApply).toHaveBeenCalledWith('edited', true)
  })
})
