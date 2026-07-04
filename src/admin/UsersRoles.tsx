import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { DeptCode, Profile, Role, RoleAssignment } from '../lib/types'

interface ProfileWithRoles extends Profile {
  role_assignments: RoleAssignment[]
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

const GRANTABLE: Role[] = ['agent', 'team_lead', 'dept_head', 'user_admin', 'system_admin']
const DEPT_SCOPED: Role[] = ['agent', 'team_lead', 'dept_head']

export function UsersRoles() {
  const { hasRole, session } = useAuth()
  const canEdit = hasRole('user_admin')
  const [users, setUsers] = useState<ProfileWithRoles[]>([])
  const [drafts, setDrafts] = useState<Record<string, { role: Role; dept: DeptCode | '' }>>({})
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
  }, [])
  useEffect(load, [load])

  const grant = async (u: ProfileWithRoles) => {
    const d = drafts[u.id]
    if (!d) return
    setError(null)
    const { error: e } = await supabase.from('role_assignments').insert({
      profile_id: u.id,
      role: d.role,
      dept: DEPT_SCOPED.includes(d.role) ? d.dept || null : null,
      source_ad_group: 'manual',
    })
    if (e) setError(e.message.includes('duplicate') ? 'That user already holds this role.' : e.message)
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

  return (
    <>
      <h2 className="page-head">User management</h2>
      <p className="page-sub">
        Add users to role groups — page access is granted to roles, never to individuals.
        Everyone is implicitly a requester; manual changes are audit-logged.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {(['requester', 'agent', 'team_lead', 'dept_head', 'user_admin', 'system_admin'] as Role[]).map((r) => {
          const n = r === 'requester'
            ? users.length
            : users.filter((u) => u.role_assignments.some((ra) => ra.role === r)).length
          const chip = ROLE_CHIP[r] ?? { bg: 'var(--surface)', fg: 'var(--muted)' }
          return (
            <div key={r} className="card" style={{ padding: '10px 16px', minWidth: 108 }}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-head)', color: chip.fg }}>{n}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{r.replace('_', ' ')}{r === 'requester' ? ' (all)' : ''}</div>
            </div>
          )
        })}
      </div>
      <div className="card">
        {users.map((u) => (
          <div className="row" key={u.id} style={{ flexWrap: 'wrap' }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: '50%', background: 'var(--it-soft)',
                color: 'var(--it)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11.5, fontWeight: 600, flexShrink: 0,
              }}
            >
              {u.display_name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
            </div>
            <div style={{ width: 170 }}>
              <div className="row-title">{u.display_name}</div>
              <div className="row-desc mono" style={{ fontSize: 11 }}>{u.upn}</div>
            </div>
            <div style={{ flex: 1, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              {u.role_assignments.map((ra, i) => {
                const chip = ROLE_CHIP[ra.role] ?? ROLE_CHIP.executive
                return (
                  <span key={i} className="chip" style={{ background: chip.bg, color: chip.fg, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                    {ra.role.replace('_', ' ')}
                    {ra.dept ? ` · ${ra.dept}` : ''}
                    {canEdit && (
                      <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => revoke(u, ra)} title="Revoke role">✕</span>
                    )}
                  </span>
                )
              })}
              {u.role_assignments.length === 0 && (
                <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>requester only</span>
              )}
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  className="input" style={{ width: 130, padding: '5px 8px', fontSize: 11.5 }}
                  value={drafts[u.id]?.role ?? ''}
                  onChange={(e) =>
                    setDrafts((s) => ({ ...s, [u.id]: { role: e.target.value as Role, dept: s[u.id]?.dept ?? 'IT' } }))
                  }
                >
                  <option value="" disabled>+ Grant role…</option>
                  {GRANTABLE.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                </select>
                {drafts[u.id] && DEPT_SCOPED.includes(drafts[u.id].role) && (
                  <select
                    className="input" style={{ width: 90, padding: '5px 8px', fontSize: 11.5 }}
                    value={drafts[u.id].dept}
                    onChange={(e) => setDrafts((s) => ({ ...s, [u.id]: { ...s[u.id], dept: e.target.value as DeptCode } }))}
                  >
                    <option value="IT">IT</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                )}
                <button className="btn primary" style={{ padding: '5px 12px', fontSize: 11.5 }} disabled={!drafts[u.id]} onClick={() => grant(u)}>
                  Grant
                </button>
              </div>
            )}
            {!u.is_active && (
              <span className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>inactive</span>
            )}
          </div>
        ))}
        {users.length === 0 && !error && <div className="row row-desc">Loading users…</div>}
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
