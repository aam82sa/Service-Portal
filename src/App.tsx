import { Suspense, lazy, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { useAuth } from './features/auth/AuthProvider'
import { SignIn } from './features/auth/SignIn'
import { Home } from './features/home/Home'
import { Portal } from './features/catalog/Portal'
import { MyRequests } from './features/requests/MyRequests'
import { Work, type WorkView } from './features/requests/Work'
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
const PmoAdmin = lazy(() => import('./features/pmo/PmoAdmin').then((m) => ({ default: m.PmoAdmin })))
const Letters = lazy(() => import('./features/letters/Letters').then((m) => ({ default: m.Letters })))

type Page = 'home' | 'portal' | 'requests' | 'work' | 'pmo' | 'letters' | 'insights' | 'assets' | 'admin' | 'pmoadmin'
export type NavOpts = { admin?: AdminSection; assetsTab?: 'hardware' | 'licenses' | 'people'; workView?: WorkView }
export type Navigate = (page: Page, opts?: NavOpts) => void

const NAV: { id: Page; label: string; ico: IconName; group?: string }[] = [
  { id: 'home', label: 'Overview', ico: 'home' },
  { id: 'portal', label: 'New request', ico: 'plus' },
  { id: 'requests', label: 'My requests', ico: 'list' },
  { id: 'work', label: 'Work', ico: 'briefcase', group: 'Workspace' },
  { id: 'pmo', label: 'Projects', ico: 'folder', group: 'Workspace' },
  { id: 'letters', label: 'Correspondence', ico: 'mail', group: 'Workspace' },
  { id: 'insights', label: 'Insights', ico: 'chart', group: 'Workspace' },
  { id: 'assets', label: 'IT assets', ico: 'device', group: 'Workspace' },
  { id: 'pmoadmin', label: 'PMO Admin', ico: 'shield', group: 'Administration' },
  { id: 'admin', label: 'Admin console', ico: 'sliders', group: 'Administration' },
]

export default function App() {
  const { session, profile, loading, isAdmin, hasRole, canSee, signOut } = useAuth()
  const [page, setPage] = useState<Page>('home')
  const [adminSection, setAdminSection] = useState<AdminSection | null>(null)
  const [assetsTab, setAssetsTab] = useState<'hardware' | 'licenses' | 'people'>('hardware')
  const [workView, setWorkView] = useState<WorkView | undefined>(undefined)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-folded') === '1')
  const [workBadge, setWorkBadge] = useState(0)
  const [isCommittee, setIsCommittee] = useState(false)
  const isStaff = hasRole('agent') || hasRole('team_lead') || hasRole('dept_admin')
  const isApprover = hasRole('approver')
  const canAdmin = isAdmin || hasRole('dept_admin')
  const isSys = hasRole('system_admin')

  const see: Record<Page, boolean> = {
    home: canSee('home') ?? true,
    portal: canSee('portal') ?? !isSys,
    requests: canSee('requests') ?? !isSys,
    work: canSee('mywork') ?? canSee('queue') ?? canSee('approvals') ?? (isStaff || isApprover),
    pmo:
      canSee('pmo') ??
      (hasRole('project_manager') || hasRole('pmo_admin') || hasRole('executive') ||
        hasRole('dept_head') || isStaff || isSys || isCommittee),
    letters:
      canSee('letters') ??
      (isStaff || hasRole('dept_head') || isSys),
    insights: canSee('insights') ?? (hasRole('team_lead') || hasRole('executive') || isSys),
    assets:
      canSee('assets') ??
      (hasRole('agent', 'IT') || hasRole('team_lead', 'IT') || hasRole('dept_admin', 'IT') || isSys),
    admin: canSee('admin') ?? canAdmin,
    pmoadmin: canSee('pmoadmin') ?? (hasRole('pmo_admin') || isSys),
  }
  const adminSections = getAdminSections(hasRole)
  const firstVisible: Page = NAV.find((n) => see[n.id])?.id ?? 'home'

  const go: Navigate = (p, opts) => {
    setDetailId(null)
    setProjectId(null)
    if (opts?.admin) setAdminSection(opts.admin)
    if (opts?.assetsTab) setAssetsTab(opts.assetsTab)
    setWorkView(opts?.workView)
    setPage(p)
  }

  useEffect(() => {
    if (!session) {
      setPage('home')
      setDetailId(null)
    }
  }, [session])

  // Open items assigned to me -> count pill on "My work"
  useEffect(() => {
    if (!session || !isStaff) {
      setWorkBadge(0)
      return
    }
    supabase
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .eq('assignee_id', session.user.id)
      .not('status', 'in', '(resolved,closed,cancelled)')
      .then(({ count }) => setWorkBadge(count ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isStaff])

  // Committee membership grants Projects access without any platform role
  useEffect(() => {
    if (!session || !profile) {
      setIsCommittee(false)
      return
    }
    supabase
      .from('pmo_committee_members')
      .select('id')
      .eq('user_id', profile.id)
      .then(({ data }) => setIsCommittee((data ?? []).length > 0))
  }, [session, profile])

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
            onClick={() => { localStorage.setItem('sidebar-folded', collapsed ? '0' : '1'); setCollapsed(!collapsed) }}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
        {NAV.filter((n) => see[n.id]).map((n) => {
          const isNewGroup = n.group && n.group !== lastGroup
          lastGroup = n.group ?? lastGroup
          return (
            <div key={n.id}>
              {isNewGroup && <div className="nav-group">{n.group}</div>}
              {isNewGroup && <div className="nav-divider" />}
              <button
                className={`nav-item${activePage === n.id ? ' active' : ''}`}
                onClick={() => go(n.id)}
                title={n.label}
              >
                <Icon name={n.ico} size={collapsed ? 17 : 16} />
                <span className="nav-label">{n.label}</span>
                {n.id === 'work' && workBadge > 0 && <span className="nav-badge">{workBadge}</span>}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }} title={profile?.display_name}>
            <span className="avatar">
              {(profile?.display_name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            <div className="foot-meta">
              <div className="foot-name">{profile?.display_name}</div>
              <div className="foot-mail">{profile?.upn}</div>
            </div>
          </div>
          <button className="nav-item foot-signout" onClick={signOut} style={{ padding: '6px 0', marginTop: 8 }}>
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
            {activePage === 'home' && see.home && <Home onNavigate={go} onOpenRequest={setDetailId} onOpenProject={setProjectId} />}
            {activePage === 'portal' && see.portal && <Portal />}
            {activePage === 'requests' && see.requests && <MyRequests onOpen={setDetailId} />}
            {activePage === 'work' && see.work && <Work onOpen={setDetailId} initialView={workView} key={workView ?? 'default'} />}
            {activePage === 'pmo' && see.pmo && <Projects onOpen={setProjectId} />}
            {activePage === 'pmoadmin' && see.pmoadmin && <PmoAdmin />}
            {activePage === 'letters' && see.letters && <Letters />}
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
