import { describe, expect, it } from 'vitest'
import {
  expandRoles,
  relevantGroupIds,
  resolveVisibility,
  type GroupDef,
  type PageDef,
  type PageGrant,
} from './pageVisibility'

const pages: PageDef[] = [
  { key: 'home', parent_key: null, backed_by_role: 'requester' },
  { key: 'requests', parent_key: null, backed_by_role: 'requester' },
  { key: 'request_detail', parent_key: 'requests', backed_by_role: 'requester' },
  { key: 'work', parent_key: null, backed_by_role: 'agent' },
  { key: 'admin', parent_key: null, backed_by_role: 'system_admin' },
]

const groups: GroupDef[] = [
  { id: 'g-req', key: 'requester', roles: ['requester'] },
  { id: 'g-it', key: 'it_officer', roles: ['agent', 'approver'] },
  { id: 'g-sys', key: 'system_admin', roles: ['system_admin', 'user_admin', 'dept_admin'] },
]

const grants: PageGrant[] = [
  { group_id: 'g-req', page_key: 'home', visibility: 'visible' },
  { group_id: 'g-req', page_key: 'requests', visibility: 'visible' },
  { group_id: 'g-it', page_key: 'work', visibility: 'visible' },
  { group_id: 'g-sys', page_key: 'admin', visibility: 'visible' },
]

describe('expandRoles', () => {
  it('dept_head implies approver and dept_admin (mirrors has_role)', () => {
    const r = expandRoles(['dept_head'])
    expect(r.has('approver')).toBe(true)
    expect(r.has('dept_admin')).toBe(true)
  })
  it('every non-sysadmin is implicitly a requester; sysadmin is not', () => {
    expect(expandRoles(['agent']).has('requester')).toBe(true)
    expect(expandRoles(['system_admin']).has('requester')).toBe(false)
  })
})

describe('relevantGroupIds', () => {
  it('includes explicit memberships and role-implied groups', () => {
    const rel = relevantGroupIds(groups, ['g-sys'], ['agent'])
    expect(rel.has('g-sys')).toBe(true)   // explicit
    expect(rel.has('g-it')).toBe(true)    // implied by agent
    expect(rel.has('g-req')).toBe(true)   // implicit requester
  })
  it('a plain requester with no roles still matches the requester group', () => {
    const rel = relevantGroupIds(groups, [], [])
    expect(rel.has('g-req')).toBe(true)
    expect(rel.has('g-it')).toBe(false)
  })
})

describe('resolveVisibility', () => {
  const rel = (roles: string[], member: string[] = []) => relevantGroupIds(groups, member, roles)

  it('an agent sees work; a plain requester does not', () => {
    expect(resolveVisibility('work', pages, grants, rel(['agent']))).toBe(true)
    expect(resolveVisibility('work', pages, grants, rel([]))).toBe(false)
  })

  it('admin needs the sysadmin group — no hardcoded fallback', () => {
    expect(resolveVisibility('admin', pages, grants, rel(['system_admin']))).toBe(true)
    expect(resolveVisibility('admin', pages, grants, rel(['agent']))).toBe(false)
  })

  it('a detail page with no explicit grant inherits its parent', () => {
    expect(resolveVisibility('request_detail', pages, grants, rel([]))).toBe(true) // requester sees requests
    const noRequests = grants.filter((g) => g.page_key !== 'requests')
    expect(resolveVisibility('request_detail', pages, noRequests, rel([]))).toBe(false)
  })

  it('an explicit hidden row beats inheritance for that group', () => {
    const withHide: PageGrant[] = [...grants, { group_id: 'g-req', page_key: 'request_detail', visibility: 'hidden' }]
    expect(resolveVisibility('request_detail', pages, withHide, rel([]))).toBe(false)
  })

  it('visible from any relevant group wins over hidden from another', () => {
    const mixed: PageGrant[] = [
      ...grants,
      { group_id: 'g-req', page_key: 'work', visibility: 'hidden' },
    ]
    expect(resolveVisibility('work', pages, mixed, rel(['agent']))).toBe(true)
  })

  it('an unknown page id resolves to false (the parity gate makes it a CI failure)', () => {
    expect(resolveVisibility('ghost', pages, grants, rel(['system_admin']))).toBe(false)
  })
})
