import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShareLinksPanel from '../components/ShareLinksPanel'
import { documentsApi } from '../api/documents'
import type { ShareLink } from '../types'

vi.mock('../api/documents', () => ({
  documentsApi: {
    listShareLinks: vi.fn(),
    createShareLink: vi.fn(),
    revokeShareLink: vi.fn(),
  },
}))

function link(overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    token: 'tok-1',
    role: 'editor',
    created_at: '2026-04-01T00:00:00Z',
    expires_at: null,
    created_by: 'owner-1',
    ...overrides,
  }
}

describe('ShareLinksPanel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders an empty state when there are no links', async () => {
    vi.mocked(documentsApi.listShareLinks).mockResolvedValueOnce([])
    render(<ShareLinksPanel documentId="doc-1" />)
    await waitFor(() => {
      expect(screen.getByText(/no active share links/i)).toBeInTheDocument()
    })
  })

  it('renders existing links with role badge and full URL', async () => {
    vi.mocked(documentsApi.listShareLinks).mockResolvedValueOnce([
      link({ token: 'abc', role: 'viewer' }),
    ])
    render(<ShareLinksPanel documentId="doc-1" />)

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`/share/abc$`))).toBeInTheDocument()
    })
    expect(screen.getByText('viewer')).toBeInTheDocument()
    expect(screen.getByText(/never expires/i)).toBeInTheDocument()
  })

  it('creates a new link with chosen role and prepends it to the list', async () => {
    vi.mocked(documentsApi.listShareLinks).mockResolvedValueOnce([])
    vi.mocked(documentsApi.createShareLink).mockResolvedValueOnce(
      link({ token: 'new-tok', role: 'viewer', expires_at: null }),
    )
    render(<ShareLinksPanel documentId="doc-1" />)

    await waitFor(() => {
      expect(screen.getByText(/no active share links/i)).toBeInTheDocument()
    })

    await userEvent.selectOptions(screen.getByLabelText(/role for new link/i), 'viewer')
    await userEvent.selectOptions(screen.getByLabelText(/link expiry/i), 'never')
    await userEvent.click(screen.getByRole('button', { name: /create link/i }))

    await waitFor(() => {
      expect(documentsApi.createShareLink).toHaveBeenCalledWith('doc-1', {
        role: 'viewer',
        expires_in_hours: null,
      })
    })
    expect(screen.getByText(new RegExp(`/share/new-tok$`))).toBeInTheDocument()
  })

  it('optimistically removes a revoked link before the API resolves', async () => {
    vi.mocked(documentsApi.listShareLinks).mockResolvedValueOnce([
      link({ token: 'abc' }),
    ])
    let resolveRevoke!: () => void
    vi.mocked(documentsApi.revokeShareLink).mockReturnValueOnce(
      new Promise<void>(resolve => { resolveRevoke = resolve }),
    )
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)

    render(<ShareLinksPanel documentId="doc-1" />)
    await waitFor(() => expect(screen.getByText(/\/share\/abc$/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /revoke link/i }))

    // Optimistic: gone immediately, before the promise resolves.
    expect(screen.queryByText(/\/share\/abc$/)).not.toBeInTheDocument()
    expect(screen.getByText(/no active share links/i)).toBeInTheDocument()

    resolveRevoke()
    await waitFor(() => expect(documentsApi.revokeShareLink).toHaveBeenCalledWith('doc-1', 'abc'))
  })

  it('restores the link if revoke fails', async () => {
    vi.mocked(documentsApi.listShareLinks).mockResolvedValueOnce([
      link({ token: 'abc' }),
    ])
    vi.mocked(documentsApi.revokeShareLink).mockRejectedValueOnce({
      response: { status: 500, data: { detail: 'Server error' } },
    })
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)

    render(<ShareLinksPanel documentId="doc-1" />)
    await waitFor(() => expect(screen.getByText(/\/share\/abc$/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /revoke link/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/server error/i)
    })
    expect(screen.getByText(/\/share\/abc$/)).toBeInTheDocument()
  })

  it('copies the link URL to the clipboard and shows a "Copied!" affordance', async () => {
    vi.mocked(documentsApi.listShareLinks).mockResolvedValueOnce([link({ token: 'abc' })])
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<ShareLinksPanel documentId="doc-1" />)
    await waitFor(() => expect(screen.getByText(/\/share\/abc$/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /copy link/i }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/share\/abc$/))
    })
    expect(screen.getByText(/copied!/i)).toBeInTheDocument()
  })

  it('skips revoke when the confirm is cancelled', async () => {
    vi.mocked(documentsApi.listShareLinks).mockResolvedValueOnce([link({ token: 'abc' })])
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)

    render(<ShareLinksPanel documentId="doc-1" />)
    await waitFor(() => expect(screen.getByText(/\/share\/abc$/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /revoke link/i }))

    expect(documentsApi.revokeShareLink).not.toHaveBeenCalled()
    expect(screen.getByText(/\/share\/abc$/)).toBeInTheDocument()
  })
})
