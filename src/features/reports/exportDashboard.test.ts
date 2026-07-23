/**
 * Pure parts of the dashboard→document bridge: one stable slug per
 * dashboard per owner (the definition is rewritten, never duplicated), and
 * a subtitle that names the applied filters on the artifact.
 */
import { describe, expect, it } from 'vitest'
import { exportSlug, exportSubtitle } from './exportDashboard'
import { DEFAULT_DASHBOARD } from './dashboards'

describe('exportSlug', () => {
  it('is stable per dashboard × owner', () => {
    expect(exportSlug('it-overview', '12345678-aaaa')).toBe('export-it-overview-12345678')
    expect(exportSlug('it-overview', '12345678-bbbb')).toBe('export-it-overview-12345678')
    expect(exportSlug('org-overview', '87654321-aaaa')).toBe('export-org-overview-87654321')
  })
})

describe('exportSubtitle', () => {
  it('names the applied filters so the artifact is self-describing', () => {
    const s = exportSubtitle(DEFAULT_DASHBOARD, {
      dash: 'it-overview', period: 'last7', dept: 'IT', priority: 'P1', status: 'open',
    })
    expect(s).toBe('IT Service Overview · Last 7 days · IT · P1 · open')
  })

  it('"all" status reads as the exclusion it is', () => {
    const s = exportSubtitle(DEFAULT_DASHBOARD, {
      dash: 'it-overview', period: 'last30', dept: 'ALL', priority: 'ALL', status: 'all',
    })
    expect(s).toBe('IT Service Overview · Last 30 days · excl. cancelled')
  })
})
