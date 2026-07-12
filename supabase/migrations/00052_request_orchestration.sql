-- 00052 — request orchestration (SPRINT2 branch 5): parent/child spawning
-- and parent auto-resolve. parent_request_id + the parent-requester RLS
-- policy already exist (00034); this builds the engine on top.
--
-- Flow: a parent service declares child_service_codes. When the parent
-- enters in_progress with its approval satisfied (immediately for
-- no-approval services; after the final DoA/Cybersecurity decision
-- otherwise — decide_approval() already moves the request to in_progress
-- at that exact moment), one child request per code is spawned into the
-- owning department's queue. When the last child reaches
-- resolved/closed/cancelled, the parent auto-resolves THROUGH the normal
-- update path so workflow guards stay in force (00047 rule: orchestration
-- never forces an out-of-workflow transition — missing transitions are
-- rejected at publish/seed time instead).

-- ============ child-spawn definition ============
alter table services add column if not exists child_service_codes text[];

-- Admin edits are validated here; publish_workflow() below validates the
-- workflow side. Together they make bad orchestration config fail at
-- configuration time, never at runtime.
create or replace function services_validate_children() returns trigger
language plpgsql security definer as $$
declare
  c text;
  wf jsonb;
begin
  if new.child_service_codes is null or coalesce(array_length(new.child_service_codes, 1), 0) = 0 then
    return new;
  end if;
  foreach c in array new.child_service_codes loop
    if c = new.code then
      raise exception 'orchestration: service % cannot spawn itself', new.code;
    end if;
    if not exists (select 1 from services s where s.code = c and s.is_active) then
      raise exception 'orchestration: child service code "%" does not match an active service', c;
    end if;
  end loop;
  -- the parent must be able to auto-resolve from in_progress
  select w.graph into wf from workflow_definitions w
  where w.service_id = new.id and w.status = 'published'
  order by w.version desc limit 1;
  if wf is not null and not exists (
    select 1 from jsonb_array_elements(wf -> 'transitions') t
    where t ->> 'from' = 'in_progress' and t ->> 'to' = 'resolved'
  ) then
    raise exception 'orchestration: the published workflow for % must keep In progress -> Resolved for parent auto-resolve', new.code;
  end if;
  return new;
end $$;

drop trigger if exists services_children_check on services;
create trigger services_children_check
  before insert or update of child_service_codes on services
  for each row execute function services_validate_children();

-- publish_workflow v2: same contract as 00008, plus the orchestration
-- check — a service that spawns children cannot publish a workflow that
-- removes the transition its auto-resolve depends on.
create or replace function publish_workflow(p_service uuid, p_graph jsonb)
returns int language plpgsql security definer as $$
declare
  d dept_code;
  req_appr boolean;
  spawns boolean;
  v int;
begin
  select dept, requires_approval,
         coalesce(array_length(child_service_codes, 1), 0) > 0
  into d, req_appr, spawns
  from services where id = p_service;
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
  if spawns and not exists (
    select 1 from jsonb_array_elements(p_graph->'transitions') t
    where t->>'from' = 'in_progress' and t->>'to' = 'resolved'
  ) then
    raise exception 'this service spawns child requests: In progress -> Resolved is required for parent auto-resolve';
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

-- ============ spawning ============
create or replace function spawn_child_requests(p_parent uuid) returns int
language plpgsql security definer as $$
declare
  parent requests%rowtype;
  codes text[];
  c text;
  child services%rowtype;
  child_ref text;
  spawned jsonb := '[]'::jsonb;
  n int := 0;
begin
  select * into parent from requests where id = p_parent;
  if not found then return 0; end if;
  select s.child_service_codes into codes from services s where s.id = parent.service_id;
  if codes is null or coalesce(array_length(codes, 1), 0) = 0 then return 0; end if;
  if exists (select 1 from requests r where r.parent_request_id = p_parent) then
    return 0;                                -- already spawned (e.g. reopened parent)
  end if;

  foreach c in array codes loop
    select * into child from services s where s.code = c and s.is_active limit 1;
    if not found then
      -- config drift after seed-time validation (service deactivated later):
      -- skip loudly rather than blocking the approval that triggered us
      raise warning 'orchestration: child service % for parent % not found — skipped', c, parent.ref;
      continue;
    end if;
    insert into requests (service_id, dept, requester_id, title, payload, parent_request_id)
    values (child.id, child.dept, parent.requester_id,
            child.name || ' — for ' || parent.ref,
            jsonb_build_object('parent_ref', parent.ref, 'parent_title', parent.title),
            p_parent)
    returning ref into child_ref;
    spawned := spawned || jsonb_build_object('ref', child_ref, 'code', c, 'dept', child.dept);
    n := n + 1;
  end loop;

  if n > 0 then
    insert into request_events (request_id, actor_id, event_type, detail)
    values (p_parent, auth.uid(), 'children_spawned',
            jsonb_build_object('count', n, 'children', spawned));
  end if;
  return n;
end $$;

