export type DeptCode = 'IT' | 'ADMIN' | 'PROC' | 'LOG'

export type Role =
  | 'requester'
  | 'agent'
  | 'team_lead'
  | 'dept_head'
  | 'approver'      // legacy — absorbed by dept_head
  | 'dept_admin'    // legacy — absorbed by dept_head
  | 'executive'     // legacy
  | 'user_admin'
  | 'system_admin'

export interface Profile {
  id: string
  upn: string
  display_name: string
  ad_department: string | null
  is_active: boolean
}

export interface RoleAssignment {
  role: Role
  dept: DeptCode | null
  source_ad_group: string | null
}

export interface FeatureFlag {
  key: string
  name: string
  description: string | null
  category: string
  is_enabled: boolean
}

export interface Service {
  id: string
  dept: DeptCode
  code: string
  name: string
  description: string | null
}

export const DEPT_COLOR: Record<DeptCode, { rail: string; soft: string; label: string }> = {
  IT: { rail: 'var(--it)', soft: 'var(--it-soft)', label: 'IT Services' },
  ADMIN: { rail: 'var(--admin)', soft: 'var(--admin-soft)', label: 'Administration' },
  PROC: { rail: 'var(--green)', soft: 'var(--green-soft)', label: 'Procurement' },
  LOG: { rail: 'var(--log)', soft: 'var(--log-soft)', label: 'Logistics' },
}

/** Active portal departments (containers). LOG is dormant (folded into ADMIN). */
export const PORTAL_DEPTS: DeptCode[] = ['IT', 'ADMIN', 'PROC']
