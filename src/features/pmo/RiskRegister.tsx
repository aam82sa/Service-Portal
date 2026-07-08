import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Chip, SectionLabel } from '../../components/ui'
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
const code = (prefix: string, seq: number) => `${prefix}-${String(seq).padStart(2, '0')}`
const isOpenRisk = (r: Risk) => r.status !== 'closed'
const overdue = (d: string | null) => Boolean(d && new Date(d + 'T23:59:59') < new Date())
const TrendUp = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round" aria-label="opportunity" style={{ flexShrink: 0 }}>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
  </svg>
)

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
    <span key={label} className="chip mono" style={{
      fontSize: 10, background: v >= 4 ? 'var(--red-soft)' : v >= 2 ? 'var(--amber-soft)' : 'var(--surface)',
      color: v >= 4 ? 'var(--red)' : v >= 2 ? 'var(--amber)' : 'var(--muted)',
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
        <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 14, alignItems: 'start' }}>
          <div className="card" style={{ padding: 14 }}>
            <SectionLabel>Probability × impact</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '14px repeat(5, 1fr)', gap: 3, marginTop: 8 }}>
              {[5, 4, 3, 2, 1].map((p) => (
                [<span key={`p${p}`} className="mono" style={{ fontSize: 9, color: 'var(--muted)', alignSelf: 'center' }}>{p}</span>,
                ...[1, 2, 3, 4, 5].map((i) => {
                  const n = heat.get(`${p}:${i}`) ?? 0
                  const band = scoreBand(p * i)
                  const active = cell?.p === p && cell?.i === i
                  return (
                    <button key={`${p}${i}`} onClick={() => setCell(active ? null : { p, i })}
                      title={`P${p} × I${i} = ${p * i}`}
                      style={{
                        aspectRatio: '1', border: active ? '2px solid var(--ink)' : '1px solid var(--card)',
                        borderRadius: 5, background: band.bg, color: n > 0 ? band.fg : 'transparent',
                        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}>
                      {n || ''}
                    </button>
                  )
                })]
              ))}
              <span />
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={`i${i}`} className="mono" style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center' }}>{i}</span>
              ))}
            </div>
            <div className="row-desc" style={{ marginTop: 6, fontSize: 10.5 }}>
              probability ↑ · impact →{cell ? ' · filtered' : ''}
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

            {filtered.map((r) => {
              const band = scoreBand(r.score)
              const open = openId === r.id
              return (
                <div key={r.id} style={{ borderTop: '1px solid #EDEFF4' }}>
                  <button className="pc-row" onClick={() => setOpenId(open ? null : r.id)}>
                    <span className="tile-code" style={{ background: 'var(--surface)', color: 'var(--ink)', fontSize: 10.5 }}>{code('R', r.seq)}</span>
                    <span className="pc-row-main">
                      <span className="pc-row-name" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {r.title}{r.type === 'opportunity' && <TrendUp />}
                      </span>
                      <span className="pc-row-desc">{CATEGORIES.find((c) => c.id === r.category)?.label} · {r.status.replace('_', ' ')}</span>
                    </span>
                    <span className="chip mono" style={{ background: band.bg, color: band.fg, fontSize: 10.5, fontWeight: 700 }}>{r.score}</span>
                    <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 10 }}>{r.response_strategy ?? '—'}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', width: 120, textAlign: 'right' }}>{r.owner?.display_name ?? '—'}</span>
                    <span className="mono" style={{ fontSize: 10.5, width: 86, textAlign: 'right', color: overdue(r.next_review_date) && isOpenRisk(r) ? 'var(--red)' : 'var(--muted)' }}>
                      {r.next_review_date ? (overdue(r.next_review_date) && isOpenRisk(r) ? 'overdue' : r.next_review_date) : '—'}
                    </span>
                  </button>
                  {open && (
                    <div style={{ padding: '4px 16px 16px 16px', background: 'var(--surface)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, margin: '10px 0' }}>
                        {(['cause', 'title', 'effect'] as const).map((k) => (
                          <div key={k} style={{ background: 'var(--card)', borderRadius: 10, padding: '8px 10px' }}>
                            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--muted)' }}>
                              {k === 'title' ? 'Risk' : k}
                            </div>
                            <div style={{ fontSize: 12 }}>{k === 'title' ? r.description ?? r.title : r[k] ?? '—'}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                        {impactChip('schedule', r.impact_schedule)}
                        {impactChip('cost', r.impact_cost)}
                        {impactChip('scope', r.impact_scope)}
                        {impactChip('quality', r.impact_quality)}
                        {r.contingency_amount != null && (
                          <span className="chip mono" style={{ fontSize: 10, background: 'var(--it-soft)', color: 'var(--it)' }}>
                            contingency {r.contingency_amount.toLocaleString()} SAR
                          </span>
                        )}
                        {r.residual_probability != null && r.residual_impact != null && (
                          <span className="chip mono" style={{ fontSize: 10, background: 'var(--green-soft)', color: 'var(--green)' }}>
                            residual P{r.residual_probability}×I{r.residual_impact}
                          </span>
                        )}
                      </div>
                      {r.trigger_note && <p className="row-desc" style={{ margin: '0 0 10px' }}>Trigger: {r.trigger_note}</p>}
                      {r.actions.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <SectionLabel>Response plan</SectionLabel>
                          {r.actions.map((a) => (
                            <label key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '3px 0', cursor: canManage ? 'pointer' : 'default' }}>
                              <input type="checkbox" checked={a.is_done} disabled={!canManage}
                                onChange={() => run(supabase.from('pmo_risk_actions')
                                  .update({ is_done: !a.is_done, done_at: !a.is_done ? new Date().toISOString() : null })
                                  .eq('id', a.id))} />
                              <span style={{ textDecoration: a.is_done ? 'line-through' : 'none', color: a.is_done ? 'var(--muted)' : 'var(--ink)' }}>{a.label}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      {canManage && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select className="input" style={{ width: 170 }} value={r.status}
                            onChange={(e) => run(supabase.from('pmo_risks').update({ status: e.target.value }).eq('id', r.id))}>
                            {RISK_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                          </select>
                          <input className="input" type="date" style={{ width: 150 }} value={r.next_review_date ?? ''}
                            onChange={(e) => run(supabase.from('pmo_risks').update({ next_review_date: e.target.value || null }).eq('id', r.id))} />
                          <span style={{ flex: 1 }} />
                          {r.status !== 'occurred' && r.status !== 'closed' && (
                            <button className="btn" style={{ color: 'var(--red)', fontWeight: 600 }} onClick={() => convert(r)}>
                              Occurred → convert to issue
                            </button>
                          )}
                        </div>
                      )}
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
