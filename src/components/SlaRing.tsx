/**
 * The SLA ring signature: remaining fraction as a ring, colored by meaning
 * (green on track, amber < 20% left, red breached, dashed grey paused).
 * Promoted from Queue.tsx so every list shares one implementation.
 */
export function SlaRing({ createdAt, due, pausedAt }: {
  createdAt: string
  due: string | null
  pausedAt?: string | null
}) {
  if (!due) return null
  // paused (pending requester): the clock freezes at the pause instant
  const ref = pausedAt ? new Date(pausedAt).getTime() : Date.now()
  const total = new Date(due).getTime() - new Date(createdAt).getTime()
  const left = new Date(due).getTime() - ref
  const frac = Math.max(0, Math.min(1, left / total))
  const color = pausedAt ? 'var(--muted)' : left <= 0 ? 'var(--red)' : frac < 0.2 ? 'var(--amber)' : 'var(--green)'
  const r = 9
  const circ = 2 * Math.PI * r
  const hoursLeft = Math.round(left / 3600000)
  return (
    <span
      title={pausedAt ? 'SLA paused — waiting on the requester' : left <= 0 ? 'SLA breached' : `${hoursLeft}h to SLA target`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
        <circle
          cx="12" cy="12" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={pausedAt ? '2 3' : `${circ * frac} ${circ}`}
          strokeLinecap="round" transform="rotate(-90 12 12)"
        />
      </svg>
      <span className="mono" style={{ fontSize: 10.5, color }}>
        {pausedAt ? 'paused' : left <= 0 ? 'breached' : `${hoursLeft}h`}
      </span>
    </span>
  )
}
