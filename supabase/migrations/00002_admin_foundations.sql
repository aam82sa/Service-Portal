-- ABC Services Hub — admin foundations
-- Feature flags, admin audit, template overrides, inbound routing, teams,
-- delegation, calendars, SLA policies, escalation, priority matrix,
-- assignment rules, announcements, settings, integrations,
-- versioned forms and workflows. Spec: docs/admin-console.md

-- ============ Feature flags ============
create table feature_flags (
  key text primary key,                      -- email_to_ticket, csat_survey ...
  name text not null,
  description text,
  category text not null default 'general',  -- channels, operations, experience, integrations
  is_enabled boolean not null default true,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

insert into feature_flags (key, name, description, category, is_enabled) values
  ('status_emails',    'Status response emails', 'Auto-send configured templates on every status change', 'channels', true),
  ('email_to_ticket',  'Email-to-ticket',        'Create requests from mail sent to service mailboxes',   'channels', true),
  ('auto_assignment',  'Auto-assignment',        'Round-robin dispatch into department queues',            'operations', true),
  ('escalation_rules', 'Escalation rules',       'Act on SLA warning and breach events',                   'operations', true),
  ('csat_survey',      'CSAT survey',            'Rating request sent when a request is resolved',         'experience', true),
  ('announcements',    'Announcements',          'Maintenance banners on the portal',                      'experience', false),
  ('api_keys',         'API keys and webhooks',  'Outbound integrations for external systems',             'integrations', false),
  ('workflow_designer','Workflow designer',      'Graphical editing of service workflows',                 'operations', true);

-- ============ Admin audit (immutable, mirrors request_events) ============
create table admin_events (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
  area text not null,                        -- feature_flags, templates, roles, workflows ...
  action text not null,                      -- updated, created, deleted, published ...
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
-- No update/delete grants will be issued on admin_events.

create or replace function log_flag_change() returns trigger language plpgsql security definer as $$
begin
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'feature_flags', 'updated',
          jsonb_build_object('key', new.key, 'is_enabled', new.is_enabled));
  new.updated_by = auth.uid();
  new.updated_at = now();
  return new;
end $$;
create trigger feature_flags_audit before update on feature_flags
  for each row when (old.is_enabled is distinct from new.is_enabled)
  execute function log_flag_change();

-- ============ Notification templates: per-dept overrides + enable switch ============
alter table notification_templates drop constraint notification_templates_pkey;
alter table notification_templates
  add column id uuid primary key default gen_random_uuid(),
  add column dept dept_code;                 -- null = platform default
create unique index notification_templates_default_key
  on notification_templates (key) where dept is null;
create unique index notification_templates_dept_key
  on notification_templates (key, dept) where dept is not null;

-- ============ Inbound email routing (email-to-ticket) ============
create table inbound_routes (
  id uuid primary key default gen_random_uuid(),
  mailbox text unique not null,              -- it-support@abccorp.com
  dept dept_code not null,
  default_service_id uuid references services(id),
  is_catch_all boolean not null default false,
  is_active boolean not null default true
);

-- ============ Teams within departments ============
create table teams (
  id uuid primary key default gen_random_uuid(),
  dept dept_code not null,
  name text not null,
  unique (dept, name)
);
create table team_members (
  team_id uuid references teams(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  primary key (team_id, profile_id)
);

-- ============ Approval delegation (out-of-office) ============
create table approval_delegations (
  id uuid primary key default gen_random_uuid(),
  delegator_id uuid not null references profiles(id),
  delegate_id uuid not null references profiles(id),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (delegator_id <> delegate_id)
);

-- ============ Business hours + Saudi holiday calendar ============
create table business_hours (
  dow smallint primary key check (dow between 0 and 6),  -- 0 = Sunday
  opens time not null default '08:00',
  closes time not null default '17:00',
  is_workday boolean not null default true
);
insert into business_hours (dow, is_workday) values
  (0, true), (1, true), (2, true), (3, true), (4, true),  -- Sun–Thu
  (5, false), (6, false);                                  -- Fri–Sat

create table holidays (
  day date primary key,
  name text not null
);

-- ============ SLA policies (per service and priority) ============
create table sla_policies (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  priority priority not null,
  response_minutes int not null,
  resolution_minutes int not null,
  pause_pending_requester boolean not null default true,
  unique (service_id, priority)
);

-- ============ Escalation rules ============
create table escalation_rules (
  id uuid primary key default gen_random_uuid(),
  dept dept_code,                            -- null = all departments
  trigger text not null check (trigger in ('sla_warning', 'sla_breach')),
  action text not null check (action in ('notify_team_lead', 'bump_priority', 'escalate')),
  is_active boolean not null default true
);

-- ============ Priority matrix (impact × urgency) ============
create table priority_matrix (
  impact smallint not null check (impact between 1 and 3),   -- 1 high, 3 low
  urgency smallint not null check (urgency between 1 and 3),
  priority priority not null,
  primary key (impact, urgency)
);
insert into priority_matrix values
  (1,1,'P1'), (1,2,'P2'), (1,3,'P3'),
  (2,1,'P2'), (2,2,'P3'), (2,3,'P3'),
  (3,1,'P3'), (3,2,'P3'), (3,3,'P4');

-- ============ Auto-assignment rules ============
create table assignment_rules (
  id uuid primary key default gen_random_uuid(),
  dept dept_code not null,
  team_id uuid references teams(id),
  strategy text not null check (strategy in ('round_robin', 'load_based')),
  is_active boolean not null default true
);

-- ============ Announcements ============
create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references profiles(id)
);

-- ============ Misc settings (CSAT, retention ...) ============
create table system_settings (
  key text primary key,
  value jsonb not null
);
insert into system_settings values
  ('csat',      '{"scale_max": 5, "prompt": "How satisfied are you with the handling of your request?"}'),
  ('retention', '{"closed_request_months": 24}');

-- ============ Integrations ============
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create table webhooks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  events text[] not null default '{}',
  secret text,
  is_active boolean not null default true
);

