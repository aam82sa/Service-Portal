import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useDepartments } from '../../lib/departments'
import './accessAdmin.css'

/**
 * Access & assignment (ACCESS1 branch 6) — the two screens from
 * prototype/access-and-assignment-reference.html.
 *
 * Tab 1 · Role groups & access: three panes — groups (a bundle of platform
 * roles AND page access, so the two can never drift), the page matrix with a
 * tri-state nav control and the RLS-honesty column (green "Enforced" naming
 * the role the database checks, amber "Cosmetic only" when hiding the page is
 * tidiness, not security), and the group's properties.
 *
 * Tab 2 · Work distribution: per-department mode (pull / round robin / least
 * loaded), the routing switch (rules vs department tray), the per-team table
 * with out-of-office counts, and the impact panel that answers "what happens
 * if I flip this, and who is affected" BEFORE anything is saved.
 */

interface Group { id: string; key: string; name: string; description: string | null; is_system: boolean }
interface GroupRole { id: string; group_id: string; role: string; dept_id: string | null }
interface AppPage { key: string; label: string; route: string; parent_key: string | null; backed_by_role: string | null; is_lockable: boolean }
interface PageGrant { id: string; group_id: string; page_key: string; visibility: 'visible' | 'hidden' }
interface Membership { group_id: string; profile_id: string; profile: { display_name: string } | null }

const ALL_ROLES = [
  'requester', 'agent', 'team_lead', 'approver', 'dept_head', 'dept_admin',
  'executive', 'user_admin', 'system_admin', 'project_manager', 'pmo_admin', 'cybersecurity',
]

export function AccessAssignment() {
  const [tab, setTab] = useState<'groups' | 'dist'>('groups')
  return (
    <div className="axs">
      <h2 className="page-head">Access &amp; assignment</h2>
      <p className="page-sub">
        A role group grants platform roles <em>and</em> page access in one place, so the two can
        never drift apart. The matrix says honestly which toggles the database enforces.
      </p>
      <div className="tabs" role="tablist" aria-label="Access and assignment">
        <button role="tab" aria-selected={tab === 'groups'} onClick={() => setTab('groups')}>
          Role groups &amp; access
        </button>
        <button role="tab" aria-selected={tab === 'dist'} onClick={() => setTab('dist')}>
          Work distribution
        </button>
      </div>
      {tab === 'groups' ? <RoleGroupsTab /> : <DistributionTab />}
    </div>
  )
}

/* ══════════════ Tab 1 — Role groups & access ══════════════ */

