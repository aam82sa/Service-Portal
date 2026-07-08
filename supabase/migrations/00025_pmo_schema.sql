-- ABC Services Hub — PMO module, Phase 6a: core schema and RLS
-- Portfolios, programs, projects, charters, conversion requests, WBS,
-- baselines, templates, resource assignments, and the requests linkage.
-- Spec: PMO Module Technical Specification v1.0 §5–6,
-- decisions: docs/pmo-gap-decisions.md

-- ============ Enums ============
create type project_status as enum
  ('draft', 'charter_submitted', 'charter_approval', 'planning', 'baselined',
   'active', 'on_hold', 'closing', 'closed', 'cancelled');
create type project_origin as enum ('scratch', 'converted');
create type charter_status as enum ('draft', 'submitted', 'approved', 'rejected');
create type conversion_status as enum ('pending_dept_head', 'approved', 'rejected');
create type baseline_type as enum ('scope', 'schedule', 'cost');

-- ============ Portfolios and programs ============
create table portfolios (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  strategic_objective text,
  sponsor_id uuid references profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

create table programs (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  portfolio_id uuid references portfolios(id),
  program_manager_id uuid references profiles(id),  -- designation, not a role; holder must be a project_manager
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

-- ============ Project / WBS templates ============
create table project_templates (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  department_scope dept_code[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

create table wbs_template_elements (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references project_templates(id) on delete cascade,
  parent_id uuid references wbs_template_elements(id) on delete cascade,
  code text not null,                        -- dot path: 1, 1.1, 1.2.3
  title text not null,
  sequence int not null default 1,
  unique (template_id, code)
);

-- ============ Projects ============
create sequence project_seq start 1;

create table projects (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('PJ-' || lpad(nextval('project_seq')::text, 4, '0')),
  name text not null,
  description text,
  status project_status not null default 'draft',
  department_scope dept_code[] not null default '{}',  -- empty = cross-functional
  origin_type project_origin not null default 'scratch',
  origin_request_id uuid references requests(id),      -- the converted ticket
  origin_department dept_code,                          -- dept that approved the conversion
  portfolio_id uuid references portfolios(id),
  program_id uuid references programs(id),
  template_id uuid references project_templates(id),
  project_manager_id uuid references profiles(id),
  sponsor_id uuid references profiles(id),
  planned_start date,
  planned_end date,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  check (origin_type = 'scratch' or origin_request_id is not null)
);

create index on projects (status);
create index on projects (project_manager_id) where status not in ('closed', 'cancelled');

-- ============ Charters ============
create table project_charters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  objective text not null,
  business_case text,
  estimated_budget numeric,                  -- SAR; drives the DoA chain in 6b
  estimated_duration_days int,
  status charter_status not null default 'draft',
  doa_tier text,                             -- snapshotted from doa_matrix at submission (gap decisions §B)
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

create index on project_charters (project_id);

-- ============ Task-to-project conversion (spec §2.5, §7.4) ============
create table project_conversion_requests (
  id uuid primary key default gen_random_uuid(),
  source_request_id uuid not null references requests(id),
  source_department dept_code not null,
  requested_by uuid not null references profiles(id),
  proposed_pm_id uuid not null references profiles(id),  -- takes effect on approval (gap decisions §E)
  department_head_id uuid references profiles(id),        -- decider, stamped on decision
  status conversion_status not null default 'pending_dept_head',
  decision_notes text,
  decided_at timestamptz,
  project_id uuid references projects(id),                -- set when approval creates the project (6b)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on project_conversion_requests (source_request_id);
create index on project_conversion_requests (source_department, status);

-- ============ Work Breakdown Structure ============
create table wbs_elements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_wbs_id uuid references wbs_elements(id) on delete cascade,
  code text not null,                        -- materialized dot path: 1.2.3
  title text not null,
  level int not null check (level >= 1),
  sequence int not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  unique (project_id, code)
);

create index on wbs_elements (project_id);
create index on wbs_elements (parent_wbs_id);

-- ============ Baselines (immutable versions — gap decisions §H) ============
create table project_baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  baseline_type baseline_type not null,
  version int not null,
  snapshot_json jsonb not null,
  locked_by uuid references profiles(id),
  locked_at timestamptz not null default now(),
  unique (project_id, baseline_type, version)
);
-- No update/delete policies will be created on project_baselines.

create index on project_baselines (project_id);

-- ============ Resource assignments (project level; task_id arrives in 6c) ============
create table resource_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references profiles(id),
  role_on_project text,
  allocation_percent int not null default 100 check (allocation_percent between 1 and 100),
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (project_id, user_id)
);

create index on resource_assignments (user_id);

-- ============ Requests linkage (spec §8.1) ============
-- project_task_id follows in 6c when the tasks table exists.
alter table requests add column project_id uuid references projects(id);
create index on requests (project_id) where project_id is not null;

-- ============ Helpers ============
-- Security definer so the projects policy can check membership without
-- triggering resource_assignments' own policies (which reference projects
-- back — same recursion hazard 00006 documents for approvals/requests).
create or replace function is_assigned_to_project(p uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from resource_assignments
    where project_id = p and user_id = auth.uid()
  )
$$;

-- Role held for any of the given departments (dept null = global grant)
create or replace function has_dept_role_any(r platform_role, depts dept_code[])
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from role_assignments
    where profile_id = auth.uid()
      and role = r
      and (dept is null or dept = any(depts))
  )
