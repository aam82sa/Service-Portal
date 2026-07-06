-- ABC Services Hub — PMO redesign: independent module
-- Personal (tracker) vs company project types, internal dept-head → committee
-- approval replacing the platform DoA coupling, PMO-managed committee, budget
-- lines with manual PO-request handoff to Procurement.
-- Spec: docs/pmo-gap-decisions.md §R

-- ============ A) Project types ============
create type project_type as enum ('personal', 'company');
alter table projects add column project_type project_type not null default 'company';

-- ============ B) PMO committee (single, PMO-console managed) ============
create table pmo_committee_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade unique,
  added_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create or replace function is_committee_member()
returns boolean language sql stable security definer as $$
  select exists (select 1 from pmo_committee_members where user_id = auth.uid())
$$;

-- ============ C) Internal project approvals (replaces DoA coupling) ============
create type project_approval_step as enum ('dept_head', 'committee');

create table project_approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  charter_id uuid not null references project_charters(id) on delete cascade,
  step project_approval_step not null,
  step_order int not null,
  target_dept dept_code,                     -- dept_head step only
  decision approval_decision not null default 'pending',
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  comment text,
  unique (charter_id, step_order)
);

-- ============ D) Charter submission → internal chain ============
create or replace function submit_charter(p_charter uuid) returns void
language plpgsql security definer as $$
declare
  c project_charters%rowtype;
  p projects%rowtype;
  dh_dept dept_code;
  n int := 0;
begin
  select * into c from project_charters where id = p_charter for update;
  if not found then raise exception 'charter not found'; end if;
  select * into p from projects where id = c.project_id for update;
  if p.project_type = 'personal' then
    raise exception 'personal projects are trackers — no charter approval needed';
  end if;
  if not (p.project_manager_id = auth.uid() or p.created_by = auth.uid()
          or has_role('pmo_admin') or has_role('system_admin')) then
    raise exception 'only the project manager can submit the charter';
  end if;
  if c.status <> 'draft' then raise exception 'charter has already been submitted'; end if;
  if p.status <> 'draft' then raise exception 'project is not in draft'; end if;

  delete from project_approvals where charter_id = c.id;
  dh_dept = coalesce(p.origin_department, p.department_scope[1]);
  if dh_dept is not null then
    n = n + 1;
    insert into project_approvals (project_id, charter_id, step, step_order, target_dept)
    values (p.id, c.id, 'dept_head', n, dh_dept);
  end if;
  n = n + 1;
  insert into project_approvals (project_id, charter_id, step, step_order)
  values (p.id, c.id, 'committee', n);

  update project_charters set status = 'submitted', submitted_at = now() where id = c.id;
  update projects set status = 'charter_submitted' where id = p.id;
  update projects set status = 'charter_approval' where id = p.id;
end $$;

-- ============ E) Decision RPC (PMO-internal, sequential) ============
create or replace function decide_project_approval(
  p_approval uuid, p_decision approval_decision, p_comment text default null
) returns void language plpgsql security definer as $$
declare
  a project_approvals%rowtype;
  c project_charters%rowtype;
  tmpl uuid;
  chain_done boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;
  select * into a from project_approvals where id = p_approval for update;
  if not found or a.decision <> 'pending' then
    raise exception 'approval step is not pending';
  end if;
  if a.step = 'dept_head' and not (has_role('dept_head', a.target_dept) or has_role('system_admin')) then
    raise exception 'this step is decided by the % department head', a.target_dept;
  end if;
  if a.step = 'committee' and not (is_committee_member() or has_role('system_admin')) then
    raise exception 'this step is decided by a PMO committee member';
  end if;
  if exists (
    select 1 from project_approvals
    where charter_id = a.charter_id and step_order < a.step_order and decision <> 'approved'
  ) then
    raise exception 'earlier steps are not approved yet';
  end if;

  update project_approvals
  set decision = p_decision, decided_at = now(), decided_by = auth.uid(), comment = p_comment
  where id = a.id;

  chain_done = not exists (
    select 1 from project_approvals where charter_id = a.charter_id and decision = 'pending'
  );

  select * into c from project_charters where id = a.charter_id for update;
  if p_decision = 'rejected' then
    update project_charters set status = 'rejected', decided_at = now() where id = c.id;
    update projects set status = 'draft' where id = c.project_id;
  elsif chain_done then
    update project_charters set status = 'approved', decided_at = now() where id = c.id;
    update projects set status = 'planning' where id = c.project_id
      returning template_id into tmpl;
    if tmpl is not null then
      perform instantiate_wbs_template(c.project_id, tmpl, auth.uid());
    end if;
  end if;
