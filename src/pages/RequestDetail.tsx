import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEPT_COLOR, type DeptCode } from '../lib/types'
import { SlaRing } from './Queue'
import { Chain, type ApprovalStep } from './Approvals'
import type { FormField } from './RequestForm'

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
  service: { code: string; name: string; form_schema: FormField[] } | null
  requester: { display_name: string } | null
  assignee: { display_name: string } | null
  approvals: ApprovalStep[]
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

export function RequestDetail({ requestId, onBack }: { requestId: string; onBack: () => void }) {
  const [req, setReq] = useState<Detail | null>(null)
  const [events, setEvents] = useState<Ev[]>([])
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
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
  }, [requestId])

  useEffect(load, [load])

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

  if (!req) return <p className="page-sub">{error ?? 'Loading…'}</p>
  const c = DEPT_COLOR[req.dept]
  const fields = (req.service?.form_schema ?? []).filter((f) => req.payload?.[f.key])
  const chain = [...(req.approvals ?? [])].sort((a, b) => a.step_order - b.step_order)

  return (
    <>
      <button className="btn" onClick={onBack} style={{ marginBottom: 14 }}>
        ← Back
      </button>
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
          <SlaRing createdAt={req.created_at} due={req.sla_resolution_due} />
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
