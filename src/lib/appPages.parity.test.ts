/**
 * The CI parity gate (ACCESS1 branch 4) — the deliverable that proves the
 * page-access fix: the router's page ids, the frontend registry and the
 * database seed are ONE vocabulary. If any of the three drifts, this fails —
 * a CI error, not a silent fallback to hardcoded role checks.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_PAGES, DETAIL_PAGES, NAV_PAGES } from './appPages'

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8')

/** the router's `type Page = 'a' | 'b' | …` ids, parsed from App.tsx */
function routerPageIds(): string[] {
  const src = read('src/App.tsx')
  const m = src.match(/type Page =\s*([^\n]+)/)
  if (!m) throw new Error('type Page not found in App.tsx')
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
}

/** the app_pages keys seeded by migration 00082 */
function seededPageKeys(): string[] {
  const sql = read('supabase/migrations/00082_role_groups_schema.sql')
  const inserts = sql.match(/insert into app_pages[\s\S]*?on conflict/g) ?? []
  return inserts.flatMap((block) =>
    [...block.matchAll(/^\s*\('([a-z_]+)',/gm)].map((x) => x[1]),
  )
}

describe('app pages — router ⇄ registry ⇄ seed parity', () => {
  it('every router page id has a registry entry, and vice versa', () => {
    const router = routerPageIds().sort()
    const nav = NAV_PAGES.map((p) => p.key).sort()
    expect(nav).toEqual(router)
  })

  it('registry routes match the router PATH map', () => {
    const src = read('src/App.tsx')
    const m = src.match(/const PATH: Record<Page, string> = \{([\s\S]*?)\n\}/)
    if (!m) throw new Error('PATH map not found in App.tsx')
    const paths = Object.fromEntries(
      [...m[1].matchAll(/([a-z_]+):\s*'([^']*)'/g)].map((x) => [x[1], x[2]]),
    )
    for (const p of NAV_PAGES) {
      expect(p.route, `route for '${p.key}'`).toBe(paths[p.key])
    }
  })

  it('every registry entry is seeded in app_pages, and vice versa', () => {
    const seeded = seededPageKeys().sort()
    expect(APP_PAGES.map((p) => p.key).sort()).toEqual(seeded)
  })

  it('detail pages point at a real parent page', () => {
    const navKeys = new Set(NAV_PAGES.map((p) => p.key))
    for (const d of DETAIL_PAGES) {
      expect(d.parentKey, `${d.key} needs a parent`).toBeDefined()
      expect(navKeys.has(d.parentKey!), `${d.key}'s parent ${d.parentKey} is not a router page`).toBe(true)
    }
  })

  it('registry keys are unique', () => {
    const keys = APP_PAGES.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('the legacy page_access vocabulary drift cannot recur: dead keys are absent', () => {
    // 'mywork', 'queue' and 'approvals' were page_access rows for routes that
    // no longer exist — the exact drift that broke the old model.
    const keys = new Set(APP_PAGES.map((p) => p.key))
    for (const dead of ['mywork', 'queue', 'approvals']) {
      expect(keys.has(dead), `dead page id '${dead}' must not re-enter the registry`).toBe(false)
    }
  })
})
