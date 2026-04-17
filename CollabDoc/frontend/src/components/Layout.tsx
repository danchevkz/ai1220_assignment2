import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

interface Props {
  children: React.ReactNode
}

export default function Layout({ children }: Props) {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <Link to="/" className="app-logo">CollabDoc</Link>
        {user && (
          <nav className="app-nav">
            <span className="app-nav-user">{user.username}</span>
            <button onClick={handleLogout} className="btn btn-ghost">
              Sign out
            </button>
          </nav>
        )}
      </header>
      <main className="app-main">{children}</main>
    </div>
  )
}
