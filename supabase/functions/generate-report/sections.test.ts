import { describe, expect, it } from 'vitest'
import { compileSections, parseSections } from './sections'
import { CompileError } from './compiler'

describe('parseSections', () => {
  it('returns null for a plain tabular definition', () => {
    expect(parseSections({ columns: ['ref'] })).toBeNull()
    expect(parseSections({})).toBeNull()
  })

  it('parses a dashboard document config', () => {
    const secs = parseSections({
      sections: [
        { title: 'Open', kind: 'kpi', source: 'requests', query: { aggregations: [{ fn: 'count', as: 'value' }] } },
        { title: 'By service', kind: 'bar', source: 'requests', query: { group_by: ['service_code'], aggregations: [{ fn: 'count', as: 'value' }] } },
      ],
    })
    expect(secs).toHaveLength(2)
    expect(secs![0].kind).toBe('kpi')
    expect(secs![1].source).toBe('requests')
  })

  it('rejects malformed sections loudly', () => {
    expect(() => parseSections({ sections: [] })).toThrow(CompileError)
    expect(() => parseSections({ sections: [{ title: 'x', kind: 'pie', source: 'requests' }] })).toThrow(/unknown kind/)
    expect(() => parseSections({ sections: [{ title: '', kind: 'kpi', source: 'requests' }] })).toThrow(/title/)
    expect(() => parseSections({ sections: [{ title: 'x', kind: 'kpi' }] })).toThrow(/missing source/)
  })
})

describe('compileSections', () => {
  it('compiles each section through the allowlist compiler', () => {
    const compiled = compileSections([
      { title: 'Open', kind: 'kpi', source: 'requests', query: { aggregations: [{ fn: 'count', as: 'value' }] } },
      { title: 'By service', kind: 'bar', source: 'requests', query: { group_by: ['service_code'], aggregations: [{ fn: 'count', as: 'value' }], sort: [{ col: 'value', dir: 'desc' }] } },
      { title: 'Records', kind: 'table', source: 'requests', query: { columns: ['ref', 'dept', 'status'] } },
    ])
    expect(compiled[0].sql).toContain('count(*) as "value"')
    expect(compiled[1].sql).toContain('group by s.code')
    expect(compiled[1].columns).toEqual(['service_code', 'value'])
    expect(compiled[2].columns).toEqual(['ref', 'dept', 'status'])
  })

  it('propagates a CompileError for an illegal section query', () => {
    expect(() => compileSections([
      { title: 'bad', kind: 'table', source: 'requests', query: { columns: ['ssn'] } },
    ])).toThrow(CompileError)
  })
})
