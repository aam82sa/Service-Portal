/**
 * The canonical page registry (ACCESS1 branch 4) — ONE vocabulary for the
 * router, the access model and the database.
 *
 * page_access failed because its row keys and the router's page ids were two
 * different vocabularies (rows for routes that no longer existed, nav pages
 * with no row at all). This list is the single source of truth on the
 * frontend; appPages.parity.test.ts asserts it stays in lockstep with BOTH
 * the router's Page type (App.tsx) and the app_pages seed (migration 00082),
 * so any drift is a CI failure, not a silent fallback.
 */

export interface AppPage {
  key: string
  route: string
  /** detail pages live under their section and inherit its visibility */
  parentKey?: string
}

/** top-level pages — keys AND routes must match App.tsx (type Page + PATH) */
export const NAV_PAGES: AppPage[] = [
  { key: 'home', route: '/' },
  { key: 'portal', route: '/new' },
  { key: 'requests', route: '/requests' },
  { key: 'work', route: '/work' },
  { key: 'pmo', route: '/projects' },
  { key: 'letters', route: '/letters' },
  { key: 'insights', route: '/insights' },
  { key: 'reports', route: '/reports' },
  { key: 'assets', route: '/assets' },
  { key: 'admin', route: '/admin' },
  { key: 'pmoadmin', route: '/pmo-admin' },
]

/** detail sub-pages the old model could never gate */
export const DETAIL_PAGES: AppPage[] = [
  { key: 'request_detail', route: '/requests/:id', parentKey: 'requests' },
  { key: 'project_detail', route: '/projects/:id', parentKey: 'pmo' },
]

export const APP_PAGES: AppPage[] = [...NAV_PAGES, ...DETAIL_PAGES]

export const APP_PAGE_KEYS = APP_PAGES.map((p) => p.key)
