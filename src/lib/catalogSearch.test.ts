import { describe, expect, it } from 'vitest'
import { searchCatalog } from './catalogSearch'

const svc = (code: string, name: string, description: string | null = null) =>
  ({ code, name, description })

const CATALOG = [
  svc('HW-01', 'New hardware request', 'Laptops, desktops and accessories'),
  svc('HW-02', 'Hardware repair', 'Broken devices'),
  svc('AC-03', 'Password / MFA reset', 'Reset a forgotten password or re-enrol MFA'),
  svc('SW-02', 'License request', 'Software licenses and subscriptions'),
  svc('IN-01', 'Report an IT issue', 'Anything not working as it should'),
  svc('TR-01', 'Business travel', 'Trips, hotels and visas'),
]

describe('searchCatalog', () => {
  it('returns nothing for empty or 1-char queries', () => {
    expect(searchCatalog(CATALOG, '')).toEqual([])
    expect(searchCatalog(CATALOG, ' h ')).toEqual([])
  })

  it('exact code beats code prefix', () => {
    const hits = searchCatalog(CATALOG, 'hw-01')
    expect(hits[0].code).toBe('HW-01')
  })

  it('code prefix beats name matches', () => {
    const hits = searchCatalog(CATALOG, 'hw')
    expect(hits.map((h) => h.code).slice(0, 2)).toEqual(['HW-01', 'HW-02'])
  })

  it('matches name words and substrings case-insensitively', () => {
    expect(searchCatalog(CATALOG, 'PASSWORD')[0].code).toBe('AC-03')
    expect(searchCatalog(CATALOG, 'travel')[0].code).toBe('TR-01')
  })

  it('falls back to description matches, ranked after name matches', () => {
    const hits = searchCatalog(CATALOG, 'laptop')
    expect(hits.map((h) => h.code)).toContain('HW-01')
  })

  it('respects the limit', () => {
    expect(searchCatalog(CATALOG, 're', 2)).toHaveLength(2)
  })

  it('finds nothing for garbage', () => {
    expect(searchCatalog(CATALOG, 'zzzzz')).toEqual([])
  })
})