end $$;

-- ============ F) Platform DoA engine: restored to requests only ============
create or replace function decide_approval(
  p_approval uuid, p_decision approval_decision, p_comment text default null
) returns void language plpgsql security definer as $$
declare
  a approvals%rowtype;
begin
  if not has_role('approver') then
    raise exception 'only approvers can decide';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;
  select * into a from approvals where id = p_approval for update;
  if not found or a.decision <> 'pending' then
    raise exception 'approval step is not pending';
  end if;
  if a.subject_type <> 'request' then
    raise exception 'project approvals are decided inside the PMO module';
  end if;
  if exists (
    select 1 from approvals
    where request_id = a.request_id and step_order < a.step_order and decision <> 'approved'
  ) then
    raise exception 'earlier steps in the chain are not approved yet';
  end if;

  update approvals
  set decision = p_decision, decided_at = now(), approver_id = auth.uid(), comment = p_comment
  where id = a.id;

  insert into request_events (request_id, actor_id, event_type, detail)
  values (a.request_id, auth.uid(), 'approval_decided',
          jsonb_build_object('step', a.step_order, 'decision', p_decision, 'comment', p_comment));

  if p_decision = 'rejected'
     or not exists (select 1 from approvals where request_id = a.request_id and decision = 'pending')
  then
    update requests set status = 'in_progress' where id = a.request_id;
  end if;
end $$;

drop policy if exists apr_read_pmo on approvals;
drop policy if exists chr_approver on project_charters;
drop policy if exists prj_approver on projects;

-- ============ G) Type-aware lifecycle guard ============
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
    if old.project_type = 'personal' then
      -- tracker: no charter, no baselining gates
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
      select count(distinct baseline_type) from project_baselines where project_id = new.id
    ) < 3 then
      raise exception 'scope, schedule and cost baselines must all exist before baselining';
    end if;
  end if;
  return new;
end $$;

-- ============ H) Type-aware visibility ============
drop policy if exists prj_read on projects;
create policy prj_read on projects for select to authenticated using (
  created_by = auth.uid()
  or project_manager_id = auth.uid()
  or sponsor_id = auth.uid()
  or is_assigned_to_project(id)
  or (project_type = 'company' and (
    has_role('system_admin') or has_role('executive') or has_role('pmo_admin')
    or has_dept_role_any('dept_head', department_scope)
    or (origin_department is not null and has_role('dept_head', origin_department))
  ))
);

-- Approvals rows: visible to project viewers and to their deciders
alter table project_approvals enable row level security;
create policy pja_read on project_approvals for select to authenticated using (
  exists (select 1 from projects p where p.id = project_id)
  or (step = 'dept_head' and has_role('dept_head', target_dept))
  or (step = 'committee' and is_committee_member())
);
-- Writes happen only via the definer RPCs above.

-- Deciders need to see the charter and project while a step is pending.
-- Security definer so these checks skip project_approvals' own policy,
-- which references projects back (same recursion hazard as 00006/00025).
create or replace function pmo_is_decider_for_project(pid uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from project_approvals a
    where a.project_id = pid and a.decision = 'pending'
      and ((a.step = 'dept_head' and has_role('dept_head', a.target_dept))
           or (a.step = 'committee' and is_committee_member()))
  )
