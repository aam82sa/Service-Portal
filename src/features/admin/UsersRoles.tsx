import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, PORTAL_DEPTS, type DeptCode, type Profile, type Role, type RoleAssignment } from '../../lib/types'

interface ProfileWithRoles extends Profile {
  role_assignments: RoleAssignment[]
}

interface Membership {
  profile_id: string
  dept: DeptCode
}

const ROLE_CHIP: Record<string, { bg: string; fg: string }> = {
  agent: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  team_lead: { bg: 'var(--admin-soft)', fg: 'var(--admin)' },
  dept_head: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  approver: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  dept_admin: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  executive: { bg: 'var(--surface)', fg: 'var(--muted)' },
  user_admin: { bg: 'var(--green-soft)', fg: 'var(--green)' },
  system_admin: { bg: 'var(--red-soft)', fg: 'var(--red)' },
}

const GLOBAL_ROLES: Role[] = ['user_admin', 'system_admin']
const CONTAINER_ROLES: Role[] = ['agent', 'team_lead', 'dept_head']

export function UsersRoles() {
  const { hasRole, session } = useAuth()
  const canEdit = hasRole('user_admin')
  const [users, setUsers] = useState<ProfileWithRoles[]>([])
  const [members, setMembers] = useState<Membership[]>([])
  const [tab, setTab] = useState<'all' | DeptCode>('all')
  const [drafts, setDrafts] = useState<Record<string, Role | ''>>({})
  const [addMember, setAddMember] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<Role | ''>('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    supabase
      .from('profiles')
      .select('*, role_assignments(role, dept, source_ad_group)')
      .order('display_name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setUsers((data as ProfileWithRoles[]) ?? [])
      })
    supabase
      .from('container_members')
      .select('profile_id, dept')
      .then(({ data }) => setMembers((data as Membership[]) ?? []))
  }, [])
  useEffect(load, [load])

  const isMember = (uid: string, d: DeptCode) => members.some((m) => m.profile_id === uid && m.dept === d)
  const containersOf = (uid: string) => members.filter((m) => m.profile_id === uid).map((m) => m.dept)

  const grant = async (uid: string, role: Role, dept: DeptCode | null) => {
    setError(null)
    setNote(null)
    const { error: e } = await supabase.from('role_assignments').insert({
      profile_id: uid, role, dept, source_ad_group: 'manual',
    })
    if (e) setError(e.message.includes('duplicate') ? 'Already holds this role.' : e.message)
    load()
  }

  const revoke = async (u: ProfileWithRoles, ra: RoleAssignment) => {
    if (u.id === session?.user.id && ra.role === 'user_admin') {
      setError('You cannot revoke your own user admin role.')
      return
    }
    setError(null)
    let q = supabase.from('role_assignments').delete().eq('profile_id', u.id).eq('role', ra.role)
    q = ra.dept ? q.eq('dept', ra.dept) : q.is('dept', null)
    const { error: e } = await q
    if (e) setError(e.message)
    load()
  }

  const addToContainer = async (uid: string, d: DeptCode) => {
    setError(null)
    const { error: e } = await supabase.from('container_members').insert({
      profile_id: uid, dept: d, added_by: session!.user.id,
    })
    if (e) setError(e.message)
    setAddMember('')
    load()
  }

  const removeFromContainer = async (uid: string, d: DeptCode) => {
    setError(null)
    const { error: e } = await supabase
      .from('container_members').delete().eq('profile_id', uid).eq('dept', d)
    if (e) setError(e.message)
    load()
  }

  const bulkApply = async () => {
    if (!bulk || tab === 'all' || selected.size === 0) return
    setError(null)
    const targets = users.filter(
      (u) => selected.has(u.id) && !u.role_assignments.some((ra) => ra.role === bulk && ra.dept === tab)
    )
    if (targets.length === 0) return setNote('All selected members already hold that role.')
    const { error: e } = await supabase.from('role_assignments').insert(
      targets.map((u) => ({ profile_id: u.id, role: bulk, dept: tab, source_ad_group: 'manual-bulk' }))
    )
    if (e) setError(e.message)
    else setNote(`Granted ${String(bulk).replace('_', ' ')} · ${tab} to ${targets.length} member${targets.length > 1 ? 's' : ''}`)
    setSelected(new Set())
    setBulk('')
    load()
  }

  const tabUsers = tab === 'all' ? users : users.filter((u) => isMember(u.id, tab))
  const nonMembers = tab === 'all' ? [] : users.filter((u) => !isMember(u.id, tab))
  const c = tab !== 'all' ? DEPT_COLOR[tab] : null

  return (
    <>
      <h2 className="page-head">User management</h2>
      <p className="page-sub">
        Containers group users per department. Roles granted inside a container apply to that
        container only; global roles live in the All tab. Everything is audit-logged.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          className="btn"
          style={{ background: tab === 'all' ? 'var(--ink)' : undefined, color: tab === 'all' ? '#fff' : undefined, borderColor: tab === 'all' ? 'var(--ink)' : undefined }}
          onClick={() => { setTab('all'); setSelected(new Set()) }}
        >
          All users <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 10, marginLeft: 4 }}>{users.length}</span>
        </button>
        {PORTAL_DEPTS.map((d) => {
          const dc = DEPT_COLOR[d]
          const n = members.filter((m) => m.dept === d).length
          const active = tab === d
          return (
            <button
              key={d}
              className="btn"
              style={{ background: active ? dc.soft : undefined, color: active ? dc.rail : undefined, borderColor: active ? dc.rail : undefined }}
              onClick={() => { setTab(d); setSelected(new Set()) }}
            >
              {dc.label} <span className="chip mono" style={{ background: 'var(--surface)', color: dc.rail, fontSize: 10, marginLeft: 4 }}>{n}</span>
            </button>
          )
        })}
      </div>

      {tab !== 'all' && canEdit && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="row" style={{ background: c!.soft }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: c!.rail, flex: 1 }}>
              {c!.label} container — roles granted here are scoped to {tab} automatically
            </span>
            <select className="input" style={{ width: 200 }} value={addMember} onChange={(e) => setAddMember(e.target.value)}>
              <option value="">Add member…</option>
              {nonMembers.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </select>
            <button className="btn primary" disabled={!addMember} onClick={() => addToContainer(addMember, tab)}>
              Add
            </button>
          </div>
          {selected.size > 0 && (
            <div className="row" style={{ background: 'var(--surface)' }}>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{selected.size} selected</span>
              <select className="input" style={{ width: 160 }} value={bulk} onChange={(e) => setBulk(e.target.value as Role)}>
                <option value="" disabled>Apply role…</option>
                {CONTAINER_ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')} · {tab}</option>)}
              </select>
              <button className="btn primary" disabled={!bulk} onClick={bulkApply}>Apply to {selected.size}</button>
              <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        {tabUsers.map((u) => {
          const shownRoles = tab === 'all'
            ? u.role_assignments
            : u.role_assignments.filter((ra) => ra.dept === tab)
          return (
            <div className="row" key={u.id} style={{ flexWrap: 'wrap' }}>
              {canEdit && tab !== 'all' && (
                <input
                  type="checkbox"
                  checked={selected.has(u.id)}
                  onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n })}
                  style={{ width: 15, height: 15, cursor: 'pointer', accentColor: c?.rail ?? 'var(--accent)' }}
                  aria-label={`Select ${u.display_name}`}
                />
              )}
              <div
                style={{
                  width: 30, height: 30, borderRadius: '50%', background: c?.soft ?? 'var(--it-soft)',
                  color: c?.rail ?? 'var(--it)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600, flexShrink: 0,
                }}
              >
                {u.display_name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </div>
              <div style={{ width: 160 }}>
                <div className="row-title" style={{ fontSize: 12.5 }}>{u.display_name}</div>
                <div className="row-desc mono" style={{ fontSize: 10.5 }}>{u.upn}</div>
              </div>
              {tab === 'all' && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {containersOf(u.id).map((d) => (
                    <span key={d} className="chip" style={{ background: DEPT_COLOR[d].soft, color: DEPT_COLOR[d].rail, fontSize: 10 }}>
                      {d}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ flex: 1, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                {shownRoles.map((ra, i) => {
                  const chip = ROLE_CHIP[ra.role] ?? ROLE_CHIP.executive
                  return (
                    <span key={i} className="chip" style={{ background: chip.bg, color: chip.fg, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                      {ra.role.replace('_', ' ')}
                      {tab === 'all' && ra.dept ? ` · ${ra.dept}` : ''}
                      {canEdit && (
                        <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => revoke(u, ra)} title="Revoke role">✕</span>
                      )}
                    </span>
                  )
                })}
                {shownRoles.length === 0 && (
                  <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                    {tab === 'all' ? 'requester only' : 'member · no roles here'}
                  </span>
                )}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    className="input" style={{ width: 140, padding: '4px 8px', fontSize: 11.5 }}
                    value={drafts[u.id] ?? ''}
                    onChange={(e) => setDrafts((s) => ({ ...s, [u.id]: e.target.value as Role }))}
                  >
                    <option value="" disabled>+ Grant role…</option>
                    {(tab === 'all' ? GLOBAL_ROLES : CONTAINER_ROLES).map((r) => (
                      <option key={r} value={r}>{r.replace('_', ' ')}{tab !== 'all' ? ` · ${tab}` : ''}</option>
                    ))}
                  </select>
                  <button
                    className="btn primary" style={{ padding: '4px 10px', fontSize: 11.5 }}
                    disabled={!drafts[u.id]}
                    onClick={() => {
                      grant(u.id, drafts[u.id] as Role, tab === 'all' ? null : tab)
                      setDrafts((s) => ({ ...s, [u.id]: '' }))
                    }}
                  >
                    Grant
                  </button>
                  {tab !== 'all' && (
                    <button
                      className="btn" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--red)' }}
                      title="Remove from container"
                      onClick={() => removeFromContainer(u.id, tab)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
              {!u.is_active && (
                <span className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>inactive</span>
              )}
            </div>
          )
        })}
        {tabUsers.length === 0 && (
          <div className="row row-desc">
            {tab === 'all' ? 'Loading users…' : 'No members in this container yet — add them above.'}
          </div>
        )}
      </div>
      {note && <p style={{ fontSize: 11.5, color: 'var(--green)', marginTop: 8 }}>{note}</p>}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
