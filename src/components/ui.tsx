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
  amber: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
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

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.6px', marginBottom: 8, textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}
