import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'
import { SlaRing } from '../../components/SlaRing'
import { FileUpload } from '../../components/FileUpload'
import { Chain, type ApprovalStep } from './Approvals'
import { LifecycleBar } from '../../components/LifecycleBar'
import { useLifecycle } from './useLifecycle'
import type { FormField } from '../catalog/RequestForm'
import { PriorityChip, StatusChip } from '../../components/ui'

interface Detail {
  id: string
  ref: string
  title: string
  dept: DeptCode
  status: string
  priority: string
  amount: number | null
  payload: Record<string, string>
  created_at: string
  sla_response_due: string | null
  sla_resolution_due: string | null
  sla_paused_at: string | null
  requester_id: string
  resolved_at: string | null
  rating: number | null
  rating_comment: string | null
  service: { code: string; name: string; form_schema: FormField[] } | null
  /** the form version this request was submitted on (00080) — wins over the live schema */
  form_version: { schema: FormField[] } | null
  requester: { display_name: string } | null
  assignee: { display_name: string } | null
  approvals: ApprovalStep[]
  project_id: string | null
  parent_request_id: string | null
}

interface ChildRow {
  id: string
  ref: string
  title: string
  status: string
  service: { code: string } | null
}

interface ConversionState {
  id: string
  status: 'pending_dept_head' | 'approved' | 'rejected'
}

interface Ev {
  id: number
  event_type: string
  detail: Record<string, unknown>
  created_at: string
  actor: { display_name: string } | null
}

function eventText(e: Ev): string {
  const d = e.detail as Record<string, string>
  switch (e.event_type) {
    case 'created': return `submitted the request (${d.ref})`
    case 'assigned': return 'assignment changed'
    case 'status_changed': return `moved ${String(d.from).replace('_', ' ')} → ${String(d.to).replace('_', ' ')}`
    case 'approval_requested': return `sent for approval (${d.steps} step${Number(d.steps) > 1 ? 's' : ''})`
    case 'approval_decided': return `step ${d.step} ${d.decision}${d.comment ? ` — "${d.comment}"` : ''}`
    case 'comment': return `commented: "${d.body}"`
    case 'children_spawned': return `spawned ${d.count} child request${Number(d.count) === 1 ? '' : 's'}`
    case 'children_completed': return 'all child requests completed — parent resolved automatically'
    default: return e.event_type.replace('_', ' ')
  }
}

const ALL_STATUSES = [
  'new', 'triaged', 'in_progress', 'pending_approval', 'pending_requester',
  'escalated', 'resolved', 'closed', 'cancelled',
]

