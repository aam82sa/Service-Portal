import type { CSSProperties, ReactNode } from 'react'

/**
 * Shared UI primitives. Convention: new and edited code uses these instead of
 * inline-styled spans/buttons, so design changes stay one-file edits.
 */

export type Tone = 'ink' | 'muted' | 'accent' | 'green' | 'amber' | 'red' | 'it' | 'admin'

const TONE: Record<Tone, { bg: string; fg: string }> = {
  ink: { bg: 'var(--surface)', fg: 'var(--ink)' },
  muted: { bg: 'var(--surface)', fg: 'var(--muted)' },
  accent: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  green: { bg: 'var(--green-soft)', fg: 'var(--green)' },
  amber: { bg: 'var(--amber-soft)', fg: 'var(--amber-ink)' },
  red: { bg: 'var(--red-soft)', fg: 'var(--red)' },
  it: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  admin: { bg: 'var(--admin-soft)', fg: 'var(--admin)' },
}

export function Chip({ tone = 'muted', mono, children, style, onClick }: {
  tone?: Tone
  mono?: boolean
  children: ReactNode
  style?: CSSProperties
  onClick?: () => void
}) {
  const t = TONE[tone]
  return (
    <span
      className={`chip${mono ? ' mono' : ''}`}
      style={{ background: t.bg, color: t.fg, cursor: onClick ? 'pointer' : undefined, ...style }}
      onClick={onClick}
    >
      {children}
    </span>
  )
}

/**
 * Canonical semantic color for request status/priority — the SAME mapping on
 * every screen. Department identity lives on the 4px rail only, never on
 * status or priority chips.
 */
export const STATUS_TONE: Record<string, Tone> = {
  new: 'it',
  triaged: 'it',
  in_progress: 'amber',
  pending_approval: 'accent',
  pending_requester: 'amber',
  escalated: 'red',
  resolved: 'green',
  closed: 'muted',
  cancelled: 'muted',
}

export const PRIORITY_TONE: Record<string, Tone> = {
  P1: 'red',
  P2: 'amber',
  P3: 'muted',
  P4: 'muted',
}

export function StatusChip({ status, escalated, style }: {
  status: string
  /** SLA escalation folds into the status chip: red tone + suffix */
  escalated?: boolean
  style?: CSSProperties
}) {
  return (
    <Chip tone={escalated ? 'red' : STATUS_TONE[status] ?? 'muted'} style={style}>
      {status.replace(/_/g, ' ')}{escalated ? ' \u00b7 escalated' : ''}
    </Chip>
  )
}

export function PriorityChip({ priority, style }: { priority: string; style?: CSSProperties }) {
  return (
    <Chip tone={PRIORITY_TONE[priority] ?? 'muted'} mono style={style}>
      {priority}
    </Chip>
  )
}

export function Toggle({ on, onChange, disabled, label }: {
  on: boolean
  onChange: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      className={`toggle${on ? ' on' : ''}`}
      onClick={onChange}
      disabled={disabled}
      aria-label={label}
    />
  )
}

export function MetricCard({ label, value, tone = 'ink' }: {
  label: string
  value: number | string
  tone?: Tone
}) {
  return (
    <div className="card" style={{ padding: '14px 18px', flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 26, fontFamily: 'var(--font-head)', color: TONE[tone].fg, marginTop: 2 }}>
        {value}
      </div>
    </div>
  )
}

export function Donut({ parts, centerTop, centerSub, size = 110 }: {
  parts: { v: number; c: string }[]
  centerTop: string
  centerSub: string
  size?: number
}) {
  const total = parts.reduce((s, p) => s + p.v, 0) || 1
  const R = 50
  const C = 2 * Math.PI * R
  let acc = 0
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg viewBox="0 0 128 128" width={size} height={size}>
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--surface)" strokeWidth="17" />
        {parts.filter((p) => p.v > 0).map((p, i) => {
          const frac = p.v / total
          const el = (
            <circle
              key={i} cx="64" cy="64" r={R} fill="none" stroke={p.c} strokeWidth="17"
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C}
              transform="rotate(-90 64 64)"
            />
          )
          acc += frac
          return el
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-head)', color: 'var(--ink)' }}>{centerTop}</div>
        <div style={{ fontSize: 8.5, color: 'var(--muted)' }}>{centerSub}</div>
      </div>
    </div>
  )
}

export function HBar({ name, value, max, color, onClick }: {
  name: string
  value: number
  max: number
  color: string
  onClick?: () => void
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
    >
      <span style={{ fontSize: 10.5, width: 104, flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}
      </span>
      <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 3, height: 12, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(3, (value / Math.max(1, max)) * 100)}%`, height: '100%', borderRadius: 3, background: color }} />
      </div>
      <span className="mono" style={{ fontSize: 10, width: 22, textAlign: 'right', color: 'var(--muted)' }}>{value}</span>
    </div>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.6px', marginBottom: 8, textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}
