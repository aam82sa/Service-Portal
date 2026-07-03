import { useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { SignIn } from './auth/SignIn'
import { Portal } from './pages/Portal'
import { MyRequests } from './pages/MyRequests'
import { Queue } from './pages/Queue'
import { Approvals } from './pages/Approvals'
import { AdminPage } from './admin/AdminPage'

type Page = 'portal' | 'requests' | 'queue' | 'approvals' | 'admin'

export default function App() {
  const { session, profile, loading, isAdmin, hasRole, signOut } = useAuth()
  const [page, setPage] = useState<Page>('portal')
  const isStaff = hasRole('agent') || hasRole('team_lead') || hasRole('dept_admin')
  const isApprover = hasRole('approver')
  const canAdmin = isAdmin || hasRole('dept_admin')

  if (loading) {
    return (
      <div className="signin-wrap">
        <span style={{ color: '#B9C2D6', fontFamily: 'var(--font-head)' }}>Loading…</span>
      </div>
    )
  }
  if (!session) return <SignIn />

  const activePage = page === 'admin' && !canAdmin ? 'portal' : page

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
        {(isStaff || isApprover) && <div className="nav-group">Workspace</div>}
        {isStaff && (
          <button
            className={`nav-item${activePage === 'queue' ? ' active' : ''}`}
            onClick={() => setPage('queue')}
          >
            Department queue
          </button>
        )}
        {isApprover && (
          <button
            className={`nav-item${activePage === 'approvals' ? ' active' : ''}`}
            onClick={() => setPage('approvals')}
          >
            Approvals
          </button>
        )}
        {canAdmin && (
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
        {activePage === 'queue' && isStaff && <Queue />}
        {activePage === 'approvals' && isApprover && <Approvals />}
        {activePage === 'admin' && canAdmin && <AdminPage />}
      </main>
    </div>
  )
}