-- ============ Versioned forms ============
create table form_versions (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  version int not null,
  schema jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  created_by uuid references profiles(id),
  published_at timestamptz,
  unique (service_id, version)
);
alter table requests add column form_version_id uuid references form_versions(id);

-- ============ Versioned workflows (graph as data) ============
create table workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  version int not null,
  graph jsonb not null default '{"steps": [], "transitions": []}',
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  created_by uuid references profiles(id),
  published_at timestamptz,
  unique (service_id, version)
);
alter table requests add column workflow_id uuid references workflow_definitions(id);

-- ============ RLS ============
alter table feature_flags enable row level security;
alter table admin_events enable row level security;
alter table notification_templates enable row level security;
alter table inbound_routes enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table approval_delegations enable row level security;
alter table business_hours enable row level security;
alter table holidays enable row level security;
alter table sla_policies enable row level security;
alter table escalation_rules enable row level security;
alter table priority_matrix enable row level security;
alter table assignment_rules enable row level security;
alter table announcements enable row level security;
alter table system_settings enable row level security;
alter table api_keys enable row level security;
alter table webhooks enable row level security;
alter table form_versions enable row level security;
alter table workflow_definitions enable row level security;

-- Read: app needs flags, calendars, matrices, announcements to render
create policy ff_read on feature_flags for select to authenticated using (true);
create policy bh_read on business_hours for select to authenticated using (true);
create policy hol_read on holidays for select to authenticated using (true);
create policy pm_read on priority_matrix for select to authenticated using (true);
create policy ann_read on announcements for select to authenticated using (true);
create policy teams_read on teams for select to authenticated using (true);
create policy tm_read on team_members for select to authenticated using (true);
create policy fv_read on form_versions for select to authenticated using (status = 'published' or has_role('system_admin') or has_role('dept_admin', (select dept from services s where s.id = service_id)));
create policy wf_read on workflow_definitions for select to authenticated using (status = 'published' or has_role('system_admin') or has_role('dept_admin', (select dept from services s where s.id = service_id)));

-- System admin: configuration surfaces
create policy ff_write on feature_flags for update to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy nt_all on notification_templates for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy ir_all on inbound_routes for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy bh_write on business_hours for update to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy hol_all on holidays for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy sla_all on sla_policies for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin', (select dept from services s where s.id = service_id)))
  with check (has_role('system_admin') or has_role('dept_admin', (select dept from services s where s.id = service_id)));
create policy esc_all on escalation_rules for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy pm_write on priority_matrix for update to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy ar_all on assignment_rules for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy ann_all on announcements for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy ss_all on system_settings for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy ak_all on api_keys for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy wh_all on webhooks for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy fv_write on form_versions for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin', (select dept from services s where s.id = service_id)))
  with check (has_role('system_admin') or has_role('dept_admin', (select dept from services s where s.id = service_id)));
create policy wf_write on workflow_definitions for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin', (select dept from services s where s.id = service_id)))
  with check (has_role('system_admin') or has_role('dept_admin', (select dept from services s where s.id = service_id)));

-- Templates: agents and dept admins may read (for previews)
create policy nt_read on notification_templates for select to authenticated using (true);

-- Sla policies readable by all (SLA rings need targets)
create policy sla_read on sla_policies for select to authenticated using (true);
create policy esc_read on escalation_rules for select to authenticated using (true);
create policy ir_read on inbound_routes for select to authenticated
  using (has_role('system_admin'));
create policy ar_read on assignment_rules for select to authenticated using (true);
create policy ss_read on system_settings for select to authenticated using (true);

-- User admin: people surfaces
create policy teams_write on teams for all to authenticated
  using (has_role('user_admin')) with check (has_role('user_admin'));
create policy tm_write on team_members for all to authenticated
  using (has_role('user_admin')) with check (has_role('user_admin'));
create policy del_read on approval_delegations for select to authenticated
  using (delegator_id = auth.uid() or delegate_id = auth.uid() or has_role('user_admin'));
create policy del_write on approval_delegations for all to authenticated
  using (has_role('user_admin') or delegator_id = auth.uid())
  with check (has_role('user_admin') or delegator_id = auth.uid());

-- Audit: system admin and executive read; inserts happen via definer functions
create policy ae_read on admin_events for select to authenticated
  using (has_role('system_admin') or has_role('executive'));

-- Profiles + role assignments management (user_admin)
alter table role_assignments enable row level security;
create policy ra_own on role_assignments for select to authenticated
  using (profile_id = auth.uid());
create policy ra_admin on role_assignments for all to authenticated
  using (has_role('user_admin')) with check (has_role('user_admin'));
create policy prof_own on profiles for select to authenticated
  using (id = auth.uid());
create policy prof_admin on profiles for select to authenticated
  using (has_role('user_admin') or has_role('system_admin') or has_role('agent')
         or has_role('team_lead') or has_role('dept_admin'));
create policy prof_admin_write on profiles for update to authenticated
  using (has_role('user_admin')) with check (has_role('user_admin'));
