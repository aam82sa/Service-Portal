/**
 * The dashboard's entire on-screen maths lives in analyticsData.ts as pure
 * functions — these tests pin the KPI/delta/bucketing semantics so widget
 * numbers can be trusted without a browser.
 */
import { describe, expect, it } from 'vitest'
import {
  OPEN_STATUSES, asOfLabel, buildExportConfig, buildLiveConfig, dailySeries, deriveKpis, openByPriority,
  periodDays, segmentRows, splitWindow, volumeByService, weeklySla, type RequestRow,
} from './analyticsData'

const NOW = new Date('2026-07-22T12:00:00Z')
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString()

let seq = 0
function row(over: Partial<RequestRow>): RequestRow {
  return {
    ref: `REQ-${1000 + ++seq}`, title: 'test', dept: 'IT', service_code: 'HW', service_name: 'Hardware',
    status: 'in_progress', priority: 'P3', created_at: daysAgo(1), resolved_at: null,
    updated_at: daysAgo(0), sla_resolution_due: null, sla_met: false, breached: false,
    ...over,
  }
}

describe('buildLiveConfig', () => {
  it('fetches twice the period and compiles the UI filters server-side', () => {
    const cfg = buildLiveConfig({ dash: 'it-overview', period: 'last30', dept: 'IT', priority: 'ALL', status: 'all' }, NOW)
    expect(cfg.period?.from).toBe(new Date(NOW.getTime() - 60 * DAY).toISOString())
    expect(cfg.filters).toEqual([
      { col: 'dept', op: 'eq', value: 'IT' },
      { col: 'status', op: 'neq', value: 'cancelled' }, // "All" still excludes cancelled
    ])
    expect(cfg.columns).toContain('service_code')
    expect(cfg.columns).toContain('sla_met')
  })

  it('maps the status presets: open → IN open statuses, resolved/closed → eq', () => {
    const open = buildLiveConfig({ dash: 'x', period: 'last7', dept: 'ALL', priority: 'P1', status: 'open' }, NOW)
    expect(open.filters).toEqual([
      { col: 'priority', op: 'eq', value: 'P1' },
      { col: 'status', op: 'in', value: OPEN_STATUSES },
    ])
    const closed = buildLiveConfig({ dash: 'x', period: 'last7', dept: 'ALL', priority: 'ALL', status: 'closed' }, NOW)
    expect(closed.filters).toEqual([{ col: 'status', op: 'eq', value: 'closed' }])
  })

  it('ytd window runs from Jan 1', () => {
    // 2026-07-22 is day 203 of the year
    expect(periodDays('ytd', NOW)).toBe(203)
    expect(periodDays('last7', NOW)).toBe(7)
    expect(periodDays('quarter', NOW)).toBe(90)
  })
})

describe('splitWindow + deriveKpis', () => {
  it('splits rows at now - days and computes deltas current vs previous', () => {
    const rows = [
      row({ created_at: daysAgo(2), status: 'new' }),                       // current, open
      row({ created_at: daysAgo(5), status: 'in_progress', breached: true }), // current, open, breached
      row({ created_at: daysAgo(3), status: 'resolved', resolved_at: daysAgo(1) }), // current, resolved in 2 days
      row({ created_at: daysAgo(12), status: 'closed' }),                   // previous
      row({ created_at: daysAgo(9), status: 'escalated' }),                 // previous, open
    ]
    const { current, previous } = splitWindow(rows, NOW, 7)
    expect(current).toHaveLength(3)
    expect(previous).toHaveLength(2)
    const k = deriveKpis(current, previous)
    expect(k.open).toBe(2)
    expect(k.openDelta).toBe(1) // 2 open now vs 1 before
    expect(k.breaches).toBe(1)
    expect(k.breachesDelta).toBe(1)
    expect(k.avgResolutionHours).toBe(48)
  })

  it('SLA compliance counts only rows with a due date; null when none', () => {
    const current = [
      row({ sla_resolution_due: daysAgo(0), sla_met: true }),
      row({ sla_resolution_due: daysAgo(0), sla_met: true }),
      row({ sla_resolution_due: daysAgo(0), sla_met: false }),
      row({ sla_resolution_due: null }), // no SLA — not in the denominator
    ]
    const k = deriveKpis(current, [])
    expect(k.slaPct).toBe(66.7)
    expect(k.slaPctDelta).toBeNull() // previous window had no SLA rows
    expect(deriveKpis([row({})], []).slaPct).toBeNull()
  })
})

describe('dailySeries', () => {
  it('buckets created and resolved per day, oldest first', () => {
    const rows = [
      row({ created_at: daysAgo(6.5) }),
      row({ created_at: daysAgo(6.2) }),
      row({ created_at: daysAgo(0.5), resolved_at: daysAgo(0.1) }),
    ]
    const s = dailySeries(rows, 7, NOW)
    expect(s.created).toEqual([2, 0, 0, 0, 0, 0, 1])
    expect(s.resolved).toEqual([0, 0, 0, 0, 0, 0, 1])
  })
})

