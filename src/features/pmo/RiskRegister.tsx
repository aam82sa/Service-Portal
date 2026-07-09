import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Chip } from '../../components/ui'
import { PersonPicker } from '../../components/PersonPicker'

/** PMI risk & issue register: 5x5 P x I heatmap, scored register with
 *  response strategies constrained by risk type, response-plan checklists,
 *  residual assessment, and risk -> issue conversion. */

type RiskType = 'threat' | 'opportunity'
type RiskStatus = 'identified' | 'analyzing' | 'response_planned' | 'monitoring' | 'occurred' | 'closed'
type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export interface Risk {
  id: string
  seq: number
  title: string
  description: string | null
  cause: string | null
  effect: string | null
  category: 'technical' | 'external' | 'organizational' | 'project_mgmt'
  type: RiskType
  probability: number
  impact_schedule: number
  impact_cost: number
  impact_scope: number
  impact_quality: number
  impact: number
  score: number
  response_strategy: string | null
  owner_id: string | null
  trigger_note: string | null
  contingency_amount: number | null
  residual_probability: number | null
  residual_impact: number | null
  status: RiskStatus
  next_review_date: string | null
  owner: { display_name: string } | null
  actions: { id: string; label: string; is_done: boolean; position: number }[]
}
export interface Issue {
  id: string
  seq: number
  title: string
  description: string | null
  severity: 'low' | 'medium' | 'high' | 'critical'
  owner_id: string | null
  due_date: string | null
  status: IssueStatus
  resolution: string | null
  origin_risk_id: string | null
  created_at: string
  owner: { display_name: string } | null
}

const CATEGORIES = [
  { id: 'technical', label: 'Technical' },
  { id: 'external', label: 'External' },
  { id: 'organizational', label: 'Organizational' },
  { id: 'project_mgmt', label: 'Project mgmt' },
] as const
const THREAT_STRATEGIES = ['avoid', 'transfer', 'mitigate', 'accept']
const OPPORTUNITY_STRATEGIES = ['exploit', 'share', 'enhance', 'accept']
const RISK_STATUSES: RiskStatus[] = ['identified', 'analyzing', 'response_planned', 'monitoring', 'occurred', 'closed']
const SEVERITY_TONE: Record<Issue['severity'], 'muted' | 'amber' | 'red'> = {
  low: 'muted', medium: 'amber', high: 'red', critical: 'red',
}

/** score band colors: 1–4, 5–9, 10–14, 15–19, 20–25 */
export function scoreBand(score: number): { bg: string; fg: string } {
  if (score >= 20) return { bg: 'var(--red)', fg: '#fff' }
  if (score >= 15) return { bg: 'var(--red-soft)', fg: 'var(--red)' }
  if (score >= 10) return { bg: 'var(--amber)', fg: '#fff' }
  if (score >= 5) return { bg: 'var(--amber-soft)', fg: 'var(--amber)' }
  return { bg: 'var(--green-soft)', fg: 'var(--green)' }
}
/** 5x5 risk-matrix bands from the design reference (rows p=5..1, cols i=1..5) */
const HEAT_BG = ['var(--green-soft)', 'var(--amber-soft)', '#F5C9C9', 'var(--red)', '#B23A3A']
const HEAT_FG = ['var(--green)', 'var(--amber)', '#B23A3A', '#fff', '#fff']
const HEAT_LEVEL: Record<number, number[]> = {
  5: [1, 1, 2, 3, 4], 4: [0, 1, 1, 2, 3], 3: [0, 0, 1, 1, 2], 2: [0, 0, 0, 1, 1], 1: [0, 0, 0, 0, 1],
}
const heatLevel = (p: number, i: number) => HEAT_LEVEL[p]?.[i - 1] ?? 0
const code = (prefix: string, seq: number) => `${prefix}-${String(seq).padStart(2, '0')}`
const isOpenRisk = (r: Risk) => r.status !== 'closed'
const overdue = (d: string | null) => Boolean(d && new Date(d + 'T23:59:59') < new Date())
const overdueDays = (d: string | null) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d + 'T23:59:59').getTime()) / 86400000)) : 0)
const fmtReview = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const RISK_COLS = { display: 'grid', gridTemplateColumns: '48px 1fr 80px 44px 92px 80px 70px', gap: 6 } as const

