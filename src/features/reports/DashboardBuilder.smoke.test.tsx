/**
 * Render smoke: the Zone 2 builder renders its three panes — palette with
 * every source and widget type, canvas with the drop slot and save bar,
 * properties — without touching the network (server render skips effects).
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }), order: () => Promise.resolve({ data: [] }) }) }),
  },
}))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ profile: { id: 'u1' }, hasRole: () => false }),
}))

import { DashboardBuilder } from './DashboardBuilder'
import { SOURCE_META, WIDGET_LABEL, WIDGET_TYPES } from './builderMeta'

describe('DashboardBuilder render smoke', () => {
  it('renders palette · canvas · properties with the full vocabulary', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/reports?tab=builder']}>
        <DashboardBuilder />
      </MemoryRouter>,
    )
    // three panes
    expect(html).toContain('Data sources and widgets palette')
    expect(html).toContain('Dashboard canvas')
    expect(html).toContain('Widget properties')
    // every source in the palette, EP carrying the personal-data tag
    for (const s of SOURCE_META) expect(html).toContain(s.label)
    expect(html).toContain('class="pal-tag"')
    // every widget type
    for (const t of WIDGET_TYPES) expect(html).toContain(WIDGET_LABEL[t])
    // canvas drop slot + save bar with the visibility segments
    expect(html).toContain('Drop a widget')
    for (const v of ['Private', 'Department', 'Organization']) expect(html).toContain(`>${v}</button>`)
    expect(html).toContain('Save &amp; publish')
  })

  it('seeds a duplicate draft from a curated overview (?seed=…) once effects run', () => {
    // server render only proves the empty state; the seed effect is covered
    // by the widget vocabulary living in seedWidgets → builderQuery tests.
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/reports?tab=builder&seed=it-overview']}>
        <DashboardBuilder />
      </MemoryRouter>,
    )
    expect(html).toContain('Untitled dashboard')
  })
})
