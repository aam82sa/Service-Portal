-- ABC Services Hub — PMO batch: activity-level WBS with multi-assignees and
-- FS dependencies (timeline/critical path), status correction with audit,
-- revocable baselines, module audit log, and full PMO RBAC (role groups +
-- page access) managed from the PMO Admin page.
-- Decisions: chat 2026-07-06 — A full custom RBAC, B owner+admin corrections,
-- C multiple assignees, D FS dependencies.

-- ============ A) WBS elements become activities ============
alter table wbs_elements
  add column planned_start date,
  add column planned_end date,
  add column status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  add column is_milestone boolean not null default false;

create table wbs_assignments (
  id uuid primary key default gen_random_uuid(),
  wbs_element_id uuid not null references wbs_elements(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (wbs_element_id, user_id)
);
create index on wbs_assignments (user_id);

create table wbs_dependencies (
  id uuid primary key default gen_random_uuid(),
  predecessor_id uuid not null references wbs_elements(id) on delete cascade,
  successor_id uuid not null references wbs_elements(id) on delete cascade,
  check (predecessor_id <> successor_id),
  unique (predecessor_id, successor_id)
);
create index on wbs_dependencies (successor_id);

alter table wbs_assignments enable row level security;
alter table wbs_dependencies enable row level security;

create policy wa_read on wbs_assignments for select to authenticated
  using (exists (select 1 from wbs_elements w where w.id = wbs_element_id));
create policy wa_write on wbs_assignments for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin')
         or exists (select 1 from wbs_elements w join projects p on p.id = w.project_id
                    where w.id = wbs_element_id and p.project_manager_id = auth.uid()))
  with check (has_role('pmo_admin') or has_role('system_admin')
              or exists (select 1 from wbs_elements w join projects p on p.id = w.project_id
                         where w.id = wbs_element_id and p.project_manager_id = auth.uid()));

create policy wd_read on wbs_dependencies for select to authenticated
  using (exists (select 1 from wbs_elements w where w.id = predecessor_id));
create policy wd_write on wbs_dependencies for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin')
         or exists (select 1 from wbs_elements w join projects p on p.id = w.project_id
                    where w.id = predecessor_id and p.project_manager_id = auth.uid()))
  with check (has_role('pmo_admin') or has_role('system_admin')
              or exists (select 1 from wbs_elements w join projects p on p.id = w.project_id
                         where w.id = predecessor_id and p.project_manager_id = auth.uid()));

-- Assignees may update their activities — but only the status column.
-- Security definer: wbs_assignments' own policy references wbs_elements
-- back, so a direct subquery here recurses (same hazard as 00027).
create or replace function is_assigned_to_activity(w uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from wbs_assignments
    where wbs_element_id = w and user_id = auth.uid()
  )
$$;
create policy wbs_assignee_update on wbs_elements for update to authenticated
  using (is_assigned_to_activity(id));

create or replace function wbs_guard_update() returns trigger
language plpgsql security definer as $$
begin
  -- service role / migrations (no JWT) bypass
  if auth.uid() is null then
    return new;
  end if;
  if has_role('pmo_admin') or has_role('system_admin')
     or exists (select 1 from projects p where p.id = new.project_id
                and (p.project_manager_id = auth.uid() or p.created_by = auth.uid())) then
    return new;
  end if;
  -- assignees: status-only edits
  if (new.code, new.title, new.level, new.sequence, coalesce(new.parent_wbs_id, new.id),
      coalesce(new.planned_start, 'epoch'::date), coalesce(new.planned_end, 'epoch'::date),
      new.is_milestone)
     is distinct from
     (old.code, old.title, old.level, old.sequence, coalesce(old.parent_wbs_id, old.id),
      coalesce(old.planned_start, 'epoch'::date), coalesce(old.planned_end, 'epoch'::date),
      old.is_milestone) then
    raise exception 'assignees can only update the activity status';
  end if;
  return new;
end $$;
create trigger wbs_guard before update on wbs_elements
  for each row execute function wbs_guard_update();

-- ============ B) Module audit log ============
create table pmo_audit_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references projects(id) on delete cascade,
  actor_id uuid references profiles(id),
  area text not null,                        -- status, baseline, access ...
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on pmo_audit_events (project_id);
alter table pmo_audit_events enable row level security;
create policy pae_read on pmo_audit_events for select to authenticated
  using (exists (select 1 from projects p where p.id = project_id));
-- No write policies: rows are inserted by definer functions only.

