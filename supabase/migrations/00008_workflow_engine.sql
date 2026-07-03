-- Workflow engine: published per-service workflows drive legal transitions;
-- publishing is validated server-side. Form schema edits are audit-logged.

-- Audit form changes
create or replace function log_service_change() returns trigger
language plpgsql security definer as $$
begin
  if old.form_schema is distinct from new.form_schema then
    insert into admin_events (actor_id, area, action, detail)
    values (auth.uid(), 'catalog', 'form_updated',
            jsonb_build_object('service', new.code, 'dept', new.dept));
  end if;
  return new;
end $$;
create trigger services_form_audit after update on services
  for each row execute function log_service_change();

-- Validated publish (returns the new version number)
create or replace function publish_workflow(p_service uuid, p_graph jsonb)
returns int language plpgsql security definer as $$
declare
  d dept_code;
  req_appr boolean;
  v int;
begin
  select dept, requires_approval into d, req_appr from services where id = p_service;
  if not found then
    raise exception 'unknown service';
  end if;
  if not (has_role('system_admin') or has_role('dept_admin', d)) then
    raise exception 'only a system admin or this department''s admin can publish workflows';
  end if;
  if jsonb_typeof(p_graph->'transitions') <> 'array'
     or jsonb_typeof(p_graph->'steps') <> 'array' then
    raise exception 'graph must contain steps and transitions arrays';
  end if;
  -- every endpoint must be a valid lifecycle status (cast raises otherwise)
  perform (t->>'from')::request_status, (t->>'to')::request_status
  from jsonb_array_elements(p_graph->'transitions') t;
  if not exists (
    select 1 from jsonb_array_elements(p_graph->'transitions') t where t->>'from' = 'new'
  ) then
    raise exception 'workflow must have a transition out of New';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_graph->'transitions') t where t->>'to' = 'closed'
  ) then
    raise exception 'workflow must reach Closed';
  end if;
  if req_appr and (
    not exists (select 1 from jsonb_array_elements(p_graph->'transitions') t
                where t->>'from' = 'in_progress' and t->>'to' = 'pending_approval')
    or not exists (select 1 from jsonb_array_elements(p_graph->'transitions') t
                   where t->>'from' = 'pending_approval' and t->>'to' = 'in_progress')
  ) then
    raise exception 'this service requires approval: the pending approval step cannot be removed';
  end if;

  v := coalesce((select max(version) from workflow_definitions where service_id = p_service), 0) + 1;
  update workflow_definitions set status = 'retired'
  where service_id = p_service and status = 'published';
  insert into workflow_definitions (service_id, version, graph, status, created_by, published_at)
  values (p_service, v, p_graph, 'published', auth.uid(), now());

  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'workflows', 'published',
          jsonb_build_object('service_id', p_service, 'version', v));
  return v;
end $$;

-- Guard v3: published workflow (if any) defines legal transitions;
-- defaults otherwise. Approval gating always applies regardless.
create or replace function requests_guard_update() returns trigger
language plpgsql security definer as $$
declare
  needs_approval boolean;
  wf jsonb;
begin
  new.requester_id = old.requester_id;
  new.ref = old.ref;
  new.service_id = old.service_id;
  new.dept = old.dept;
  new.created_at = old.created_at;

  if new.status is distinct from old.status then
    select graph into wf from workflow_definitions
    where service_id = new.service_id and status = 'published'
    order by version desc limit 1;

    if wf is not null then
      if not exists (
        select 1 from jsonb_array_elements(wf->'transitions') t
        where t->>'from' = old.status::text and t->>'to' = new.status::text
      ) then
        raise exception 'transition % -> % is not in this service''s published workflow',
          old.status, new.status;
      end if;
    elsif (old.status::text, new.status::text) not in (
      ('new', 'triaged'), ('new', 'cancelled'),
      ('triaged', 'in_progress'),
      ('in_progress', 'pending_approval'), ('in_progress', 'pending_requester'),
      ('in_progress', 'resolved'), ('in_progress', 'escalated'),
      ('pending_requester', 'in_progress'),
      ('pending_approval', 'in_progress'),
      ('escalated', 'in_progress'),
      ('resolved', 'closed'), ('resolved', 'in_progress')
    ) then
      raise exception 'transition % -> % is not allowed', old.status, new.status;
    end if;
  end if;

  if old.status = 'in_progress' and new.status = 'resolved' then
    select s.requires_approval into needs_approval from services s where s.id = new.service_id;
    if needs_approval and (
      not exists (select 1 from approvals where request_id = new.id)
      or exists (select 1 from approvals where request_id = new.id and decision <> 'approved')
    ) then
      raise exception 'this request requires an approved DoA chain before it can be resolved';
    end if;
  end if;
  return new;
end $$;
