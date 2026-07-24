/**
 * Pure parts of the dashboard→document bridge: one stable slug per
 * dashboard per owner (the definition is rewritten, never duplicated), and
 * a subtitle that names the applied filters on the artifact.
 */
import { describe, expect, it, vi } from 'vitest'

// exportDashboard imports the supabase client at module level; CI's Node has
// no native WebSocket for the realtime client, so tests always mock it
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { exportSlug, exportSubtitle } from './exportDashboard'
import { DEFAULT_DASHBOARD } from './dashboards'

describe('exportSlug', () => {
  it('is stable per dashboard × owner', () => {
    expect(exportSlug('it-overview', '12345678-aaaa')).toBe('export-it-overview-12345678')
    expect(exportSlug('it-overview', '12345678-bbbb')).toBe('export-it-overview-12345678')
    expect(exportSlug('org-overview', '87654321-aaaa')).toBe('export-org-overview-87654321')
  })
})

describe('exportSubtitle', () => {
  it('names the applied filters so the artifact is self-describing', () => {
    const s = exportSubtitle(DEFAULT_DASHBOARD, {
      dash: 'it-overview', period: 'last7', dept: 'IT', priority: 'P1', status: 'open',
    })
    expect(s).toBe('IT Service Overview · Last 7 days · IT · P1 · open')
  })

  it('"all" status reads as the exclusion it is', () => {
    const s = exportSubtitle(DEFAULT_DASHBOARD, {
      dash: 'it-overview', period: 'last30', dept: 'ALL', priority: 'ALL', status: 'all',
    })
    expect(s).toBe('IT Service Overview · Last 30 days · excl. cancelled')
  })
})

import { boardSections, curatedSections } from './exportDashboard'

const NOW = new Date('2026-07-22T12:00:00Z')

describe('curatedSections', () => {
  const secs = curatedSections({ dash: 'it-overview', period: 'last30', dept: 'IT', priority: 'ALL', status: 'all' }, NOW)

  it('is a KPI + three bar breakdowns + the underlying table', () => {
    expect(secs.map((s) => s.kind)).toEqual(['kpi', 'bar', 'bar', 'bar', 'table'])
    expect(secs.map((s) => s.title)).toEqual([
      'Requests in period', 'Volume by service', 'By priority', 'By status', 'Underlying records',
    ])
  })

  it('every section carries the applied filters and a count-as-value aggregate for charts', () => {
    for (const s of secs) {
      expect(s.query.filters).toContainEqual({ col: 'dept', op: 'eq', value: 'IT' })
    }
    const bar = secs.find((s) => s.title === 'Volume by service')!
    expect(bar.query.group_by).toEqual(['service_code'])
    expect(bar.query.aggregations).toEqual([{ fn: 'count', as: 'value' }])
    expect(bar.query.sort).toEqual([{ col: 'value', dir: 'desc' }])
  })
})

describe('boardSections', () => {
  it('maps widget types to section kinds and compiles each widget config', () => {
    const secs = boardSections([
      { widget_type: 'kpi', data_source: 'requests', title: 'Open', config: { measure: 'count' } },
      { widget_type: 'donut', data_source: 'requests', title: 'Priority mix', config: { measure: 'count', group_by: 'priority' } },
      { widget_type: 'table', data_source: 'assets', title: 'Assets', config: {} },
    ], NOW)
    expect(secs.map((s) => s.kind)).toEqual(['kpi', 'bar', 'table']) // donut → bar section
    expect(secs[1].query.group_by).toEqual(['priority'])
    expect(secs[2].source).toBe('assets')
  })
})
