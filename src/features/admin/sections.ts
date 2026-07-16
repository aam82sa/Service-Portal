import type { DeptCode, Role } from '../../lib/types'

export type AdminSection =
  | 'functions' | 'access' | 'email' | 'sla' | 'announcements'
  | 'services' | 'forms' | 'workflows' | 'teams' | 'users' | 'delegation' | 'doa' | 'audit'

/** every admin section belongs to a fixed role scope (the sub-nav groups) */
export type AdminScope = 'system' | 'department' | 'user'

export const SCOPE_META: Record<AdminScope, { label: string; dot: string; badge: string }> = {
  system: { label: 'System admin', dot: 'var(--admin)', badge: 'scope-sys' },
  department: { label: 'Department admin', dot: 'var(--it)', badge: 'scope-dept' },
  user: { label: 'User admin', dot: 'var(--green)', badge: 'scope-user' },
}

export interface AdminSectionDef {
  id: AdminSection
  label: string
  ico: string
  scope: AdminScope
}

type HasRole = (role: Role, dept?: DeptCode) => boolean

/**
 * Sections visible per role, grouped by scope (the console sub-nav order).
 * Grouping is fixed per section; visibility depends on the viewer's roles.
 */
export function getAdminSections(hasRole: HasRole): AdminSectionDef[] {
  const isSys = hasRole('system_admin')
  const isDept = hasRole('dept_admin')
  const isUsr = hasRole('user_admin')
  const out: AdminSectionDef[] = []

  if (isSys) {
    out.push({ id: 'functions', label: 'Functions', ico: 'Fn', scope: 'system' })
    out.push({ id: 'access', label: 'Page access', ico: 'Pa', scope: 'system' })
    out.push({ id: 'email', label: 'Email studio', ico: 'Em', scope: 'system' })
    out.push({ id: 'sla', label: 'SLA & escalation', ico: 'Sl', scope: 'system' })
    out.push({ id: 'doa', label: 'DoA matrix', ico: 'Do', scope: 'system' })
    out.push({ id: 'announcements', label: 'Announcements', ico: 'An', scope: 'system' })
  }
  if (isSys || isDept) {
    out.push({ id: 'services', label: 'Service builder', ico: 'Sv', scope: 'department' })
    out.push({ id: 'forms', label: 'Form builder', ico: 'Fb', scope: 'department' })
    out.push({ id: 'workflows', label: 'Workflow designer', ico: 'Wf', scope: 'department' })
    out.push({ id: 'teams', label: 'Teams & routing', ico: 'Tm', scope: 'department' })
    out.push({ id: 'audit', label: 'Audit log', ico: 'Au', scope: 'department' })
  }
  if (isUsr) {
    out.push({ id: 'users', label: 'User management', ico: 'Um', scope: 'user' })
  }
  if (isUsr || hasRole('dept_head')) {
    out.push({ id: 'delegation', label: 'Delegation', ico: 'Dg', scope: 'user' })
  }
  return out
}
