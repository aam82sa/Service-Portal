/**
 * The widget → query-live mapping, including the strongest guarantee we can
 * give the builder: every source × supported widget type compiles through
 * the real allowlist compiler without throwing — a widget the palette can
 * produce can never be a guaranteed compile error.
 */
import { describe, expect, it } from 'vitest'
import { periodFrom, widgetToConfig, type WidgetDraft } from './builderQuery'

const NOW = new Date('2026-07-22T12:00:00Z')

const draft = (over: Partial<WidgetDraft>): WidgetDraft => ({
  widget_type: 'bar', data_source: 'requests', title: 't', config: {}, ...over,
})

describe('widgetToConfig', () => {
  it('kpi compiles to a bare aggregate with filters and period', () => {
    const cfg = widgetToConfig(draft({
      widget_type: 'kpi',
      config: { measure: 'count', filters: [{ col: 'dept', op: 'eq', value: 'IT' }], period: { preset: 'last30' } },
    }), NOW)
    expect(cfg.aggregations).toEqual([{ fn: 'count', as: 'value' }])
    expect(cfg.filters).toEqual([{ col: 'dept', op: 'eq', value: 'IT' }])
    expect(cfg.period?.from).toBe(new Date(NOW.getTime() - 30 * 86_400_000).toISOString())
    expect(cfg.group_by).toBeUndefined()
  })

  it('bar/donut compile to group_by + aggregate sorted desc', () => {
    const cfg = widgetToConfig(draft({
      widget_type: 'bar',
      config: { measure: 'count', group_by: 'service_code' },
    }), NOW)
    expect(cfg.group_by).toEqual(['service_code'])
    expect(cfg.sort).toEqual([{ col: 'value', dir: 'desc' }])
  })

  it('a non-count measure carries its column', () => {
    const cfg = widgetToConfig(draft({
      widget_type: 'kpi',
      config: { measure: 'sum_amount' },
    }), NOW)
    expect(cfg.aggregations).toEqual([{ fn: 'sum', col: 'amount', as: 'value' }])
  })

  it('table uses the source defaults (no aggregate)', () => {
    const cfg = widgetToConfig(draft({ widget_type: 'table', config: {} }), NOW)
    expect(cfg.aggregations).toBeUndefined()
    expect(cfg.group_by).toBeUndefined()
  })

  it('fixed sources ignore measure/group picks and keep only dept filters', () => {
    const cfg = widgetToConfig(draft({
      widget_type: 'table', data_source: 'dept_performance',
      config: { measure: 'count', group_by: 'x', filters: [{ col: 'dept', op: 'eq', value: 'IT' }, { col: 'status', op: 'eq', value: 'new' }] },
    }), NOW)
    expect(cfg.aggregations).toBeUndefined()
    expect(cfg.filters).toEqual([{ col: 'dept', op: 'eq', value: 'IT' }])
  })

  it('"follow dashboard filter" emits no period of its own', () => {
    expect(periodFrom('follow', NOW)).toBeNull()
    const cfg = widgetToConfig(draft({ config: { period: { preset: 'follow' } } }), NOW)
    expect(cfg.period).toBeUndefined()
  })
})

// NOTE: the "every palette combination compiles through the real allowlist
// compiler" round-trip lives in supabase/functions/generate-report/
// builder.parity.test.ts — src/ cannot import the deno-style edge modules.
