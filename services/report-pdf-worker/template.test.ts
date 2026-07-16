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
