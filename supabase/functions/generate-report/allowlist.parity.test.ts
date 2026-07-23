/**
 * Source-vocabulary parity gate (REPORTING v2 branch 1) — the allowlist module
 * and the report_definitions CHECK constraint are ONE list. v1 let them
 * diverge: the CHECK accepted pmo_evm/pmo_risks/audit while the compiler knew
 * none of them, so a definition could be inserted and then fail with a
 * guaranteed compile error. Any future drift fails here, in CI.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_DATA_SOURCES, FIXED_SOURCES, SOURCES } from './allowlist'

function checkConstraintSources(): string[] {
  const sql = readFileSync(
    join(__dirname, '..', '..', 'migrations', '00086_report_source_parity.sql'),
    'utf8',
  )
  const m = sql.match(/check \(data_source in \(([\s\S]*?)\)\)/)
  if (!m) throw new Error('data_source CHECK not found in 00086')
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
}

describe('report data sources — allowlist ⇄ CHECK parity', () => {
  it('the CHECK constraint and the allowlist module are the same list', () => {
    expect(ALL_DATA_SOURCES).toEqual(checkConstraintSources())
  })

  it('every free-column source and fixed source is in the canonical list', () => {
    for (const k of Object.keys(SOURCES)) expect(ALL_DATA_SOURCES).toContain(k)
    for (const k of FIXED_SOURCES) expect(ALL_DATA_SOURCES).toContain(k)
  })

  it('pmo_evm stays out — no tabular EVM source exists', () => {
    expect(ALL_DATA_SOURCES).not.toContain('pmo_evm')
  })
})
