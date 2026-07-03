import { useEffect, useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { SignIn } from './auth/SignIn'
import { Portal } from './pages/Portal'
import { MyRequests } from './pages/MyRequests'
import { Queue } from './pages/Queue'
import { Approvals } from './pages/Approvals'
import { MyWork } from './pages/MyWork'
import { Insights } from './pages/Insights'
import { RequestDetail } from './pages/RequestDetail'
import { Assets } from './pages/Assets'
import { AdminPage } from './admin/AdminPage'

type Page = 'portal' | 'requests' | 'mywork' | 'queue' | 'approvals' | 'insights' | 'assets' | 'admin'

export default function App() {
  const { session, profile, loading, isAdmin, hasRole, signOut } = useAuth()
  const [page, setPage] = useState<Page>('portal')
  const [detailId, setDetailId] = useState<string | null>(null)
  const isStaff = hasRole('agent') || hasRole('team_lead') || hasRole('dept_admin')
  const isApprover = hasRole('approver')
  const canAdmin = isAdmin || hasRole('dept_admin')
  const canInsights = hasRole('team_lead') || hasRole('executive') || hasRole('system_admin')
  const canAssets =
    hasRole('agent', 'IT') || hasRole('team_lead', 'IT') || hasRole('dept_admin', 'IT') || hasRole('system_admin')
  const go = (p: Page) => {
    setDetailId(null)
    setPage(p)
  }

  useEffect(() => {
    if (!session) {
      setPage('portal')
      setDetailId(null)
    }
  }, [session])

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
          onClick={() => go('portal')}
        >
          Portal
        </button>
        <button
          className={`nav-item${activePage === 'requests' ? ' active' : ''}`}
          onClick={() => go('requests')}
        >
          My requests
        </button>
        {(isStaff || isApprover) && <div className="nav-group">Workspace</div>}
        {(isStaff || isApprover) && (
          <button
            className={`nav-item${activePage === 'mywork' ? ' active' : ''}`}
            onClick={() => go('mywork')}
          >
            My work
          </button>
        )}
        {isStaff && (
          <button
            className={`nav-item${activePage === 'queue' ? ' active' : ''}`}
            onClick={() => go('queue')}
          >
            Department queue
          </button>
        )}
        {isApprover && (
          <button
            className={`nav-item${activePage === 'approvals' ? ' active' : ''}`}
            onClick={() => go('approvals')}
          >
            Approvals
          </button>
        )}
        {canInsights && (
          <button
            className={`nav-item${activePage === 'insights' ? ' active' : ''}`}
            onClick={() => go('insights')}
          >
            Insights
          </button>
        )}
        {canAssets && (
          <button
            className={`nav-item${activePage === 'assets' ? ' active' : ''}`}
            onClick={() => go('assets')}
          >
            IT assets
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
        {detailId ? (
          <RequestDetail requestId={detailId} onBack={() => setDetailId(null)} />
        ) : (
          <>
            {activePage === 'portal' && <Portal />}
            {activePage === 'requests' && <MyRequests onOpen={setDetailId} />}
            {activePage === 'mywork' && (isStaff || isApprover) && <MyWork onOpen={setDetailId} />}
            {activePage === 'queue' && isStaff && <Queue onOpen={setDetailId} />}
            {activePage === 'approvals' && isApprover && <Approvals />}
            {activePage === 'insights' && canInsights && <Insights />}
            {activePage === 'assets' && canAssets && <Assets onOpenRequest={setDetailId} />}
            {activePage === 'admin' && canAdmin && <AdminPage />}
          </>
        )}
      </main>
    </div>
  )
}
