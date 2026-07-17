import { describe, expect, it } from 'vitest'
import { buildPresentation, type ColSpec } from './presentation'

const cols = (p: { columns: ColSpec[] | string[] }) => p.columns as ColSpec[]

describe('buildPresentation — built-in slugs', () => {
  it('request volume: totals, top-dept KPI, dept bars, totals row', () => {
    const p = buildPresentation('request-volume-by-dept', [], [
      { dept: 'IT', status: 'new', count_all: 5 },
      { dept: 'IT', status: 'resolved', count_all: 3 },
      { dept: 'ADMIN', status: 'new', count_all: 2 },
    ])
    expect(p.kpis?.[0]).toEqual({ value: '10', label: 'Total requests' })
    expect(p.kpis?.[1].value).toBe('IT · 8')
    expect(p.bars?.[0]).toEqual({ label: 'IT', value: 8, color: '#3E6DD8' })
    expect(p.totalsRow).toEqual({ dept: 'Total', count_all: 10 })
    expect(cols(p).find((c) => c.key === 'dept')?.deptRail).toBe(true)
  })

  it('sla compliance: compliance %, met/breached/at-risk KPIs, chips', () => {
    const soon = new Date(Date.now() + 3600_000).toISOString()
    const p = buildPresentation('sla-compliance', [], [
      { ref: 'R1', dept: 'IT', priority: 'P1', status: 'resolved', sla_resolution_due: soon, sla_met: true, breached: false },
      { ref: 'R2', dept: 'IT', priority: 'P2', status: 'in_progress', sla_resolution_due: soon, sla_met: false, breached: true },
      { ref: 'R3', dept: 'ADMIN', priority: 'P3', status: 'in_progress', sla_resolution_due: soon, sla_met: false, breached: false },
    ])
    expect(p.kpis?.[0].value).toBe('33.3%')
    expect(p.kpis?.[1]).toMatchObject({ value: '1', label: 'Met' })
    expect(p.kpis?.[2]).toMatchObject({ value: '1', tone: 'red' })
    expect(p.kpis?.[3]).toMatchObject({ value: '1', label: 'At risk (<4h)', tone: 'amber' })
    expect(cols(p).find((c) => c.key === 'sla_met')?.chip).toBe('boolean')
  })

  it('open aging: bucket KPIs, median, and age tones written into rows', () => {
    const p = buildPresentation('open-request-aging', [], [
      { ref: 'R1', age_days: 2 }, { ref: 'R2', age_days: 9 }, { ref: 'R3', age_days: 20 },
    ])
    const labels = p.kpis!.map((k) => k.label)
    expect(labels).toEqual(['0–3 days', '4–7 days', '8–14 days', '15+ days', 'Median age'])
    expect(p.kpis![4].value).toBe('9')
    expect(p.rows[1]._tone_age).toBe('amber')
    expect(p.rows[2]._tone_age).toBe('red')
    expect(cols(p).find((c) => c.key === 'age_days')?.toneKey).toBe('_tone_age')
  })

  it('asset inventory: status KPIs + totals', () => {
    const p = buildPresentation('asset-inventory', [], [
      { category: 'laptop', status: 'assigned', count_all: 6 },
      { category: 'laptop', status: 'in_stock', count_all: 3 },
      { category: 'monitor', status: 'retired', count_all: 1 },
    ])
    expect(p.kpis?.map((k) => k.value)).toEqual(['10', '6', '3', '1'])
    expect(p.totalsRow).toEqual({ category: 'Total', count_all: 10 })
  })

  it('department performance: SLA tone thresholds 92/85', () => {
    const p = buildPresentation('department-performance', [], [
      { dept: 'IT', sla_compliance_pct: 95 },
      { dept: 'ADMIN', sla_compliance_pct: 88 },
      { dept: 'PROC', sla_compliance_pct: 70 },
    ])
    expect(p.rows.map((r) => r._tone_sla)).toEqual(['green', 'amber', 'red'])
    expect(p.containsPersonalData).toBeUndefined()
  })

  it('employee performance is flagged as personal data', () => {
    const p = buildPresentation('employee-performance', [], [{ agent: 'A', dept: 'IT', sla_hit_pct: 90 }])
    expect(p.containsPersonalData).toBe(true)
    expect(p.rows[0]._tone_sla).toBe('amber')
  })

  it('pmo status: on-track/at-risk/delayed KPIs + scope bars', () => {
    const p = buildPresentation('pmo-project-status', [], [
      { status: 'on_track', department_scope: 'IT', count_all: 3 },
      { status: 'at_risk', department_scope: 'ADMIN', count_all: 1 },
      { status: 'delayed', department_scope: 'IT', count_all: 1 },
    ])
    expect(p.kpis?.map((k) => k.value)).toEqual(['5', '3', '1', '1'])
    expect(p.bars?.[0].label).toBe('IT')
  })

  it('unknown slugs fall back to plain columns', () => {
    const p = buildPresentation('my-custom-report', ['a', 'b'], [{ a: 1, b: 2 }])
    expect(p.columns).toEqual(['a', 'b'])
    expect(p.kpis).toBeUndefined()
  })
})
