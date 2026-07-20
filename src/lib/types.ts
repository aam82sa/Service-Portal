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
  | 'project_manager'
  | 'pmo_admin'
  | 'cybersecurity'

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

/** A department / "service stream" as stored in the departments table. */
export interface Department {
  id: string
  code: string
  name: string
  name_ar: string | null
  color: string | null
  rail_color: string | null
  icon: string | null
  is_active: boolean
  position: number | null
}

export const DEPT_COLOR: Record<DeptCode, { rail: string; soft: string; label: string }> = {
  IT: { rail: 'var(--it)', soft: 'var(--it-soft)', label: 'IT Services' },
  ADMIN: { rail: 'var(--admin)', soft: 'var(--admin-soft)', label: 'Administration' },
  PROC: { rail: 'var(--green)', soft: 'var(--green-soft)', label: 'Procurement' },
  LOG: { rail: 'var(--log)', soft: 'var(--log-soft)', label: 'Logistics' },
}

/** Active portal departments (containers). LOG is dormant (folded into ADMIN). */
export const PORTAL_DEPTS: DeptCode[] = ['IT', 'ADMIN', 'PROC']

// ============ PMO module (Phase 6) ============

export type ProjectStatus =
  | 'draft' | 'charter_submitted' | 'charter_approval' | 'planning' | 'baselined'
  | 'active' | 'on_hold' | 'closing' | 'closed' | 'cancelled'

export type ProjectType = 'personal' | 'company'

export interface Project {
  id: string
  code: string
  name: string
  description: string | null
  status: ProjectStatus
  project_type: ProjectType
  department_scope: DeptCode[]
  origin_type: 'scratch' | 'converted'
  project_manager_id: string | null
  sponsor_id: string | null
  planned_start: string | null
  planned_end: string | null
  created_by: string | null
  pm?: { display_name: string } | null
}

export interface ProjectCharter {
  id: string
  project_id: string
  objective: string
  business_case: string | null
  estimated_budget: number | null
  estimated_duration_days: number | null
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  doa_tier: string | null
  submitted_at: string | null
  decided_at: string | null
}

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: 'muted' | 'accent' | 'amber' | 'green' | 'red' | 'ink' }> = {
  draft: { label: 'Draft', tone: 'muted' },
  charter_submitted: { label: 'Charter submitted', tone: 'amber' },
  charter_approval: { label: 'Charter approval', tone: 'amber' },
  planning: { label: 'Planning', tone: 'accent' },
  baselined: { label: 'Baselined', tone: 'accent' },
  active: { label: 'Active', tone: 'green' },
  on_hold: { label: 'On hold', tone: 'amber' },
  closing: { label: 'Closing', tone: 'ink' },
  closed: { label: 'Closed', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'red' },
}
