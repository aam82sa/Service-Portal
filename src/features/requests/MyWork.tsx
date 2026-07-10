import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'
import { SlaRing } from './Queue'

interface WorkRow {
  id: string
  ref: string
  title: string
  dept: DeptCode
  status: string
  priority: string
  created_at: string
  sla_resolution_due: string | null
  sla_paused_at: string | null
}

function Section({
  title,
  rows,
  empty,
  onOpen,
}: {
  title: string
  rows: WorkRow[]
  empty: string
  onOpen: (id: string) => void
}) {
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--muted)', margin: '18px 0 8px', fontWeight: 500 }}>
        {title}
      </div>
      <div className="card">
        {rows.map((r) => {
          const c = DEPT_COLOR[r.dept]
          return (
            <div
              className="row"
              key={r.id}
              style={{ cursor: 'pointer' }}
              onClick={() => onOpen(r.id)}
            >
              <span style={{ width: 4, alignSelf: 'stretch', background: c.rail, borderRadius: 2 }} />
              <span className="mono" style={{ fontSize: 12, width: 84 }}>{r.ref}</span>
              <span className="row-title" style={{ flex: 1 }}>{r.title}</span>
              <SlaRing createdAt={r.created_at} due={r.sla_resolution_due} pausedAt={r.sla_paused_at} />
              <span className="chip" style={{ background: c.soft, color: c.rail }}>
                {r.status.replace('_', ' ')}
              </span>
            </div>
          )
        })}
        {rows.length === 0 && <div className="row row-desc">{empty}</div>}
      </div>
    </>
  )
}

export function MyWork({ onOpen }: { onOpen: (id: string) => void }) {
  const { session, hasRole } = useAuth()
  const [assigned, setAssigned] = useState<WorkRow[]>([])
  const [approvalRefs, setApprovalRefs] = useState<WorkRow[]>([])
  const [own, setOwn] = useState<WorkRow[]>([])

  useEffect(() => {
    const uid = session!.user.id
    const cols = 'id, ref, title, dept, status, priority, created_at, sla_resolution_due, sla_paused_at'
    supabase
      .from('requests').select(cols)
      .eq('assignee_id', uid).not('status', 'in', '(closed,cancelled)').order('created_at')
      .then(({ data }) => setAssigned((data as WorkRow[]) ?? []))
    if (hasRole('approver')) {
      supabase
        .from('requests').select(cols)
        .eq('status', 'pending_approval').order('created_at')
        .then(({ data }) => setApprovalRefs((data as WorkRow[]) ?? []))
    }
    supabase
      .from('requests').select(cols)
      .eq('requester_id', uid).not('status', 'in', '(closed,cancelled)').order('created_at')
      .then(({ data }) => setOwn((data as WorkRow[]) ?? []))
  }, [session, hasRole])

  const isStaff = hasRole('agent') || hasRole('team_lead') || hasRole('dept_admin')

  return (
    <>
      <h2 className="page-head">My work</h2>
      <p className="page-sub">Everything that needs you, in one place.</p>
      {isStaff && (
        <Section title="Assigned to me" rows={assigned} empty="Nothing assigned to you." onOpen={onOpen} />
      )}
      {hasRole('approver') && (
        <Section title="Awaiting my approval" rows={approvalRefs} empty="No pending approvals." onOpen={onOpen} />
      )}
      <Section title="My open requests" rows={own} empty="You have no open requests." onOpen={onOpen} />
    </>
  )
}
