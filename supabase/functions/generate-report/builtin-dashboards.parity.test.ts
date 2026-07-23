/**
 * Seed gate for 00089: every widget the migration seeds must (a) use a
 * widget type the dashboard renderer draws today, (b) name an allowlist
 * source, and (c) compile through the real allowlist compiler via the same
 * widgetToConfig the renderer uses — a builtin dashboard can never ship a
 * widget that errors on screen.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_DATA_SOURCES } from './allowlist.ts'
import { compileQuery } from './compiler.ts'
import { previewSupported, widgetToConfig, type WidgetDraft } from '../../../src/features/reports/builderQuery'
import type { WidgetType } from '../../../src/features/reports/builderMeta'

const migration = readFileSync(join(__dirname, '../../migrations/00089_builtin_dashboards.sql'), 'utf8')

interface SeedWidget { dash: string; position: number; type: string; source: string; config: Record<string, unknown>; title: string }

function parseSeeds(): SeedWidget[] {
  const re = /\('([a-z-]+)',\s*(\d+),\s*'(\w+)',\s*'(\w+)',\s*\n\s*'(\{[\s\S]*?\})',\s*\n\s*'([^']*)'/g
  const out: SeedWidget[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(migration))) {
    out.push({ dash: m[1], position: Number(m[2]), type: m[3], source: m[4], config: JSON.parse(m[5]), title: m[6] })
  }
  return out
}

describe('00089 builtin dashboard seeds', () => {
  const seeds = parseSeeds()

  it('seeds the nine widgets across the three dashboards', () => {
    expect(seeds).toHaveLength(9)
    expect(new Set(seeds.map((s) => s.dash))).toEqual(
      new Set(['service-operations', 'assets-and-projects', 'workforce-performance']))
  })

  it('every widget uses a renderable type and an allowlist source', () => {
    for (const s of seeds) {
      expect(previewSupported(s.type as WidgetType), `${s.dash}/${s.title} type ${s.type}`).toBe(true)
      expect(ALL_DATA_SOURCES, `${s.dash}/${s.title} source`).toContain(s.source)
    }
  })

  it('every seeded config compiles through the allowlist compiler', () => {
    for (const s of seeds) {
      const draft: WidgetDraft = {
        widget_type: s.type as WidgetType, data_source: s.source,
        title: s.title, config: s.config as WidgetDraft['config'],
      }
      expect(() => compileQuery(s.source, widgetToConfig(draft, new Date())), `${s.dash}/${s.title}`).not.toThrow()
    }
  })

  it('the employee_performance widget is present — its RLS gate does the hiding', () => {
    expect(seeds.filter((s) => s.source === 'employee_performance')).toHaveLength(1)
  })
})
