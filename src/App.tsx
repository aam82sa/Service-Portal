import { Suspense, lazy, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuth } from './features/auth/AuthProvider'
import { SignIn } from './features/auth/SignIn'
import { Home } from './features/home/Home'
import { Portal } from './features/catalog/Portal'
import { MyRequests } from './features/requests/MyRequests'
import { Work, type WorkView } from './features/requests/Work'
import { RequestDetail } from './features/requests/RequestDetail'
import { Icon, type IconName } from './components/icons'
import { useTranslation } from 'react-i18next'
import { applyLang, type Lang } from './i18n'
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

/** URL home of each page — deep-linkable and bookmarkable */
const PATH: Record<Page, string> = {
  home: '/', portal: '/new', requests: '/requests', work: '/work',
  pmo: '/projects', letters: '/letters', insights: '/insights',
  assets: '/assets', admin: '/admin', pmoadmin: '/pmo-admin',
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NAV: { id: Page; tkey: string; ico: IconName; group?: 'workspace' | 'administration' }[] = [
  { id: 'home', tkey: 'nav.overview', ico: 'home' },
  { id: 'portal', tkey: 'nav.newRequest', ico: 'plus' },
  { id: 'requests', tkey: 'nav.myRequests', ico: 'list' },
  { id: 'work', tkey: 'nav.work', ico: 'briefcase', group: 'workspace' },
  { id: 'pmo', tkey: 'nav.projects', ico: 'folder', group: 'workspace' },
  { id: 'letters', tkey: 'nav.correspondence', ico: 'mail', group: 'workspace' },
  { id: 'insights', tkey: 'nav.insights', ico: 'chart', group: 'workspace' },
  { id: 'assets', tkey: 'nav.assets', ico: 'device', group: 'workspace' },
  { id: 'pmoadmin', tkey: 'nav.pmoAdmin', ico: 'shield', group: 'administration' },
  { id: 'admin', tkey: 'nav.admin', ico: 'sliders', group: 'administration' },
]

export default function App() {
  const { session, profile, loading, isAdmin, hasRole, canSee, signOut } = useAuth()
  const { t, i18n } = useTranslation()
  const loc = useLocation()
  const nav = useNavigate()
  const [assetsTab, setAssetsTab] = useState<'hardware' | 'licenses' | 'people'>('hardware')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)

  // ---- URL is the source of truth ----
  const segs = loc.pathname.split('/').filter(Boolean)
  const base = '/' + (segs[0] ?? '')
  const page = (Object.entries(PATH).find(([, path]) => path === base)?.[0] ?? 'home') as Page
  const detailParam = segs[0] === 'requests' ? segs[1] ?? null : null
  const projectParam = segs[0] === 'projects' ? segs[1] ?? null : null
  const adminSection = (segs[0] === 'admin' ? (segs[1] as AdminSection | undefined) : undefined) ?? null
  const workView = (new URLSearchParams(loc.search).get('view') as WorkView | null) ?? undefined
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
    if (opts?.assetsTab) setAssetsTab(opts.assetsTab)
    let path = PATH[p]
    if (p === 'admin' && opts?.admin) path = `/admin/${opts.admin}`
    if (p === 'work' && opts?.workView) path = `/work?view=${opts.workView}`
    nav(path)
  }
  const openRequest = (id: string) => nav(`/requests/${id}`)
  const openProject = (id: string) => nav(`/projects/${id}`)
  const goBack = () => (window.history.length > 1 ? nav(-1) : nav('/'))

  // /requests/:refOrId — accept both, then canonicalize the URL to the REF
  useEffect(() => {
    if (!detailParam) {
      setDetailId(null)
      return
    }
    if (UUID_RE.test(detailParam)) {
      setDetailId(detailParam)
      supabase.from('requests').select('ref').eq('id', detailParam).single()
        .then(({ data }) => {
          const ref = (data as { ref: string } | null)?.ref
          if (ref) nav(`/requests/${ref}`, { replace: true })
        })
    } else {
      supabase.from('requests').select('id').eq('ref', detailParam.toUpperCase()).single()
        .then(({ data }) => setDetailId((data as { id: string } | null)?.id ?? null))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailParam])

  // /projects/:codeOrId — same treatment with the PJ- code
  useEffect(() => {
    if (!projectParam) {
      setProjectId(null)
      return
    }
    if (UUID_RE.test(projectParam)) {
      setProjectId(projectParam)
      supabase.from('projects').select('code').eq('id', projectParam).single()
        .then(({ data }) => {
          const code = (data as { code: string } | null)?.code
          if (code) nav(`/projects/${code}`, { replace: true })
        })
    } else {
      supabase.from('projects').select('id').eq('code', projectParam.toUpperCase()).single()
        .then(({ data }) => setProjectId((data as { id: string } | null)?.id ?? null))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectParam])

  useEffect(() => {
    if (!session && loc.pathname !== '/') nav('/', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              {isNewGroup && <div className="nav-group">{t(`nav.${n.group}`)}</div>}
              {isNewGroup && <div className="nav-divider" />}
              <button
                className={`nav-item${activePage === n.id ? ' active' : ''}`}
                onClick={() => go(n.id)}
                title={t(n.tkey)}
              >
                <Icon name={n.ico} size={collapsed ? 17 : 16} />
                <span className="nav-label">{t(n.tkey)}</span>
                {n.id === 'work' && workBadge > 0 && <span className="nav-badge">{workBadge}</span>}
              </button>
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
          <button
            className="nav-item foot-signout"
            onClick={() => applyLang((i18n.language === 'ar' ? 'en' : 'ar') as Lang)}
            style={{ padding: '6px 0', marginTop: 8 }}
            title={t('common.language')}
          >
            <span className="nav-label">{i18n.language === 'ar' ? 'English' : 'العربية'}</span>
          </button>
          <button className="nav-item foot-signout" onClick={signOut} style={{ padding: '6px 0', marginTop: 4 }}>
            <span className="nav-label">{t('nav.signOut')}</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <Suspense fallback={<p className="page-sub">Loading…</p>}>
        {detailParam && detailId ? (
          <RequestDetail requestId={detailId} onBack={goBack} />
        ) : projectParam && projectId ? (
          <ProjectDetail projectId={projectId} onBack={goBack} />
        ) : (
          <>
            {activePage === 'home' && see.home && <Home onNavigate={go} onOpenRequest={openRequest} onOpenProject={openProject} />}
            {activePage === 'portal' && see.portal && <Portal />}
            {activePage === 'requests' && see.requests && <MyRequests onOpen={openRequest} />}
            {activePage === 'work' && see.work && (
              <Work
                onOpen={openRequest}
                initialView={workView}
                key={workView ?? 'default'}
                onViewChange={(v) => nav(`/work?view=${v}`, { replace: true })}
              />
            )}
            {activePage === 'pmo' && see.pmo && <Projects onOpen={openProject} />}
            {activePage === 'pmoadmin' && see.pmoadmin && <PmoAdmin />}
            {activePage === 'letters' && see.letters && <Letters />}
            {activePage === 'insights' && see.insights && <Insights onOpen={openRequest} />}
            {activePage === 'assets' && see.assets && (
              <Assets onOpenRequest={openRequest} initialSection={assetsTab} />
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
