import { useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { SignIn } from './auth/SignIn'
import { Portal } from './pages/Portal'
import { MyRequests } from './pages/MyRequests'
import { AdminPage } from './admin/AdminPage'

type Page = 'portal' | 'requests' | 'admin'

export default function App() {
  const { session, profile, loading, isAdmin, signOut } = useAuth()
  const [page, setPage] = useState<Page>('portal')

  if (loading) {
    return (
      <div className="signin-wrap">
        <span style={{ color: '#B9C2D6', fontFamily: 'var(--font-head)' }}>Loading…</span>
      </div>
    )
  }
  if (!session) return <SignIn />

  const activePage = page === 'admin' && !isAdmin ? 'portal' : page

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-badge">RLC</span>
          Services Hub
        </div>
        <button
          className={`nav-item${activePage === 'portal' ? ' active' : ''}`}
          onClick={() => setPage('portal')}
        >
          Portal
        </button>
        <button
          className={`nav-item${activePage === 'requests' ? ' active' : ''}`}
          onClick={() => setPage('requests')}
        >
          My requests
        </button>
        {isAdmin && (
          <>
            <div className="nav-group">Administration</div>
            <button
              className={`nav-item${activePage === 'admin' ? ' active' : ''}`}
              onClick={() => setPage('admin')}
            >
              Admin console
            </button>
          </>
        )}
        <div className="sidebar-foot">
          <div style={{ color: '#fff', fontWeight: 500 }}>{profile?.display_name}</div>
          <div className="mono" style={{ fontSize: 10.5, margin: '2px 0 10px' }}>
            {profile?.upn}
          </div>
          <button className="nav-item" onClick={signOut} style={{ padding: '6px 0' }}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        {activePage === 'portal' && <Portal />}
        {activePage === 'requests' && <MyRequests />}
        {activePage === 'admin' && isAdmin && <AdminPage />}
      </main>
    </div>
  )
}
