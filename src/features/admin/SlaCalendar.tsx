import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'

interface SlaProfile {
  id: string
  name: string
  description: string | null
  response_minutes: number
  resolution_minutes: number
}

interface Svc {
  id: string
  dept: DeptCode
  code: string
  name: string
  sla_profile_id: string | null
}

interface DayRow {
  dow: number
  opens: string
  closes: string
  is_workday: boolean
}

interface Holiday {
  day: string
  name: string
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PROFILE_COLOR = ['var(--green)', 'var(--it)', 'var(--accent)', 'var(--admin)', 'var(--amber)']

const fmt = (mins: number) => (mins % 60 === 0 ? `${mins / 60}h` : `${mins}m`)

export function SlaCalendar() {
  const [profiles, setProfiles] = useState<SlaProfile[]>([])
  const [services, setServices] = useState<Svc[]>([])
  const [days, setDays] = useState<DayRow[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [form, setForm] = useState({ name: '', respH: '2', resoH: '24', description: '' })
  const [newDay, setNewDay] = useState('')
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    supabase.from('sla_profiles').select('*').order('response_minutes')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setProfiles((data as SlaProfile[]) ?? [])
      })
    supabase.from('services').select('id, dept, code, name, sla_profile_id').eq('is_active', true).order('name')
      .then(({ data }) => setServices((data as Svc[]) ?? []))
    supabase.from('business_hours').select('*').order('dow')
      .then(({ data }) => setDays((data as DayRow[]) ?? []))
    supabase.from('holidays').select('*').order('day')
      .then(({ data }) => setHolidays((data as Holiday[]) ?? []))
  }, [])
  useEffect(load, [load])

  const addProfile = async () => {
    setError(null)
    const { error: e } = await supabase.from('sla_profiles').insert({
      name: form.name.trim(),
      description: form.description.trim() || null,
      response_minutes: Math.round(Number(form.respH) * 60) || 60,
      resolution_minutes: Math.round(Number(form.resoH) * 60) || 480,
    })
    if (e) setError(e.message)
    else setForm({ name: '', respH: '2', resoH: '24', description: '' })
    load()
  }

  const assign = async (svcId: string, profileId: string) => {
    setError(null)
    const { error: e } = await supabase
      .from('services')
      .update({ sla_profile_id: profileId || null })
      .eq('id', svcId)
    if (e) setError(e.message)
    else setNote('Assignment saved — applies to new requests immediately.')
    load()
  }

  const patchDay = async (d: DayRow, p: Partial<DayRow>) => {
    setError(null)
    const { error: e } = await supabase.from('business_hours').update(p).eq('dow', d.dow)
    if (e) setError(e.message)
    load()
  }

  const addHoliday = async () => {
    if (!newDay || !newName.trim()) return
    const { error: e } = await supabase.from('holidays').insert({ day: newDay, name: newName.trim() })
    if (e) setError(e.message)
    else { setNewDay(''); setNewName('') }
    load()
  }

  return (
    <>
      <h2 className="page-head">SLA management</h2>
      <p className="page-sub">
        Named SLA profiles with the processes they govern. A service linked to a profile uses
        its targets; unlinked services keep their own per-service hours.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 14 }}>
        {profiles.map((p, i) => {
          const color = PROFILE_COLOR[i % PROFILE_COLOR.length]
          const linked = services.filter((s) => s.sla_profile_id === p.id)
          return (
            <div className="card" key={p.id} style={{ padding: 16, position: 'relative', overflow: 'hidden' }}>
              <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: color }} />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div className="row-title" style={{ fontSize: 15, color }}>{p.name}</div>
                <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)', marginLeft: 'auto' }}>
                  {linked.length} process{linked.length === 1 ? '' : 'es'}
                </span>
              </div>
              <div className="row-desc" style={{ margin: '2px 0 12px' }}>{p.description ?? '—'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-head)', color }}>{fmt(p.response_minutes)}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>Response target</div>
                </div>
                <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-head)', color }}>{fmt(p.resolution_minutes)}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>Resolution target</div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
                Linked processes
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {linked.map((s) => (
                  <span key={s.id} className="chip mono" style={{ background: DEPT_COLOR[s.dept].soft, color: DEPT_COLOR[s.dept].rail, fontSize: 10 }}>
                    {s.code} {s.name.length > 18 ? s.name.slice(0, 17) + '…' : s.name}
                  </span>
                ))}
                {linked.length === 0 && <span className="row-desc">None yet — link below.</span>}
              </div>
            </div>
          )
        })}
        <div className="card" style={{ padding: 16, border: '1.5px dashed var(--line)' }}>
          <div className="row-title" style={{ marginBottom: 10 }}>New SLA profile</div>
          <input className="input" style={{ marginBottom: 8 }} placeholder="Name (e.g. After-hours)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" style={{ marginBottom: 8 }} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: 12, color: 'var(--muted)' }}>
            response
            <input className="input" type="number" style={{ width: 64 }} value={form.respH} onChange={(e) => setForm({ ...form, respH: e.target.value })} />
            h · resolution
            <input className="input" type="number" style={{ width: 64 }} value={form.resoH} onChange={(e) => setForm({ ...form, resoH: e.target.value })} />
            h
          </div>
          <button className="btn primary" onClick={addProfile} disabled={!form.name.trim()}>Create profile</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ background: 'var(--surface)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
          LINK PROCESSES TO SLA PROFILES
          <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--green)' }}>{note}</span>
        </div>
        {services.map((s) => (
          <div className="row" key={s.id}>
            <span className="tile-code" style={{ background: DEPT_COLOR[s.dept].soft, color: DEPT_COLOR[s.dept].rail, fontSize: 10 }}>{s.code}</span>
            <span className="row-title" style={{ flex: 1, fontSize: 12.5 }}>{s.name}</span>
            <select
              className="input" style={{ width: 220, padding: '5px 8px', fontSize: 12 }}
              value={s.sla_profile_id ?? ''}
              onChange={(e) => assign(s.id, e.target.value)}
            >
              <option value="">Per-service hours (no profile)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {fmt(p.response_minutes)} / {fmt(p.resolution_minutes)}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="card" style={{ flex: 1, minWidth: 320 }}>
          <div className="row" style={{ background: 'var(--surface)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
            BUSINESS HOURS (SLA CLOCK) — SUN–THU
          </div>
          {days.map((d) => (
            <div className="row" key={d.dow} style={{ opacity: d.is_workday ? 1 : 0.55 }}>
              <span style={{ width: 90, fontSize: 13 }}>{DAY_NAMES[d.dow]}</span>
              <button
                className={`toggle${d.is_workday ? ' on' : ''}`}
                onClick={() => patchDay(d, { is_workday: !d.is_workday })}
                aria-label={`${DAY_NAMES[d.dow]} workday`}
              />
              <input className="input" type="time" style={{ width: 105 }} value={d.opens.slice(0, 5)} disabled={!d.is_workday}
                onChange={(e) => patchDay(d, { opens: e.target.value })} />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
              <input className="input" type="time" style={{ width: 105 }} value={d.closes.slice(0, 5)} disabled={!d.is_workday}
                onChange={(e) => patchDay(d, { closes: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="card" style={{ flex: 1, minWidth: 300 }}>
          <div className="row" style={{ background: 'var(--surface)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
            HOLIDAYS (SLA CLOCK PAUSED)
          </div>
          {holidays.map((h) => (
            <div className="row" key={h.day}>
              <span className="mono" style={{ fontSize: 12, width: 100 }}>{h.day}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{h.name}</span>
              <button
                className="btn" style={{ padding: '2px 8px', color: 'var(--red)' }}
                onClick={async () => { await supabase.from('holidays').delete().eq('day', h.day); load() }}
                aria-label={`Remove ${h.name}`}
              >
                ×
              </button>
            </div>
          ))}
          {holidays.length === 0 && <div className="row row-desc">No holidays configured.</div>}
          <div className="row">
            <input className="input" type="date" style={{ width: 150 }} value={newDay} onChange={(e) => setNewDay(e.target.value)} />
            <input className="input" style={{ flex: 1 }} placeholder="Eid al-Fitr" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn" onClick={addHoliday} disabled={!newDay || !newName.trim()}>Add</button>
          </div>
        </div>
      </div>
      <PriorityMatrixEditor onError={setError} />
      <EscalationRulesAdmin services={services} onError={setError} />
      {error && <p className="error-note">{error}</p>}
    </>
  )
}

interface EscalationRule {
  id: string
  trigger_on: 'sla_warning' | 'sla_breached'
  dept: DeptCode | null
  service_id: string | null
  actions: { notify_roles?: string[]; bump_priority?: boolean; escalate_status?: boolean }
  is_enabled: boolean
}

const NOTIFY_ROLES = ['team_lead', 'dept_head', 'dept_admin', 'system_admin', 'executive']

/**
 * CRUD over escalation_rules (consumed by the sla_check sweep). "Escalate"
 * sets the escalated_at marker — it never mutates status (00047 rule).
 * Every change is audit-logged by the database.
 */
function EscalationRulesAdmin({ services, onError }: { services: Svc[]; onError: (m: string) => void }) {
  const [rules, setRules] = useState<EscalationRule[]>([])
  const [draft, setDraft] = useState<{ trigger_on: EscalationRule['trigger_on']; dept: string; service_id: string }>(
    { trigger_on: 'sla_breached', dept: '', service_id: '' })

  const load = useCallback(() => {
    supabase.from('escalation_rules').select('*').order('created_at')
      .then(({ data, error }) => {
        if (error) onError(error.message)
        else setRules((data as EscalationRule[]) ?? [])
      })
  }, [onError])
  useEffect(load, [load])

  const run = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await q
    if (error) onError(error.message)
    load()
  }

  const patchActions = (r: EscalationRule, p: Partial<EscalationRule['actions']>) =>
    run(supabase.from('escalation_rules').update({ actions: { ...r.actions, ...p } }).eq('id', r.id))

  const svcCode = (id: string | null) => services.find((s) => s.id === id)?.code

  return (
    <>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', margin: '14px 0 6px' }}>
        Escalation rules — what the SLA sweep does on warning / breach · most specific rule wins
      </div>
      <div className="card">
        {rules.map((r) => (
          <div className="row" key={r.id} style={{ gap: 8, flexWrap: 'wrap', opacity: r.is_enabled ? 1 : 0.55 }}>
            <span className="chip mono" style={{
              background: r.trigger_on === 'sla_breached' ? 'var(--red-soft)' : 'var(--amber-soft)',
              color: r.trigger_on === 'sla_breached' ? 'var(--red)' : 'var(--amber)',
            }}>
              {r.trigger_on === 'sla_breached' ? 'breach' : 'warning'}
            </span>
            <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
              {r.dept ?? 'all depts'}{r.service_id ? ` · ${svcCode(r.service_id) ?? 'service'}` : ''}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>notify</span>
            {NOTIFY_ROLES.map((role) => {
              const on = (r.actions.notify_roles ?? []).includes(role)
              return (
                <span key={role} className="chip" style={{
                  cursor: 'pointer',
                  background: on ? 'var(--accent-soft)' : 'var(--surface)',
                  color: on ? 'var(--accent)' : 'var(--muted)',
                }}
                  onClick={() => patchActions(r, {
                    notify_roles: on
                      ? (r.actions.notify_roles ?? []).filter((x) => x !== role)
                      : [...(r.actions.notify_roles ?? []), role],
                  })}
                >
                  {role.replace('_', ' ')}
                </span>
              )
            })}
            <span style={{ flex: 1 }} />
            <button className={`btn${r.actions.bump_priority ? ' primary' : ''}`}
              style={{ padding: '2px 10px', fontSize: 11.5 }}
              title="One-level priority bump on breach"
              onClick={() => patchActions(r, { bump_priority: !r.actions.bump_priority })}>
              bump priority
            </button>
            <button className={`btn${r.actions.escalate_status ? ' primary' : ''}`}
              style={{ padding: '2px 10px', fontSize: 11.5 }}
              title="Sets the escalated marker (never changes status)"
              onClick={() => patchActions(r, { escalate_status: !r.actions.escalate_status })}>
              escalate
            </button>
            <button
              className={`toggle${r.is_enabled ? ' on' : ''}`}
              onClick={() => run(supabase.from('escalation_rules').update({ is_enabled: !r.is_enabled }).eq('id', r.id))}
              aria-label={`rule enabled: ${r.is_enabled}`}
            />
            <button className="btn" style={{ padding: '2px 8px', color: 'var(--red)' }}
              onClick={() => run(supabase.from('escalation_rules').delete().eq('id', r.id))}
              aria-label="Delete rule">
              ×
            </button>
          </div>
        ))}
        {rules.length === 0 && <div className="row row-desc">No escalation rules — breaches are stamped but nothing else happens.</div>}
        <div className="row" style={{ gap: 8 }}>
          <select className="input" style={{ width: 130 }} value={draft.trigger_on}
            onChange={(e) => setDraft((s) => ({ ...s, trigger_on: e.target.value as EscalationRule['trigger_on'] }))}>
            <option value="sla_breached">on breach</option>
            <option value="sla_warning">on warning</option>
          </select>
          <select className="input" style={{ width: 120 }} value={draft.dept}
            onChange={(e) => setDraft((s) => ({ ...s, dept: e.target.value, service_id: '' }))}>
            <option value="">all depts</option>
            {(['IT', 'ADMIN', 'LOG', 'PROC'] as const).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="input" style={{ width: 200 }} value={draft.service_id}
            onChange={(e) => setDraft((s) => ({ ...s, service_id: e.target.value }))}>
            <option value="">all services</option>
            {services.filter((s) => !draft.dept || s.dept === draft.dept).map((s) => (
              <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
            ))}
          </select>
          <button className="btn primary"
            onClick={() => run(supabase.from('escalation_rules').insert({
              trigger_on: draft.trigger_on,
              dept: draft.dept || null,
              service_id: draft.service_id || null,
              actions: { notify_roles: ['team_lead'], bump_priority: false, escalate_status: true },
              is_enabled: true,
            }))}>
            Add rule
          </button>
        </div>
      </div>
    </>
  )
}

interface MatrixCell { impact: number; urgency: number; priority: 'P1' | 'P2' | 'P3' | 'P4' }

const PRIORITY_COLOR: Record<MatrixCell['priority'], string> = {
  P1: 'var(--red)', P2: 'var(--amber)', P3: 'var(--it)', P4: 'var(--muted)',
}
const LEVEL_LABEL = ['', 'Low (1)', 'Medium (2)', 'High (3)']

/**
 * The impact × urgency → priority matrix applied automatically to incident
 * submissions (server-side, migration 00051). Edits are audit-logged.
 */
function PriorityMatrixEditor({ onError }: { onError: (m: string) => void }) {
  const [cells, setCells] = useState<MatrixCell[]>([])
  const [saved, setSaved] = useState(false)

  const load = useCallback(() => {
    supabase.from('priority_matrix').select('impact, urgency, priority')
      .then(({ data, error }) => {
        if (error) onError(error.message)
        else setCells((data as MatrixCell[]) ?? [])
      })
  }, [onError])
  useEffect(load, [load])

  const cell = (i: number, u: number) => cells.find((c) => c.impact === i && c.urgency === u)

  const patch = async (i: number, u: number, p: MatrixCell['priority']) => {
    const { error } = await supabase.from('priority_matrix')
      .update({ priority: p }).eq('impact', i).eq('urgency', u)
    if (error) onError(error.message)
    else setSaved(true)
    load()
  }

  if (cells.length === 0) return null

  return (
    <>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', margin: '14px 0 6px' }}>
        Priority matrix — impact × urgency → P1–P4 (applied to incident submissions)
      </div>
      <div className="card" style={{ padding: 16, maxWidth: 560 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '110px repeat(3, 1fr)', gap: 6, alignItems: 'center' }}>
          <span />
          {[1, 2, 3].map((u) => (
            <span key={u} style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: 'center' }}>
              Urgency {LEVEL_LABEL[u]}
            </span>
          ))}
          {[3, 2, 1].map((i) => (
            <div key={i} style={{ display: 'contents' }}>
              <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Impact {LEVEL_LABEL[i]}</span>
              {[1, 2, 3].map((u) => {
                const c = cell(i, u)
                return (
                  <select
                    key={u}
                    className="input mono"
                    aria-label={`impact ${i} urgency ${u}`}
                    style={{ textAlign: 'center', fontWeight: 700, color: c ? PRIORITY_COLOR[c.priority] : undefined }}
                    value={c?.priority ?? 'P3'}
                    onChange={(e) => patch(i, u, e.target.value as MatrixCell['priority'])}
                  >
                    {(['P1', 'P2', 'P3', 'P4'] as const).map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )
              })}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
          {saved ? 'Saved — new incident submissions use the updated mapping. Changes are audit-logged.'
            : 'Incidents whose form captures impact + urgency are prioritized from this matrix; other requests keep their service default.'}
        </div>
      </div>
    </>
  )
}
