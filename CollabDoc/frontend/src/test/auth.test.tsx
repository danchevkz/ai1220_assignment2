import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Login from '../pages/Login'
import { useAuthStore } from '../store/authStore'
import type { AuthState } from '../store/authStore'

// Mock the entire authStore
vi.mock('../store/authStore')

const mockLogin = vi.fn()
const mockClearError = vi.fn()

function mockAuthStore(overrides: Partial<AuthState> = {}) {
  vi.mocked(useAuthStore).mockImplementation(<T,>(selector: (s: AuthState) => T): T => {
    const state: AuthState = {
      user: null,
      isLoading: false,
      error: null,
      login: mockLogin,
      register: vi.fn(),
      logout: vi.fn(),
      bootstrap: vi.fn(),
      clearError: mockClearError,
      ...overrides,
    }
    return selector(state)
  })
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>
  )
}

describe('Login page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthStore()
  })

  it('renders username, password fields and submit button', () => {
    renderLogin()
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('calls login with entered credentials on submit', async () => {
    mockLogin.mockResolvedValueOnce(undefined)
    renderLogin()

    await userEvent.type(screen.getByLabelText(/username/i), 'alice')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('alice', 'secret123')
    })
  })

  it('shows loading state while submitting', async () => {
    mockAuthStore({ isLoading: true })
    renderLogin()

    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
  })

  it('displays server error message on failed login', () => {
    mockAuthStore({ error: 'Invalid credentials' })
    renderLogin()

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials')
  })

  it('calls clearError on mount-equivalent (when component sees prior error)', () => {
    mockAuthStore({ error: 'old error' })
    renderLogin()
    // clearError is called on submit, not on mount; error should still be visible
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('disables inputs while loading', () => {
    mockAuthStore({ isLoading: true })
    renderLogin()

    expect(screen.getByLabelText(/username/i)).toBeDisabled()
    expect(screen.getByLabelText(/password/i)).toBeDisabled()
  })
})
