/**
 * Curated dashboards (Zone 1). Until the builder ships (branch 5) these are
 * code-defined presets: each picks the default department scope the filter
 * bar opens with — everything else about a dashboard is the shared widget
 * set, filtered at run time. The builder's report_dashboards table will
 * absorb these as builtin rows in the migration branch.
 */

export interface CuratedDashboard {
  slug: string
  name: string
  /** default department filter this dashboard opens scoped to */
  dept: string
  scopeLabel: string
}

export const CURATED_DASHBOARDS: CuratedDashboard[] = [
  { slug: 'it-overview', name: 'IT Service Overview', dept: 'IT', scopeLabel: 'Curated · shared with IT' },
  { slug: 'admin-overview', name: 'Administration Overview', dept: 'ADMIN', scopeLabel: 'Curated · shared with Administration' },
  { slug: 'log-overview', name: 'Logistics Overview', dept: 'LOG', scopeLabel: 'Curated · shared with Logistics' },
  { slug: 'org-overview', name: 'Organisation Overview', dept: 'ALL', scopeLabel: 'Curated · org-wide' },
]

export const DEFAULT_DASHBOARD = CURATED_DASHBOARDS[0]

export const dashboardBySlug = (slug: string | null): CuratedDashboard =>
  CURATED_DASHBOARDS.find((d) => d.slug === slug) ?? DEFAULT_DASHBOARD
