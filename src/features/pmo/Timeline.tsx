import { useMemo, useState, type ReactNode } from 'react'
import { STATUS_META, buildTree, type Activity, type WbsDependency } from './Wbs'

/**
 * Project timeline (Gantt): WBS-tree row order with click-through, month
 * grid, today line, progress-filled bars (critical path in the accent
 * family, the rest in blue), summary brackets, baseline ghost bars when an
 * approved schedule baseline carries activity dates, milestone diamonds,
 * and FS dependency connectors (skipped above 60 rows for performance).
 */

const DAY = 86400000
const parse = (d: string) => new Date(d + 'T00:00:00').getTime()

export interface BaselineDates {
  [activityId: string]: { start: string; end: string }
}

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

export function TimelineView({ activities, dependencies, baselineDates, onOpen, headerExtra }: {
  activities: Activity[]
  dependencies: WbsDependency[]
  baselineDates?: BaselineDates
  onOpen?: (id: string) => void
  headerExtra?: ReactNode
}) {
  const [hover, setHover] = useState<string | null>(null)

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
    if (baselineDates) {
      for (const b of Object.values(baselineDates)) {
        const s = parse(b.start), e = parse(b.end)
        if (s < min) min = s
        if (e > max) max = e
      }
    }
    min -= 3 * DAY; max += 3 * DAY
    return { rows, min, max, critical: computeCritical(activities, dependencies) }
  }, [activities, dependencies, baselineDates])

  if (activities.length === 0) {
    return <div className="card" style={{ padding: 18 }}><div className="row-desc">Add WBS activities with dates to see the timeline.</div></div>
  }

  const labelW = 200
  const chartW = 900
  const rowH = 30
  const headH = 26
  const W = labelW + chartW
  const H = headH + rows.length * rowH + 8
  const X = (t: number) => labelW + ((t - min) / (max - min)) * chartW
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tx = X(today.getTime())
  const rowIndex = new Map(rows.map((r, i) => [r.a.id, i]))
  const drawDeps = rows.length <= 60

  // hover highlights the row plus its connected dependencies
  const connected = new Set<string>()
  if (hover) {
    connected.add(hover)
    for (const d of dependencies) {
      if (d.predecessor_id === hover) connected.add(d.successor_id)
      if (d.successor_id === hover) connected.add(d.predecessor_id)
    }
  }

  // month grid
  const ticks: { x: number; label: string }[] = []
  const cursor = new Date(min)
  cursor.setDate(1)
  while (cursor.getTime() <= max) {
    if (cursor.getTime() >= min) {
      ticks.push({ x: X(cursor.getTime()), label: cursor.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) })
    }
    cursor.setMonth(cursor.getMonth() + 1)
  }

  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
  const barH = 10
  const barY = (i: number) => headH + i * rowH + (rowH - barH) / 2

  return (
    <div className="card pmo-card" style={{ padding: '14px 16px' }}>
      <div className="sechead" style={{ marginBottom: 10 }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth={1.7}
          strokeLinecap="round" aria-hidden="true"><path d="M4 5h9M4 10h14M4 15h6" /></svg>
        Timeline
        <span style={{ flex: 1 }} />
        {headerExtra}
        <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 400 }}>
          <span style={{ color: 'var(--accent)' }}>—</span> critical path · ◆ milestone · ░ baseline
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} style={{ maxWidth: '100%', height: 'auto', minWidth: 700, fontFamily: 'inherit' }}>
          <line x1={0} y1={headH} x2={W} y2={headH} stroke="var(--line)" strokeWidth={1} />
          {ticks.map((t, i) => (
            <text key={i} x={t.x + 3} y={headH - 8} fontSize={10.5} fill="var(--muted)">{t.label}</text>
          ))}

          {rows.map((r, i) => {
            const y = headH + i * rowH
            const meta = STATUS_META[r.a.status]
            const isCrit = critical.has(r.a.id)
            const dated = r.start !== null && r.end !== null
            const dim = hover !== null && !connected.has(r.a.id)
            const remainder = isCrit ? '#993C1D' : 'var(--it)'
            const progress = isCrit ? '#D85A30' : 'var(--green)'
            const bl = baselineDates?.[r.a.id]
            const topLevel = r.a.level === 1
            const tip = `${r.a.code} ${r.a.title}\n${dated ? `${fmt(r.start!)} → ${fmt(r.end!)}` : 'no dates'} · ${meta.pct}% complete${isCrit ? ' · critical path' : ''}`
            const barW = dated ? Math.max(4, X(r.end! + DAY) - X(r.start!)) : 0
            return (
              <g key={r.a.id} opacity={dim ? 0.35 : 1}
                 onClick={onOpen ? () => onOpen(r.a.id) : undefined}
                 onMouseEnter={() => setHover(r.a.id)} onMouseLeave={() => setHover(null)}
                 style={onOpen ? { cursor: 'pointer' } : undefined}>
                {r.summary && <rect x={0} y={y} width={W} height={rowH} fill="var(--surface)" rx={6} />}
                {hover === r.a.id && !r.summary && <rect x={0} y={y} width={W} height={rowH} fill="var(--it-soft)" opacity={0.5} />}
                <rect x={0} y={y} width={W} height={rowH} fill="transparent"><title>{tip}</title></rect>
                <text x={8 + (r.a.level - 1) * 14} y={y + rowH / 2 + 3.5}
                  fontSize={11.5} fontWeight={topLevel ? 500 : 400} fill="var(--ink)">
                  <tspan fill="var(--muted)" fontFamily="var(--font-mono, monospace)" fontSize={10}>{r.a.code}</tspan>
                  {'  ' + (r.a.title.length > 24 ? r.a.title.slice(0, 23) + '…' : r.a.title)}
                </text>

                {bl && !r.a.is_milestone && (
                  <rect x={X(parse(bl.start))} y={barY(i) + barH + 1}
                    width={Math.max(3, X(parse(bl.end) + DAY) - X(parse(bl.start)))} height={3}
                    rx={1.5} fill="#C9CFDB" />
                )}

                {dated && r.a.is_milestone ? (
                  <g>
                    <rect x={X(r.start!) - 6} y={y + rowH / 2 - 6} width={12} height={12} rx={2}
                      fill={isCrit ? 'var(--red)' : 'var(--amber)'}
                      transform={`rotate(45 ${X(r.start!)} ${y + rowH / 2})`} />
                    <text x={X(r.start!) + 12} y={y + rowH / 2 + 3.5} fontSize={10} fill="var(--muted)"
                      fontFamily="var(--font-mono, monospace)">{fmt(r.start!)}</text>
                  </g>
                ) : dated ? (
                  <g>
                    <rect x={X(r.start!)} y={barY(i)} width={barW} height={barH} rx={5} fill={remainder} />
                    {meta.pct > 0 && (
                      <rect x={X(r.start!)} y={barY(i)}
                        width={Math.max(3, barW * (meta.pct / 100))}
                        height={barH} rx={5} fill={progress} />
                    )}
                  </g>
                ) : (
                  <text x={labelW + 6} y={y + rowH / 2 + 3.5} fontSize={9.5} fill="var(--muted)">no dates</text>
                )}
              </g>
            )
          })}

          {drawDeps && dependencies.map((d) => {
            const pi = rowIndex.get(d.predecessor_id)
            const si = rowIndex.get(d.successor_id)
            if (pi === undefined || si === undefined) return null
            const p = rows[pi], s = rows[si]
            if (p.end === null || s.start === null) return null
            const x1 = X(p.end + DAY)
            const y1 = barY(pi) + barH / 2
            const x2 = X(s.start)
            const y2 = barY(si) + barH / 2
            const active = hover === d.predecessor_id || hover === d.successor_id
            const mid = Math.max(x1 + 6, x2 - 6)
            return (
              <g key={d.id} opacity={hover === null ? 0.45 : active ? 1 : 0.1} pointerEvents="none">
                <path d={`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`} fill="none"
                  stroke={active ? 'var(--accent)' : 'var(--muted)'} strokeWidth={active ? 1.6 : 1} />
                <polygon points={`${x2},${y2} ${x2 - 5},${y2 - 3.5} ${x2 - 5},${y2 + 3.5}`}
                  fill={active ? 'var(--accent)' : 'var(--muted)'} />
              </g>
            )
          })}

          <line x1={tx} y1={headH} x2={tx} y2={H} stroke="var(--red)" strokeWidth={2} opacity={0.7} />
          <g>
            <rect x={tx - 17} y={headH - 15} width={34} height={13} rx={4} fill="var(--red-soft)" />
            <text x={tx} y={headH - 5.5} fontSize={9.5} fill="var(--red)" textAnchor="middle">today</text>
          </g>
        </svg>
      </div>
    </div>
  )
}
