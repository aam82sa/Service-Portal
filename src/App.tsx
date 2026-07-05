import { Suspense, lazy, useEffect, useState } from 'react'
import { useAuth } from './features/auth/AuthProvider'
import { SignIn } from './features/auth/SignIn'
import { Home } from './features/home/Home'
import { Portal } from './features/catalog/Portal'
import { MyRequests } from './features/requests/MyRequests'
import { Queue } from './features/requests/Queue'
import { Approvals } from './features/requests/Approvals'
import { MyWork } from './features/requests/MyWork'
import { RequestDetail } from './features/requests/RequestDetail'
import { getAdminSections, type AdminSection } from './features/admin/sections'

// Heavy features load on demand: assets pulls xlsx+qrcode, admin pulls the
// designer tools, insights pulls the charts. Keeps the first load small.
const Assets = lazy(() => import('./features/assets/Assets').then((m) => ({ default: m.Assets })))
const AdminPage = lazy(() => import('./features/admin/AdminPage').then((m) => ({ default: m.AdminPage })))
const Insights = lazy(() => import('./features/insights/Insights').then((m) => ({ default: m.Insights })))

type Page = 'home' | 'portal' | 'requests' | 'mywork' | 'queue' | 'approvals' | 'insights' | 'assets' | 'admin'

const NAV: { id: Page; label: string; ico: string; group?: string }[] = [
  { id: 'home', label: 'Home', ico: 'Ho' },
  { id: 'portal', label: 'Portal', ico: 'Po' },
  { id: 'requests', label: 'My requests', ico: 'Rq' },
  { id: 'mywork', label: 'My work', ico: 'Wk', group: 'Workspace' },
  { id: 'queue', label: 'Department queue', ico: 'Qu', group: 'Workspace' },
  { id: 'approvals', label: 'Approvals', ico: 'Ap', group: 'Workspace' },
  { id: 'insights', label: 'Insights', ico: 'In', group: 'Workspace' },
  { id: 'assets', label: 'IT assets', ico: 'As', group: 'Workspace' },
  { id: 'admin', label: 'Admin console', ico: 'Ad', group: 'Administration' },
]

export default function App() {
  const { session, profile, loading, isAdmin, hasRole, canSee, signOut } = useAuth()
  const [page, setPage] = useState<Page>('portal')
  const [adminSection, setAdminSection] = useState<AdminSection | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const isStaff = hasRole('agent') || hasRole('team_lead') || hasRole('dept_admin')
  const isApprover = hasRole('approver')
  const canAdmin = isAdmin || hasRole('dept_admin')
  const isSys = hasRole('system_admin')
  const isRequesterOnly = !isStaff && !isApprover && !canAdmin && !hasRole('executive')

  // Page access panel decides visibility; role checks remain the fallback
  // until the panel data is loaded (or if a page is missing from it).
  const see: Record<Page, boolean> = {
    home: canSee('home') ?? !isSys,
    portal: canSee('portal') ?? !isSys,
    requests: canSee('requests') ?? !isSys,
    mywork: canSee('mywork') ?? (isStaff || isApprover),
    queue: canSee('queue') ?? isStaff,
    approvals: canSee('approvals') ?? isApprover,
    insights: canSee('insights') ?? (hasRole('team_lead') || hasRole('executive') || isSys),
    assets:
      canSee('assets') ??
      (hasRole('agent', 'IT') || hasRole('team_lead', 'IT') || hasRole('dept_admin', 'IT') || isSys),
    admin: canSee('admin') ?? canAdmin,
  }
  const adminSections = getAdminSections(hasRole)
  const firstVisible: Page = NAV.find((n) => see[n.id])?.id ?? 'portal'

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
    if (loading || !session) return
    if (isSys || (canAdmin && !isStaff)) setPage('admin')
    else if (isRequesterOnly) setPage('home')
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

  const activePage = see[page] ? page : firstVisible

  let lastGroup: string | undefined
  return (
    <div className="shell">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <span className="brand-badge">RLC</span>
          <span className="brand-name">Services Hub</span>
          <button
            className="collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
        {NAV.filter((n) => see[n.id]).map((n) => {
          const header =
            n.group && n.group !== lastGroup ? <div className="nav-group" key={`g-${n.group}`}>{n.group}</div> : null
          lastGroup = n.group ?? lastGroup
          return (
            <div key={n.id}>
              {header}
              <button
                className={`nav-item${activePage === n.id ? ' active' : ''}`}
                onClick={() => go(n.id)}
                title={n.label}
              >
                <span className="nav-ico mono">{n.ico}</span>
                <span className="nav-label">{n.label}</span>
              </button>
              {n.id === 'admin' && activePage === 'admin' &&
                adminSections.map((s) => (
                  <button
                    key={s.id}
                    className={`nav-item sub${(adminSection ?? adminSections[0]?.id) === s.id ? ' active' : ''}`}
                    onClick={() => { setDetailId(null); setAdminSection(s.id) }}
                    title={s.label}
                  >
                    <span className="nav-ico mono">{s.ico}</span>
                    <span className="nav-label">{s.label}</span>
                  </button>
                ))}
            </div>
          )
        })}
        <div className="sidebar-foot">
          <div style={{ color: '#fff', fontWeight: 500 }}>{profile?.display_name}</div>
          <div className="mono" style={{ fontSize: 10.5, margin: '2px 0 10px' }}>
            {profile?.upn}
          </div>
          <button className="nav-item" onClick={signOut} style={{ padding: '6px 0' }}>
            <span className="nav-label">Sign out</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <Suspense fallback={<p className="page-sub">Loading…</p>}>
        {detailId ? (
          <RequestDetail requestId={detailId} onBack={() => setDetailId(null)} />
        ) : (
          <>
            {activePage === 'home' && see.home && <Home onNavigate={(p) => go(p)} />}
            {activePage === 'portal' && see.portal && <Portal />}
            {activePage === 'requests' && see.requests && <MyRequests onOpen={setDetailId} />}
            {activePage === 'mywork' && see.mywork && <MyWork onOpen={setDetailId} />}
            {activePage === 'queue' && see.queue && <Queue onOpen={setDetailId} />}
            {activePage === 'approvals' && see.approvals && <Approvals />}
            {activePage === 'insights' && see.insights && <Insights onOpen={setDetailId} />}
            {activePage === 'assets' && see.assets && <Assets onOpenRequest={setDetailId} />}
            {activePage === 'admin' && see.admin && (
              <AdminPage section={adminSection ?? adminSections[0]?.id ?? 'overview'} />
            )}
          </>
        )}
        </Suspense>
      </main>
    </div>
  )
}
