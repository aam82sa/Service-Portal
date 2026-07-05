-- ABC Services Hub — PMO module, Phase 6b: charter intake, DoA generalization,
-- project lifecycle state machine, and conversion-to-project creation.
-- The approvals engine gains a polymorphic subject so charters (and later
-- change requests) route through the same doa_matrix chains as requests.
-- Spec: docs/pmo-gap-decisions.md §B, §E, §H; PMO spec §7.1, §7.4

-- ============ A) Approvals: polymorphic subject ============
alter table approvals alter column request_id drop not null;
alter table approvals
  add column subject_type text not null default 'request'
    check (subject_type in ('request', 'project_charter', 'change_request')),
  add column subject_id uuid;
update approvals set subject_id = request_id;
alter table approvals alter column subject_id set not null;
alter table approvals add constraint approvals_request_subject
  check (subject_type <> 'request' or request_id is not null);
create unique index approvals_subject_step
  on approvals (subject_type, subject_id, step_order);

-- Shared chain generation, extracted from create_approval_chain (00006)
create or replace function generate_doa_chain(
  p_subject_type text, p_subject_id uuid, p_dept dept_code,
  p_service uuid, p_amount numeric
) returns int language plpgsql security definer as $$
declare
  n int := 0;
begin
  -- fresh chain per submission; decision history lives in the event logs
  delete from approvals where subject_type = p_subject_type and subject_id = p_subject_id;
  insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint)
  select case when p_subject_type = 'request' then p_subject_id end,
         p_subject_type, p_subject_id, d.step_order, d.approver_hint
  from doa_matrix d
  where (d.dept is null or d.dept = p_dept)
    and (d.service_id is null or d.service_id = p_service)
    and coalesce(p_amount, 0) >= d.min_amount
    and (d.max_amount is null or coalesce(p_amount, 0) < d.max_amount)
  order by d.step_order;
  get diagnostics n = row_count;
  return n;
end $$;

-- Request trigger now delegates to the shared generator (behavior unchanged)
create or replace function create_approval_chain() returns trigger
language plpgsql security definer as $$
declare
  n int := 0;
begin
  if new.status = 'pending_approval' and old.status is distinct from new.status then
    n = generate_doa_chain('request', new.id, new.dept, new.service_id, new.amount);
    if n = 0 then
      insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint)
      values (new.id, 'request', new.id, 1, 'Line manager');
    end if;
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.id, auth.uid(), 'approval_requested',
            jsonb_build_object('steps', greatest(n, 1), 'amount', new.amount));
  end if;
  return new;
end $$;

-- Charter approvals visible to whoever can see the project (chr_read applies)
create policy apr_read_pmo on approvals for select to authenticated
  using (subject_type = 'project_charter'
         and exists (select 1 from project_charters c where c.id = subject_id));

-- Approvers see submitted charters and their projects while deciding
-- (mirrors req_approver from 00006)
create policy chr_approver on project_charters for select to authenticated
  using (has_role('approver') and status = 'submitted');
create policy prj_approver on projects for select to authenticated
  using (has_role('approver') and status in ('charter_submitted', 'charter_approval'));

-- ============ B) Display tier for charter snapshots ============
-- Display label only — spend authority itself always resolves from doa_matrix
create or replace function doa_tier_for(amount numeric) returns text
language sql immutable as $$
  select case
    when coalesce(amount, 0) < 25000 then 'Tier 1'
    when coalesce(amount, 0) < 100000 then 'Tier 2'
    else 'Tier 3'
  end
$$;

-- ============ C) Charter submission (RPC, mirrors the request engine) ============
create or replace function submit_charter(p_charter uuid) returns void
language plpgsql security definer as $$
declare
  c project_charters%rowtype;
  p projects%rowtype;
  n int;
begin
  select * into c from project_charters where id = p_charter for update;
  if not found then raise exception 'charter not found'; end if;
  select * into p from projects where id = c.project_id for update;
  if not (p.project_manager_id = auth.uid() or p.created_by = auth.uid()
          or has_role('pmo_admin') or has_role('system_admin')) then
    raise exception 'only the project manager can submit the charter';
  end if;
  if c.status <> 'draft' then raise exception 'charter has already been submitted'; end if;
  if p.status <> 'draft' then raise exception 'project is not in draft'; end if;

  -- Project spend authority is administered by Procurement (spec §2.2)
  n = generate_doa_chain('project_charter', c.id, 'PROC', null, c.estimated_budget);
  if n = 0 then
    insert into approvals (subject_type, subject_id, step_order, approver_hint)
    values ('project_charter', c.id, 1, 'Project sponsor');
  end if;

  update project_charters
  set status = 'submitted', submitted_at = now(), doa_tier = doa_tier_for(c.estimated_budget)
  where id = c.id;
  update projects set status = 'charter_submitted' where id = p.id;
  update projects set status = 'charter_approval' where id = p.id;

  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'pmo_charters', 'submitted',
          jsonb_build_object('charter_id', c.id, 'project_id', p.id,
                             'steps', greatest(n, 1), 'amount', c.estimated_budget));
end $$;

