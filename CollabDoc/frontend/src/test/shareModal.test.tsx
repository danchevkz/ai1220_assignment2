import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShareModal from '../components/ShareModal'
import { documentsApi } from '../api/documents'
import type { Document } from '../types'

vi.mock('../api/documents', () => ({
  documentsApi: {
    share: vi.fn(),
    updateCollaborator: vi.fn(),
    removeCollaborator: vi.fn(),
    listShareLinks: vi.fn().mockResolvedValue([]),
    createShareLink: vi.fn(),
    revokeShareLink: vi.fn(),
  },
}))

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    title: 'My doc',
    content: '',
    owner_id: 'owner-1',
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    version: 1,
    collaborators: [
      { user_id: 'owner-1', username: 'alice', email: 'alice@x.com', role: 'owner' },
      { user_id: 'editor-1', username: 'bob', email: 'bob@x.com', role: 'editor' },
    ],
    ...overrides,
  }
}

describe('ShareModal', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders nothing when closed', () => {
    const { container } = render(
      <ShareModal
        document={makeDoc()}
        currentUserId="owner-1"
        open={false}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the dialog with the document title and an invite form when open as owner', async () => {
    render(
      <ShareModal
        document={makeDoc()}
        currentUserId="owner-1"
        open={true}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Share document')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/my doc/i)
    expect(screen.getByLabelText(/role for new collaborator/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/username or email/i)).toBeInTheDocument()
    // Let the embedded ShareLinksPanel finish its initial fetch.
    await screen.findByText(/no active share links/i)
  })

  it('invites with the chosen role and calls onChanged with the new document', async () => {
    const updated = makeDoc({
      collaborators: [
        { user_id: 'owner-1', username: 'alice', email: 'alice@x.com', role: 'owner' },
        { user_id: 'editor-1', username: 'bob', email: 'bob@x.com', role: 'editor' },
        { user_id: 'viewer-1', username: 'carol', email: 'carol@x.com', role: 'viewer' },
      ],
    })
    vi.mocked(documentsApi.share).mockResolvedValueOnce(updated)

    const onChanged = vi.fn()
    render(
      <ShareModal
        document={makeDoc()}
        currentUserId="owner-1"
        open={true}
        onClose={vi.fn()}
        onChanged={onChanged}
      />,
    )

    await userEvent.type(screen.getByPlaceholderText(/username or email/i), 'carol')
    await userEvent.selectOptions(screen.getByLabelText(/role for new collaborator/i), 'viewer')
    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }))

    await waitFor(() => {
      expect(documentsApi.share).toHaveBeenCalledWith('doc-1', {
        username_or_email: 'carol',
        role: 'viewer',
      })
    })
    expect(onChanged).toHaveBeenCalledWith(updated)
  })

  it('disables the invite button when the input is empty', async () => {
    render(
      <ShareModal
        document={makeDoc()}
        currentUserId="owner-1"
        open={true}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^invite$/i })).toBeDisabled()
    await screen.findByText(/no active share links/i)
  })

  it('shows the owner first labeled "(you)" and lists other collaborators', async () => {
    render(
      <ShareModal
        document={makeDoc()}
        currentUserId="owner-1"
        open={true}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    const items = screen.getAllByRole('listitem')
    // first list is the people list; first item is the owner
    expect(items[0]).toHaveTextContent(/alice \(you\)/i)
    expect(items[0]).toHaveTextContent(/owner/i)
    expect(items[1]).toHaveTextContent(/bob/i)
    await screen.findByText(/no active share links/i)
  })

  it('changes a collaborator role via the per-row select', async () => {
    const updated = makeDoc({
      collaborators: [
        { user_id: 'owner-1', username: 'alice', email: 'alice@x.com', role: 'owner' },
        { user_id: 'editor-1', username: 'bob', email: 'bob@x.com', role: 'viewer' },
      ],
    })
    vi.mocked(documentsApi.updateCollaborator).mockResolvedValueOnce(updated)

    const onChanged = vi.fn()
    render(
      <ShareModal
        document={makeDoc()}
        currentUserId="owner-1"
        open={true}
        onClose={vi.fn()}
        onChanged={onChanged}
      />,
    )

    await userEvent.selectOptions(screen.getByLabelText(/role for bob/i), 'viewer')

    await waitFor(() => {
      expect(documentsApi.updateCollaborator).toHaveBeenCalledWith('doc-1', 'editor-1', { role: 'viewer' })
    })
    expect(onChanged).toHaveBeenCalledWith(updated)
  })

  it('removes a collaborator after confirming', async () => {
    const updated = makeDoc({
      collaborators: [
        { user_id: 'owner-1', username: 'alice', email: 'alice@x.com', role: 'owner' },
      ],
    })
    vi.mocked(documentsApi.removeCollaborator).mockResolvedValueOnce(updated)
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)

    const onChanged = vi.fn()
    render(
      <ShareModal
        document={makeDoc()}
        currentUserId="owner-1"
        open={true}
        onClose={vi.fn()}
        onChanged={onChanged}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /remove bob/i }))

    await waitFor(() => {
      expect(documentsApi.removeCollaborator).toHaveBeenCalledWith('doc-1', 'editor-1')
    })
    expect(onChanged).toHaveBeenCalledWith(updated)
  })

  it('skips removal when the confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    render(
      <ShareModal
        document={makeDoc()}
        currentUserId="owner-1"
        open={true}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /remove bob/i }))
    expect(documentsApi.removeCollaborator).not.toHaveBeenCalled()
  })

  it('hides invite controls and shows read-only note for non-owners', () => {
    render(
      <ShareModal
        document={makeDoc()}
        currentUserId="editor-1"
        open={true}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.queryByPlaceholderText(/username or email/i)).not.toBeInTheDocument()
    expect(screen.getByText(/only the owner can change sharing settings/i)).toBeInTheDocument()
    // Non-owners see a static role badge for self, not a select.
    const items = screen.getAllByRole('listitem')
    const bobRow = items.find(i => within(i).queryByText(/^bob$/i))!
    expect(within(bobRow).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('surfaces an error message if the invite fails', async () => {
    vi.mocked(documentsApi.share).mockRejectedValueOnce({
      response: { status: 404, data: { detail: 'User not found' } },
    })
    render(
      <ShareModal
        document={makeDoc()}
        currentUserId="owner-1"
        open={true}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    await userEvent.type(screen.getByPlaceholderText(/username or email/i), 'ghost')
    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/user not found/i)
    })
  })
})
