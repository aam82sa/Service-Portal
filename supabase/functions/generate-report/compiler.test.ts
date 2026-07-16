import { describe, expect, it } from 'vitest'
import { compileQuery, CompileError } from './compiler'

describe('compileQuery — free-column sources', () => {
  it('emits the default column set for requests', () => {
    const { sql, columns } = compileQuery('requests', {})
    expect(sql).toBe(
      'select r.ref as "ref", r.title as "title", r.dept::text as "dept", ' +
        'r.status::text as "status", r.priority::text as "priority", r.created_at as "created_at" ' +
        'from requests r',
    )
    expect(columns).toEqual(['ref', 'title', 'dept', 'status', 'priority', 'created_at'])
  })

  it('projects only the requested allowlisted columns', () => {
    const { sql, columns } = compileQuery('requests', { columns: ['ref', 'amount', 'age_days'] })
    expect(sql).toContain('r.ref as "ref"')
    expect(sql).toContain('r.amount as "amount"')
    expect(sql).toContain('round(extract(epoch from (now() - r.created_at)) / 86400)::int as "age_days"')
    expect(columns).toEqual(['ref', 'amount', 'age_days'])
  })

  it('builds a grouped aggregate with count(*)', () => {
    const { sql, columns } = compileQuery('requests', {
      group_by: ['dept', 'status'],
      aggregations: [{ fn: 'count' }],
    })
    expect(sql).toBe(
      'select r.dept::text as "dept", r.status::text as "status", count(*) as "count_all" ' +
        'from requests r group by r.dept::text, r.status::text',
    )
    expect(columns).toEqual(['dept', 'status', 'count_all'])
  })

  it('supports aggregations over a column with an alias and sort', () => {
    const { sql } = compileQuery('requests', {
      group_by: ['dept'],
      aggregations: [{ fn: 'sum', col: 'amount', as: 'Total Spend' }],
      sort: [{ col: 'total_spend', dir: 'desc' }],
    })
    expect(sql).toContain('sum(r.amount) as "total_spend"')
    expect(sql).toContain('group by r.dept::text')
    expect(sql).toContain('order by "total_spend" desc')
  })
})

describe('compileQuery — filters and value escaping', () => {
  it('renders eq/in/between/null operators with typed literals', () => {
    const { sql } = compileQuery('requests', {
      filters: [
        { col: 'dept', op: 'eq', value: 'IT' },
        { col: 'status', op: 'in', value: ['open', 'resolved'] },
        { col: 'amount', op: 'between', value: [100, 500] },
      ],
      period: { from: '2026-01-01', to: '2026-06-30' },
    })
    expect(sql).toContain("r.dept::text = 'IT'")
    expect(sql).toContain("r.status::text in ('open', 'resolved')")
    expect(sql).toContain('r.amount between 100 and 500')
    expect(sql).toContain("r.created_at >= '2026-01-01'::timestamptz")
    expect(sql).toContain("r.created_at <= '2026-06-30'::timestamptz")
  })

  it('rejects an identifier value carrying SQL punctuation', () => {
    expect(() =>
      compileQuery('requests', { filters: [{ col: 'dept', op: 'eq', value: "IT'); drop table requests;--" }] }),
    ).toThrow(CompileError)
  })

  it('rejects a non-numeric value on a number column', () => {
    expect(() =>
      compileQuery('requests', { filters: [{ col: 'amount', op: 'gt', value: '10 or 1=1' }] }),
    ).toThrow(/invalid numeric/)
  })

  it('rejects a malformed date', () => {
    expect(() =>
      compileQuery('requests', { filters: [{ col: 'created_at', op: 'gte', value: 'yesterday' }] }),
    ).toThrow(/invalid date/)
  })
})

describe('compileQuery — allowlist rejection', () => {
  it('rejects an unknown data source', () => {
    expect(() => compileQuery('secrets', {})).toThrow(/unknown data source/)
  })
  it('rejects a column not in the source allowlist', () => {
    expect(() => compileQuery('requests', { columns: ['ref', 'password'] })).toThrow(/not selectable/)
  })
  it('rejects a filter on a non-filterable column', () => {
    expect(() => compileQuery('requests', { filters: [{ col: 'title', op: 'eq', value: 'x' }] })).toThrow(
      /not filterable/,
    )
  })
  it('rejects grouping by a non-groupable column', () => {
    expect(() => compileQuery('requests', { group_by: ['title'] })).toThrow(/not groupable/)
  })
  it('rejects an unknown aggregation function', () => {
    expect(() =>
      compileQuery('requests', { group_by: ['dept'], aggregations: [{ fn: 'median' as never, col: 'amount' }] }),
    ).toThrow(/unknown aggregation/)
  })
  it('rejects sorting by a column not in the output', () => {
    expect(() => compileQuery('requests', { columns: ['ref'], sort: [{ col: 'amount' }] })).toThrow(
      /cannot sort by/,
    )
  })
})

describe('compileQuery — every free source has a sane default', () => {
  it.each([
    ['sla', 'from requests r'],
    ['assets', 'from assets a'],
    ['letters', 'from letters l'],
    ['pmo_projects', 'from projects p'],
  ])('%s defaults compile', (source, fromClause) => {
    const { sql, columns } = compileQuery(source, {})
    expect(sql.startsWith('select ')).toBe(true)
    expect(sql).toContain(fromClause)
    expect(columns.length).toBeGreaterThan(0)
  })
})

describe('compileQuery — fixed performance sources', () => {
  it('compiles dept_performance with a period window', () => {
    const { sql, columns } = compileQuery('dept_performance', { period: { from: '2026-01-01', to: '2026-03-31' } })
    expect(sql.startsWith('select r.dept::text as "dept"')).toBe(true)
    expect(sql).toContain('from requests r where')
    expect(sql).toContain("r.created_at >= '2026-01-01'::timestamptz")
    expect(sql).toContain('group by r.dept order by r.dept')
    expect(columns).toContain('sla_compliance_pct')
  })

  it('compiles employee_performance joining profiles', () => {
    const { sql, columns } = compileQuery('employee_performance', {})
    expect(sql).toContain('from requests r join profiles p on p.id = r.assignee_id')
    expect(sql).toContain('group by p.display_name, r.dept')
    expect(columns).toEqual(['agent', 'dept', 'assigned', 'resolved', 'open_load', 'sla_hit_pct', 'avg_resolution_hours', 'reopens'])
  })

  it('accepts a dept filter but rejects any other filter on fixed sources', () => {
    expect(compileQuery('dept_performance', { filters: [{ col: 'dept', value: 'IT' }] }).sql).toContain(
      "r.dept::text in ('IT')",
    )
    expect(() => compileQuery('dept_performance', { filters: [{ col: 'status', value: 'open' }] })).toThrow(
      /filter not allowed/,
    )
  })
})

describe('compileQuery — output is a single read-only statement', () => {
  it('never contains a semicolon and always starts with select', () => {
    for (const src of ['requests', 'sla', 'assets', 'letters', 'pmo_projects', 'dept_performance', 'employee_performance']) {
      const { sql } = compileQuery(src, {})
      expect(sql).not.toContain(';')
      expect(sql.trimStart().toLowerCase().startsWith('select')).toBe(true)
    }
  })
})