function RoleGroupsTab() {
  const { refreshAccess } = useAuth()
  const { active: depts } = useDepartments()
  const [groups, setGroups] = useState<Group[]>([])
  const [groupRoles, setGroupRoles] = useState<GroupRole[]>([])
  const [pages, setPages] = useState<AppPage[]>([])
  const [grants, setGrants] = useState<PageGrant[]>([])
  const [members, setMembers] = useState<Membership[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addRole, setAddRole] = useState('')
  const [addDept, setAddDept] = useState('')

  const load = useCallback(() => {
    supabase.from('role_groups').select('id, key, name, description, is_system').order('created_at')
      .then(({ data, error: e }) => {
        if (e) return setError(e.message)
        const gs = (data as Group[]) ?? []
        setGroups(gs)
        setSel((s) => s ?? gs[0]?.id ?? null)
      })
    supabase.from('role_group_roles').select('id, group_id, role, dept_id')
      .then(({ data }) => setGroupRoles((data as GroupRole[]) ?? []))
    supabase.from('app_pages').select('key, label, route, parent_key, backed_by_role, is_lockable')
      .then(({ data }) => setPages((data as AppPage[]) ?? []))
    supabase.from('role_group_pages').select('id, group_id, page_key, visibility')
      .then(({ data }) => setGrants((data as PageGrant[]) ?? []))
    supabase.from('profile_role_groups').select('group_id, profile_id, profile:profiles(display_name)')
      .then(({ data }) => setMembers((data as unknown as Membership[]) ?? []))
  }, [])
  useEffect(load, [load])

  const run = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    setError(null)
    const { error: e } = await q
    if (e) setError(e.message)
    load()
    refreshAccess()
  }

  const group = groups.find((g) => g.id === sel) ?? null
  const rolesOf = (gid: string) => groupRoles.filter((r) => r.group_id === gid)
  const membersOf = (gid: string) => members.filter((m) => m.group_id === gid)
  const deptName = (id: string | null) => (id ? depts.find((d) => d.id === id)?.code ?? '?' : 'All depts')

  // ordered matrix rows: nav pages, each followed by its detail sub-pages
  const navPages = pages.filter((p) => !p.parent_key)
  const rows = navPages.flatMap((p) => [p, ...pages.filter((s) => s.parent_key === p.key)])

  const grantFor = (pageKey: string) =>
    grants.find((g) => g.group_id === sel && g.page_key === pageKey) ?? null
  const stateFor = (pageKey: string): 'visible' | 'hidden' | 'inherited' =>
    grantFor(pageKey)?.visibility ?? 'inherited'

  // lockable pages (admin console, PMO admin) are never editable here: they
  // can only be granted to their admin group, and cannot be removed there —
  // that would lock every administrator out. The grant state is data-driven.
  const isLockedRow = (p: AppPage) => p.is_lockable

  const setState = (p: AppPage, next: 'visible' | 'hidden' | 'inherited') => {
    if (!sel) return
    const existing = grantFor(p.key)
    if (next === 'inherited') {
      if (existing) run(supabase.from('role_group_pages').delete().eq('id', existing.id))
      return
    }
    if (existing) run(supabase.from('role_group_pages').update({ visibility: next }).eq('id', existing.id))
    else run(supabase.from('role_group_pages').insert({ group_id: sel, page_key: p.key, visibility: next }))
  }

  // live validation, computed from the model
  const cosmeticVisible = rows.filter((p) => !p.backed_by_role && stateFor(p.key) === 'visible')
  const backedCount = rows.filter((p) => p.backed_by_role).length

  return (
    <>
      <div className="three">
        {/* LEFT — role groups */}
        <aside className="pane" aria-label="Role groups">
          <div className="pane-head"><span>Role groups</span><span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>{groups.length}</span></div>
          <div className="glist">
            {groups.map((g) => (
              <button key={g.id} className={`gitem${g.id === sel ? ' on' : ''}`} onClick={() => setSel(g.id)} aria-current={g.id === sel}>
                <span className="g-top">
                  <span className="g-name">{g.name}</span>
                  <span className="g-count">{membersOf(g.id).length}</span>
                </span>
                <span className="g-roles">
                  {rolesOf(g.id).slice(0, 3).map((r) => (
                    <span key={r.id} className={`rchip${r.role === 'system_admin' || r.role === 'user_admin' || r.role === 'dept_admin' ? ' sys' : r.dept_id ? ' hi' : ''}`}>
                      {r.role}{r.dept_id ? ` · ${deptName(r.dept_id)}` : ''}
                    </span>
                  ))}
                  {rolesOf(g.id).length > 3 && <span className="rchip">+{rolesOf(g.id).length - 3}</span>}
                </span>
              </button>
            ))}
            <div className="glist-foot">
              <button
                className="btn sm"
                style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed' }}
                onClick={() => {
                  const name = window.prompt('New group name')
                  if (!name?.trim()) return
                  const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
                  run(supabase.from('role_groups').insert({ key, name: name.trim() }))
                }}
              >
                + New group
              </button>
              <p className="hint">A group grants platform roles <em>and</em> page access in one place, so the two can never drift apart.</p>
            </div>
          </div>
        </aside>

        {/* CENTRE — page matrix */}
        <section className="pane" aria-label={`Page access matrix${group ? ` for ${group.name}` : ''}`}>
          <div className="pane-head">
            <span>Page access{group ? ` — ${group.name}` : ''}</span>
            <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
              {navPages.length} pages · {rows.length - navPages.length} sub-pages
            </span>
          </div>

          {cosmeticVisible.length > 0 && (
            <div className="valbar" role="status" aria-label="Validation">
              <span className="vlabel">Validation</span>
              <span className="vitem warn">
                <span className="vmark w">•</span>
                {cosmeticVisible.length} visible page{cosmeticVisible.length === 1 ? ' is' : 's are'} nav-only — RLS still returns their rows to the API.
              </span>
            </div>
          )}

          <div style={{ overflow: 'auto' }}>
            <table className="mx">
              <thead>
                <tr>
                  <th style={{ width: '34%' }}>Page</th>
                  <th style={{ width: '24%' }}>Nav visibility</th>
                  <th>Backed by RLS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const st = stateFor(p.key)
                  const locked = isLockedRow(p)
                  const cosmetic = !p.backed_by_role
                  return (
                    <tr key={p.key} className={`${p.parent_key ? 'sub ' : ''}${cosmetic ? 'warnrow' : ''}${locked ? ' lockedrow' : ''}`}>
                      <td>
                        <span className="p-cell">
                          <span>
                            <span className="p-name2">{p.label}</span>
                            <span className="p-route">{p.route}</span>
                          </span>
                          {locked && <span className="lock">locked</span>}
                        </span>
                      </td>
                      <td>
                        <span className={`tri${locked ? ' dis' : ''}`} role="group" aria-label={`${p.label} visibility`}>
                          {(['visible', 'hidden', 'inherited'] as const).map((v) => (
                            <button key={v} aria-pressed={st === v} disabled={locked} onClick={() => setState(p, v)}>
                              {v[0].toUpperCase() + v.slice(1)}
                            </button>
                          ))}
                        </span>
                      </td>
                      <td>
                        <span className="rls">
                          <span className={`rmark ${cosmetic ? 'w' : 'ok'}`}>{cosmetic ? '!' : '✓'}</span>
                          <span className="rtext">
                            {cosmetic ? (
                              <><strong>Cosmetic only — data still readable via API</strong>Hiding this tile does not stop the query. No platform role gates the data.</>
                            ) : (
                              <><strong>Enforced</strong>A platform role checks this in the database. <span className="rrole">{p.backed_by_role}</span></>
                            )}
                          </span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mx-foot">
            <span><span className="rmark ok" style={{ display: 'inline-flex', verticalAlign: -3, marginInlineEnd: 5 }}>✓</span>A platform role enforces this in the database.</span>
            <span><span className="rmark w" style={{ display: 'inline-flex', verticalAlign: -3, marginInlineEnd: 5 }}>!</span>Nav only — tidiness, not security.</span>
          </div>
        </section>

        {/* RIGHT — group properties */}
        <aside className="pane" aria-label="Group properties">
          <div className="pane-head"><span>Group properties</span><span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>group</span></div>
          {group ? (
            <div className="props">
              <div className="p-title">{group.name}</div>
              <div className="p-key">role_group · {group.key}</div>

              <div className="prop-sec">Identity</div>
              <div className="prop-row">
                <label className="prop-lbl" htmlFor="gname">Name</label>
                <input className="input" id="gname" defaultValue={group.name} key={group.id + '-n'}
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value !== group.name) run(supabase.from('role_groups').update({ name: e.target.value.trim() }).eq('id', group.id)) }} />
              </div>
              <div className="prop-row">
                <label className="prop-lbl" htmlFor="gdesc">Description</label>
                <textarea className="input" id="gdesc" rows={2} defaultValue={group.description ?? ''} key={group.id + '-d'}
                  onBlur={(e) => { if (e.target.value !== (group.description ?? '')) run(supabase.from('role_groups').update({ description: e.target.value || null }).eq('id', group.id)) }} />
              </div>

              <div className="prop-sec">Platform roles granted <span className="chip t-green" style={{ background: 'var(--green-soft)', color: 'var(--green)', fontSize: 9 }}>RLS honours these</span></div>
              {rolesOf(group.id).map((r) => (
                <div className="grant" key={r.id}>
                  <span className="rn">{r.role}</span>
                  <span className="sc">· {deptName(r.dept_id)}</span>
                  <button className="x" aria-label={`Remove ${r.role} role`}
                    onClick={() => run(supabase.from('role_group_roles').delete().eq('id', r.id))}>×</button>
                </div>
              ))}
              <div className="addrole">
                <select className="input" aria-label="Role to add" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                  <option value="">Add role…</option>
                  {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="input" aria-label="Department scope" style={{ maxWidth: 96 }} value={addDept} onChange={(e) => setAddDept(e.target.value)}>
                  <option value="">All depts</option>
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
                </select>
                <button className="btn sm" disabled={!addRole}
                  onClick={() => { run(supabase.from('role_group_roles').insert({ group_id: group.id, role: addRole, dept_id: addDept || null })); setAddRole('') }}>
                  Add
                </button>
              </div>
              <p className="hint">Adding a role here materialises a <span className="mono">role_assignments</span> row for every member — RLS applies immediately at the database layer.</p>

              <div className="prop-sec">Members</div>
              <div className="memrow">
                <span className="memnum">{membersOf(group.id).length}</span>
                <span className="hint" style={{ marginTop: 0 }}>
                  {membersOf(group.id).slice(0, 3).map((m) => m.profile?.display_name).filter(Boolean).join(', ') || 'No members yet — assign from User management.'}
                  {membersOf(group.id).length > 3 && ` +${membersOf(group.id).length - 3} more`}
                </span>
              </div>

              <div className="prop-sec">Impact</div>
              <div className="callout amber">
                <span className="ct">Changing this affects {membersOf(group.id).length} {membersOf(group.id).length === 1 ? 'person' : 'people'}</span>
                Role grants apply immediately at the database layer — an open tab loses access to data before the nav updates.
              </div>

              <div className="prop-sec">Coverage</div>
              <div className="callout info">
                <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{backedCount} of {rows.length} rows</strong> are backed by a platform role.{' '}
                {rows.length - backedCount} nav-only.
              </div>
            </div>
          ) : (
            <div className="props"><p className="hint">Select a group.</p></div>
          )}
        </aside>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}