-- ============ C) Status correction (owner or PMO admin, audited) ============
create or replace function pmo_correct_status(
  p_project uuid, p_status project_status, p_reason text
) returns void language plpgsql security definer as $$
declare
  p projects%rowtype;
begin
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'a reason (at least 5 characters) is required to correct the status';
  end if;
  select * into p from projects where id = p_project for update;
  if not found then raise exception 'project not found'; end if;
  if not (has_role('pmo_admin') or has_role('system_admin')
          or p.project_manager_id = auth.uid() or p.created_by = auth.uid()) then
    raise exception 'only the PMO admin or the project owner can correct the status';
  end if;
  if p.status = p_status then return; end if;
  perform set_config('pmo.status_override', '1', true);
  update projects set status = p_status where id = p_project;
  perform set_config('pmo.status_override', '0', true);
  insert into pmo_audit_events (project_id, actor_id, area, action, detail)
  values (p_project, auth.uid(), 'status', 'corrected',
          jsonb_build_object('from', p.status, 'to', p_status, 'reason', trim(p_reason)));
end $$;

-- ============ D) Revocable baselines ============
alter table project_baselines
  add column revoked_at timestamptz,
  add column revoked_by uuid references profiles(id),
  add column revoke_reason text;

create or replace function revoke_baseline(p_baseline uuid, p_reason text)
returns void language plpgsql security definer as $$
declare
  b project_baselines%rowtype;
  p projects%rowtype;
begin
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'a reason (at least 5 characters) is required to revoke a baseline';
  end if;
  select * into b from project_baselines where id = p_baseline for update;
  if not found then raise exception 'baseline not found'; end if;
  if b.revoked_at is not null then raise exception 'baseline is already revoked'; end if;
  select * into p from projects where id = b.project_id;
  if not (has_role('pmo_admin') or has_role('system_admin')
          or p.project_manager_id = auth.uid() or p.created_by = auth.uid()) then
    raise exception 'only the PMO admin or the project owner can revoke a baseline';
  end if;
  update project_baselines
  set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = trim(p_reason)
  where id = p_baseline;
  insert into pmo_audit_events (project_id, actor_id, area, action, detail)
  values (b.project_id, auth.uid(), 'baseline', 'revoked',
          jsonb_build_object('type', b.baseline_type, 'version', b.version, 'reason', trim(p_reason)));
end $$;

-- Locking a baseline is audited too
create or replace function baseline_lock_audit() returns trigger
language plpgsql security definer as $$
begin
  insert into pmo_audit_events (project_id, actor_id, area, action, detail)
  values (new.project_id, coalesce(new.locked_by, auth.uid()), 'baseline', 'locked',
          jsonb_build_object('type', new.baseline_type, 'version', new.version));
  return new;
end $$;
create trigger baselines_audit after insert on project_baselines
  for each row execute function baseline_lock_audit();

-- ============ E) Lifecycle guard: override bypass + revocation-aware ============
create or replace function projects_guard_update() returns trigger
language plpgsql security definer as $$
begin
  new.code = old.code;
  new.created_at = old.created_at;
  new.created_by = old.created_by;
  new.origin_type = old.origin_type;
  new.origin_request_id = old.origin_request_id;
  new.origin_department = old.origin_department;
  new.project_type = old.project_type;

  if new.status is distinct from old.status then
    -- pmo_correct_status sets this flag; the correction is audited instead
    if current_setting('pmo.status_override', true) = '1' then
      return new;
    end if;
    if old.project_type = 'personal' then
      if (old.status::text, new.status::text) not in (
        ('draft', 'active'), ('draft', 'cancelled'),
        ('active', 'on_hold'), ('active', 'closing'),
        ('on_hold', 'active'),
        ('closing', 'closed')
      ) then
        raise exception 'tracker transition % -> % is not allowed', old.status, new.status;
      end if;
      return new;
    end if;
    if (old.status::text, new.status::text) not in (
      ('draft', 'charter_submitted'), ('draft', 'cancelled'),
      ('charter_submitted', 'charter_approval'), ('charter_submitted', 'draft'),
      ('charter_submitted', 'cancelled'),
      ('charter_approval', 'planning'), ('charter_approval', 'draft'),
      ('charter_approval', 'cancelled'),
      ('planning', 'baselined'), ('planning', 'cancelled'),
      ('baselined', 'active'), ('baselined', 'cancelled'),
      ('active', 'on_hold'), ('active', 'closing'),
      ('on_hold', 'active'),
      ('closing', 'closed')
    ) then
      raise exception 'project transition % -> % is not allowed', old.status, new.status;
    end if;
    if new.status = 'charter_submitted' and not exists (
      select 1 from project_charters where project_id = new.id and status = 'submitted'
    ) then
      raise exception 'submit a charter before moving the project to charter_submitted';
    end if;
    if new.status = 'planning' and not exists (
      select 1 from project_charters where project_id = new.id and status = 'approved'
    ) then
      raise exception 'the project needs an approved charter to enter planning';
    end if;
    if new.status = 'baselined' and (
      select count(distinct baseline_type) from project_baselines
      where project_id = new.id and revoked_at is null
    ) < 3 then
      raise exception 'scope, schedule and cost baselines must all exist before baselining';
    end if;
  end if;
  return new;
