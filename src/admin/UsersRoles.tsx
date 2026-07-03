import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile, RoleAssignment } from '../lib/types'

interface ProfileWithRoles extends Profile {
  role_assignments: RoleAssignment[]
}

const ROLE_CHIP: Record<string, { bg: string; fg: string }> = {
  agent: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  team_lead: { bg: 'var(--admin-soft)', fg: 'var(--admin)' },
  approver: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  dept_admin: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  executive: { bg: 'var(--surface)', fg: 'var(--muted)' },
  user_admin: { bg: 'var(--green-soft)', fg: 'var(--green)' },
  system_admin: { bg: 'var(--red-soft)', fg: 'var(--red)' },
}

export function UsersRoles() {
  const [users, setUsers] = useState<ProfileWithRoles[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*, role_assignments(role, dept, source_ad_group)')
      .order('display_name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setUsers((data as ProfileWithRoles[]) ?? [])
      })
  }, [])

  return (
    <>
      <h2 className="page-head">Users and roles</h2>
      <p className="page-sub">
        Directory mastered in Entra ID. Roles follow AD security groups; every user is a
        requester by default.
      </p>
      <div className="card">
        {users.map((u) => (
          <div className="row" key={u.id}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--it-soft)',
                color: 'var(--it)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {u.display_name
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')}
            </div>
            <div style={{ flex: 1 }}>
              <div className="row-title">{u.display_name}</div>
              <div className="row-desc mono" style={{ fontSize: 11 }}>
                {u.upn}
              </div>
            </div>
            {u.role_assignments.map((ra, i) => {
              const chip = ROLE_CHIP[ra.role] ?? ROLE_CHIP.executive
              return (
                <span key={i} className="chip" style={{ background: chip.bg, color: chip.fg }}>
                  {ra.role.replace('_', ' ')}
                  {ra.dept ? ` · ${ra.dept}` : ''}
                </span>
              )
            })}
            {!u.is_active && (
              <span className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>
                inactive
              </span>
            )}
          </div>
        ))}
        {users.length === 0 && !error && <div className="row row-desc">Loading users…</div>}
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
