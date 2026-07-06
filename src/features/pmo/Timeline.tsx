import { useMemo } from 'react'
import { SectionLabel } from '../../components/ui'
import { STATUS_META, buildTree, type Activity, type WbsDependency } from './Wbs'

/**
 * Project timeline (Gantt): one bar per activity following the WBS tree,
 * today indicator, completed shading, milestones as diamonds, and the
 * critical path (longest finish-to-start chain by duration) highlighted.
 */

const DAY = 86400000
const parse = (d: string) => new Date(d + 'T00:00:00').getTime()

interface Row {
  a: Activity
  start: number | null
  end: number | null
  summary: boolean
}

function computeCritical(activities: Activity[], deps: WbsDependency[]): Set<string> {
  const dated = activities.filter((a) => a.planned_start && a.planned_end)
  const ids = new Set(dated.map((a) => a.id))
  const dur = new Map(dated.map((a) => [a.id, (parse(a.planned_end!) - parse(a.planned_start!)) / DAY + 1]))
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  let hasEdges = false
  for (const d of deps) {
    if (!ids.has(d.predecessor_id) || !ids.has(d.successor_id)) continue
    hasEdges = true
    preds.set(d.successor_id, [...(preds.get(d.successor_id) ?? []), d.predecessor_id])
    succs.set(d.predecessor_id, [...(succs.get(d.predecessor_id) ?? []), d.successor_id])
  }
  if (!hasEdges) return new Set()
  // longest path by total duration (topological, graph is small)
  const dist = new Map<string, number>()
  const via = new Map<string, string | null>()
  const indeg = new Map<string, number>()
  for (const id of ids) indeg.set(id, (preds.get(id) ?? []).length)
  const queue = [...ids].filter((id) => indeg.get(id) === 0)
  for (const id of queue) { dist.set(id, dur.get(id)!); via.set(id, null) }
  while (queue.length) {
    const id = queue.shift()!
    for (const s of succs.get(id) ?? []) {
      const cand = (dist.get(id) ?? 0) + dur.get(s)!
      if (cand > (dist.get(s) ?? -1)) { dist.set(s, cand); via.set(s, id) }
      indeg.set(s, indeg.get(s)! - 1)
      if (indeg.get(s) === 0) queue.push(s)
    }
  }
  let endId: string | null = null
  for (const [id, d] of dist) if (endId === null || d > dist.get(endId)!) endId = id
  const critical = new Set<string>()
  while (endId) { critical.add(endId); endId = via.get(endId) ?? null }
  return critical
}

