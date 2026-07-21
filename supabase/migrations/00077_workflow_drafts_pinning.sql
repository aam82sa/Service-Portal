-- 00077 — WORKFL1 branch 4: persisted workflow drafts + version pinning.
--
-- 1) Drafts survive reload: one draft row per service
--    (workflow_definitions.status='draft'), upserted by save_workflow_draft().
--    Publishing consumes the draft. updated_at powers the "edited N min ago ·
--    autosaved" note in the designer's version bar.
--
-- 2) The version bar states "in-flight requests keep running on v3 until they
--    close". Until now that was false: requests_guard_update always read the
--    LATEST published graph, so publishing v4 silently rewrote the rules for
--    requests already in flight. requests.workflow_id has existed since 00002
--    but was never written. Now: requests_before_insert stamps the current
--    published workflow id, and the guard prefers the pinned graph (even after
--    that version is retired by a later publish). Requests predating this
--    migration have workflow_id null and keep today's behaviour (latest
--    published). This is also the foundation Part 2's "let them finish on the
--    old version" resolution relies on.
--
-- 3) publish_workflow's admin gate read services.dept (enum) — a dept_admin of
--    a dynamic stream (Phase 1) was refused. The gate now uses dept_id.

-- ── workflow_definitions: draft bookkeeping ────────────────────────────────
alter table workflow_definitions add column if not exists updated_at timestamptz not null default now();

-- one draft per service (defensively drop stray extras, keep the newest)
delete from workflow_definitions w
 where w.status = 'draft'
   and exists (
     select 1 from workflow_definitions w2
      where w2.service_id = w.service_id and w2.status = 'draft' and w2.version > w.version
   );
create unique index if not exists wfd_one_draft_per_service
  on workflow_definitions (service_id) where status = 'draft';

