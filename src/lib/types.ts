export type DeptCode = 'IT' | 'ADMIN' | 'LOG'

export type Role =
  | 'requester'
  | 'agent'
  | 'team_lead'
  | 'approver'
  | 'dept_admin'
  | 'executive'
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
  LOG: { rail: 'var(--log)', soft: 'var(--log-soft)', label: 'Logistics' },
}