/* ══════════════ Tab 2 — Work distribution ══════════════ */

interface Team { id: string; dept: string | null; dept_id: string | null; name: string; assignment_strategy: 'none' | 'round_robin' | 'load_based' }

const MODE_META = {
  none: { title: 'Pull — officers claim their own work', desc: 'Requests land unassigned in the team queue. Officers pick what they take. Nothing is pushed to anyone.', chip: 'Pull' },
  round_robin: { title: 'Push — round robin', desc: 'Each new request goes to the next officer in the rotation, skipping anyone marked out of office.', chip: 'Round robin' },
  load_based: { title: 'Push — least loaded', desc: 'Each new request goes to the officer with the fewest open requests. Ties break by longest idle.', chip: 'Least loaded' },
} as const

function DistributionTab() {
  const { active: depts } = useDepartments()
  const [deptId, setDeptId] = useState('')
  const [teams, setTeams] = useState<Team[]>([])
  const [memberCount, setMemberCount] = useState<Map<string, number>>(new Map())
  const [oooCount, setOooCount] = useState<Map<string, number>>(new Map())
  const [openLoad, setOpenLoad] = useState<Map<string, number>>(new Map())
  const [openAssigned, setOpenAssigned] = useState(0)
  const [routeViaRules, setRouteViaRules] = useState(true)
  const [ruleCount, setRuleCount] = useState(0)
  const [mode, setMode] = useState<Team['assignment_strategy']>('none')
  const [routing, setRouting] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!deptId && depts.length > 0) setDeptId(depts[0].id) }, [depts, deptId])

  const load = useCallback(() => {
    if (!deptId) return
    supabase.from('teams').select('id, dept, dept_id, name, assignment_strategy').eq('dept_id', deptId).order('name')
      .then(async ({ data, error: e }) => {
        if (e) return setError(e.message)
        const ts = (data as Team[]) ?? []
        setTeams(ts)
        // dominant mode = the mode most teams run; preview starts from it
        const counts = new Map<string, number>()
        for (const t of ts) counts.set(t.assignment_strategy, (counts.get(t.assignment_strategy) ?? 0) + 1)
        const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as Team['assignment_strategy'] | undefined
        setMode(dominant ?? 'none')
        const ids = ts.map((t) => t.id)
        if (ids.length === 0) { setMemberCount(new Map()); setOooCount(new Map()); setOpenLoad(new Map()); return }
        const [{ data: tm }, { data: reqs }] = await Promise.all([
          supabase.from('team_members').select('team_id, profile_id').in('team_id', ids),
          supabase.from('requests').select('team_id, assignee_id').in('team_id', ids)
            .not('status', 'in', '(resolved,closed,cancelled)'),
        ])
        const mc = new Map<string, number>()
        for (const m of (tm as { team_id: string; profile_id: string }[]) ?? []) mc.set(m.team_id, (mc.get(m.team_id) ?? 0) + 1)
        setMemberCount(mc)
        const ol = new Map<string, number>()
        let assigned = 0
        for (const r of (reqs as { team_id: string; assignee_id: string | null }[]) ?? []) {
          ol.set(r.team_id, (ol.get(r.team_id) ?? 0) + 1)
          if (r.assignee_id) assigned += 1
        }
        setOpenLoad(ol)
        setOpenAssigned(assigned)
        // out-of-office: an active delegation row, the same predicate the engine skips on
        const profileIds = [...new Set(((tm as { team_id: string; profile_id: string }[]) ?? []).map((m) => m.profile_id))]
        if (profileIds.length > 0) {
          const today = new Date().toISOString().slice(0, 10)
          const { data: dels } = await supabase.from('approval_delegations')
            .select('delegator_id').in('delegator_id', profileIds)
            .lte('starts_on', today).gte('ends_on', today)
          const away = new Set(((dels as { delegator_id: string }[]) ?? []).map((d) => d.delegator_id))
          const oc = new Map<string, number>()
          for (const m of (tm as { team_id: string; profile_id: string }[]) ?? []) {
            if (away.has(m.profile_id)) oc.set(m.team_id, (oc.get(m.team_id) ?? 0) + 1)
          }
          setOooCount(oc)
        } else setOooCount(new Map())
      })
    supabase.from('departments').select('route_via_rules').eq('id', deptId).single()
      .then(({ data }) => {
        const v = (data as { route_via_rules: boolean } | null)?.route_via_rules ?? true
        setRouteViaRules(v); setRouting(v)
      })
    supabase.from('routing_rules').select('id', { count: 'exact', head: true }).eq('dept_id', deptId)
      .then(({ count }) => setRuleCount(count ?? 0))
  }, [deptId])
  useEffect(load, [load])

  const dept = depts.find((d) => d.id === deptId)
  const officers = [...memberCount.values()].reduce((a, b) => a + b, 0)
  const away = [...oooCount.values()].reduce((a, b) => a + b, 0)
  const currentDominant = teams.length > 0 ? teams[0].assignment_strategy : 'none'
  const dirty = teams.some((t) => t.assignment_strategy !== mode) || routing !== routeViaRules
  const maxLoad = Math.max(1, ...openLoad.values())

  const apply = async () => {
    setError(null)
    if (teams.some((t) => t.assignment_strategy !== mode)) {
      const { error: e } = await supabase.from('teams').update({ assignment_strategy: mode }).eq('dept_id', deptId)
      if (e) return setError(e.message)
    }
    if (routing !== routeViaRules) {
      const { error: e } = await supabase.from('departments').update({ route_via_rules: routing }).eq('id', deptId)
      if (e) return setError(e.message)
    }
    setNote(`Applied to ${dept?.code ?? 'department'} — new requests only; nothing was reassigned.`)
    load()
  }

  return (
    <>
      <div className="builder-bar" style={{ marginBottom: 12 }}>
        <span className="scope-badge scope-dept" style={{ background: 'var(--it-soft)', color: 'var(--it)' }}>Department · {dept?.code ?? '—'}</span>
        <select className="input" style={{ maxWidth: 240 }} aria-label="Department" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
        </select>
        <span className="tool-spacer" />
        <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>Set per department, not globally</span>
      </div>

      <div className="dist">
        <section className="pane" aria-label="Distribution settings">
          <div className="pane-head"><span>How requests reach officers</span><span className="chip mono" style={{ background: 'var(--it-soft)', color: 'var(--it)' }}>{dept?.code ?? ''} · {teams.length} team{teams.length === 1 ? '' : 's'}</span></div>
          <div className="dbody">
            <div className="subhead">Mode</div>
            <div className="modes" role="radiogroup" aria-label="Distribution mode">
              {(Object.keys(MODE_META) as Team['assignment_strategy'][]).map((m) => (
                <label key={m} className={`mode${mode === m ? ' on' : ''}`}>
                  <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                  <span>
                    <span className="mt">{MODE_META[m].title}</span>
                    <span className="md">{MODE_META[m].desc}</span>
                  </span>
                  <span className="mk">{m}</span>
                </label>
              ))}
            </div>

            <div className="subhead">Routing — which tray a request lands in first</div>
            <div className="split" role="radiogroup" aria-label="Routing">
              <label className={`rt${routing ? ' on' : ''}`}>
                <input type="radio" name="routing" checked={routing} onChange={() => setRouting(true)} />
                <span>
                  <span className="mt">Route to a team using rules</span>
                  <span className="md">Category and service decide the team; {ruleCount} rule{ruleCount === 1 ? ' is' : 's are'} active for {dept?.code ?? 'this department'}.</span>
                </span>
              </label>
              <label className={`rt${!routing ? ' on' : ''}`}>
                <input type="radio" name="routing" checked={!routing} onChange={() => setRouting(false)} />
                <span>
                  <span className="mt">Send everything to the department tray</span>
                  <span className="md">One shared tray. Team leads triage by hand.</span>
                </span>
              </label>
            </div>

            <div className="subhead">Teams in {dept?.code ?? '—'}</div>
            <table className="tt">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Team</th>
                  <th className="num" style={{ width: '11%' }}>Members</th>
                  <th style={{ width: '22%' }}>Current mode</th>
                  <th className="num" style={{ width: '22%' }}>Open load</th>
                  <th className="num" style={{ width: '15%' }}>Out of office</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => {
                  const loadN = openLoad.get(t.id) ?? 0
                  const ooo = oooCount.get(t.id) ?? 0
                  return (
                    <tr key={t.id}>
                      <td><span className="tname">{t.name}</span></td>
                      <td className="num">{memberCount.get(t.id) ?? 0}</td>
                      <td>
                        <span className="chip" style={t.assignment_strategy === 'none'
                          ? { background: 'var(--surface)', color: 'var(--muted)' }
                          : { background: 'var(--it-soft)', color: 'var(--it)' }}>
                          {MODE_META[t.assignment_strategy].chip}
                        </span>
                      </td>
                      <td className="num">
                        <span className="bar"><i className={loadN > maxLoad * 0.7 ? 'hot' : ''} style={{ width: Math.max(6, Math.round((loadN / maxLoad) * 74)) }} />{loadN}</span>
                      </td>
                      <td className="num" style={ooo > 0 ? { color: 'var(--amber-ink)', fontWeight: 600 } : undefined}>{ooo}</td>
                    </tr>
                  )
                })}
                {teams.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>No teams in this department yet.</td></tr>}
              </tbody>
            </table>
            <p className="hint" style={{ padding: '6px 12px 2px' }}>
              Push modes skip officers who are out of office — the rotation falls to whoever remains.
              The old global “Auto-assignment” flag was removed: nothing ever read it. Distribution is
              decided here, per department and per team.
            </p>
          </div>
        </section>

        <aside className="pane" aria-label="What happens if I change this">
          <div className="pane-head"><span>What happens if I change this</span><span className="chip mono" style={{ background: 'var(--amber-soft)', color: 'var(--amber-ink)' }}>{dirty ? 'preview' : 'current'}</span></div>
          <div className="dbody">
            <div className="callout info" style={{ marginBottom: 10 }}>
              {dirty ? (
                <>Previewing a switch to <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{MODE_META[mode].chip}</strong>{routing !== routeViaRules && <> and routing {routing ? 'via rules' : 'to the department tray'}</>} for {dept?.code ?? 'this department'}. Nothing is saved until you press Apply.</>
              ) : (
                <>This is the current configuration for {dept?.code ?? 'this department'} — {MODE_META[currentDominant].chip}, routing {routeViaRules ? 'via rules' : 'to the department tray'}.</>
              )}
            </div>

            <div className="imp-row">
              <span className="imp-num">{officers}</span>
              <span className="imp-txt"><b>officers across {teams.length} team{teams.length === 1 ? '' : 's'}</b> {mode === 'none' ? 'choose their own work from the queue.' : 'start receiving requests automatically instead of choosing them.'}</span>
            </div>
            <div className="imp-row">
              <span className="imp-num">{openAssigned}</span>
              <span className="imp-txt"><b>currently-open requests keep their assignee.</b> Nothing is reshuffled, reassigned or re-queued.</span>
            </div>
            <div className="imp-row">
              <span className="imp-num">→</span>
              <span className="imp-txt"><b>New requests only.</b> The rule applies from the moment you apply it, to requests raised after that point.</span>
            </div>
            <div className="imp-row">
              <span className="imp-num">{away}</span>
              <span className="imp-txt"><b>officers are out of office</b> and will be skipped until they return.</span>
            </div>

            <div className="who">
              <div className="prop-sec" style={{ margin: '0 0 4px' }}>Who is affected</div>
              <div className="who-row"><span className="dot" style={{ background: '#C3CAD8' }} /><span className="who-role">Requesters</span><span className="who-eff">No visible change. They still submit the same way.</span></div>
              <div className="who-row"><span className="dot" style={{ background: 'var(--accent)' }} /><span className="who-role">Officers</span><span className="who-eff">{mode === 'none' ? 'Officers claim from the queue — the “Claim” button stays.' : 'Work is pushed instead of pulled. The “Claim” button disappears from the team queue.'}</span></div>
              <div className="who-row"><span className="dot" style={{ background: 'var(--it)' }} /><span className="who-role">Team leads</span><span className="who-eff">Can still reassign within their team, exactly as today.</span></div>
              <div className="who-row"><span className="dot" style={{ background: '#C3CAD8' }} /><span className="who-role">Dept heads</span><span className="who-eff">Unchanged. Reporting and approvals are not affected.</span></div>
              <div className="who-row"><span className="dot" style={{ background: 'var(--green)' }} /><span className="who-role">Admins</span><span className="who-eff">Can switch back at any time. The previous mode is kept in the audit log.</span></div>
            </div>

            <div className="callout green" style={{ marginTop: 12 }}>
              <span className="ct">Reversible</span>
              Switching back leaves every assignment already made in place — it only stops new ones being pushed.
            </div>

            <div className="savebar">
              <button className="btn primary" onClick={apply} disabled={!dirty}>Apply to {dept?.code ?? '—'}</button>
              <button className="btn" onClick={() => { setMode(currentDominant); setRouting(routeViaRules) }} disabled={!dirty}>Cancel</button>
              <span className="tool-spacer" />
              {note && <span style={{ fontSize: 11.5, color: 'var(--green)' }}>{note}</span>}
            </div>
          </div>
        </aside>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
