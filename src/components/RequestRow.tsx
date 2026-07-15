import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DEPT_COLOR, type DeptCode } from '../lib/types'
import { PriorityChip, StatusChip } from './ui'
import { SlaRing } from './SlaRing'

/**
 * The shared operations list row: aligned columns (select · priority/ref ·
 * title+meta · assignee · SLA · status · overflow), department color on the
 * 4px rail only, secondary actions behind the ⋮ overflow menu. The title is
 * the focusable open target.
 */
export interface RequestRowData {
  id: string
  ref: string
  title: string
  dept: DeptCode
  status: string
  priority: string
  created_at: string
  sla_resolution_due: string | null
  sla_paused_at: string | null
  escalated_at?: string | null
}

const initials = (n: string) =>
  n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

export function RequestRow({
  row, meta, assignee, onOpen, selectable, selected, onToggleSelect, menu,
}: {
  row: RequestRowData
  /** secondary line under the title (requester · team · …) */
  meta?: string
  /** display name; null/undefined renders as Unassigned */
  assignee?: string | null
  onOpen: () => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  /** overflow menu content (menu-item buttons); omit to hide the ⋮ */
  menu?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const d = DEPT_COLOR[row.dept]
  return (
    <div className={`qrow${selected ? ' sel' : ''}`} role="row">
      <span className="rail-bar" style={{ background: d.rail }} aria-hidden="true" />
      <span>
        {selectable && (
          <input
            type="checkbox" className="ck" checked={!!selected}
            onChange={onToggleSelect} aria-label={`Select ${row.ref}`}
          />
        )}
      </span>
      <span>
        <PriorityChip priority={row.priority} style={{ marginBottom: 3 }} />
        <br />
        <span className="r-ref mono">{row.ref}</span>
      </span>
      <button className="r-main" onClick={onOpen} title={row.title}>
        <div className="r-title">{row.title}</div>
        {meta && <div className="r-meta">{meta}</div>}
      </button>
      <span className={`assignee${assignee ? '' : ' none'}`}>
        {assignee ? (
          <>
            <span className="avatar">{initials(assignee)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{assignee}</span>
          </>
        ) : 'Unassigned'}
      </span>
      <span><SlaRing createdAt={row.created_at} due={row.sla_resolution_due} pausedAt={row.sla_paused_at} /></span>
      <span><StatusChip status={row.status} escalated={!!row.escalated_at} /></span>
      <span ref={popRef} style={{ position: 'relative' }}>
        {menu && (
          <button className="overflow" aria-label={`Actions for ${row.ref}`} aria-expanded={open}
            onClick={() => setOpen((o) => !o)}>
            ⋮
          </button>
        )}
        {open && (
          <div className="menu-pop" onClick={(e) => {
            // menu-item buttons close the menu; embedded pickers keep it open
            if ((e.target as HTMLElement).closest('.menu-item')) setOpen(false)
          }}>
            {menu}
          </div>
        )}
      </span>
    </div>
  )
}

/** column header matching the RequestRow grid */
export function RequestRowHead({ selectAll }: {
  selectAll?: { checked: boolean; onChange: () => void }
}) {
  return (
    <div className="qhead" role="row">
      <span>
        {selectAll && (
          <input type="checkbox" className="ck" checked={selectAll.checked}
            onChange={selectAll.onChange} aria-label="Select all" />
        )}
      </span>
      <span>Priority · Ref</span>
      <span>Request</span>
      <span>Assignee</span>
      <span>SLA</span>
      <span>Status</span>
      <span />
    </div>
  )
}
