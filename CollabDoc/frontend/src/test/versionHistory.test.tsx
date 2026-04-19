import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VersionHistory from '../components/VersionHistory'
import { documentsApi } from '../api/documents'

vi.mock('../api/documents', () => ({
  documentsApi: {
    versions: vi.fn(),
    restoreVersion: vi.fn(),
  },
}))

const FIXTURE = [
  { version: 2, content: '<p>second</p>', saved_at: '2026-04-18T10:00:00Z', saved_by: 'alice' },
  { version: 1, content: '<p>first</p>', saved_at: '2026-04-17T09:00:00Z', saved_by: 'alice' },
]

function renderDrawer(open = true) {
  const onClose = vi.fn()
  const onRestored = vi.fn()
  render(
    <VersionHistory
      documentId="doc-1"
      open={open}
      onClose={onClose}
      onRestored={onRestored}
      canRestore={true}
    />,
  )
  return { onClose, onRestored }
}

describe('VersionHistory drawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(documentsApi.versions).mockResolvedValue(FIXTURE)
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <VersionHistory
        documentId="doc-1"
        open={false}
        onClose={vi.fn()}
        onRestored={vi.fn()}
        canRestore={true}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders each version row with a descriptive aria-label', async () => {
    renderDrawer(true)
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /preview version 2, saved .* by alice/i }),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByRole('button', { name: /preview version 1, saved .* by alice/i }),
    ).toBeInTheDocument()
  })

  it('closes on Escape keydown while open', async () => {
    const { onClose } = renderDrawer(true)
    await waitFor(() => screen.getByRole('dialog', { name: /version history/i }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