describe('volumeByService', () => {
  it('groups by dept+code, sorts desc, caps at topN', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row({ service_code: 'AC', service_name: 'Access request' })),
      ...Array.from({ length: 3 }, () => row({ service_code: 'HW', service_name: 'Hardware' })),
      ...Array.from({ length: 4 }, () => row({ dept: 'ADMIN', service_code: 'RB', service_name: 'Room booking' })),
    ]
    const v = volumeByService(rows, 2)
    expect(v).toEqual([
      { code: 'AC', name: 'Access request', dept: 'IT', value: 5 },
      { code: 'RB', name: 'Room booking', dept: 'ADMIN', value: 4 },
    ])
  })
})

describe('openByPriority', () => {
  it('counts only open statuses, P1→P4 order', () => {
    const rows = [
      row({ priority: 'P1', status: 'new' }),
      row({ priority: 'P3', status: 'in_progress' }),
      row({ priority: 'P3', status: 'resolved' }), // not open — excluded
      row({ priority: 'P4', status: 'escalated' }),
    ]
    expect(openByPriority(rows)).toEqual([
      { priority: 'P1', value: 1 },
      { priority: 'P2', value: 0 },
      { priority: 'P3', value: 1 },
      { priority: 'P4', value: 1 },
    ])
  })
})

describe('weeklySla', () => {
  it('buckets by Sunday-start weeks, flags the running week partial with a star', () => {
    // 2026-07-22 is a Wednesday; this week started Sunday 19 Jul
    const rows = [
      row({ created_at: '2026-07-20T09:00:00Z', sla_resolution_due: daysAgo(0), sla_met: true }),   // this week, met
      row({ created_at: '2026-07-13T09:00:00Z', sla_resolution_due: daysAgo(0), sla_met: false, breached: true }), // last week, breached
      row({ created_at: '2026-07-13T10:00:00Z', sla_resolution_due: daysAgo(0), sla_met: true }),   // last week, met
      row({ created_at: '2026-07-14T10:00:00Z', sla_resolution_due: null }),                        // no SLA — ignored
    ]
    const w = weeklySla(rows, NOW, 5)
    expect(w).toHaveLength(5)
    expect(w[4].label).toBe('19 Jul*')
    expect(w[4].partial).toBe(true)
    expect(w[4].met).toBe(1)
    expect(w[3].label).toBe('12 Jul')
    expect(w[3].met).toBe(1)
    expect(w[3].breached).toBe(1)
    expect(w[0].label).toBe('21 Jun')
  })

  it('a resolved-late row (not flagged breached any more) still counts as breached', () => {
    const rows = [row({
      created_at: '2026-07-20T09:00:00Z', sla_resolution_due: daysAgo(2),
      sla_met: false, breached: false, resolved_at: daysAgo(0), status: 'resolved',
    })]
    const w = weeklySla(rows, NOW, 5)
    expect(w[4].breached).toBe(1)
  })
})

describe('segmentRows (drill-down)', () => {
  const rows = [
    row({ service_code: 'AC', dept: 'IT', priority: 'P1', status: 'new', created_at: daysAgo(2) }),
    row({ service_code: 'AC', dept: 'ADMIN', priority: 'P1', status: 'new', created_at: daysAgo(2) }),
    row({ service_code: 'HW', dept: 'IT', priority: 'P1', status: 'resolved', created_at: daysAgo(3), resolved_at: daysAgo(1) }),
  ]

  it('service segment matches code AND dept', () => {
    const out = segmentRows(rows, { kind: 'service', code: 'AC', dept: 'IT', label: '' }, NOW, 7)
    expect(out.map((r) => r.dept)).toEqual(['IT'])
  })

  it('priority segment includes only open rows', () => {
    const out = segmentRows(rows, { kind: 'priority', priority: 'P1', label: '' }, NOW, 7)
    expect(out).toHaveLength(2)
  })

  it('day segment picks the daily bucket for the chosen series', () => {
    // bucket i covers [now - 7d + i·1d, +1d): created 2 days ago → bucket 5
    const created = segmentRows(rows, { kind: 'day', index: 5, series: 'created', label: '' }, NOW, 7)
    expect(created).toHaveLength(2)
    const resolved = segmentRows(rows, { kind: 'day', index: 6, series: 'resolved', label: '' }, NOW, 7)
    expect(resolved.map((r) => r.service_code)).toEqual(['HW'])
  })
})

describe('asOfLabel', () => {
  it('renders the relative stamp', () => {
    expect(asOfLabel(new Date(NOW.getTime() - 2 * 60_000).toISOString(), NOW)).toBe('Data as of 2 min ago')
    expect(asOfLabel(NOW.toISOString(), NOW)).toBe('Data as of just now')
  })
})

describe('buildExportConfig (dashboard → document)', () => {
  it('carries exactly the applied window (1×) and the same filters as the live view', () => {
    const f = { dash: 'it-overview', period: 'last7' as const, dept: 'IT', priority: 'P1', status: 'open' as const }
    const live = buildLiveConfig(f, NOW)
    const exp = buildExportConfig(f, NOW)
    expect(exp.period?.from).toBe(new Date(NOW.getTime() - 7 * DAY).toISOString())
    expect(live.period?.from).toBe(new Date(NOW.getTime() - 14 * DAY).toISOString())
    expect(exp.filters).toEqual(live.filters) // same filters, different window
    expect(exp.sort).toEqual([{ col: 'created_at', dir: 'desc' }])
    expect(exp.columns).toContain('ref')
    expect(exp.columns).toContain('sla_met')
  })
})