$$;
create or replace function pmo_is_decider_for_charter(cid uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from project_approvals a
    where a.charter_id = cid and a.decision = 'pending'
      and ((a.step = 'dept_head' and has_role('dept_head', a.target_dept))
           or (a.step = 'committee' and is_committee_member()))
  )
$$;

create policy chr_decider on project_charters for select to authenticated
  using (status = 'submitted' and pmo_is_decider_for_charter(id));
create policy prj_decider on projects for select to authenticated
  using (status in ('charter_submitted', 'charter_approval') and pmo_is_decider_for_project(id));

-- Committee roster: readable to PMO actors, managed by PMO Admin
create policy pcm_read on pmo_committee_members for select to authenticated
  using (has_role('pmo_admin') or has_role('project_manager') or has_role('executive')
         or has_role('dept_head') or has_role('system_admin') or is_committee_member());
create policy pcm_write on pmo_committee_members for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin'))
  with check (has_role('pmo_admin') or has_role('system_admin'));

-- ============ I) Budget lines + PO handoff (integration point 2) ============
create table budget_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  wbs_element_id uuid references wbs_elements(id),
  category text,
  description text not null,
  planned_amount numeric not null check (planned_amount > 0),
  cost_center text,
  po_request_id uuid references requests(id),   -- set by create_po_request
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);
create index on budget_lines (project_id);
create trigger budget_lines_audit before insert or update on budget_lines
  for each row execute function pmo_stamp_audit();

alter table budget_lines enable row level security;
create policy bl_read on budget_lines for select to authenticated
  using (exists (select 1 from projects p where p.id = project_id));
create policy bl_write on budget_lines for all to authenticated
  using (has_role('pmo_admin') or has_role('system_admin')
         or exists (select 1 from projects p
                    where p.id = project_id and p.project_manager_id = auth.uid()))
  with check (has_role('pmo_admin') or has_role('system_admin')
              or exists (select 1 from projects p
                         where p.id = project_id and p.project_manager_id = auth.uid()));

-- Dedicated Procurement service the handoff files under
insert into services (dept, code, name, description, requires_approval, is_active)
values ('PROC', 'PPO', 'Project purchase order',
        'Purchase request raised from a PMO project budget line', true, true)
on conflict (dept, code) do nothing;

create or replace function create_po_request(p_budget_line uuid)
returns uuid language plpgsql security definer as $$
declare
  bl budget_lines%rowtype;
  p projects%rowtype;
  svc uuid;
  req uuid;
begin
  select * into bl from budget_lines where id = p_budget_line for update;
  if not found then raise exception 'budget line not found'; end if;
  if bl.po_request_id is not null then raise exception 'a PO request already exists for this line'; end if;
  select * into p from projects where id = bl.project_id;
  if p.project_type <> 'company' then
    raise exception 'personal trackers have no procurement integration';
  end if;
  if not (p.project_manager_id = auth.uid() or has_role('pmo_admin') or has_role('system_admin')) then
    raise exception 'only the project manager can raise a PO request';
  end if;
  if not exists (select 1 from project_charters where project_id = p.id and status = 'approved') then
    raise exception 'the project charter must be approved before raising purchase requests';
  end if;

  select id into svc from services where dept = 'PROC' and code = 'PPO';
  insert into requests (service_id, dept, requester_id, title, amount, cost_center, payload, project_id)
  values (svc, 'PROC', auth.uid(),
          p.code || ' — ' || bl.description,
          bl.planned_amount, bl.cost_center,
          jsonb_build_object('project_code', p.code, 'project_name', p.name,
                             'budget_line_id', bl.id, 'category', bl.category),
          p.id)
  returning id into req;

  update budget_lines set po_request_id = req where id = bl.id;
  return req;
end $$;
