/**
 * Page-visibility resolution (ACCESS1 branch 5) — the pure logic behind
 * canSee(), replacing page_access's role arrays and every hardcoded fallback.
 *
 * A page is visible when a RELEVANT group grants it:
 *   - a group the user is an explicit member of, or
 *   - a group whose role bundle intersects the user's expanded roles —
 *     this reproduces the old allowed-array semantics exactly, so nobody is
 *     locked out before memberships are assigned.
 *
 * Expansion mirrors has_role (00015) and the old canSee: dept_head implies
 * approver and dept_admin; every non-system_admin user is implicitly a
 * requester. Detail pages with no explicit grant inherit their parent's
 * visibility. An unknown page id resolves to false — and the parity gate
 * (branch 4) makes an unknown id a CI failure, not a silent default.
 */

export interface PageDef {
  key: string
  parent_key: string | null
  backed_by_role: string | null
}

export interface GroupDef {
  id: string
  key: string
  roles: string[]
}

export interface PageGrant {
  group_id: string
  page_key: string
  visibility: 'visible' | 'hidden'
}

/** dept_head inherits approver + dept_admin (00015); non-sysadmins are requesters */
export function expandRoles(roles: string[]): Set<string> {
  const out = new Set(roles)
  if (out.has('dept_head')) {
    out.add('approver')
    out.add('dept_admin')
  }
  if (!out.has('system_admin')) out.add('requester')
  return out
}

/** groups that count for this user: explicit memberships ∪ role-implied */
export function relevantGroupIds(
  groups: GroupDef[],
  memberGroupIds: string[],
  roles: string[],
): Set<string> {
  const mine = expandRoles(roles)
  const out = new Set(memberGroupIds)
  for (const g of groups) {
    if (g.roles.some((r) => mine.has(r))) out.add(g.id)
  }
  return out
}

export function resolveVisibility(
  pageKey: string,
  pages: PageDef[],
  grants: PageGrant[],
  relevant: Set<string>,
): boolean {
  const page = pages.find((p) => p.key === pageKey)
  if (!page) return false

  const rows = grants.filter((g) => g.page_key === pageKey && relevant.has(g.group_id))
  if (rows.some((r) => r.visibility === 'visible')) return true
  if (rows.length > 0) return false // every relevant group explicitly hides it

  // inherited: a detail page with no explicit grant follows its parent
  if (page.parent_key) return resolveVisibility(page.parent_key, pages, grants, relevant)
  return false
}