end $$;

-- ============ F) PMO RBAC: role groups + page access ============
create table pmo_role_groups (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  permissions text[] not null default '{}',  -- create_project, view_all_projects, manage_budget
  pages text[] not null default '{}',        -- projects, charter, wbs, timeline, baselines, budget, team
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);
create trigger pmo_role_groups_audit before insert or update on pmo_role_groups
  for each row execute function pmo_stamp_audit();

create table pmo_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references pmo_role_groups(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (group_id, user_id)
);
create index on pmo_group_members (user_id);

create or replace function pmo_has_permission(p text)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from pmo_group_members m
    join pmo_role_groups g on g.id = m.group_id
    where m.user_id = auth.uid() and p = any(g.permissions)
  )
$$;

create or replace function pmo_my_pages()
returns text[] language sql stable security definer as $$
  select coalesce(array_agg(distinct pg), '{}')
  from pmo_group_members m
  join pmo_role_groups g on g.id = m.group_id, unnest(g.pages) pg
  where m.user_id = auth.uid()
$$;

alter table pmo_role_groups enable row level security;
alter table pmo_group_members enable row level security;

create policy prgp_read on pmo_role_groups for select to authenticated
  using (has_role('pmo_admin') or has_role('system_admin')
         or exists (select 1 from pmo_group_members m
                    where m.group_id = id and m.user_id = auth.uid()));
create policy prgp_write on pmo_role_groups for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin'))
  with check (has_role('pmo_admin') or has_role('system_admin'));

create policy pgm_read on pmo_group_members for select to authenticated
  using (user_id = auth.uid() or has_role('pmo_admin') or has_role('system_admin'));
create policy pgm_write on pmo_group_members for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin'))
  with check (has_role('pmo_admin') or has_role('system_admin'));

-- PMO Admin can grant/revoke the module's platform roles (and only those)
create policy ra_pmo_admin on role_assignments for all to authenticated
  using (has_role('pmo_admin') and role in ('project_manager', 'pmo_admin'))
  with check (has_role('pmo_admin') and role in ('project_manager', 'pmo_admin'));

-- Group permissions extend project access alongside the platform roles
drop policy if exists prj_read on projects;
create policy prj_read on projects for select to authenticated using (
  created_by = auth.uid()
  or project_manager_id = auth.uid()
  or sponsor_id = auth.uid()
  or is_assigned_to_project(id)
  or (project_type = 'company' and (
    has_role('system_admin') or has_role('executive') or has_role('pmo_admin')
    or pmo_has_permission('view_all_projects')
    or has_dept_role_any('dept_head', department_scope)
    or (origin_department is not null and has_role('dept_head', origin_department))
  ))
);

drop policy if exists prj_insert on projects;
create policy prj_insert on projects for insert to authenticated with check (
  has_role('pmo_admin') or has_role('project_manager') or has_role('agent')
  or has_role('team_lead') or has_role('dept_head') or has_role('system_admin')
  or pmo_has_permission('create_project')
);

drop policy if exists bl_write on budget_lines;
create policy bl_write on budget_lines for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin')
         or pmo_has_permission('manage_budget')
         or exists (select 1 from projects p
                    where p.id = project_id and p.project_manager_id = auth.uid()))
  with check (has_role('pmo_admin') or has_role('system_admin')
              or pmo_has_permission('manage_budget')
              or exists (select 1 from projects p
                         where p.id = project_id and p.project_manager_id = auth.uid()));

-- Example groups to start from
insert into pmo_role_groups (name, description, permissions, pages) values
  ('Project Managers', 'Create and run projects end to end',
   '{create_project,view_all_projects,manage_budget}',
   '{projects,charter,wbs,timeline,baselines,budget,team}'),
  ('Project Viewers', 'Read-only visibility of company projects',
   '{view_all_projects}', '{projects,timeline}')
on conflict (name) do nothing;
