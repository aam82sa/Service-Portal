import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'
import { SlaRing } from './Queue'
import { FileUpload } from '../../components/FileUpload'
import { Chain, type ApprovalStep } from './Approvals'
import { LifecycleBar } from '../../components/LifecycleBar'
import { useLifecycle } from './useLifecycle'
import type { FormField } from '../catalog/RequestForm'

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
  service: { code: string; name: string; form_schema: FormField[] } | null
  requester: { display_name: string } | null
  assignee: { display_name: string } | null
  approvals: ApprovalStep[]
  project_id: string | null
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
  const [overrideTo, setOverrideTo] = useState('')
  const [conversion, setConversion] = useState<ConversionState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lifecycleTick, setLifecycleTick] = useState(0)
  const lifecycle = useLifecycle(requestId, lifecycleTick)
  const isSysAdmin = hasRole('system_admin')

  const load = useCallback(() => {
    setLifecycleTick((t) => t + 1)
    supabase
      .from('requests')
      .select(
        '*, service:services(code, name, form_schema), requester:profiles!requests_requester_id_fkey(display_name), assignee:profiles!requests_assignee_id_fkey(display_name), approvals(id, request_id, step_order, approver_hint, decision, comment)'
      )
      .eq('id', requestId)
      .single()
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setReq(data as unknown as Detail)
      })
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

  if (!req) return <p className="page-sub">{error ?? 'Loading…'}</p>
  const c = DEPT_COLOR[req.dept]
  const fields = (req.service?.form_schema ?? []).filter((f) => req.payload?.[f.key])
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
          <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
            {req.priority}
          </span>
          <span className="chip" style={{ background: c.soft, color: c.rail }}>
            {req.status.replace('_', ' ')}
          </span>
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
              <div className="row-desc" style={{ fontSize: 11 }}>
                {new Date(e.created_at).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Add a comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button className="btn primary" onClick={send} disabled={!comment.trim()}>
            Comment
          </button>
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
