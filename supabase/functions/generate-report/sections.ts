/**
 * Dashboard document exports. An export definition may carry
 * `config.sections` — one entry per widget: a title, a presentation kind,
 * and the widget's compiled-config QUERY (never values: every run — manual
 * or scheduled — recomputes under the owner's RLS at run time). Each query
 * still goes through the allowlist compiler and report_fetch_rows, so a
 * dashboard export has exactly the same security envelope as a tabular one.
 */

import { CompileError, compileQuery, type ReportConfig } from './compiler.ts'

export type SectionKind = 'kpi' | 'bar' | 'table'

export interface DashboardSection {
  title: string
  kind: SectionKind
  source: string
  query: ReportConfig
}

export interface CompiledSection {
  title: string
  kind: SectionKind
  sql: string
  columns: string[]
}

const KINDS = new Set<string>(['kpi', 'bar', 'table'])
const MAX_SECTIONS = 12

/**
 * Read `sections` out of an (already params-merged) config. Returns null
 * when this is a plain tabular definition; throws CompileError on a
 * malformed sections payload — the run should fail loudly, not fall back
 * to rendering something else.
 */
export function parseSections(config: Record<string, unknown>): DashboardSection[] | null {
  const raw = config['sections']
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw) || raw.length === 0) throw new CompileError('sections must be a non-empty array')
  if (raw.length > MAX_SECTIONS) throw new CompileError(`too many sections (max ${MAX_SECTIONS})`)
  return raw.map((s, i) => {
    const sec = s as Partial<DashboardSection>
    const title = String(sec.title ?? '').trim()
    if (!title || title.length > 80) throw new CompileError(`section ${i + 1}: title must be 1-80 characters`)
    if (!KINDS.has(String(sec.kind))) throw new CompileError(`section ${i + 1}: unknown kind ${String(sec.kind)}`)
    if (typeof sec.source !== 'string') throw new CompileError(`section ${i + 1}: missing source`)
    return {
      title,
      kind: sec.kind as SectionKind,
      source: sec.source,
      query: (sec.query ?? {}) as ReportConfig,
    }
  })
}

/** compile every section through the allowlist compiler (throws CompileError) */
export function compileSections(sections: DashboardSection[]): CompiledSection[] {
  return sections.map((s) => {
    const { sql, columns } = compileQuery(s.source, s.query)
    return { title: s.title, kind: s.kind, sql, columns }
  })
}