-- ── save_workflow_draft: autosave upsert ───────────────────────────────────
create or replace function save_workflow_draft(p_service uuid, p_graph jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  did uuid;
  v int;
  ts timestamptz;
begin
  select dept_id into did from services where id = p_service;
  if not found then
    raise exception 'unknown service';
  end if;
  if not (has_role('system_admin') or has_role('dept_admin', did)) then
    raise exception 'only a system admin or this department''s admin can edit workflows';
  end if;
  if jsonb_typeof(p_graph->'transitions') <> 'array'
     or jsonb_typeof(p_graph->'steps') <> 'array' then
    raise exception 'graph must contain steps and transitions arrays';
  end if;

  v := coalesce((select max(version) from workflow_definitions
                  where service_id = p_service and status <> 'draft'), 0) + 1;
  insert into workflow_definitions (service_id, version, graph, status, created_by, updated_at)
  values (p_service, v, p_graph, 'draft', auth.uid(), now())
  on conflict (service_id) where status = 'draft'
  do update set graph = excluded.graph,
                version = excluded.version,
                created_by = excluded.created_by,
                updated_at = now()
  returning updated_at into ts;
  return ts;
end $$;
revoke all on function save_workflow_draft(uuid, jsonb) from public, anon;
grant execute on function save_workflow_draft(uuid, jsonb) to authenticated, service_role;

-- ── publish_workflow: dept_id gate + consume the draft ─────────────────────
create or replace function publish_workflow(p_service uuid, p_graph jsonb)
returns int language plpgsql security definer as $$
declare
  did uuid;
  req_appr boolean;
  v int;
begin
  select dept_id, requires_approval into did, req_appr from services where id = p_service;
  if not found then
    raise exception 'unknown service';
  end if;
  if not (has_role('system_admin') or has_role('dept_admin', did)) then
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

  -- the draft becomes this published version; delete it before numbering so
  -- drafts never inflate the version sequence
  delete from workflow_definitions where service_id = p_service and status = 'draft';
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

-- ── pin the workflow version a request starts on ───────────────────────────
-- (00075 body + workflow_id stamp; own published workflow first, else the
-- parent service's — matching what the guard falls back to.)
create or replace function requests_before_insert()
returns trigger language plpgsql security definer as $$
declare
  svc services%rowtype;
  resp int;
  reso int;
begin
  select * into svc from services where id = new.service_id and is_active;
  if not found then
    raise exception 'unknown or inactive service';
  end if;
  new.dept = svc.dept;         -- legacy denormalised code (null for dynamic streams)
  new.dept_id = svc.dept_id;   -- canonical department reference
  new.workflow_id = coalesce(
    (select w.id from workflow_definitions w
      where w.service_id = new.service_id and w.status = 'published'
      order by w.version desc limit 1),
    (select w.id from workflow_definitions w
      where w.service_id = svc.parent_id and w.status = 'published'
      order by w.version desc limit 1)
  );
  select o_response, o_resolution into resp, reso from sla_minutes_for(new.service_id, new.priority);
  if resp is not null then new.sla_response_due = add_business_minutes(now(), resp); end if;
  if reso is not null then new.sla_resolution_due = add_business_minutes(now(), reso); end if;
  return new;
end $$;

-- ── guard: prefer the pinned graph (00053 body + pinning) ──────────────────
create or replace function requests_guard_update() returns trigger
language plpgsql security definer as $$
declare
  needs_approval boolean;
  wf jsonb;
  is_override boolean := false;
  guard_team uuid;
begin
  new.requester_id = old.requester_id;
  new.ref = old.ref;
  new.service_id = old.service_id;
  new.dept = old.dept;
  new.created_at = old.created_at;
  new.workflow_id = old.workflow_id;   -- the pinned version is immutable

  if new.status is distinct from old.status then
    if has_role('system_admin') then
      is_override := true;
      insert into admin_events (actor_id, area, action, detail)
      values (auth.uid(), 'governance', 'status_override',
              jsonb_build_object('ref', new.ref, 'from', old.status, 'to', new.status));
    else
      -- pinned version first (kept even after it is retired by a later
      -- publish — in-flight requests finish on the version they started on)
      select w.graph into wf from workflow_definitions w
      where w.id = old.workflow_id and w.status <> 'draft';
      if wf is null then
        select w.graph into wf from workflow_definitions w
        where w.service_id = new.service_id and w.status = 'published'
        order by w.version desc limit 1;
      end if;
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

  -- —— assignment & team governance (officers pull, leads and heads push) ——
  if auth.uid() is not null and not has_role('system_admin') then
    guard_team := coalesce(old.team_id, new.team_id);

    if new.team_id is distinct from old.team_id then
      if not (has_role('dept_head', new.dept) or has_role('dept_admin', new.dept)) then
        raise exception 'moving a request between teams needs the department head';
      end if;
      if new.team_id is not null and not exists (
        select 1 from teams t where t.id = new.team_id and t.dept = new.dept
      ) then
        raise exception 'target team is not in this department';
      end if;
    end if;

    if new.assignee_id is distinct from old.assignee_id then
      if has_role('dept_head', new.dept) or has_role('dept_admin', new.dept) then
        if new.assignee_id is not null and not exists (
          select 1 from team_members tm
          join teams t on t.id = tm.team_id
          where t.dept = new.dept and tm.profile_id = new.assignee_id
        ) then
          raise exception 'assignee must be a member of a team in this department';
        end if;
      elsif is_team_lead(guard_team) then
        if new.assignee_id is not null and not exists (
          select 1 from team_members tm
          where tm.team_id = guard_team and tm.profile_id = new.assignee_id
        ) then
          raise exception 'a team lead can only assign to members of that team';
        end if;
      else
        -- officer: claim (null -> self) or hand back (self -> null), nothing else
        if not ((old.assignee_id is null and new.assignee_id = auth.uid())
                or (old.assignee_id = auth.uid() and new.assignee_id is null)) then
          raise exception 'officers can claim or hand back — assigning to someone else needs a team lead or department head';
        end if;
      end if;
    end if;

    if new.priority is distinct from old.priority then
      if not (has_role('dept_head', new.dept) or has_role('dept_admin', new.dept)
              or is_team_lead(guard_team)) then
        raise exception 'priority can only be changed by a team lead or department head';
      end if;
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
