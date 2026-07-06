import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Chip, SectionLabel, Toggle } from '../../components/ui'

/**
 * PMO Admin — module-owned administration, independent of the platform
 * admin console. Users (module role grants), custom role groups with
 * permissions + page access, and the approval committee.
 */

const PMO_ROLES = ['project_manager', 'pmo_admin'] as const
const ALL_PERMISSIONS = [
  { key: 'create_project', label: 'Create projects' },
  { key: 'view_all_projects', label: 'View all company projects' },
  { key: 'manage_budget', label: 'Manage budgets and PO requests' },
]
const ALL_PAGES = ['projects', 'charter', 'wbs', 'timeline', 'baselines', 'budget', 'team']

interface Person { id: string; display_name: string }
interface RoleRow { profile_id: string; role: string }
interface Group {
  id: string
  name: string
  description: string | null
  permissions: string[]
  pages: string[]
}
interface GroupMember { id: string; group_id: string; member: Person | null }
interface CommitteeRow { id: string; member: Person | null }

type Section = 'users' | 'groups' | 'committee'

export function PmoAdmin() {
  const [section, setSection] = useState<Section>('users')
  const [people, setPeople] = useState<Person[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [committee, setCommittee] = useState<CommitteeRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newGroup, setNewGroup] = useState('')
  const [picks, setPicks] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    supabase.from('profiles').select('id, display_name').eq('is_active', true).order('display_name')
      .then(({ data }) => setPeople(data ?? []))
    supabase.from('role_assignments').select('profile_id, role').in('role', [...PMO_ROLES])
      .then(({ data }) => setRoles((data as RoleRow[]) ?? []))
    supabase.from('pmo_role_groups').select('id, name, description, permissions, pages').order('name')
      .then(({ data }) => setGroups((data as Group[]) ?? []))
    supabase.from('pmo_group_members')
      .select('id, group_id, member:profiles!pmo_group_members_user_id_fkey(id, display_name)')
      .then(({ data }) => setMembers((data as unknown as GroupMember[]) ?? []))
    supabase.from('pmo_committee_members')
      .select('id, member:profiles!pmo_committee_members_user_id_fkey(id, display_name)')
      .then(({ data }) => setCommittee((data as unknown as CommitteeRow[]) ?? []))
  }, [])

  useEffect(load, [load])

  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setError(null)
    const { error: e } = await fn()
    if (e) setError(e.message)
    load()
  }

  const hasRoleRow = (pid: string, role: string) => roles.some((r) => r.profile_id === pid && r.role === role)
  const toggleRole = (pid: string, role: string) =>
    act(() =>
      hasRoleRow(pid, role)
        ? supabase.from('role_assignments').delete().eq('profile_id', pid).eq('role', role)
        : supabase.from('role_assignments').insert({ profile_id: pid, role })
    )

  const updateGroup = (g: Group, patch: Partial<Group>) =>
    act(() => supabase.from('pmo_role_groups').update(patch).eq('id', g.id))

  const pmoUsers = people.filter(
    (p) => roles.some((r) => r.profile_id === p.id) || committee.some((c) => c.member?.id === p.id)
  )

  return (
    <>
      <h2 className="page-head">PMO Admin</h2>
      <p className="page-sub">
        Module-owned administration — users, role groups, page access, and the approval
        committee. Independent of the platform admin console.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['users', 'groups', 'committee'] as Section[]).map((s) => (
          <Chip key={s} tone={section === s ? 'accent' : 'muted'} onClick={() => setSection(s)}>
            {s === 'users' ? 'Users' : s === 'groups' ? 'Role groups' : 'Committee'}
          </Chip>
        ))}
      </div>

      {section === 'users' && (
        <div className="card" style={{ padding: 18 }}>
          <SectionLabel>Module roles — grant or revoke per user</SectionLabel>
          <p className="row-desc" style={{ marginBottom: 8 }}>
            Project Manager can create and run projects; PMO Admin has full module control.
            Committee membership is managed on its own tab. Group-based access is under
            Role groups.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select
              className="input" style={{ flex: 1 }}
              value={picks.user ?? ''}
              onChange={(e) => setPicks((s) => ({ ...s, user: e.target.value }))}
            >
              <option value="">Add a user…</option>
              {people.filter((p) => !pmoUsers.some((u) => u.id === p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
            <button
              className="btn primary" disabled={!picks.user}
              onClick={() => { toggleRole(picks.user, 'project_manager'); setPicks((s) => ({ ...s, user: '' })) }}
            >
              Grant Project Manager
            </button>
          </div>
          {pmoUsers.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
              <span style={{ flex: 1 }}>{p.display_name}</span>
              {committee.some((c) => c.member?.id === p.id) && <Chip tone="ink">committee</Chip>}
              {PMO_ROLES.map((role) => (
                <span key={role} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="row-desc">{role === 'project_manager' ? 'PM' : 'PMO Admin'}</span>
                  <Toggle
                    on={hasRoleRow(p.id, role)}
                    onChange={() => toggleRole(p.id, role)}
                    label={`${role} for ${p.display_name}`}
                  />
                </span>
              ))}
            </div>
          ))}
          {pmoUsers.length === 0 && <div className="row-desc">No module users yet.</div>}
        </div>
      )}

      {section === 'groups' && (
        <>
          <div className="card" style={{ padding: 18, marginBottom: 14 }}>
            <SectionLabel>Create a role group</SectionLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="Group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
              <button
                className="btn primary" disabled={!newGroup.trim()}
                onClick={() => { act(() => supabase.from('pmo_role_groups').insert({ name: newGroup.trim() })); setNewGroup('') }}
              >
                Create
              </button>
            </div>
          </div>
          {groups.map((g) => {
            const gm = members.filter((m) => m.group_id === g.id)
            return (
              <div className="card" key={g.id} style={{ padding: 18, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div className="row-title">{g.name}</div>
                    {g.description && <div className="row-desc">{g.description}</div>}
                  </div>
                  <button className="btn" style={{ fontSize: 11 }} onClick={() => {
                    if (window.confirm(`Delete group "${g.name}"?`)) act(() => supabase.from('pmo_role_groups').delete().eq('id', g.id))
                  }}>delete group</button>
                </div>
                <div style={{ marginTop: 12 }}>
                  <SectionLabel>Permissions</SectionLabel>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ALL_PERMISSIONS.map((perm) => (
                      <Chip
                        key={perm.key}
                        tone={g.permissions.includes(perm.key) ? 'accent' : 'muted'}
                        onClick={() => updateGroup(g, {
                          permissions: g.permissions.includes(perm.key)
                            ? g.permissions.filter((x) => x !== perm.key)
                            : [...g.permissions, perm.key],
                        })}
                      >
                        {perm.label}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <SectionLabel>Page access</SectionLabel>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ALL_PAGES.map((pg) => (
                      <Chip
                        key={pg}
                        tone={g.pages.includes(pg) ? 'accent' : 'muted'}
                        onClick={() => updateGroup(g, {
                          pages: g.pages.includes(pg) ? g.pages.filter((x) => x !== pg) : [...g.pages, pg],
                        })}
                      >
                        {pg}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <SectionLabel>Members ({gm.length})</SectionLabel>
                  {gm.map((m) => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{m.member?.display_name ?? '—'}</span>
                      <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }}
                        onClick={() => act(() => supabase.from('pmo_group_members').delete().eq('id', m.id))}>
                        remove
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <select
                      className="input" style={{ flex: 1 }}
                      value={picks[g.id] ?? ''}
                      onChange={(e) => setPicks((s) => ({ ...s, [g.id]: e.target.value }))}
                    >
                      <option value="">Add member…</option>
                      {people.filter((p) => !gm.some((m) => m.member?.id === p.id)).map((p) => (
                        <option key={p.id} value={p.id}>{p.display_name}</option>
                      ))}
                    </select>
                    <button
                      className="btn primary" disabled={!picks[g.id]}
                      onClick={() => { act(() => supabase.from('pmo_group_members').insert({ group_id: g.id, user_id: picks[g.id] })); setPicks((s) => ({ ...s, [g.id]: '' })) }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </>
      )}

      {section === 'committee' && (
        <div className="card" style={{ padding: 18 }}>
          <SectionLabel>Project committee</SectionLabel>
          <p className="row-desc" style={{ marginBottom: 10 }}>
            Company charters are approved by the department head, then by any member of
            this committee. Membership requires no platform role.
          </p>
          {committee.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
              <span style={{ flex: 1 }}>{c.member?.display_name ?? '—'}</span>
              <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => act(() => supabase.from('pmo_committee_members').delete().eq('id', c.id))}>
                remove
              </button>
            </div>
          ))}
          {committee.length === 0 && <div className="row-desc">No committee members yet.</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <select
              className="input" style={{ flex: 1 }}
              value={picks.committee ?? ''}
              onChange={(e) => setPicks((s) => ({ ...s, committee: e.target.value }))}
            >
              <option value="">Add a committee member…</option>
              {people.filter((p) => !committee.some((c) => c.member?.id === p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
            <button className="btn primary" disabled={!picks.committee}
              onClick={() => { act(() => supabase.from('pmo_committee_members').insert({ user_id: picks.committee })); setPicks((s) => ({ ...s, committee: '' })) }}>
              Add
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-note" style={{ marginTop: 12 }}>{error}</p>}
    </>
  )
}
