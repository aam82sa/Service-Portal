-- RLC Services Hub — initial schema
-- Phase 1: core entities, lifecycle, DoA approvals, audit log, RLS foundations

create extension if not exists pgcrypto;

-- ============ Enums ============
create type dept_code as enum ('IT', 'ADMIN', 'LOG');
create type request_status as enum
  ('new', 'triaged', 'in_progress', 'pending_approval', 'pending_requester', 'escalated', 'resolved', 'closed', 'cancelled');
create type priority as enum ('P1', 'P2', 'P3', 'P4');
create type platform_role as enum
  ('requester', 'agent', 'team_lead', 'approver', 'dept_admin', 'executive', 'user_admin', 'system_admin');
create type approval_decision as enum ('pending', 'approved', 'rejected', 'info_requested');

-- ============ Directory (mastered in Entra ID) ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  entra_object_id uuid unique,               -- Entra ID objectId
  upn text unique not null,                  -- user@rlc.sa
  display_name text not null,
  ad_department text,                        -- department attribute from AD
  is_active boolean not null default true,   -- mirrors AD accountEnabled
  synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table role_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  role platform_role not null,
  dept dept_code,                            -- null = global (executive, platform_admin)
  source_ad_group text,                      -- e.g. SG-RLC-ServiceDesk-IT
  unique (profile_id, role, dept)
);

-- ============ Catalog ============
create table departments (
  code dept_code primary key,
  name text not null,
  color_hex text not null
);

insert into departments values
  ('IT', 'IT Services', '#3E6DD8'),
  ('ADMIN', 'Administration', '#8A5FC9'),
  ('LOG', 'Logistics', '#2E9E6B');

create table services (
  id uuid primary key default gen_random_uuid(),
  dept dept_code not null references departments(code),
  code text not null,                        -- HW, AC, TR ...
  name text not null,
  description text,
  form_schema jsonb not null default '[]',   -- dynamic form fields
  sla_response_minutes int,
  sla_resolution_minutes int,
  requires_approval boolean not null default false,
  is_active boolean not null default true,
  unique (dept, code)
);

-- ============ DoA matrix ============
create table doa_matrix (
  id uuid primary key default gen_random_uuid(),
  dept dept_code,                            -- null = applies to all
  service_id uuid references services(id),   -- null = applies to whole dept
  min_amount numeric not null default 0,     -- SAR
  max_amount numeric,                        -- null = no upper bound
  step_order int not null,
  approver_role platform_role not null default 'approver',
  approver_hint text                         -- 'Line manager', 'Finance controller'...
);

-- ============ Requests ============
create sequence request_seq start 2500;

create table requests (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('REQ-' || nextval('request_seq')),
  service_id uuid not null references services(id),
  dept dept_code not null,
  requester_id uuid not null references profiles(id),
  assignee_id uuid references profiles(id),
  status request_status not null default 'new',
  priority priority not null default 'P3',
  title text not null,
  payload jsonb not null default '{}',       -- dynamic form answers
  amount numeric,                            -- for DoA routing
  cost_center text,
  sla_response_due timestamptz,
  sla_resolution_due timestamptz,
  escalation_level int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on requests (dept, status);
create index on requests (assignee_id) where status not in ('resolved','closed','cancelled');
create index on requests (sla_resolution_due) where status not in ('resolved','closed','cancelled');

-- ============ Approvals ============
create table approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  step_order int not null,
  approver_id uuid references profiles(id),
  approver_hint text,
  decision approval_decision not null default 'pending',
  decided_at timestamptz,
  comment text,
  unique (request_id, step_order)
);

-- ============ Audit log (immutable) ============
create table request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references requests(id) on delete cascade,
  actor_id uuid references profiles(id),
  event_type text not null,                  -- created, assigned, status_changed, comment, approval_decided, escalated, sla_breached
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
-- No update/delete grants will be issued on request_events.

-- ============ Notification templates ============
create table notification_templates (
  key text primary key,                      -- request_created, pending_approval, ...
  subject text not null,
  body_html text not null,
  is_active boolean not null default true
);

-- ============ RLS ============
alter table profiles enable row level security;
alter table requests enable row level security;
alter table approvals enable row level security;
alter table request_events enable row level security;

-- Helper: current user's roles
create or replace function my_roles()
returns setof role_assignments language sql stable security definer as $$
  select * from role_assignments where profile_id = auth.uid()
$$;

create or replace function has_role(r platform_role, d dept_code default null)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from role_assignments
    where profile_id = auth.uid()
      and role = r
      and (dept is null or d is null or dept = d)
  )
$$;

-- Requesters: own requests only
create policy req_own on requests for select
  using (requester_id = auth.uid());

-- Agents / team leads / dept admins: their department scope
create policy req_dept_scope on requests for select
  using (
    has_role('agent', dept) or has_role('team_lead', dept)
    or has_role('dept_admin', dept)
    or has_role('executive') or has_role('system_admin')
  );

-- Approvers: requests with a pending approval addressed to them
create policy req_approver on requests for select
  using (exists (
    select 1 from approvals a
    where a.request_id = requests.id and a.approver_id = auth.uid()
  ));

-- (Write policies added per-module in later migrations.)

-- updated_at trigger
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger requests_touch before update on requests
  for each row execute function touch_updated_at();
