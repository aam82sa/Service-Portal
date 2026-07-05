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
import { Icon, type IconName } from './components/icons'
import { getAdminSections, type AdminSection } from './features/admin/sections'

// Heavy features load on demand: assets pulls xlsx+qrcode, admin pulls the
// designer tools, insights pulls the charts. Keeps the first load small.
const Assets = lazy(() => import('./features/assets/Assets').then((m) => ({ default: m.Assets })))
const AdminPage = lazy(() => import('./features/admin/AdminPage').then((m) => ({ default: m.AdminPage })))
const Insights = lazy(() => import('./features/insights/Insights').then((m) => ({ default: m.Insights })))
const Projects = lazy(() => import('./features/pmo/Projects').then((m) => ({ default: m.Projects })))
const ProjectDetail = lazy(() => import('./features/pmo/ProjectDetail').then((m) => ({ default: m.ProjectDetail })))

type Page = 'home' | 'portal' | 'requests' | 'mywork' | 'queue' | 'approvals' | 'pmo' | 'insights' | 'assets' | 'admin'
export type NavOpts = { admin?: AdminSection; assetsTab?: 'hardware' | 'licenses' | 'people' }
export type Navigate = (page: Page, opts?: NavOpts) => void

const NAV: { id: Page; label: string; ico: IconName; group?: string }[] = [
  { id: 'home', label: 'Overview', ico: 'home' },
  { id: 'portal', label: 'Portal', ico: 'grid' },
  { id: 'requests', label: 'My requests', ico: 'list' },
  { id: 'mywork', label: 'My work', ico: 'briefcase', group: 'Workspace' },
  { id: 'queue', label: 'Department queue', ico: 'inbox', group: 'Workspace' },
  { id: 'approvals', label: 'Approvals', ico: 'check', group: 'Workspace' },
  { id: 'pmo', label: 'Projects', ico: 'folder', group: 'Workspace' },
  { id: 'insights', label: 'Insights', ico: 'chart', group: 'Workspace' },
  { id: 'assets', label: 'IT assets', ico: 'device', group: 'Workspace' },
  { id: 'admin', label: 'Admin console', ico: 'gear', group: 'Administration' },
]

export default function App() {
  const { session, profile, loading, isAdmin, hasRole, canSee, signOut } = useAuth()
  const [page, setPage] = useState<Page>('home')
  const [adminSection, setAdminSection] = useState<AdminSection | null>(null)
  const [assetsTab, setAssetsTab] = useState<'hardware' | 'licenses' | 'people'>('hardware')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const isStaff = hasRole('agent') || hasRole('team_lead') || hasRole('dept_admin')
  const isApprover = hasRole('approver')
  const canAdmin = isAdmin || hasRole('dept_admin')
  const isSys = hasRole('system_admin')

  const see: Record<Page, boolean> = {
    home: canSee('home') ?? true,
    portal: canSee('portal') ?? !isSys,
    requests: canSee('requests') ?? !isSys,
    mywork: canSee('mywork') ?? (isStaff || isApprover),
    queue: canSee('queue') ?? isStaff,
    approvals: canSee('approvals') ?? isApprover,
    pmo:
      canSee('pmo') ??
      (hasRole('project_manager') || hasRole('pmo_admin') || hasRole('executive') ||
        hasRole('dept_head') || isStaff || isSys),
    insights: canSee('insights') ?? (hasRole('team_lead') || hasRole('executive') || isSys),
    assets:
      canSee('assets') ??
      (hasRole('agent', 'IT') || hasRole('team_lead', 'IT') || hasRole('dept_admin', 'IT') || isSys),
    admin: canSee('admin') ?? canAdmin,
  }
  const adminSections = getAdminSections(hasRole)
  const firstVisible: Page = NAV.find((n) => see[n.id])?.id ?? 'home'

  const go: Navigate = (p, opts) => {
    setDetailId(null)
    setProjectId(null)
    if (opts?.admin) setAdminSection(opts.admin)
    if (opts?.assetsTab) setAssetsTab(opts.assetsTab)
    setPage(p)
  }

  useEffect(() => {
    if (!session) {
      setPage('home')
      setDetailId(null)
    }
  }, [session])

  useEffect(() => {
    if (loading || !session) return
    setPage(see.home ? 'home' : firstVisible)
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
          <span className="brand-badge">ABC</span>
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
                <Icon name={n.ico} size={collapsed ? 20 : 16} />
                <span className="nav-label">{n.label}</span>
              </button>
              {n.id === 'admin' && activePage === 'admin' && !collapsed &&
                adminSections.map((s) => (
                  <button
                    key={s.id}
                    className={`nav-item sub${(adminSection ?? adminSections[0]?.id) === s.id ? ' active' : ''}`}
                    onClick={() => { setDetailId(null); setAdminSection(s.id) }}
                    title={s.label}
                  >
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
        ) : projectId ? (
          <ProjectDetail projectId={projectId} onBack={() => setProjectId(null)} />
        ) : (
          <>
            {activePage === 'home' && see.home && <Home onNavigate={go} onOpenRequest={setDetailId} />}
            {activePage === 'portal' && see.portal && <Portal />}
            {activePage === 'requests' && see.requests && <MyRequests onOpen={setDetailId} />}
            {activePage === 'mywork' && see.mywork && <MyWork onOpen={setDetailId} />}
            {activePage === 'queue' && see.queue && <Queue onOpen={setDetailId} />}
            {activePage === 'approvals' && see.approvals && <Approvals />}
            {activePage === 'pmo' && see.pmo && <Projects onOpen={setProjectId} />}
            {activePage === 'insights' && see.insights && <Insights onOpen={setDetailId} />}
            {activePage === 'assets' && see.assets && (
              <Assets onOpenRequest={setDetailId} initialSection={assetsTab} />
            )}
            {activePage === 'admin' && see.admin && (
              <AdminPage section={adminSection ?? adminSections[0]?.id ?? 'functions'} />
            )}
          </>
        )}
        </Suspense>
      </main>
    </div>
  )
}
