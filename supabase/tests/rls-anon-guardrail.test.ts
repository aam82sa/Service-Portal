/**
 * S0 Harden — Branch 1 guardrail (regression gate).
 *
 * The 2026-07-12 security review found (C-2) that migration 00045 granted ALL
 * privileges on the whole `public` schema to `anon`, and that
 * `pmo_committee_members` shipped without RLS enabled — together an
 * unauthenticated read/write hole. Migration 00060 closed it: it revoked the
 * anon grants (and the anon default privileges) and enabled RLS on the last
 * table missing it.
 *
 * This test freezes that state so the class of bug cannot silently return. It
 * is a pure static analysis of the migration SQL — no database connection — so
 * it runs inside the normal unit-test job and gates every PR:
 *
 *   1. Every table created in schema `public` (and not later dropped) has an
 *      `enable row level security` somewhere in the migration set.
 *   2. `anon` is stripped of blanket table/sequence/routine privileges and of
 *      the schema default privileges, and nothing re-grants them afterwards.
 *
 * If you add a table, enable RLS on it in the same migration. If you ever need
 * anon to reach the Data API, that is a deliberate design change — update this
 * test in the same PR so the decision is reviewed, never drifted into.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/** Strip `-- line` and `/* block *\/` comments so commented-out SQL never matches. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

interface Migration {
  name: string
  sql: string
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: stripComments(readFileSync(join(MIGRATIONS_DIR, name), 'utf8')) }))
}

const ident = '(?:public\\.)?"?([a-z_][a-z_0-9]*)"?'

function matchAll(sql: string, re: RegExp): string[] {
  return [...sql.matchAll(re)].map((m) => m[1].toLowerCase())
}

const migrations = loadMigrations()
const allSql = migrations.map((m) => m.sql).join('\n')

describe('S0 guardrail — RLS coverage', () => {
  const created = new Set<string>()
  const dropped = new Set<string>()
  const rlsEnabled = new Set<string>()

  for (const { sql } of migrations) {
    for (const t of matchAll(sql, new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${ident}`, 'gi'))) created.add(t)
    for (const t of matchAll(sql, new RegExp(`drop\\s+table\\s+(?:if\\s+exists\\s+)?${ident}`, 'gi'))) dropped.add(t)
    for (const t of matchAll(sql, new RegExp(`alter\\s+table\\s+(?:only\\s+)?${ident}\\s+enable\\s+row\\s+level\\s+security`, 'gi'))) rlsEnabled.add(t)
  }

  it('found a non-trivial set of tables (parser sanity)', () => {
    expect(created.size).toBeGreaterThan(50)
  })

  it('every created public table (not later dropped) has RLS enabled', () => {
    const live = [...created].filter((t) => !dropped.has(t)).sort()
    const missing = live.filter((t) => !rlsEnabled.has(t))
    expect(missing, `tables missing "enable row level security": ${missing.join(', ')}`).toEqual([])
  })

  it('pmo_committee_members specifically has RLS (the C-2 finding)', () => {
    expect(rlsEnabled.has('pmo_committee_members')).toBe(true)
  })
})

describe('S0 guardrail — anon holds no Data API privileges', () => {
  const grantIndexes = (kind: string) =>
    migrations.flatMap((m, i) =>
      new RegExp(`grant\\s+[^;]*\\son\\s+all\\s+${kind}\\s+in\\s+schema\\s+public\\s+to\\s+[^;]*\\banon\\b`, 'i').test(m.sql) ? [i] : [],
    )
  const revokeIndexes = (kind: string) =>
    migrations.flatMap((m, i) =>
      new RegExp(`revoke\\s+[^;]*\\son\\s+all\\s+${kind}\\s+in\\s+schema\\s+public\\s+from\\s+[^;]*\\banon\\b`, 'i').test(m.sql) ? [i] : [],
    )

  for (const kind of ['tables', 'sequences', 'routines']) {
    it(`anon's blanket ${kind} grant is revoked and not re-granted`, () => {
      const lastRevoke = Math.max(-1, ...revokeIndexes(kind))
      expect(lastRevoke, `expected a "revoke all ... on all ${kind} ... from anon"`).toBeGreaterThanOrEqual(0)
      const grantsAfter = grantIndexes(kind).filter((i) => i > lastRevoke)
      const names = grantsAfter.map((i) => migrations[i].name)
      expect(grantsAfter, `${kind} re-granted to anon after revoke in: ${names.join(', ')}`).toEqual([])
    })
  }

  it('anon is removed from schema default privileges (future objects)', () => {
    for (const kind of ['tables', 'sequences', 'routines']) {
      const re = new RegExp(`alter\\s+default\\s+privileges\\s+in\\s+schema\\s+public\\s+revoke\\s+[^;]*\\son\\s+${kind}\\s+from\\s+[^;]*\\banon\\b`, 'i')
      expect(re.test(allSql), `expected default privileges on ${kind} revoked from anon`).toBe(true)
    }
  })
})