$$;

-- ============ Audit stamping ============
create or replace function pmo_stamp_audit() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by = auth.uid();
  new.updated_at = now();
  return new;
end $$;

create trigger portfolios_audit before insert or update on portfolios
  for each row execute function pmo_stamp_audit();
create trigger programs_audit before insert or update on programs
  for each row execute function pmo_stamp_audit();
create trigger project_templates_audit before insert or update on project_templates
  for each row execute function pmo_stamp_audit();
create trigger projects_audit before insert or update on projects
  for each row execute function pmo_stamp_audit();
create trigger project_charters_audit before insert or update on project_charters
  for each row execute function pmo_stamp_audit();
create trigger wbs_elements_audit before insert or update on wbs_elements
  for each row execute function pmo_stamp_audit();
create trigger conversion_requests_touch before update on project_conversion_requests
  for each row execute function touch_updated_at();

-- ============ RLS ============
alter table portfolios enable row level security;
alter table programs enable row level security;
alter table project_templates enable row level security;
alter table wbs_template_elements enable row level security;
alter table projects enable row level security;
alter table project_charters enable row level security;
alter table project_conversion_requests enable row level security;
alter table wbs_elements enable row level security;
alter table project_baselines enable row level security;
alter table resource_assignments enable row level security;

-- Portfolios / programs: PMO-wide read, configuration write
create policy pf_read on portfolios for select to authenticated
  using (has_role('pmo_admin') or has_role('project_manager') or has_role('executive')
         or has_role('dept_head') or has_role('system_admin'));
create policy pf_write on portfolios for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin'))
  with check (has_role('pmo_admin') or has_role('system_admin'));

create policy prg_read on programs for select to authenticated
  using (has_role('pmo_admin') or has_role('project_manager') or has_role('executive')
         or has_role('dept_head') or has_role('system_admin'));
create policy prg_write on programs for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin'))
  with check (has_role('pmo_admin') or has_role('system_admin'));

-- Templates: anyone can read (project pickers), PMO Admin configures
create policy pt_read on project_templates for select to authenticated using (true);
create policy pt_write on project_templates for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin'))
  with check (has_role('pmo_admin') or has_role('system_admin'));

create policy wte_read on wbs_template_elements for select to authenticated using (true);
create policy wte_write on wbs_template_elements for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin'))
  with check (has_role('pmo_admin') or has_role('system_admin'));

