import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import NotFound from './pages/NotFound'
import './styles/index.css'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const DocumentPage = lazy(() => import('./pages/DocumentPage'))

export default function App() {
  const bootstrap = useAuthStore(s => s.bootstrap)
  const logout = useAuthStore(s => s.logout)

  useEffect(() => {
    bootstrap()

    // Global logout signal fired by the axios refresh interceptor
    const handler = () => logout()
    window.addEventListener('auth:logout', handler)
    return () => window.removeEventListener('auth:logout', handler)
  }, [bootstrap, logout])

  return (
    <BrowserRouter>
      <Layout>
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/documents/:id"
              element={
                <ProtectedRoute>
                  <DocumentPage />
                </ProtectedRoute>
              }
            />
            <Route path="/404" element={<NotFound />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  )
}
