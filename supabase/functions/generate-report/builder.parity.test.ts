/**
 * Three vocabularies must never drift: the builder's client metadata, the
 * edge allowlist (the compiler's ground truth), and the 00088 CHECK
 * constraints. This test imports/parses all three and asserts equality —
 * the same gate pattern as appPages and the 00086 source parity.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_DATA_SOURCES, FIXED_SOURCES, SOURCES } from './allowlist.ts'
import { SOURCE_META, WIDGET_TYPES } from '../../../src/features/reports/builderMeta'

const migration = readFileSync(
  join(__dirname, '../../migrations/00088_report_dashboards.sql'), 'utf8')

const parseCheck = (column: string): string[] => {
  const m = migration.match(new RegExp(`check \\(${column} in \\(([\\s\\S]*?)\\)\\)`))
  if (!m) throw new Error(`no CHECK found for ${column} in 00088`)
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort()
}

describe('builder metadata parity', () => {
  it('the palette lists exactly the allowlist sources', () => {
    expect(SOURCE_META.map((s) => s.key).sort()).toEqual(ALL_DATA_SOURCES)
  })

  it('00088 widget data_source CHECK equals the allowlist vocabulary', () => {
    expect(parseCheck('data_source')).toEqual(ALL_DATA_SOURCES)
  })

  it('00088 widget_type CHECK equals the palette widget types', () => {
    expect(parseCheck('widget_type')).toEqual([...WIDGET_TYPES].sort())
  })

  it('every group-by option is allowlist-groupable and every measure column selectable', () => {
    for (const meta of SOURCE_META) {
      if (meta.fixed) {
        expect(FIXED_SOURCES.has(meta.key)).toBe(true)
        continue
      }
      const spec = SOURCES[meta.key]
      expect(spec, meta.key).toBeDefined()
      for (const g of meta.groupable) {
        expect(spec.groupable, `${meta.key}.${g.key}`).toContain(g.key)
      }
      for (const m of meta.measures) {
        if (m.col) expect(spec.columns[m.col], `${meta.key} measure ${m.key}`).toBeDefined()
      }
      for (const f of meta.filterable ?? []) {
        expect(spec.filterable[f], `${meta.key} filterable ${f}`).toBeDefined()
      }
      if (meta.periodCol) {
        expect(spec.filterable[meta.periodCol], `${meta.key} periodCol`).toBe('date')
      } else {
        // periodCol: null must mean the source really has no created_at date filter
        expect(spec.filterable['created_at']).toBeUndefined()
      }
      expect(meta.measures.length).toBeGreaterThan(0)
      expect(meta.groupable.length).toBeGreaterThan(0)
    }
  })

  it('employee performance is the one personal-data source', () => {
    expect(SOURCE_META.filter((s) => s.personalData).map((s) => s.key)).toEqual(['employee_performance'])
  })
})

/**
 * Round-trip: every widget the palette can produce compiles through the real
 * allowlist compiler — a builder widget can never be a guaranteed compile
 * error. (Lives here, not in src/: the edge modules are deno-style imports.)
 */
import { compileQuery } from './compiler.ts'
import { widgetToConfig, type WidgetDraft } from '../../../src/features/reports/builderQuery'

describe('every palette combination compiles', () => {
  const NOW = new Date('2026-07-22T12:00:00Z')
  it('source × preview widget type × every measure/group option never throws', () => {
    for (const meta of SOURCE_META) {
      for (const t of ['kpi', 'bar', 'donut', 'table'] as const) {
        if (meta.fixed && t !== 'table') continue // fixed sources render as tables
        const groups = meta.fixed ? [undefined] : meta.groupable.map((g) => g.key)
        const measures = meta.fixed ? [undefined] : meta.measures.map((m) => m.key)
        for (const g of groups) {
          for (const m of measures) {
            // the default new-widget filters ride along — sources that can't
            // bind them (e.g. audit has no status) must drop, not throw
            const w: WidgetDraft = {
              widget_type: t, data_source: meta.key, title: 't',
              config: {
                measure: m, group_by: g, period: { preset: 'last30' },
                filters: [{ col: 'status', op: 'neq', value: 'cancelled' }, { col: 'dept', op: 'eq', value: 'IT' }],
              },
            }
            const cfg = widgetToConfig(w, NOW)
            expect(() => compileQuery(meta.key, cfg), `${meta.key}/${t}/${g}/${m}`).not.toThrow()
          }
        }
      }
    }
  })
})
