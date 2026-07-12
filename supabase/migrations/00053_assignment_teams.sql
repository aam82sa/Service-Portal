-- 00053 — assignment & teams (SPRINT3 branch 1): the approved model —
-- officers pull, leads and heads push. Team sub-queues inside departments,
-- routing on submit, and request-level governance enforced in the guard
-- trigger (not just the UI).
--
-- RACI: requester (own; no field edits after submit) · officer/agent
-- (their team queue: claim, hand back, workflow status; NOT assign-to-peer,
-- NOT priority, NOT team) · team lead (per-team via team_members.is_lead:
-- + assign within team, edit priority) · dept head (+ reassign across
-- dept, move between teams, unrouted tray) · dept/system admin (config).
--
-- Also fixes the known bug: dept_head was missing from req_agent_update
-- for non-restricted requests, so their saves were silently blocked.

-- ============ schema ============
alter table requests add column if not exists team_id uuid references teams(id);
create index if not exists requests_team_idx on requests (team_id);
alter table team_members add column if not exists is_lead boolean not null default false;

create table if not exists routing_rules (
  id uuid primary key default gen_random_uuid(),
  dept dept_code not null,
  match_type text not null check (match_type in ('service', 'keyword', 'default')),
  match_value text,                          -- service code / title keyword; null for default
  team_id uuid not null references teams(id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table routing_rules enable row level security;
drop policy if exists rr_read on routing_rules;
create policy rr_read on routing_rules for select to authenticated using (true);
drop policy if exists rr_write on routing_rules;
create policy rr_write on routing_rules for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin', dept))
  with check (has_role('system_admin') or has_role('dept_admin', dept));

-- dept admins manage their department's teams and membership (was user_admin only)
drop policy if exists teams_dept_admin_write on teams;
create policy teams_dept_admin_write on teams for all to authenticated
  using (has_role('dept_admin', dept)) with check (has_role('dept_admin', dept));
drop policy if exists tm_dept_admin_write on team_members;
create policy tm_dept_admin_write on team_members for all to authenticated
  using (has_role('dept_admin', (select t.dept from teams t where t.id = team_id)))
  with check (has_role('dept_admin', (select t.dept from teams t where t.id = team_id)));

-- ============ membership helpers (definer: no policy recursion) ============
create or replace function is_team_member(p_team uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from team_members tm
    where tm.team_id = p_team and tm.profile_id = auth.uid()
  )
$$;

-- Lead capability is per team (team_members.is_lead); the legacy dept-wide
-- team_lead role keeps working as "lead of every team in the department".
create or replace function is_team_lead(p_team uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from team_members tm
    where tm.team_id = p_team and tm.profile_id = auth.uid() and tm.is_lead
  )
  or exists (
    select 1 from teams t
    where t.id = p_team and has_role('team_lead', t.dept)
  )
$$;

-- ============ routing on submit ============
-- service match beats keyword beats department default; no match -> null
-- (the request lands in the department's unrouted tray, heads/admins only).
create or replace function resolve_team(p_dept dept_code, p_service uuid, p_title text)
returns uuid language sql stable security definer as $$
  select team_id from (
    select r.team_id,
           case r.match_type when 'service' then 0 when 'keyword' then 1 else 2 end as tier,
           r.position
    from routing_rules r
    where r.dept = p_dept
      and (
        (r.match_type = 'service' and r.match_value = (select s.code from services s where s.id = p_service))
        or (r.match_type = 'keyword' and r.match_value is not null
            and position(lower(r.match_value) in lower(coalesce(p_title, ''))) > 0)
        or r.match_type = 'default'
      )
    order by tier, r.position, r.created_at
    limit 1
  ) best
$$;

create or replace function requests_route_team_fn() returns trigger
language plpgsql security definer as $$
declare
  svc_dept dept_code;
begin
  if new.team_id is not null then return new; end if;
  select s.dept into svc_dept from services s where s.id = new.service_id;
  new.team_id = resolve_team(svc_dept, new.service_id, new.title);
  return new;
end $$;

drop trigger if exists requests_route_team on requests;
create trigger requests_route_team
  before insert on requests
  for each row execute function requests_route_team_fn();

-- ============ audit detail: from/to/by + team_changed ============
create or replace function requests_log_update() returns trigger
language plpgsql security definer as $$
begin
  if new.status is distinct from old.status then
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.id, auth.uid(), 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.id, auth.uid(), 'assigned',
            jsonb_build_object(
              'assignee_id', new.assignee_id,
              'from', (select display_name from profiles where id = old.assignee_id),
              'to', (select display_name from profiles where id = new.assignee_id),
              'by', (select display_name from profiles where id = auth.uid())));
  end if;
  if new.team_id is distinct from old.team_id then
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.id, auth.uid(), 'team_changed',
            jsonb_build_object(
              'from', (select name from teams where id = old.team_id),
              'to', (select name from teams where id = new.team_id),
              'by', (select display_name from profiles where id = auth.uid())));
  end if;
  return new;
end $$;

-- ============ guard v6: assignment governance in the database ============
-- v5 (00052) + the RACI rules for assignee/priority/team changes. Enforced
-- only for real user sessions (auth.uid() present): background engines —
-- the SLA sweep's bump_priority, auto-assignment — run without a JWT and
-- stay exempt, as does the system_admin override.
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

-- ============ update policy v3: dept_head fixed in, team-scoped officers ============
drop policy if exists req_agent_update on requests;
create policy req_agent_update on requests for update to authenticated
  using (
    has_role('system_admin')
    or (not restricted and (
      has_role('dept_head', dept) or has_role('dept_admin', dept) or has_role('team_lead', dept)
      or (has_role('agent', dept) and team_id is not null and is_team_member(team_id))
    ))
    or (restricted and (assignee_id = auth.uid() or has_role('team_lead', dept)
                        or has_role('dept_head', dept)))
  )
  with check (
    has_role('system_admin')
    or (not restricted and (
      has_role('dept_head', dept) or has_role('dept_admin', dept) or has_role('team_lead', dept)
      or (has_role('agent', dept) and team_id is not null and is_team_member(team_id))
    ))
    or (restricted and (assignee_id = auth.uid() or has_role('team_lead', dept)
                        or has_role('dept_head', dept)))
  );

-- ============ backfill ============
-- One default "Service Desk" team per department; existing agents become
-- members (team_lead role holders as per-team leads); a default routing
-- rule per department; open requests routed to their department default.
do $$
declare
  d dept_code;
  tid uuid;
begin
  foreach d in array enum_range(null::dept_code) loop
    insert into teams (dept, name) values (d, 'Service Desk')
    on conflict (dept, name) do nothing;
    select id into tid from teams where dept = d and name = 'Service Desk';

    insert into team_members (team_id, profile_id, is_lead)
    select tid, ra.profile_id, bool_or(ra.role = 'team_lead')
    from role_assignments ra
    where ra.dept = d and ra.role in ('agent', 'team_lead')
    group by ra.profile_id
    on conflict (team_id, profile_id) do nothing;

    if not exists (
      select 1 from routing_rules where dept = d and match_type = 'default'
    ) then
      insert into routing_rules (dept, match_type, match_value, team_id, position)
      values (d, 'default', null, tid, 100);
    end if;

    update requests set team_id = tid
    where dept = d and team_id is null
      and status not in ('closed', 'cancelled');
  end loop;
end $$;