-- Projects: two-layer read — role + scope (spec §6.2 translated to the
-- real has_role signature; gap decisions §A)
create policy prj_read on projects for select to authenticated using (
  has_role('system_admin') or has_role('executive') or has_role('pmo_admin')
  or created_by = auth.uid()          -- creator keeps visibility (insert..returning also needs this)
  or project_manager_id = auth.uid()
  or sponsor_id = auth.uid()
  or is_assigned_to_project(id)
  or has_dept_role_any('dept_head', department_scope)
  or (origin_department is not null and has_role('dept_head', origin_department))
);

-- From-scratch origination is open to PMO roles and department staff (spec §2.4)
create policy prj_insert on projects for insert to authenticated with check (
  has_role('pmo_admin') or has_role('project_manager') or has_role('agent')
  or has_role('team_lead') or has_role('dept_head') or has_role('system_admin')
);

create policy prj_update on projects for update to authenticated using (
  has_role('pmo_admin') or has_role('system_admin')
  or project_manager_id = auth.uid()
);

-- Charters: visibility follows the project (subquery applies projects RLS)
create policy chr_read on project_charters for select to authenticated
  using (exists (select 1 from projects p where p.id = project_id));
create policy chr_insert on project_charters for insert to authenticated with check (
  has_role('pmo_admin') or has_role('system_admin')
  or exists (select 1 from projects p
             where p.id = project_id and p.project_manager_id = auth.uid())
);
-- PM edits only while draft; PMO Admin / System Admin anytime
create policy chr_update on project_charters for update to authenticated using (
  has_role('pmo_admin') or has_role('system_admin')
  or (status = 'draft'
      and exists (select 1 from projects p
                  where p.id = project_id and p.project_manager_id = auth.uid()))
);

-- Conversion requests: requester + originating department head (spec §2.5)
create policy pcr_read on project_conversion_requests for select to authenticated using (
  requested_by = auth.uid()
  or has_role('dept_head', source_department)
  or has_role('pmo_admin') or has_role('executive') or has_role('system_admin')
);
create policy pcr_insert on project_conversion_requests for insert to authenticated with check (
  requested_by = auth.uid()
  and (has_role('agent', source_department)
       or has_role('team_lead', source_department)
       or has_role('dept_head', source_department))
);
create policy pcr_decide on project_conversion_requests for update to authenticated using (
  has_role('dept_head', source_department) or has_role('system_admin')
);

-- WBS: read follows project; PM plans, PMO Admin assists
create policy wbs_read on wbs_elements for select to authenticated
  using (exists (select 1 from projects p where p.id = project_id));
create policy wbs_write on wbs_elements for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin')
         or exists (select 1 from projects p
                    where p.id = project_id and p.project_manager_id = auth.uid()))
  with check (has_role('pmo_admin') or has_role('system_admin')
              or exists (select 1 from projects p
                         where p.id = project_id and p.project_manager_id = auth.uid()));

-- Baselines: read follows project; insert-only (immutable versions)
create policy pbl_read on project_baselines for select to authenticated
  using (exists (select 1 from projects p where p.id = project_id));
create policy pbl_insert on project_baselines for insert to authenticated with check (
  has_role('pmo_admin') or has_role('system_admin')
  or exists (select 1 from projects p
             where p.id = project_id and p.project_manager_id = auth.uid())
);

-- Assignments: own rows, project leadership, and global read roles
create policy ra_read on resource_assignments for select to authenticated using (
  user_id = auth.uid()
  or has_role('pmo_admin') or has_role('executive') or has_role('system_admin')
  or exists (select 1 from projects p
             where p.id = project_id
               and (p.project_manager_id = auth.uid() or p.sponsor_id = auth.uid()))
);
create policy ra_write on resource_assignments for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin')
         or exists (select 1 from projects p
                    where p.id = project_id and p.project_manager_id = auth.uid()))
  with check (has_role('pmo_admin') or has_role('system_admin')
              or exists (select 1 from projects p
                         where p.id = project_id and p.project_manager_id = auth.uid()));
