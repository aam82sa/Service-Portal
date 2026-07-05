import type { DeptCode, Role } from '../../lib/types'

export type AdminSection =
  | 'overview' | 'functions' | 'access' | 'email' | 'sla' | 'announcements'
  | 'services' | 'forms' | 'workflows' | 'users' | 'delegation'

export interface AdminSectionDef {
  id: AdminSection
  label: string
  ico: string
  group: string
}

type HasRole = (role: Role, dept?: DeptCode) => boolean

/** Sections visible per role — shared by the sidebar and the admin page. */
export function getAdminSections(hasRole: HasRole): AdminSectionDef[] {
  const isSys = hasRole('system_admin')
  const isDept = hasRole('dept_admin')
  const isUsr = hasRole('user_admin')
  const out: AdminSectionDef[] = []

  if (isSys) {
    out.push({ id: 'overview', label: 'Overview', ico: 'Ov', group: 'System admin' })
    out.push({ id: 'functions', label: 'Functions', ico: 'Fn', group: 'System admin' })
    out.push({ id: 'access', label: 'Page access', ico: 'Pa', group: 'System admin' })
    out.push({ id: 'email', label: 'Email studio', ico: 'Em', group: 'System admin' })
    out.push({ id: 'sla', label: 'SLA management', ico: 'Sl', group: 'System admin' })
    out.push({ id: 'announcements', label: 'Announcements', ico: 'An', group: 'System admin' })
  }
  if (isSys || isDept) {
    const group = isSys ? 'System admin' : 'Department admin'
    out.push({ id: 'services', label: 'Service builder', ico: 'Sv', group })
    out.push({ id: 'forms', label: 'Form builder', ico: 'Fb', group })
    out.push({ id: 'workflows', label: 'Workflow designer', ico: 'Wf', group })
  }
  if (isUsr) {
    out.push({ id: 'users', label: 'User management', ico: 'Um', group: 'User admin' })
  }
  if (isUsr || hasRole('dept_head')) {
    out.push({ id: 'delegation', label: 'Delegation', ico: 'Dg', group: isUsr ? 'User admin' : 'Department head' })
  }
  return out
}
