import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import DocumentPage from '../pages/DocumentPage'

const getDocumentMock = vi.fn()
const replaceSelectionMock = vi.fn()
const useAIStreamMock = vi.fn()
const useAIHistoryMock = vi.fn()

vi.mock('../api/documents', () => ({
  documentsApi: {
    get: (...args: unknown[]) => getDocumentMock(...args),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../hooks/useCollaborativeDoc', () => ({
  useCollaborativeDoc: () => ({
    provider: null,
    status: 'connected',
    synced: true,
  }),
}))

vi.mock('../hooks/useAwareness', () => ({
  useAwareness: () => ({
    users: [],
    markActive: vi.fn(),
  }),
}))

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string; username: string; email: string; created_at: string } }) => unknown) =>
    selector({
      user: {
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        created_at: '2026-01-01T00:00:00Z',
      },
    }),
}))

vi.mock('../components/ConnectionStatus', () => ({
  default: () => <div>Connection</div>,
}))

vi.mock('../components/PresenceStack', () => ({
  default: () => <div>Presence</div>,
}))

vi.mock('../components/TypingIndicator', () => ({
  default: () => <div>Typing</div>,
}))

vi.mock('../components/VersionHistory', () => ({
  default: () => null,
}))

vi.mock('../components/ShareModal', () => ({
  default: () => null,
}))

vi.mock('../collab/identity', () => ({
  identityFor: () => ({ name: 'Alice', color: '#000000' }),
}))

vi.mock('../hooks/useAIStream', () => ({
  useAIStream: () => useAIStreamMock(),
}))

vi.mock('../hooks/useAIHistory', () => ({
  useAIHistory: () => useAIHistoryMock(),
}))

vi.mock('../components/Editor/Editor', async () => {
  const React = await import('react')
  return {
    default: (props: {
      onSelectionChange?: (selection: { text: string; hasSelection: boolean; from: number; to: number }) => void
      onReplaceSelectionReady?: (replace: ((text: string, selection?: { from: number; to: number }) => boolean) | null) => void
    }) => {
      useEffect(() => {
        props.onReplaceSelectionReady?.((text, selection) => {
          replaceSelectionMock(text, selection)
          return true
        })
        return () => props.onReplaceSelectionReady?.(null)
      }, [props])

      return (
        <div>
          <button
            type="button"
            onClick={() => props.onSelectionChange?.({
              text: 'Original text',
              hasSelection: true,
              from: 4,
              to: 17,
            })}
          >
            Select text
          </button>
        </div>
      )
    },
  }
})

describe('AI integration', () => {
  beforeEach(() => {
    getDocumentMock.mockReset()
    replaceSelectionMock.mockReset()
    useAIStreamMock.mockReset()
    useAIHistoryMock.mockReset()

    getDocumentMock.mockResolvedValue({
      id: 'doc-1',
      title: 'Doc',
      content: '',
      owner_id: 'user-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      version: 1,
      collaborators: [],
    })

    useAIHistoryMock.mockReturnValue({
      items: [],
      loading: false,
      error: null,
      reload: vi.fn(),
    })

    useAIStreamMock.mockReturnValue({
      streamedText: 'AI suggestion',
      status: 'completed',
      error: null,
      requestId: 'req-1',
      startStream: vi.fn(),
      cancelStream: vi.fn(),
      reset: vi.fn(),
    })
  })

  it('accepting an AI suggestion applies the replacement into the editor/document flow', async () => {
    renderDocumentPage()

    await waitFor(() => expect(getDocumentMock).toHaveBeenCalledWith('doc-1'))

    fireEvent.click(screen.getByRole('button', { name: /select text/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /accept/i }))

    expect(replaceSelectionMock).toHaveBeenCalledWith('AI suggestion', {
      from: 4,
      to: 17,
    })
  })

  it('rejecting an AI suggestion does not modify the document', async () => {
    renderDocumentPage()

    await waitFor(() => expect(getDocumentMock).toHaveBeenCalledWith('doc-1'))

    fireEvent.click(screen.getByRole('button', { name: /select text/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /reject/i }))

    expect(replaceSelectionMock).not.toHaveBeenCalled()
  })
})

function renderDocumentPage() {
  return render(
    <MemoryRouter initialEntries={['/documents/doc-1']}>
      <Routes>
        <Route path="/documents/:id" element={<DocumentPage />} />
      </Routes>
    </MemoryRouter>,
  )
}