-- Fires when a parent enters in_progress with approval satisfied. For
-- approval services that is exactly the moment decide_approval() records
-- the final approval; for no-approval services it is the agent starting
-- work. The no-children-yet guard in spawn_child_requests makes re-entries
-- (pending_requester, reopen) no-ops.
create or replace function requests_spawn_children() returns trigger
language plpgsql security definer as $$
begin
  if new.status = 'in_progress' and old.status is distinct from new.status then
    if exists (
      select 1 from services s
      where s.id = new.service_id
        and coalesce(array_length(s.child_service_codes, 1), 0) > 0
        and (not s.requires_approval or (
          exists (select 1 from approvals a where a.request_id = new.id)
          and not exists (select 1 from approvals a where a.request_id = new.id and a.decision <> 'approved')
        ))
    ) then
      perform spawn_child_requests(new.id);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists requests_spawn_children_t on requests;
create trigger requests_spawn_children_t
  after update of status on requests
  for each row
  when (old.status is distinct from new.status)
  execute function requests_spawn_children();

-- ============ parent auto-resolve ============
-- Through a plain UPDATE so requests_guard_update stays in force. If the
-- parent's workflow forbids the transition (config drift the publish/seed
-- checks should prevent), the child's resolve still succeeds — the failure
-- is logged, never propagated.
create or replace function requests_parent_autoresolve() returns trigger
language plpgsql security definer as $$
declare
  pstatus request_status;
begin
  if new.parent_request_id is null then return null; end if;
  if new.status not in ('resolved', 'closed', 'cancelled')
     or old.status is not distinct from new.status then
    return null;
  end if;
  if exists (
    select 1 from requests c
    where c.parent_request_id = new.parent_request_id
      and c.status not in ('resolved', 'closed', 'cancelled')
  ) then
    return null;                             -- siblings still open
  end if;
  select status into pstatus from requests where id = new.parent_request_id;
  if pstatus is null or pstatus in ('resolved', 'closed', 'cancelled') then
    return null;
  end if;
  begin
    update requests set status = 'resolved' where id = new.parent_request_id;
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.parent_request_id, auth.uid(), 'children_completed',
            jsonb_build_object('last_child', new.ref));
  exception when others then
    raise warning 'orchestration: parent % auto-resolve failed — %',
      new.parent_request_id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists requests_parent_autoresolve_t on requests;
create trigger requests_parent_autoresolve_t
  after update of status on requests
  for each row
  when (old.status is distinct from new.status)
  execute function requests_parent_autoresolve();

-- ============ guard v5: children are pre-approved work orders ============
-- Identical to 00012's v4 except the DoA-approved gate no longer applies to
-- child requests: the PARENT went through the chain (manager, Cybersecurity,
-- DoA bands); its work orders must not each demand a fresh chain.
create or replace function requests_guard_update() returns trigger
language plpgsql security definer as $$
declare
  needs_approval boolean;
  wf jsonb;
  is_override boolean := false;
begin
  new.requester_id = old.requester_id;
  new.ref = old.ref;
  new.service_id = old.service_id;
  new.dept = old.dept;
  new.created_at = old.created_at;

  if new.status is distinct from old.status then
    if has_role('system_admin') then
      is_override := true;
      insert into admin_events (actor_id, area, action, detail)
      values (auth.uid(), 'governance', 'status_override',
              jsonb_build_object('ref', new.ref, 'from', old.status, 'to', new.status));
    else
      select w.graph into wf from workflow_definitions w
      where w.service_id = new.service_id and w.status = 'published'
      order by w.version desc limit 1;
      if wf is null then
        select w.graph into wf from workflow_definitions w
        join services s on s.id = new.service_id
        where w.service_id = s.parent_id and w.status = 'published'
        order by w.version desc limit 1;
      end if;

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

    -- governance: any change to a closed request alerts the IT head
    if old.status = 'closed' then
      insert into admin_events (actor_id, area, action, detail)
      values (auth.uid(), 'governance', 'closed_request_changed',
              jsonb_build_object('ref', new.ref, 'to', new.status));
    end if;
  end if;

  if not is_override and old.status = 'in_progress' and new.status = 'resolved'
     and new.parent_request_id is null then
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

-- ============ seeds ============
-- EL-01 onboarding: account + hardware + licenses. EL-02 offboarding:
-- revoke access + collect hardware. SA-01 (the cross-dept flagship):
-- Cybersecurity's final approval spawns the IT implementation child
-- (AC-02 Permission / access change) — no manual handoff.
update services set child_service_codes = array['AC-01', 'HW-01', 'SW-02']
  where code = 'EL-01' and child_service_codes is distinct from array['AC-01', 'HW-01', 'SW-02'];
update services set child_service_codes = array['AC-04', 'HW-05']
  where code = 'EL-02' and child_service_codes is distinct from array['AC-04', 'HW-05'];
update services set child_service_codes = array['AC-02']
  where code = 'SA-01' and child_service_codes is distinct from array['AC-02'];

update services
set description = 'Access to Administration-owned systems. Manager approval, then Cybersecurity, then the IT implementation child request is created automatically.'
where code = 'SA-01'
  and description like '%manual handoff%';
