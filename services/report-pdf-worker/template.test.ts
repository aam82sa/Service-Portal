import { describe, expect, it } from 'vitest'
import { escapeHtml, reportHtml } from './template'

const base = {
  title: 'SLA compliance',
  subtitle: 'Jan–Jun 2026',
  columns: ['dept', 'met', 'flag'],
  rows: [
    { dept: 'IT', met: 98, flag: true },
    { dept: 'ADMIN', met: 87, flag: false },
  ],
}

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<b>a&b"c'd</b>`)).toBe('&lt;b&gt;a&amp;b&quot;c&#39;d&lt;/b&gt;')
  })
  it('renders null/undefined as empty', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('reportHtml', () => {
  it('includes the title, subtitle, headers and every row value', () => {
    const html = reportHtml(base)
    expect(html).toContain('<title>SLA compliance</title>')
    expect(html).toContain('SLA compliance')
    expect(html).toContain('Jan–Jun 2026')
    for (const c of base.columns) expect(html).toContain(`<th>${c}</th>`)
    expect(html).toContain('<td>IT</td>')
    expect(html).toContain('<td>98</td>')
    expect(html).toContain('2 rows')
  })

  it('renders booleans as Yes/No', () => {
    const html = reportHtml(base)
    expect(html).toContain('<td>Yes</td>')
    expect(html).toContain('<td>No</td>')
  })

  it('HTML-escapes cell content so report data cannot inject markup', () => {
    const html = reportHtml({ ...base, rows: [{ dept: '<script>alert(1)</script>', met: 0, flag: false }] })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('shows an empty-state row when there are no rows', () => {
    const html = reportHtml({ ...base, rows: [] })
    expect(html).toContain('No data for this report.')
    expect(html).toContain('colspan="3"')
  })

  it('switches to RTL when asked', () => {
    expect(reportHtml({ ...base, direction: 'rtl' })).toContain('<html lang="en" dir="rtl">')
    expect(reportHtml(base)).toContain('<html lang="en" dir="ltr">')
  })

  it('stringifies nested object cells (escaped)', () => {
    const html = reportHtml({ ...base, columns: ['j'], rows: [{ j: { k: '<x>' } }] })
    expect(html).toContain('{&quot;k&quot;:&quot;&lt;x&gt;&quot;}')
  })
})

describe('services hub anatomy', () => {
  const spec = {
    title: 'SLA compliance',
    columns: [
      { key: 'ref', label: 'Ref', format: 'id' as const },
      { key: 'dept', label: 'Department', deptRail: true },
      { key: 'priority', label: 'Priority', chip: 'priority' as const },
      { key: 'sla_met', label: 'SLA met', chip: 'boolean' as const },
      { key: 'breached', label: 'Breached', chip: 'boolean' as const },
      { key: 'amount', label: 'Amount', format: 'number' as const },
    ],
    rows: [
      { ref: 'REQ-1001', dept: 'IT', priority: 'P1', sla_met: true, breached: true, amount: 12500 },
      { ref: 'REQ-1002', dept: 'ADMIN', priority: 'P4', sla_met: false, breached: null, amount: null },
    ],
  }

  it('renders chips: priority tones, Yes/No, Breached, em-dash for null', () => {
    const html = reportHtml(spec)
    expect(html).toContain('>P1</span>')
    expect(html).toContain('>Yes</span>')
    expect(html).toContain('>No</span>')
    expect(html).toContain('>Breached</span>')
    expect(html).toContain('—')
  })

  it('formats numbers with thousands separators and renders ids in mono', () => {
    const html = reportHtml(spec)
    expect(html).toContain('12,500')
    expect(html).toContain('<span class="mono">REQ-1001</span>')
  })

  it('adds the department rail border from the dept color map', () => {
    const html = reportHtml(spec)
    expect(html).toContain('border-left:3px solid #3E6DD8')
    expect(html).toContain('border-left:3px solid #8A5FC9')
  })

  it('renders the KPI band with tone colors', () => {
    const html = reportHtml({ ...spec, kpis: [{ value: '94.2%', label: 'Compliance', tone: 'green' }] })
    expect(html).toContain('94.2%')
    expect(html).toContain('kpi-label')
    expect(html).toContain('#2E9E6B')
  })

  it('renders the bar band scaled to the max value', () => {
    const html = reportHtml({ ...spec, bars: [{ label: 'IT', value: 50, color: '#3E6DD8' }, { label: 'ADMIN', value: 25, color: '#8A5FC9' }] })
    expect(html).toContain('width:100%')
    expect(html).toContain('width:50%')
  })

  it('renders the personal-data banner when flagged (footer is printed by the worker)', () => {
    const html = reportHtml({ ...spec, containsPersonalData: true })
    expect(html).toContain('PERSONAL DATA')
    expect(html).toContain('Do not forward')
  })

  it('renders a totals row and the truncation line', () => {
    const html = reportHtml({ ...spec, totalsRow: { ref: 'Total', amount: 12500 }, rowCountTotal: 120 })
    expect(html).toContain('class="totals"')
    expect(html).toContain('Showing 2 of 120 rows.')
  })

  it('accent rule replaces the legacy gold theme', () => {
    const html = reportHtml(spec)
    expect(html).toContain('#D97757')
    expect(html).not.toContain('#c9a227')
  })
})
