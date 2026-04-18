import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams, Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { documentsApi } from '../api/documents'
import { extractError } from '../api/errors'

type Phase = 'checking' | 'redeeming' | 'error'

export default function ShareRedeem() {
  const { token } = useParams<{ token: string }>()
  const user = useAuthStore(s => s.user)
  const isLoading = useAuthStore(s => s.isLoading)
  const location = useLocation()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('checking')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Wait for auth bootstrap to finish before deciding anything.
    if (isLoading || !user || !token) return

    let cancelled = false
    setPhase('redeeming')

    documentsApi
      .redeemShareLink(token)
      .then(doc => {
        if (cancelled) return
        navigate(`/documents/${doc.id}`, { replace: true })
      })
      .catch(err => {
        if (cancelled) return
        setError(extractError(err, 'This share link is invalid or has expired.'))
        setPhase('error')
      })

    return () => {
      cancelled = true
    }
  }, [isLoading, user, token, navigate])

  if (!token) {
    return <Navigate to="/404" replace />
  }

  if (isLoading) {
    return (
      <div className="auth-loading">
        <span>Loading…</span>
      </div>
    )
  }

  if (!user) {
    // Send through login; Login already redirects back to `from` on success.
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (phase === 'error') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">Link unavailable</h1>
          <p className="form-error" role="alert">{error}</p>
          <p className="auth-footer">
            <Link to="/">Back to your documents</Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-loading">
      <span>Opening shared document…</span>
    </div>
  )
}