export function RiskRegister({ projectId, canManage, onError }: {
  projectId: string
  canManage: boolean
  onError: (m: string) => void
}) {
  const [risks, setRisks] = useState<Risk[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [people, setPeople] = useState<{ id: string; display_name: string }[]>([])
  const [tab, setTab] = useState<'risks' | 'issues'>('risks')
  const [cell, setCell] = useState<{ p: number; i: number } | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [nf, setNf] = useState({
    title: '', type: 'threat' as RiskType, category: 'project_mgmt', probability: '3',
    impact_schedule: '0', impact_cost: '0', impact_scope: '0', impact_quality: '0',
    response_strategy: '', owner_id: '', next_review_date: '', cause: '', effect: '',
  })

  const load = useCallback(() => {
    supabase.from('pmo_risks')
      .select('*, owner:profiles!pmo_risks_owner_id_fkey(display_name), actions:pmo_risk_actions(id, label, is_done, position)')
      .eq('project_id', projectId).order('score', { ascending: false }).order('seq')
      .then(({ data, error: e }) => {
        if (e) onError(e.message)
        else setRisks(((data as unknown as Risk[]) ?? []).map((r) => ({
          ...r, actions: [...(r.actions ?? [])].sort((a, b) => a.position - b.position),
        })))
      })
    supabase.from('pmo_issues')
      .select('*, owner:profiles!pmo_issues_owner_id_fkey(display_name)')
      .eq('project_id', projectId).order('status').order('created_at')
      .then(({ data }) => setIssues((data as unknown as Issue[]) ?? []))
  }, [projectId, onError])
  useEffect(load, [load])
  useEffect(() => {
    supabase.from('profiles').select('id, display_name').eq('is_active', true).order('display_name')
      .then(({ data }) => setPeople(data ?? []))
  }, [])

  const run = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    const { error: e } = await q
    if (e) onError(e.message)
    load()
  }

  const openRisks = risks.filter(isOpenRisk)
  const heat = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of openRisks) m.set(`${r.probability}:${r.impact}`, (m.get(`${r.probability}:${r.impact}`) ?? 0) + 1)
    return m
  }, [openRisks])

  const filtered = risks.filter((r) =>
    (!cell || (r.probability === cell.p && r.impact === cell.i)) &&
    (!statusFilter || r.status === statusFilter) &&
    (!catFilter || r.category === catFilter) &&
    (!typeFilter || r.type === typeFilter))

  const overdueReviews = openRisks.filter((r) => overdue(r.next_review_date)).length
  const openIssues = issues.filter((i) => !['resolved', 'closed'].includes(i.status))
  const highOpen = openRisks.filter((r) => r.score >= 10).length

  const addRisk = () =>
    run(supabase.from('pmo_risks').insert({
      project_id: projectId, title: nf.title.trim(), type: nf.type, category: nf.category,
      probability: Number(nf.probability),
      impact_schedule: Number(nf.impact_schedule), impact_cost: Number(nf.impact_cost),
      impact_scope: Number(nf.impact_scope), impact_quality: Number(nf.impact_quality),
      response_strategy: nf.response_strategy || null, owner_id: nf.owner_id || null,
      next_review_date: nf.next_review_date || null,
      cause: nf.cause.trim() || null, effect: nf.effect.trim() || null,
    })).then(() => { setAdding(false); setNf({ ...nf, title: '', cause: '', effect: '' }) })

  const convert = async (r: Risk) => {
    if (!window.confirm(`Mark ${code('R', r.seq)} as occurred and open a linked issue?`)) return
    const { data, error: e } = await supabase.rpc('pmo_convert_risk_to_issue', { p_risk: r.id })
    if (e) { onError(e.message); return }
    load()
    setTab('issues')
    setOpenId(typeof data === 'string' ? data : null)
  }

  const resolveIssue = (i: Issue, to: IssueStatus) => {
    if (to === 'resolved' || to === 'closed') {
      const resolution = window.prompt('Resolution (required):', i.resolution ?? '')
      if (!resolution?.trim()) return
      run(supabase.from('pmo_issues').update({ status: to, resolution: resolution.trim() }).eq('id', i.id))
    } else {
      run(supabase.from('pmo_issues').update({ status: to }).eq('id', i.id))
    }
  }

  const strategies = nf.type === 'threat' ? THREAT_STRATEGIES : OPPORTUNITY_STRATEGIES
  const fieldNum = (label: string, key: keyof typeof nf, min = 0) => (
    <div style={{ width: 78 }}>
      <label className="field-label" style={{ fontSize: 10.5 }}>{label}</label>
      <input className="input" type="number" min={min} max={5} value={nf[key]}
        onChange={(e) => setNf({ ...nf, [key]: e.target.value })} />
    </div>
  )
  const impactChip = (label: string, v: number) => (
    <span key={label} className="chip" style={{
      fontSize: 10.5,
      background: v >= 4 ? 'var(--red-soft)' : v >= 2 ? 'var(--amber-soft)' : 'var(--surface)',
      color: v >= 4 ? 'var(--red)' : v >= 2 ? 'var(--amber)' : 'var(--muted)',
      border: v < 2 ? '1px solid var(--line)' : 'none',
    }}>{label} {v}</span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip tone={highOpen > 0 ? 'red' : 'green'}>{highOpen} high/critical open risk{highOpen === 1 ? '' : 's'}</Chip>
        <Chip tone={overdueReviews > 0 ? 'amber' : 'muted'}>{overdueReviews} overdue review{overdueReviews === 1 ? '' : 's'}</Chip>
        <Chip tone={openIssues.length > 0 ? 'amber' : 'muted'}>{openIssues.length} open issue{openIssues.length === 1 ? '' : 's'}</Chip>
        <span style={{ flex: 1 }} />
        <Chip tone={tab === 'risks' ? 'accent' : 'muted'} onClick={() => setTab('risks')}>Risks · {risks.length}</Chip>
        <Chip tone={tab === 'issues' ? 'accent' : 'muted'} onClick={() => setTab('issues')}>Issues · {issues.length}</Chip>
      </div>

      {tab === 'risks' && (
        <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 12, alignItems: 'start' }}>
          <div className="card" style={{ padding: '13px 15px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-head)', color: 'var(--ink)', marginBottom: 9 }}>
              Probability × impact
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3 }}>
              {[5, 4, 3, 2, 1].map((p) =>
                [1, 2, 3, 4, 5].map((i) => {
                  const n = heat.get(`${p}:${i}`) ?? 0
                  const lvl = heatLevel(p, i)
                  const active = cell?.p === p && cell?.i === i
                  return (
                    <button key={`${p}${i}`} onClick={() => setCell(active ? null : { p, i })}
                      title={`P${p} × I${i} = ${p * i}${n ? ` · ${n} open` : ''}`}
                      style={{
                        height: 30, border: 'none', borderRadius: 5, background: HEAT_BG[lvl],
                        outline: active ? '2px solid var(--ink)' : 'none', outlineOffset: -2,
                        color: n > 0 ? HEAT_FG[lvl] : 'transparent',
                        fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}>
                      {n || ''}
                    </button>
                  )
                })
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--muted)', marginTop: 5 }}>
              <span>impact →</span><span>↑ probability</span>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #EDEFF4', flexWrap: 'wrap' }}>
              <select className="input" style={{ width: 150 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {RISK_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
              <select className="input" style={{ width: 150 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <select className="input" style={{ width: 140 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">Threats + opportunities</option>
                <option value="threat">Threats</option>
                <option value="opportunity">Opportunities</option>
              </select>
              <span style={{ flex: 1 }} />
              {canManage && <button className="btn primary" onClick={() => setAdding(!adding)}>{adding ? 'Close' : '+ Risk'}</button>}
            </div>

            {adding && canManage && (
              <div style={{ padding: '12px 14px', borderBottom: '1px solid #EDEFF4', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input className="input" placeholder="Risk title" value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select className="input" style={{ width: 130 }} value={nf.type}
                    onChange={(e) => setNf({ ...nf, type: e.target.value as RiskType, response_strategy: '' })}>
                    <option value="threat">Threat</option>
                    <option value="opportunity">Opportunity</option>
                  </select>
                  <select className="input" style={{ width: 150 }} value={nf.category} onChange={(e) => setNf({ ...nf, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <select className="input" style={{ width: 140 }} value={nf.response_strategy} onChange={(e) => setNf({ ...nf, response_strategy: e.target.value })}>
                    <option value="">Strategy…</option>
                    {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <PersonPicker people={people} value={nf.owner_id || null} width={180} placeholder="Owner…"
                    onPick={(p) => setNf({ ...nf, owner_id: p.id })} />
                  <input className="input" type="date" style={{ width: 150 }} value={nf.next_review_date}
                    onChange={(e) => setNf({ ...nf, next_review_date: e.target.value })} />
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  {fieldNum('Prob 1–5', 'probability', 1)}
                  {fieldNum('Schedule', 'impact_schedule')}
                  {fieldNum('Cost', 'impact_cost')}
                  {fieldNum('Scope', 'impact_scope')}
                  {fieldNum('Quality', 'impact_quality')}
                  <span style={{ flex: 1 }} />
                  <button className="btn primary" disabled={!nf.title.trim()} onClick={addRisk}>Add risk</button>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" placeholder="Cause" value={nf.cause} onChange={(e) => setNf({ ...nf, cause: e.target.value })} />
                  <input className="input" placeholder="Effect" value={nf.effect} onChange={(e) => setNf({ ...nf, effect: e.target.value })} />
                </div>
              </div>
            )}

            <div style={{ ...RISK_COLS, padding: '8px 14px', fontSize: 10, color: 'var(--muted)', borderBottom: '1px solid var(--line)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>
              <span>ID</span><span>Risk</span><span>Category</span><span>P×I</span><span>Response</span><span>Owner</span><span>Review</span>
            </div>
            {filtered.map((r) => {
              const band = scoreBand(r.score)
              const open = openId === r.id
              const isOverdue = overdue(r.next_review_date) && isOpenRisk(r)
              const opp = r.type === 'opportunity'
              return (
                <div key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <div onClick={() => setOpenId(open ? null : r.id)}
                    style={{ ...RISK_COLS, padding: '9px 14px', fontSize: 12, alignItems: 'center', cursor: 'pointer', background: open ? 'var(--it-soft)' : undefined }}>
                    <span className="mono" style={{ fontSize: 11 }}>{code('R', r.seq)}</span>
                    <span style={{ fontWeight: opp || r.score >= 15 ? 600 : 400, color: opp ? 'var(--green)' : r.score >= 15 ? 'var(--ink)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.title}{opp ? ' ↗' : ''}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>{CATEGORIES.find((c) => c.id === r.category)?.label ?? '—'}</span>
                    <span className="mono" style={{ fontSize: 10.5, background: band.bg, color: band.fg, borderRadius: 6, padding: '2px 6px', textAlign: 'center', fontWeight: 500 }}>{r.score}</span>
                    <span style={{ textTransform: 'capitalize' }}>{r.response_strategy ?? '—'}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.owner?.display_name ?? '—'}</span>
                    <span style={{ color: isOverdue ? 'var(--red)' : 'var(--muted)', fontWeight: isOverdue ? 600 : 400 }} className={isOverdue ? '' : 'mono'}>
                      {isOverdue ? 'overdue' : r.next_review_date ? fmtReview(r.next_review_date) : '—'}
                    </span>
                  </div>
                  {open && (
                    <div style={{ padding: '14px 16px 16px', background: 'var(--surface)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13, flexWrap: 'wrap' }}>
                        <span className="mono" style={{ fontSize: 11, background: 'var(--red-soft)', color: 'var(--red)', borderRadius: 6, padding: '3px 8px', fontWeight: 500 }}>{code('R', r.seq)}</span>
                        <span style={{ fontFamily: 'var(--font-head)', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{r.title}</span>
                        <span className="chip" style={{ background: opp ? 'var(--green-soft)' : 'var(--red-soft)', color: opp ? 'var(--green)' : 'var(--red)' }}>
                          {opp ? 'Opportunity' : 'Threat'} · score {r.score}
                        </span>
                        <span style={{ flex: 1 }} />
                        {canManage && r.status !== 'occurred' && r.status !== 'closed' && (
                          <button onClick={() => convert(r)}
                            style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 500, background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>
                            Occurred → convert to issue
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                        <div>
                          <div className="klabel" style={{ marginBottom: 3 }}>Cause → risk → effect</div>
                          <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6 }}>
                            {[r.cause, r.description ?? r.title, r.effect].filter(Boolean).join(' → ') || '—'}
                          </div>
                          {r.trigger_note && (
                            <>
                              <div className="klabel" style={{ margin: '11px 0 3px' }}>Trigger / early warning</div>
                              <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{r.trigger_note}</div>
                            </>
                          )}
                          <div className="klabel" style={{ margin: '11px 0 4px' }}>Impacted objectives</div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {impactChip('Schedule', r.impact_schedule)}
                            {impactChip('Cost', r.impact_cost)}
                            {impactChip('Scope', r.impact_scope)}
                            {impactChip('Quality', r.impact_quality)}
                          </div>
                        </div>
                        <div>
                          <div className="klabel" style={{ marginBottom: 5 }}>
                            Response plan{r.response_strategy ? ` — ${r.response_strategy[0].toUpperCase() + r.response_strategy.slice(1)}` : ''}{r.owner?.display_name ? ` · owner ${r.owner.display_name}` : ''}
                          </div>
                          {r.actions.length === 0 && <div className="row-desc" style={{ fontSize: 12 }}>No response actions yet.</div>}
                          {r.actions.map((a) => (
                            <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0', color: a.is_done ? 'var(--muted)' : 'var(--ink)', cursor: canManage ? 'pointer' : 'default' }}>
                              <span onClick={canManage ? () => run(supabase.from('pmo_risk_actions')
                                .update({ is_done: !a.is_done, done_at: !a.is_done ? new Date().toISOString() : null }).eq('id', a.id)) : undefined}
                                style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff',
                                  background: a.is_done ? 'var(--green)' : 'transparent', border: a.is_done ? 'none' : '1.5px solid var(--line)' }}>
                                {a.is_done ? '✓' : ''}
                              </span>
                              <span style={{ textDecoration: a.is_done ? 'line-through' : 'none' }}>{a.label}</span>
                            </label>
                          ))}
                          <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
                            <div>
                              <div className="klabel">Residual P×I</div>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--amber)' }}>
                                {r.residual_probability != null && r.residual_impact != null ? `${r.residual_probability * r.residual_impact} (after response)` : '—'}
                              </div>
                            </div>
                            <div>
                              <div className="klabel">Contingency</div>
                              <div className="kval mono">{r.contingency_amount != null ? `SAR ${r.contingency_amount.toLocaleString()}` : '—'}</div>
                            </div>
                            <div>
                              <div className="klabel">Next review</div>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: isOverdue ? 'var(--red)' : 'var(--ink)' }}>
                                {isOverdue ? `overdue ${overdueDays(r.next_review_date)}d` : r.next_review_date ? fmtReview(r.next_review_date) : '—'}
                              </div>
                            </div>
                          </div>
                          {canManage && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                              <select className="input" style={{ width: 160 }} value={r.status}
                                onChange={(e) => run(supabase.from('pmo_risks').update({ status: e.target.value }).eq('id', r.id))}>
                                {RISK_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                              </select>
                              <input className="input" type="date" style={{ width: 150 }} value={r.next_review_date ?? ''}
                                onChange={(e) => run(supabase.from('pmo_risks').update({ next_review_date: e.target.value || null }).eq('id', r.id))} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {filtered.length === 0 && <div className="row-desc" style={{ padding: '14px 16px' }}>No risks match.</div>}
          </div>
        </div>
      )}

      {tab === 'issues' && (
        <div className="card">
          {issues.map((i) => {
            const origin = i.origin_risk_id ? risks.find((r) => r.id === i.origin_risk_id) : null
            const aging = Math.max(0, Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86400000))
            const open = openId === i.id
            return (
              <div key={i.id} style={{ borderTop: '1px solid #EDEFF4' }}>
                <button className="pc-row" onClick={() => setOpenId(open ? null : i.id)}>
                  <span className="tile-code" style={{ background: 'var(--surface)', color: 'var(--ink)', fontSize: 10.5 }}>{code('I', i.seq)}</span>
                  <span className="pc-row-main">
                    <span className="pc-row-name">{i.title}</span>
                    <span className="pc-row-desc">{i.owner?.display_name ?? 'unowned'} · {aging}d open{i.due_date ? ` · due ${i.due_date}` : ''}</span>
                  </span>
                  {origin && (
                    <span className="chip mono" style={{ background: 'var(--it-soft)', color: 'var(--it)', fontSize: 10, cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); setTab('risks'); setOpenId(origin.id) }}>
                      {code('R', origin.seq)}
                    </span>
                  )}
                  <Chip tone={SEVERITY_TONE[i.severity]}>{i.severity}</Chip>
                  <Chip tone={i.status === 'open' ? 'red' : i.status === 'in_progress' ? 'amber' : 'green'}>{i.status.replace('_', ' ')}</Chip>
                </button>
                {open && (
                  <div style={{ padding: '4px 16px 14px', background: 'var(--surface)', fontSize: 12.5 }}>
                    <p style={{ margin: '8px 0' }}>{i.description ?? '—'}</p>
                    {i.resolution && <p className="row-desc" style={{ margin: '0 0 8px' }}>Resolution: {i.resolution}</p>}
                    {canManage && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        {(['open', 'in_progress', 'resolved', 'closed'] as IssueStatus[])
                          .filter((s) => s !== i.status)
                          .map((s) => (
                            <button key={s} className="btn" style={{ fontSize: 11.5 }} onClick={() => resolveIssue(i, s)}>
                              {s.replace('_', ' ')}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {issues.length === 0 && <div className="row-desc" style={{ padding: '14px 16px' }}>No issues logged.</div>}
        </div>
      )}
    </div>
  )
}