export function RequestDetail({ requestId, onBack }: { requestId: string; onBack: () => void }) {
  const { profile, hasRole } = useAuth()
  const [req, setReq] = useState<Detail | null>(null)
  const [events, setEvents] = useState<Ev[]>([])
  const [comment, setComment] = useState('')
  const [internalNote, setInternalNote] = useState(false)
  const [overrideTo, setOverrideTo] = useState('')
  const [conversion, setConversion] = useState<ConversionState | null>(null)
  const [children, setChildren] = useState<ChildRow[]>([])
  const [parentRef, setParentRef] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lifecycleTick, setLifecycleTick] = useState(0)
  const lifecycle = useLifecycle(requestId, lifecycleTick)
  const isSysAdmin = hasRole('system_admin')

  const load = useCallback(() => {
    setLifecycleTick((t) => t + 1)
    supabase
      .from('requests')
      .select(
        '*, service:services(code, name, form_schema), form_version:form_versions(schema), resolved_at, rating, rating_comment, requester:profiles!requests_requester_id_fkey(display_name), assignee:profiles!requests_assignee_id_fkey(display_name), approvals(id, request_id, step_order, approver_hint, decision, comment, assigned:profiles!approvals_assigned_approver_id_fkey(display_name))'
      )
      .eq('id', requestId)
      .single()
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else {
          const d = data as unknown as Detail
          setReq(d)
          if (d.parent_request_id) {
            supabase.from('requests').select('ref').eq('id', d.parent_request_id).single()
              .then(({ data: p }) => setParentRef((p as { ref: string } | null)?.ref ?? null))
          } else setParentRef(null)
        }
      })
    supabase
      .from('requests')
      .select('id, ref, title, status, service:services(code)')
      .eq('parent_request_id', requestId)
      .order('ref')
      .then(({ data }) => setChildren((data as unknown as ChildRow[]) ?? []))
    supabase
      .from('request_events')
      .select('id, event_type, detail, created_at, actor:profiles(display_name)')
      .eq('request_id', requestId)
      .order('id')
      .then(({ data }) => setEvents((data as unknown as Ev[]) ?? []))
    supabase
      .from('project_conversion_requests')
      .select('id, status')
      .eq('source_request_id', requestId)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => setConversion((data?.[0] as ConversionState) ?? null))
  }, [requestId])

  useEffect(load, [load])

  const applyOverride = async () => {
    if (!overrideTo) return
    setError(null)
    const { error: e } = await supabase
      .from('requests')
      .update({ status: overrideTo })
      .eq('id', requestId)
    if (e) setError(e.message)
    else {
      setOverrideTo('')
      load()
    }
  }

  const send = async () => {
    if (!comment.trim()) return
    const { error: e } = await supabase.rpc('add_comment', {
      p_request: requestId,
      p_body: comment.trim(),
      p_internal: internalNote,
    })
    if (e) setError(e.message)
    else {
      setComment('')
      load()
    }
  }

  const escalate = async () => {
    if (!req || !profile) return
    setError(null)
    const { error: e } = await supabase.from('project_conversion_requests').insert({
      source_request_id: req.id,
      source_department: req.dept,
      requested_by: profile.id,
      proposed_pm_id: profile.id,
    })
    if (e) setError(e.message)
    load()
  }

  const reopen = async () => {
    const { error: e } = await supabase.rpc('reopen_request', {
      p_request: requestId, p_reason: null,
    })
    if (e) setError(e.message)
    else load()
  }

  const rate = async (stars: number) => {
    const { error: e } = await supabase.rpc('rate_request', {
      p_request: requestId, p_rating: stars, p_comment: null,
    })
    if (e) setError(e.message)
    else load()
  }

  if (!req) return <p className="page-sub">{error ?? 'Loading…'}</p>
  const c = DEPT_COLOR[req.dept]
  // render answers against the form as SUBMITTED (pinned version, 00080);
  // requests predating versioning fall back to the live schema
  const fields = (req.form_version?.schema ?? req.service?.form_schema ?? []).filter((f) => req.payload?.[f.key])
  const chain = [...(req.approvals ?? [])].sort((a, b) => a.step_order - b.step_order)
  const isDeptStaff =
    hasRole('agent', req.dept) || hasRole('team_lead', req.dept) || hasRole('dept_head', req.dept)
  const canEscalate =
    isDeptStaff && !req.project_id && !conversion &&
    !['resolved', 'closed', 'cancelled'].includes(req.status)

  return (
    <>
      <button className="btn" onClick={onBack} style={{ marginBottom: 14 }}>
        ← Back
      </button>
      {lifecycle && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
          <LifecycleBar {...lifecycle} />
        </div>
      )}
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 4, alignSelf: 'stretch', background: c.rail, borderRadius: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="mono" style={{ fontSize: 13, color: 'var(--accent)' }}>{req.ref}</span>
              <h2 style={{ fontSize: 17 }}>{req.title}</h2>
            </div>
            <div className="row-desc" style={{ marginTop: 3 }}>
              {req.service?.name} · {c.label} · requested by {req.requester?.display_name ?? '—'}
              {req.assignee ? ` · assigned to ${req.assignee.display_name}` : ' · unassigned'}
            </div>
          </div>
          <SlaRing createdAt={req.created_at} due={req.sla_resolution_due} pausedAt={req.sla_paused_at} />
          <PriorityChip priority={req.priority} />
          <StatusChip status={req.status} />
        </div>

        {fields.length > 0 && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            {fields.map((f) => (
              <div key={f.key} style={{ display: 'flex', gap: 12, padding: '4px 0', fontSize: 13 }}>
                <span style={{ color: 'var(--muted)', width: 180, flexShrink: 0 }}>{f.label}</span>
                <span style={{ color: 'var(--ink)' }}>
                  {f.type === 'amount'
                    ? `${Number(req.payload[f.key]).toLocaleString()} SAR`
                    : req.payload[f.key]}
                </span>
              </div>
            ))}
          </div>
        )}

        {chain.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
              DoA approval chain{req.amount != null ? ` · ${req.amount.toLocaleString()} SAR` : ''}
            </div>
            <Chain steps={chain} />
          </div>
        )}

        {req.requester_id === profile?.id && ['resolved', 'closed'].includes(req.status) && (() => {
          const withinWindow = req.status === 'resolved' && req.resolved_at != null
            && Date.now() - new Date(req.resolved_at).getTime() < 24 * 3600 * 1000
          return (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
                {req.status === 'resolved'
                  ? 'This request was resolved. Rate the service or reopen it within 24 hours if it isn’t fixed.'
                  : 'This request is closed. You can still rate the service.'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 2 }} role="radiogroup" aria-label="Rate this request">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                      aria-pressed={(req.rating ?? 0) >= n}
                      onClick={() => rate(n)}
                      style={{
                        padding: '2px 7px', fontSize: 16, lineHeight: 1,
                        border: 'none', background: 'none', cursor: 'pointer',
                        color: (req.rating ?? 0) >= n ? 'var(--amber)' : 'var(--line)',
                      }}
                    >
                      ★
                    </button>
                  ))}
                </div>
                {req.rating != null && (
                  <span className="chip" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                    You rated {req.rating}/5
                  </span>
                )}
                {withinWindow && (
                  <button className="btn" style={{ color: 'var(--amber-ink)', borderColor: 'var(--amber)' }} onClick={reopen}>
                    Reopen — not fixed
                  </button>
                )}
              </div>
            </div>
          )
        })()}

        {(canEscalate || conversion || req.project_id) && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {req.project_id && (
              <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                part of a project
              </span>
            )}
            {!req.project_id && conversion?.status === 'pending_dept_head' && (
              <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}>
                project conversion awaiting department head
              </span>
            )}
            {!req.project_id && conversion?.status === 'rejected' && (
              <span className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>
                project conversion rejected
              </span>
            )}
            {canEscalate && (
              <>
                <span style={{ fontSize: 11.5, color: 'var(--muted)', flex: 1, minWidth: 160 }}>
                  Bigger than one ticket? Escalate it into a managed project — your department
                  head approves the conversion.
                </span>
                <button className="btn" onClick={escalate}>Escalate to project</button>
              </>
            )}
          </div>
        )}

        {isSysAdmin && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>
              system admin override
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--muted)', flex: 1, minWidth: 160 }}>
              Any transition allowed, including closed requests — every change is written to
              the audit log and alerts the IT head.
            </span>
            <select
              className="input" style={{ width: 190 }}
              value={overrideTo} onChange={(e) => setOverrideTo(e.target.value)}
            >
              <option value="">Change status to…</option>
              {ALL_STATUSES.filter((s) => s !== req.status).map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
            <button className="btn primary" onClick={applyOverride} disabled={!overrideTo}>
              Apply
            </button>
          </div>
        )}
      </div>

      {(children.length > 0 || parentRef) && (
        <div className="card" style={{ padding: 20, marginBottom: 14 }}>
          {parentRef && (
            <div style={{ fontSize: 13, marginBottom: children.length > 0 ? 12 : 0 }}>
              <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', marginRight: 8 }}>
                work order
              </span>
              Spawned from <span className="mono" style={{ color: 'var(--accent)' }}>{parentRef}</span> —
              resolving it feeds back into the parent automatically.
            </div>
          )}
          {children.length > 0 && (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
                Child requests · parent auto-resolves when all of them are done
              </div>
              {children.map((ch) => (
                <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13, borderTop: '1px solid var(--line)' }}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>{ch.ref}</span>
                  {ch.service && (
                    <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 10 }}>
                      {ch.service.code}
                    </span>
                  )}
                  <span style={{ flex: 1 }}>{ch.title}</span>
                  <span
                    className="chip"
                    style={{
                      background: ['resolved', 'closed'].includes(ch.status) ? 'var(--green-soft)' : 'var(--surface)',
                      color: ['resolved', 'closed'].includes(ch.status) ? 'var(--green)' : 'var(--muted)',
                    }}
                  >
                    {ch.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>Attachments</div>
        <FileUpload
          requestId={req.id}
          canUpload={req.requester_id === profile?.id || hasRole('agent', req.dept) || hasRole('team_lead', req.dept) || hasRole('system_admin')}
          onError={setError}
        />
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>Timeline</div>
        {events.map((e) => (
          <div key={e.id} style={{ display: 'flex', gap: 12, padding: '7px 0', fontSize: 13 }}>
            <span
              style={{
                width: 9, height: 9, borderRadius: '50%', marginTop: 4, flexShrink: 0,
                background: e.event_type === 'comment' ? 'var(--it)' : e.event_type.startsWith('approval') ? 'var(--accent)' : 'var(--green)',
              }}
            />
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 500 }}>{e.actor?.display_name ?? 'Staff'}</span>{' '}
              <span>{eventText(e)}</span>
              {e.event_type === 'comment' && (e.detail as { internal?: boolean }).internal === true && (
                <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber-ink)', marginInlineStart: 6, fontSize: 10 }}>
                  internal
                </span>
              )}
              <div className="row-desc" style={{ fontSize: 11 }}>
                {new Date(e.created_at).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <textarea
            className="input"
            rows={2}
            style={{ width: '100%', resize: 'vertical', background: internalNote ? 'var(--amber-soft)' : undefined }}
            placeholder={internalNote ? 'Internal note — the requester will not see this' : 'Add a comment'}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
            {isDeptStaff && (
              <div className="density" role="radiogroup" aria-label="Comment visibility">
                <button className={internalNote ? '' : 'on'} onClick={() => setInternalNote(false)}>
                  Public reply
                </button>
                <button className={internalNote ? 'on' : ''} onClick={() => setInternalNote(true)}>
                  Internal note
                </button>
              </div>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Ctrl+Enter to send</span>
            <button className="btn primary" onClick={send} disabled={!comment.trim()}>
              {internalNote ? 'Add note' : 'Comment'}
            </button>
          </div>
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
