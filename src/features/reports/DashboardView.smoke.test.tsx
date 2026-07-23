/**
 * Render smoke: a saved/builtin board renders its widget chrome from an
 * empty result set (server render skips effects — no network).
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }) }) }),
  },
}))

import { DashboardView } from './DashboardView'

const board = {
  id: 'b1', slug: 'service-operations', name: 'Service Operations', kind: 'builtin' as const,
  visibility: 'org' as const, dept_id: null, owner_id: null, is_active: true, updated_at: '',
}

describe('DashboardView render smoke', () => {
  it('renders the widget grid shell and the action bar note', () => {
    const html = renderToStaticMarkup(<DashboardView board={board} />)
    expect(html).toContain('class="widgets"')
    expect(html).toContain('aria-label="Dashboard actions"')
    expect(html).toContain('saved queries under your own access')
  })
})
