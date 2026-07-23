/**
 * Render smoke: the Zone 1 dashboard renders its full chrome — filter bar,
 * four KPI cards, all four widgets, action bar — from an empty result set
 * (server render skips effects, so no network is touched).
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: () => Promise.resolve({ data: null, error: null }) } },
}))

import { AnalyticsDashboard } from './AnalyticsDashboard'

describe('AnalyticsDashboard render smoke', () => {
  it('renders filter bar, KPI row, the 2×2 widget grid and the action bar', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/reports?tab=analytics&dash=it-overview']}>
        <AnalyticsDashboard />
      </MemoryRouter>,
    )
    // filter bar with the reference's four run-time filters + applied chips
    expect(html).toContain('Run-time filters')
    for (const lbl of ['Period', 'Department', 'Priority', 'Status']) expect(html).toContain(`>${lbl}</span>`)
    expect(html).toContain('class="fchip"')
    // dashboard picker scoped to IT by default
    expect(html).toContain('IT Service Overview')
    expect(html).toContain('Curated · shared with IT')
    // four KPI cards with sparklines
    expect(html.match(/class="kpi"/g)).toHaveLength(4)
    expect(html.match(/class="spark"/g)).toHaveLength(4)
    // the 2×2 widget grid
    for (const t of ['Requests created vs resolved', 'Volume by service', 'By priority', 'SLA met vs breached']) {
      expect(html).toContain(t)
    }
    expect(html.match(/class="widget"/g)).toHaveLength(4)
    // no drill open by default; action bar present
    expect(html).not.toContain('Underlying records')
    expect(html).toContain('aria-label="Dashboard actions"')
  })

  it('reads filters from the URL (shareable filtered views)', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/reports?tab=analytics&dash=admin-overview&period=last7&priority=P1&status=open']}>
        <AnalyticsDashboard />
      </MemoryRouter>,
    )
    expect(html).toContain('Administration Overview')
    // applied chips reflect the URL state
    expect(html).toContain('Last 7 days')
    expect(html).toContain('>P1<')
    expect(html).toContain('Open only')
  })
})
