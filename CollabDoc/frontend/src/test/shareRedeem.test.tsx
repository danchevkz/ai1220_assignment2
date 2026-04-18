import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ShareRedeem from '../pages/ShareRedeem'
import { useAuthStore } from '../store/authStore'
import { documentsApi } from '../api/documents'
import type { AuthState } from '../store/authStore'
import type { Document, User } from '../types'

vi.mock('../store/authStore')
vi.mock('../api/documents', () => ({
  documentsApi: { redeemShareLink: vi.fn() },
}))

function mockAuth(overrides: Partial<AuthState> = {}) {
  vi.mocked(useAuthStore).mockImplementation(<T,>(selector: (s: AuthState) => T): T => {
    const state: AuthState = {
      user: null,
      isLoading: false,
      error: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      bootstrap: vi.fn(),
      clearError: vi.fn(),
      ...overrides,
    }
    return selector(state)
  })
}

const user: User = {
  id: 'u1',
  username: 'alice',
  email: 'a@b.c',
  created_at: '2026-04-18T00:00:00Z',
}

const doc: Document = {
  id: 'doc-42',
  title: 'Shared doc',
  content: '',
  owner_id: 'u2',
  created_at: '2026-04-18T00:00:00Z',
  updated_at: '2026-04-18T00:00:00Z',
  version: 1,
  collaborators: [],
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/share/:token" element={<ShareRedeem />} />
        <Route path="/documents/:id" element={<div>Document page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ShareRedeem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /login when the user is not authenticated', async () => {
    mockAuth({ user: null })
    renderAt('/share/abc')
    await waitFor(() => {
      expect(screen.getByText(/login page/i)).toBeInTheDocument()
    })
    expect(documentsApi.redeemShareLink).not.toHaveBeenCalled()
  })

  it('redeems the token and navigates to the document on success', async () => {
    mockAuth({ user })
    vi.mocked(documentsApi.redeemShareLink).mockResolvedValueOnce(doc)

    renderAt('/share/tok-1')

    await waitFor(() => {
      expect(documentsApi.redeemShareLink).toHaveBeenCalledWith('tok-1')
    })
    await waitFor(() => {
      expect(screen.getByText(/document page/i)).toBeInTheDocument()
    })
  })

  it('shows an error card when the token is invalid', async () => {
    mockAuth({ user })
    vi.mocked(documentsApi.redeemShareLink).mockRejectedValueOnce({
      response: { data: { detail: 'Share link expired' } },
    })

    renderAt('/share/bad')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/share link expired/i)
    })
    expect(screen.getByRole('link', { name: /back to your documents/i })).toBeInTheDocument()
  })

  it('shows a loading state while auth is bootstrapping', () => {
    mockAuth({ user: null, isLoading: true })
    renderAt('/share/abc')
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(documentsApi.redeemShareLink).not.toHaveBeenCalled()
  })
})