-- ============ D) WBS template instantiation ============
create or replace function instantiate_wbs_template(
  p_project uuid, p_template uuid, p_actor uuid
) returns void language plpgsql security definer as $$
begin
  insert into wbs_elements (project_id, code, title, level, sequence, created_by)
  select p_project, t.code, t.title,
         array_length(string_to_array(t.code, '.'), 1), t.sequence, p_actor
  from wbs_template_elements t
  where t.template_id = p_template
  on conflict (project_id, code) do nothing;

  update wbs_elements w
  set parent_wbs_id = pw.id
  from wbs_template_elements t
  join wbs_template_elements pt on pt.id = t.parent_id
  join wbs_elements pw on pw.project_id = w.project_id and pw.code = pt.code
  where w.project_id = p_project and w.code = t.code and t.template_id = p_template;
end $$;

-- ============ E) Sequential decision RPC, now subject-aware ============
create or replace function decide_approval(
  p_approval uuid, p_decision approval_decision, p_comment text default null
) returns void language plpgsql security definer as $$
declare
  a approvals%rowtype;
  c project_charters%rowtype;
  tmpl uuid;
  chain_done boolean;
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
  if exists (
    select 1 from approvals
    where subject_type = a.subject_type and subject_id = a.subject_id
      and step_order < a.step_order and decision <> 'approved'
  ) then
    raise exception 'earlier steps in the chain are not approved yet';
  end if;

  update approvals
  set decision = p_decision, decided_at = now(), approver_id = auth.uid(), comment = p_comment
  where id = a.id;

  chain_done = not exists (
    select 1 from approvals
    where subject_type = a.subject_type and subject_id = a.subject_id
      and decision = 'pending'
  );

  if a.subject_type = 'request' then
    insert into request_events (request_id, actor_id, event_type, detail)
    values (a.request_id, auth.uid(), 'approval_decided',
            jsonb_build_object('step', a.step_order, 'decision', p_decision, 'comment', p_comment));
    if p_decision = 'rejected' or chain_done then
      update requests set status = 'in_progress' where id = a.request_id;
    end if;

  elsif a.subject_type = 'project_charter' then
    select * into c from project_charters where id = a.subject_id for update;
    insert into admin_events (actor_id, area, action, detail)
    values (auth.uid(), 'pmo_charters', 'approval_decided',
            jsonb_build_object('charter_id', c.id, 'project_id', c.project_id,
                               'step', a.step_order, 'decision', p_decision, 'comment', p_comment));
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
  end if;
end $$;

-- ============ F) Project lifecycle guard (spec §7.1) ============
create or replace function projects_guard_update() returns trigger
language plpgsql security definer as $$
begin
  new.code = old.code;
  new.created_at = old.created_at;
  new.created_by = old.created_by;
  new.origin_type = old.origin_type;
  new.origin_request_id = old.origin_request_id;
  new.origin_department = old.origin_department;

  if new.status is distinct from old.status then
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
    -- entering charter flow requires a submitted charter
    if new.status = 'charter_submitted' and not exists (
      select 1 from project_charters where project_id = new.id and status = 'submitted'
    ) then
      raise exception 'submit a charter before moving the project to charter_submitted';
    end if;
    -- planning requires an approved charter
    if new.status = 'planning' and not exists (
      select 1 from project_charters where project_id = new.id and status = 'approved'
    ) then
      raise exception 'the project needs an approved charter to enter planning';
    end if;
    -- baselining requires scope + schedule + cost locked (spec §3.1 exit condition)
    if new.status = 'baselined' and (
      select count(distinct baseline_type) from project_baselines where project_id = new.id
    ) < 3 then
      raise exception 'scope, schedule and cost baselines must all exist before baselining';
    end if;
  end if;
  return new;
end $$;
create trigger projects_guard before update on projects
  for each row execute function projects_guard_update();

-- ============ G) Conversion decision creates the project (spec §7.4) ============
create or replace function conversion_on_decide() returns trigger
language plpgsql security definer as $$
declare
  pid uuid;
begin
  if old.status <> 'pending_dept_head' then
    raise exception 'conversion is already decided';
  end if;
  if not (has_role('dept_head', new.source_department) or has_role('system_admin')) then
    raise exception 'only the originating department head can decide a conversion';
  end if;
  new.department_head_id = coalesce(new.department_head_id, auth.uid());
  new.decided_at = coalesce(new.decided_at, now());

  if new.status = 'approved' then
    insert into projects (name, status, department_scope, origin_type, origin_request_id,
                          origin_department, project_manager_id, created_by)
    select r.title, 'draft', array[new.source_department], 'converted',
           new.source_request_id, new.source_department, new.proposed_pm_id, new.requested_by
    from requests r where r.id = new.source_request_id
    returning id into pid;
    new.project_id = pid;
    -- root WBS element; the source ticket becomes its first task in 6c
    insert into wbs_elements (project_id, code, title, level, sequence, created_by)
    values (pid, '1', 'Converted scope', 1, 1, new.requested_by);
    update requests set project_id = pid where id = new.source_request_id;
    insert into admin_events (actor_id, area, action, detail)
    values (auth.uid(), 'pmo_conversions', 'approved',
            jsonb_build_object('conversion_id', new.id, 'project_id', pid,
                               'source_request_id', new.source_request_id));
  else
    insert into admin_events (actor_id, area, action, detail)
    values (auth.uid(), 'pmo_conversions', 'rejected',
            jsonb_build_object('conversion_id', new.id,
                               'source_request_id', new.source_request_id,
                               'notes', new.decision_notes));
  end if;
  return new;
end $$;
create trigger conversion_decide before update on project_conversion_requests
  for each row when (old.status is distinct from new.status)
  execute function conversion_on_decide();