export function TimelineView({ activities, dependencies }: {
  activities: Activity[]
  dependencies: WbsDependency[]
}) {
  const { rows, min, max, critical } = useMemo(() => {
    const children = buildTree(activities)
    const spanOf = (a: Activity): [number | null, number | null] => {
      const kids = children.get(a.id) ?? []
      if (kids.length === 0) {
        return [a.planned_start ? parse(a.planned_start) : null, a.planned_end ? parse(a.planned_end) : null]
      }
      let s: number | null = null, e: number | null = null
      for (const k of kids) {
        const [ks, ke] = spanOf(k)
        if (ks !== null && (s === null || ks < s)) s = ks
        if (ke !== null && (e === null || ke > e)) e = ke
      }
      return [s, e]
    }
    const rows: Row[] = []
    const walk = (a: Activity) => {
      const kids = children.get(a.id) ?? []
      const [s, e] = spanOf(a)
      rows.push({ a, start: s, end: e, summary: kids.length > 0 })
      kids.forEach(walk)
    }
    ;(children.get(null) ?? []).forEach(walk)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    let min = today.getTime(), max = today.getTime()
    for (const r of rows) {
      if (r.start !== null && r.start < min) min = r.start
      if (r.end !== null && r.end > max) max = r.end
    }
    min -= 3 * DAY; max += 3 * DAY
    return { rows, min, max, critical: computeCritical(activities, dependencies) }
  }, [activities, dependencies])

  if (activities.length === 0) {
    return <div className="card" style={{ padding: 18 }}><div className="row-desc">Add WBS activities with dates to see the timeline.</div></div>
  }

  const labelW = 240
  const chartW = 760
  const rowH = 30
  const headH = 26
  const W = labelW + chartW
  const H = headH + rows.length * rowH + 8
  const X = (t: number) => labelW + ((t - min) / (max - min)) * chartW
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tx = X(today.getTime())

  // month ticks
  const ticks: { x: number; label: string }[] = []
  const cursor = new Date(min)
  cursor.setDate(1)
  while (cursor.getTime() <= max) {
    if (cursor.getTime() >= min) {
      ticks.push({ x: X(cursor.getTime()), label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })
    }
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <SectionLabel>Timeline</SectionLabel>
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--muted)', alignItems: 'center' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--green)', borderRadius: 2, marginRight: 4 }} />done</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 2, marginRight: 4 }} />in progress</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--red)', borderRadius: 2, marginRight: 4 }} />critical path</span>
          <span style={{ color: 'var(--red)' }}>│ today</span>
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 700, fontFamily: 'inherit' }}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={t.x} y1={headH} x2={t.x} y2={H} stroke="var(--line)" strokeWidth={1} />
              <text x={t.x + 3} y={14} fontSize={9.5} fill="var(--muted)">{t.label}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = headH + i * rowH
            const meta = STATUS_META[r.a.status]
            const isCrit = critical.has(r.a.id)
            const dated = r.start !== null && r.end !== null
            return (
              <g key={r.a.id}>
                {i % 2 === 1 && <rect x={0} y={y} width={W} height={rowH} fill="var(--surface)" opacity={0.45} />}
                <text x={8 + (r.a.level - 1) * 14} y={y + rowH / 2 + 3.5} fontSize={r.summary ? 11 : 10.5}
                  fontWeight={r.summary ? 700 : 400} fill="var(--ink)">
                  <tspan fill="var(--accent)" fontFamily="var(--font-mono, monospace)">{r.a.code}</tspan>
                  {'  ' + (r.a.title.length > 24 ? r.a.title.slice(0, 23) + '…' : r.a.title)}
                </text>
                {dated && r.a.is_milestone ? (
                  <polygon
                    points={`${X(r.start!)},${y + 7} ${X(r.start!) + 7},${y + rowH / 2} ${X(r.start!)},${y + rowH - 7} ${X(r.start!) - 7},${y + rowH / 2}`}
                    fill="var(--amber)" stroke={isCrit ? 'var(--red)' : 'none'} strokeWidth={2}
                  />
                ) : dated ? (
                  r.summary ? (
                    <rect x={X(r.start!)} y={y + rowH / 2 - 3} width={Math.max(3, X(r.end! + DAY) - X(r.start!))} height={6}
                      rx={3} fill="var(--muted)" opacity={0.55} />
                  ) : (
                    <g>
                      <rect x={X(r.start!)} y={y + 6} width={Math.max(4, X(r.end! + DAY) - X(r.start!))} height={rowH - 12}
                        rx={4} fill="var(--surface)"
                        stroke={isCrit ? 'var(--red)' : 'var(--line)'} strokeWidth={isCrit ? 2 : 1} />
                      {meta.pct > 0 && (
                        <rect x={X(r.start!)} y={y + 6}
                          width={Math.max(3, (X(r.end! + DAY) - X(r.start!)) * (meta.pct / 100))}
                          height={rowH - 12} rx={4}
                          fill={r.a.status === 'done' ? 'var(--green)' : 'var(--accent)'} opacity={0.9} />
                      )}
                    </g>
                  )
                ) : (
                  <text x={labelW + 6} y={y + rowH / 2 + 3.5} fontSize={9.5} fill="var(--muted)">no dates</text>
                )}
              </g>
            )
          })}
          <line x1={tx} y1={headH - 4} x2={tx} y2={H} stroke="var(--red)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={tx + 4} y={headH + 6} fontSize={9.5} fill="var(--red)">today</text>
        </svg>
      </div>
    </div>
  )
}
