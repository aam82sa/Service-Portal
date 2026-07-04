import { useEffect, useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { SignIn } from './auth/SignIn'
import { Home } from './pages/Home'
import { Portal } from './pages/Portal'
import { MyRequests } from './pages/MyRequests'
import { Queue } from './pages/Queue'
import { Approvals } from './pages/Approvals'
import { MyWork } from './pages/MyWork'
import { Insights } from './pages/Insights'
import { RequestDetail } from './pages/RequestDetail'
import { Assets } from './pages/Assets'
import { AdminPage } from './admin/AdminPage'

type Page = 'home' | 'portal' | 'requests' | 'mywork' | 'queue' | 'approvals' | 'insights' | 'assets' | 'admin'

export default function App() {
  const { session, profile, loading, isAdmin, hasRole, canSee, signOut } = useAuth()
  const [page, setPage] = useState<Page>('portal')
  const [detailId, setDetailId] = useState<string | null>(null)
  const isStaff = hasRole('agent') || hasRole('team_lead') || hasRole('dept_admin')
  const isApprover = hasRole('approver')
  const canAdmin = isAdmin || hasRole('dept_admin')
  const isRequesterOnly =
    !isStaff && !isApprover && !canAdmin && !hasRole('executive')

  // Page access panel decides visibility; role checks remain the fallback
  // until the panel data is loaded (or if a page is missing from it).
  const see: Record<Page, boolean> = {
    home: canSee('home') ?? true,
    portal: canSee('portal') ?? true,
    requests: canSee('requests') ?? true,
    mywork: canSee('mywork') ?? (isStaff || isApprover),
    queue: canSee('queue') ?? isStaff,
    approvals: canSee('approvals') ?? isApprover,
    insights: canSee('insights') ?? (hasRole('team_lead') || hasRole('executive') || hasRole('system_admin')),
    assets:
      canSee('assets') ??
      (hasRole('agent', 'IT') || hasRole('team_lead', 'IT') || hasRole('dept_admin', 'IT') || hasRole('system_admin')),
    admin: canSee('admin') ?? canAdmin,
  }
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

  useEffect(() => {
    if (!loading && session && isRequesterOnly) setPage('home')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session])

  if (loading) {
    return (
      <div className="signin-wrap">
        <span style={{ color: '#B9C2D6', fontFamily: 'var(--font-head)' }}>Loading…</span>
      </div>
    )
  }
  if (!session) return <SignIn />

  const activePage = see[page] ? page : 'portal'

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-badge">RLC</span>
          Services Hub
        </div>
        {see.home && (
          <button
            className={`nav-item${activePage === 'home' ? ' active' : ''}`}
            onClick={() => go('home')}
          >
            Home
          </button>
        )}
        {see.portal && (
          <button
            className={`nav-item${activePage === 'portal' ? ' active' : ''}`}
            onClick={() => go('portal')}
          >
            Portal
          </button>
        )}
        {see.requests && (
          <button
            className={`nav-item${activePage === 'requests' ? ' active' : ''}`}
            onClick={() => go('requests')}
          >
            My requests
          </button>
        )}
        {(see.mywork || see.queue || see.approvals || see.insights || see.assets) && (
          <div className="nav-group">Workspace</div>
        )}
        {see.mywork && (
          <button
            className={`nav-item${activePage === 'mywork' ? ' active' : ''}`}
            onClick={() => go('mywork')}
          >
            My work
          </button>
        )}
        {see.queue && (
          <button
            className={`nav-item${activePage === 'queue' ? ' active' : ''}`}
            onClick={() => go('queue')}
          >
            Department queue
          </button>
        )}
        {see.approvals && (
          <button
            className={`nav-item${activePage === 'approvals' ? ' active' : ''}`}
            onClick={() => go('approvals')}
          >
            Approvals
          </button>
        )}
        {see.insights && (
          <button
            className={`nav-item${activePage === 'insights' ? ' active' : ''}`}
            onClick={() => go('insights')}
          >
            Insights
          </button>
        )}
        {see.assets && (
          <button
            className={`nav-item${activePage === 'assets' ? ' active' : ''}`}
            onClick={() => go('assets')}
          >
            IT assets
          </button>
        )}
        {see.admin && (
          <>
            <div className="nav-group">Administration</div>
            <button
              className={`nav-item${activePage === 'admin' ? ' active' : ''}`}
              onClick={() => go('admin')}
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
            {activePage === 'home' && see.home && <Home onNavigate={(p) => go(p)} />}
            {activePage === 'portal' && <Portal />}
            {activePage === 'requests' && see.requests && <MyRequests onOpen={setDetailId} />}
            {activePage === 'mywork' && see.mywork && <MyWork onOpen={setDetailId} />}
            {activePage === 'queue' && see.queue && <Queue onOpen={setDetailId} />}
            {activePage === 'approvals' && see.approvals && <Approvals />}
            {activePage === 'insights' && see.insights && <Insights onOpen={setDetailId} />}
            {activePage === 'assets' && see.assets && <Assets onOpenRequest={setDetailId} />}
            {activePage === 'admin' && see.admin && <AdminPage />}
          </>
        )}
      </main>
    </div>
  )
}
