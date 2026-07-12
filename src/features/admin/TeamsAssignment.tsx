import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'
import { PersonPicker } from '../../components/PersonPicker'

interface Team {
  id: string
  dept: DeptCode
  name: string
  assignment_strategy: 'none' | 'round_robin' | 'load_based'
}

interface Member {
  team_id: string
  profile_id: string
  is_lead: boolean
  profile: { display_name: string } | null
}

interface RoutingRule {
  id: string
  dept: DeptCode
  match_type: 'service' | 'keyword' | 'default'
  match_value: string | null
  team_id: string
  position: number
}

interface Person { id: string; display_name: string }

const STRATEGY_HINT: Record<Team['assignment_strategy'], string> = {
  none: 'officers claim from the queue',
  round_robin: 'new requests cycle across active members',
  load_based: 'new requests go to the member with the fewest open requests',
}

export function TeamsAssignment() {
  const { hasRole } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [rules, setRules] = useState<RoutingRule[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [load, setLoadMap] = useState<Map<string, number>>(new Map())
  const [newTeam, setNewTeam] = useState({ dept: 'IT' as DeptCode, name: '' })
  const [newRule, setNewRule] = useState({ dept: 'IT' as DeptCode, match_type: 'service' as RoutingRule['match_type'], match_value: '', team_id: '' })
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    supabase.from('teams').select('id, dept, name, assignment_strategy').order('dept').order('name')
      .then(({ data, error: e }) => { if (e) setError(e.message); else setTeams((data as Team[]) ?? []) })
    supabase.from('team_members').select('team_id, profile_id, is_lead, profile:profiles(display_name)')
      .then(({ data }) => setMembers((data as unknown as Member[]) ?? []))
    supabase.from('routing_rules').select('*').order('dept').order('position')
      .then(({ data }) => setRules((data as RoutingRule[]) ?? []))
    supabase.from('profiles').select('id, display_name').eq('is_active', true).order('display_name')
      .then(({ data }) => setPeople((data as Person[]) ?? []))
    supabase.from('requests').select('assignee_id')
      .not('status', 'in', '(resolved,closed,cancelled)').not('assignee_id', 'is', null)
      .then(({ data }) => {
        const m = new Map<string, number>()
        for (const r of (data as { assignee_id: string }[]) ?? []) {
          m.set(r.assignee_id, (m.get(r.assignee_id) ?? 0) + 1)
        }
        setLoadMap(m)
      })
  }, [])
  useEffect(reload, [reload])

  const canEdit = (d: DeptCode) => hasRole('system_admin') || hasRole('dept_admin', d) || hasRole('user_admin')
  const depts = useMemo(() => [...new Set(teams.map((t) => t.dept))], [teams])
  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])

  const run = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    setError(null)
    const { error: e } = await q
    if (e) setError(e.message)
    reload()
  }

  return (
    <>
      <h2 className="page-head">Teams &amp; assignment</h2>
      <p className="page-sub">
        Team sub-queues inside each department: routing rules resolve a team on submit, the
        team's strategy hands new requests to a member (skipping anyone out-of-office), and
        officers pull the rest from their team queue.
      </p>

      {teams.map((t) => {
        const c = DEPT_COLOR[t.dept]
        const tm = members.filter((m) => m.team_id === t.id)
        const editable = canEdit(t.dept)
        const memberIds = new Set(tm.map((m) => m.profile_id))
        return (
          <div className="card" key={t.id} style={{ marginBottom: 12 }}>
            <div className="row" style={{ background: 'var(--surface)' }}>
              <span className="chip" style={{ background: c.soft, color: c.rail }}>{t.dept}</span>
              <span className="row-title" style={{ flex: 1 }}>{t.name}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{STRATEGY_HINT[t.assignment_strategy]}</span>
              <select
                className="input" style={{ width: 140, padding: '4px 8px', fontSize: 12 }}
                value={t.assignment_strategy} disabled={!editable}
                onChange={(e) => run(supabase.from('teams').update({ assignment_strategy: e.target.value }).eq('id', t.id))}
              >
                <option value="none">none</option>
                <option value="round_robin">round robin</option>
                <option value="load_based">load based</option>
              </select>
            </div>
            {tm.map((m) => (
              <div className="row" key={m.profile_id}>
                <span style={{ flex: 1, fontSize: 13 }}>{m.profile?.display_name ?? m.profile_id}</span>
                <span className="chip mono" title="Open requests assigned"
                  style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                  {load.get(m.profile_id) ?? 0} open
                </span>
                {editable ? (
                  <button
                    className={`btn${m.is_lead ? ' primary' : ''}`}
                    style={{ padding: '2px 10px', fontSize: 11.5 }}
                    title="Team lead: can assign within this team and edit priority"
                    onClick={() => run(supabase.from('team_members').update({ is_lead: !m.is_lead })
                      .eq('team_id', t.id).eq('profile_id', m.profile_id))}
                  >
                    {m.is_lead ? 'lead' : 'member'}
                  </button>
                ) : (
                  m.is_lead && <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>lead</span>
                )}
                {editable && (
                  <button className="btn" style={{ padding: '2px 8px', color: 'var(--red)' }}
                    onClick={() => run(supabase.from('team_members').delete()
                      .eq('team_id', t.id).eq('profile_id', m.profile_id))}
                    aria-label="Remove member">
                    ×
                  </button>
                )}
              </div>
            ))}
            {tm.length === 0 && <div className="row row-desc">No members yet.</div>}
            {editable && (
              <div className="row">
                <PersonPicker
                  small width={240}
                  people={people.filter((p) => !memberIds.has(p.id))}
                  placeholder="Add a member…"
                  onPick={(p) => run(supabase.from('team_members').insert({ team_id: t.id, profile_id: p.id }))}
                />
              </div>
            )}
          </div>
        )
      })}

      {(hasRole('system_admin') || hasRole('user_admin')) && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <select className="input" style={{ width: 110 }} value={newTeam.dept}
              onChange={(e) => setNewTeam((s) => ({ ...s, dept: e.target.value as DeptCode }))}>
              {(['IT', 'ADMIN', 'LOG', 'PROC'] as DeptCode[]).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input className="input" style={{ flex: 1 }} placeholder="New team name"
              value={newTeam.name} onChange={(e) => setNewTeam((s) => ({ ...s, name: e.target.value }))} />
            <button className="btn primary" disabled={!newTeam.name.trim()}
              onClick={() => { run(supabase.from('teams').insert({ dept: newTeam.dept, name: newTeam.name.trim() })); setNewTeam((s) => ({ ...s, name: '' })) }}>
              Add team
            </button>
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', margin: '14px 0 6px' }}>
        Routing rules — resolve a team on submit · service match beats keyword beats default
      </div>
      <div className="card">
        {rules.map((r) => (
          <div className="row" key={r.id}>
            <span className="chip" style={{ background: DEPT_COLOR[r.dept].soft, color: DEPT_COLOR[r.dept].rail }}>{r.dept}</span>
            <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>{r.match_type}</span>
            <span className="mono" style={{ flex: 1, fontSize: 12.5 }}>{r.match_value ?? '—'}</span>
            <span style={{ fontSize: 13 }}>→ {teamName.get(r.team_id) ?? '?'}</span>
            <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>#{r.position}</span>
            {canEdit(r.dept) && (
              <button className="btn" style={{ padding: '2px 8px', color: 'var(--red)' }}
                onClick={() => run(supabase.from('routing_rules').delete().eq('id', r.id))}
                aria-label="Delete rule">
                ×
              </button>
            )}
          </div>
        ))}
        {rules.length === 0 && <div className="row row-desc">No routing rules — everything lands unrouted.</div>}
        <div className="row" style={{ gap: 8 }}>
          <select className="input" style={{ width: 100 }} value={newRule.dept}
            onChange={(e) => setNewRule((s) => ({ ...s, dept: e.target.value as DeptCode, team_id: '' }))}>
            {(depts.length ? depts : ['IT']).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="input" style={{ width: 110 }} value={newRule.match_type}
            onChange={(e) => setNewRule((s) => ({ ...s, match_type: e.target.value as RoutingRule['match_type'] }))}>
            <option value="service">service</option>
            <option value="keyword">keyword</option>
            <option value="default">default</option>
          </select>
          <input className="input" style={{ flex: 1 }} disabled={newRule.match_type === 'default'}
            placeholder={newRule.match_type === 'service' ? 'Service code (e.g. IN-01)' : newRule.match_type === 'keyword' ? 'Title keyword' : '—'}
            value={newRule.match_value} onChange={(e) => setNewRule((s) => ({ ...s, match_value: e.target.value }))} />
          <select className="input" style={{ width: 160 }} value={newRule.team_id}
            onChange={(e) => setNewRule((s) => ({ ...s, team_id: e.target.value }))}>
            <option value="">Team…</option>
            {teams.filter((t) => t.dept === newRule.dept).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="btn primary"
            disabled={!newRule.team_id || (newRule.match_type !== 'default' && !newRule.match_value.trim())}
            onClick={() => {
              run(supabase.from('routing_rules').insert({
                dept: newRule.dept, match_type: newRule.match_type,
                match_value: newRule.match_type === 'default' ? null : newRule.match_value.trim(),
                team_id: newRule.team_id, position: 1,
              }))
              setNewRule((s) => ({ ...s, match_value: '' }))
            }}>
            Add rule
          </button>
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
