-- 00043 — SLA engine: business-hours due dates, pause/resume accounting,
-- warning/breach detection on a 5-minute pg_cron sweep, and configurable
-- escalation actions. Dormant until the `sla_engine` feature flag is enabled.
--
-- The business-minutes math here MUST mirror src/lib/slaHours.ts — the unit
-- tests on that module are the executable spec (Sun–Thu week from
-- business_hours, holidays list, pause on pending_requester).

-- ============ requests: idempotency + pause accounting ============
alter table requests
  add column if not exists sla_warned_at timestamptz,
  add column if not exists sla_breached_at timestamptz,
  add column if not exists sla_paused_at timestamptz,
  add column if not exists sla_paused_minutes int not null default 0;

-- ============ feature flag (off = engine dormant) ============
insert into feature_flags (key, name, description, category, is_enabled)
values ('sla_engine', 'SLA engine',
        'Business-hours SLA due dates, pause on pending-requester, and the 5-minute warning/breach sweep with escalation actions.',
        'operations', false)
on conflict (key) do nothing;

-- ============ business-minutes arithmetic (mirror of slaHours.ts) ============
create or replace function add_business_minutes(p_start timestamptz, p_minutes numeric)
returns timestamptz language plpgsql stable as $$
declare
  remaining numeric := greatest(0, coalesce(p_minutes, 0));
  cursor_ts timestamptz := p_start;
  d date;
  bh business_hours%rowtype;
  win_open timestamptz;
  win_close timestamptz;
  from_ts timestamptz;
  available numeric;
  hop int := 0;
begin
  if not exists (select 1 from business_hours where is_workday) then
    raise exception 'no workdays configured in business_hours';
  end if;
  loop
    hop := hop + 1;
    if hop > 3660 then
      raise exception 'SLA window not found within 10 years — check the business calendar';
    end if;
    d := cursor_ts::date;
    select * into bh from business_hours where dow = extract(dow from d)::int;
    if found and bh.is_workday and not exists (select 1 from holidays where day = d) then
      win_open := d::timestamp + bh.opens;
      win_close := d::timestamp + bh.closes;
      if win_close > win_open and cursor_ts < win_close then
        from_ts := greatest(cursor_ts, win_open);
        available := extract(epoch from (win_close - from_ts)) / 60;
        if remaining <= available then
          return from_ts + (remaining * interval '1 minute');
        end if;
        remaining := remaining - available;
      end if;
    end if;
    cursor_ts := (d + 1)::timestamp;
  end loop;
end $$;

create or replace function business_minutes_between(p_from timestamptz, p_to timestamptz)
returns numeric language plpgsql stable as $$
declare
  total numeric := 0;
  d date;
  last_day date;
  bh business_hours%rowtype;
  win_open timestamptz;
  win_close timestamptz;
  seg_from timestamptz;
  seg_to timestamptz;
begin
  if p_to <= p_from then return 0; end if;
  d := p_from::date;
  last_day := p_to::date;
  while d <= last_day loop
    select * into bh from business_hours where dow = extract(dow from d)::int;
    if found and bh.is_workday and not exists (select 1 from holidays where day = d) then
      win_open := d::timestamp + bh.opens;
      win_close := d::timestamp + bh.closes;
      if win_close > win_open then
        seg_from := greatest(p_from, win_open);
        seg_to := least(p_to, win_close);
        if seg_to > seg_from then
          total := total + extract(epoch from (seg_to - seg_from)) / 60;
        end if;
      end if;
    end if;
    d := d + 1;
  end loop;
  return total;
end $$;

-- ============ SLA minutes for a request (policy > profile > service) ============
create or replace function sla_minutes_for(p_service uuid, p_priority priority,
                                           out o_response int, out o_resolution int)
language plpgsql stable as $$
declare
  svc services%rowtype;
begin
  select * into svc from services where id = p_service;
  if not found then return; end if;
  o_response := svc.sla_response_minutes;
  o_resolution := svc.sla_resolution_minutes;
  if svc.sla_profile_id is not null then
    select response_minutes, resolution_minutes into o_response, o_resolution
    from sla_profiles where id = svc.sla_profile_id;
  end if;
  -- a priority-specific policy is the most specific override
  perform 1 from sla_policies where service_id = p_service and priority = p_priority;
  if found then
    select response_minutes, resolution_minutes into o_response, o_resolution
    from sla_policies where service_id = p_service and priority = p_priority;
  end if;
end $$;

-- ============ compute_sla_due: stamp both due timestamps on a request ============
-- Anchored at created_at, in business hours, shifted by any accrued pause time.
create or replace function compute_sla_due(p_request uuid) returns void
language plpgsql security definer as $$
declare
  req requests%rowtype;
  resp int;
  reso int;
begin
  select * into req from requests where id = p_request;
  if not found then return; end if;
  select o_response, o_resolution into resp, reso from sla_minutes_for(req.service_id, req.priority);
  update requests set
    sla_response_due = case when resp is null then null
      else add_business_minutes(req.created_at, resp + req.sla_paused_minutes) end,
    sla_resolution_due = case when reso is null then null
      else add_business_minutes(req.created_at, reso + req.sla_paused_minutes) end
  where id = p_request;
end $$;

-- submit: business-hours due dates replace the old wall-clock intervals
create or replace function requests_before_insert() returns trigger
language plpgsql security definer as $$
declare
  svc services%rowtype;
  resp int;
  reso int;
begin
  select * into svc from services where id = new.service_id and is_active;
  if not found then
    raise exception 'unknown or inactive service';
  end if;
  new.dept = svc.dept;
  select o_response, o_resolution into resp, reso from sla_minutes_for(new.service_id, new.priority);
  if resp is not null then
    new.sla_response_due = add_business_minutes(now(), resp);
  end if;
  if reso is not null then
    new.sla_resolution_due = add_business_minutes(now(), reso);
  end if;
  return new;
end $$;

-- priority/service change: recompute from scratch (pause time preserved)
create or replace function requests_sla_recompute() returns trigger
language plpgsql security definer as $$
begin
  perform compute_sla_due(new.id);
  return new;
end $$;

drop trigger if exists requests_sla_recompute on requests;
create trigger requests_sla_recompute
  after update of priority, service_id on requests
  for each row
  when (old.priority is distinct from new.priority or old.service_id is distinct from new.service_id)
  execute function requests_sla_recompute();

-- ============ pause/resume on pending_requester ============
create or replace function requests_sla_pause() returns trigger
language plpgsql security definer as $$
declare
  paused numeric;
begin
  if new.status = 'pending_requester' and old.status <> 'pending_requester' then
    new.sla_paused_at = now();
  elsif old.status = 'pending_requester' and new.status <> 'pending_requester'
        and old.sla_paused_at is not null then
    paused := business_minutes_between(old.sla_paused_at, now());
    new.sla_paused_minutes = old.sla_paused_minutes + round(paused)::int;
    new.sla_paused_at = null;
    if new.sla_response_due is not null then
      new.sla_response_due = add_business_minutes(new.sla_response_due, paused);
    end if;
    if new.sla_resolution_due is not null then
      new.sla_resolution_due = add_business_minutes(new.sla_resolution_due, paused);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists requests_sla_pause on requests;
create trigger requests_sla_pause
  before update of status on requests
  for each row
  when (old.status is distinct from new.status)
  execute function requests_sla_pause();

-- ============ escalation rules ============
-- 00002 scaffolded a single-action escalation_rules table that nothing reads
-- or writes (no rows, no frontend/SQL consumers); replace it with the
-- actions-jsonb shape the engine executes.
drop table if exists escalation_rules;
create table escalation_rules (
  id uuid primary key default gen_random_uuid(),
  trigger_on text not null check (trigger_on in ('sla_warning', 'sla_breached')),
  dept dept_code,                          -- null = all departments
  service_id uuid references services(id), -- null = all services
  actions jsonb not null default '{}',     -- { notify_roles: [], bump_priority: bool, escalate_status: bool }
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table escalation_rules enable row level security;
create policy esc_read on escalation_rules for select to authenticated using (true);
create policy esc_admin_write on escalation_rules for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));

insert into escalation_rules (trigger_on, actions)
select 'sla_warning',
       jsonb_build_object('notify_roles', jsonb_build_array('assignee', 'team_lead'),
                          'bump_priority', false, 'escalate_status', false)
where not exists (select 1 from escalation_rules where trigger_on = 'sla_warning' and dept is null and service_id is null);

insert into escalation_rules (trigger_on, actions)
select 'sla_breached',
       jsonb_build_object('notify_roles', jsonb_build_array('team_lead', 'dept_head'),
                          'bump_priority', true, 'escalate_status', true)
where not exists (select 1 from escalation_rules where trigger_on = 'sla_breached' and dept is null and service_id is null);

-- ============ the 5-minute sweep ============
create or replace function sla_check() returns int
language plpgsql security definer as $$
declare
  req record;
  rule record;
  hits int := 0;
  warn_at timestamptz;
  acted jsonb;
begin
  if not exists (select 1 from feature_flags where key = 'sla_engine' and is_enabled) then
    return 0; -- engine dormant
  end if;

  for req in
    select * from requests
    where status not in ('resolved', 'closed', 'cancelled')
      and sla_resolution_due is not null
      and sla_paused_at is null
      and (sla_breached_at is null or sla_warned_at is null)
  loop
    -- breach: past due, once (guarded by the stamp)
    if req.sla_breached_at is null and now() > req.sla_resolution_due then
      select * into rule from escalation_rules
      where trigger_on = 'sla_breached' and is_enabled
        and (dept is null or dept = req.dept)
        and (service_id is null or service_id = req.service_id)
      order by (service_id is not null)::int desc, (dept is not null)::int desc
      limit 1;

      acted := jsonb_build_object(
        'due', req.sla_resolution_due,
        'notify_roles', coalesce(rule.actions -> 'notify_roles', '[]'::jsonb),
        'priority_bumped', false, 'escalated', false);

      update requests set sla_breached_at = now(),
        sla_warned_at = coalesce(sla_warned_at, now())
      where id = req.id;

      if rule.id is not null and coalesce((rule.actions ->> 'bump_priority')::boolean, false)
         and req.priority <> 'P1' then
        update requests set priority = (case req.priority
          when 'P4' then 'P3' when 'P3' then 'P2' else 'P1' end)::priority
        where id = req.id;
        acted := jsonb_set(acted, '{priority_bumped}', 'true');
      end if;

      if rule.id is not null and coalesce((rule.actions ->> 'escalate_status')::boolean, false)
         and req.status = 'in_progress' then
        update requests set status = 'escalated' where id = req.id;
        acted := jsonb_set(acted, '{escalated}', 'true');
      end if;

      insert into request_events (request_id, actor_id, event_type, detail)
      values (req.id, null, 'sla_breached', acted);
      hits := hits + 1;

    -- warning: past 75% of the window, once
    elsif req.sla_warned_at is null then
      warn_at := req.created_at + (req.sla_resolution_due - req.created_at) * 0.75;
      if now() >= warn_at then
        select * into rule from escalation_rules
        where trigger_on = 'sla_warning' and is_enabled
          and (dept is null or dept = req.dept)
          and (service_id is null or service_id = req.service_id)
        order by (service_id is not null)::int desc, (dept is not null)::int desc
        limit 1;

        update requests set sla_warned_at = now() where id = req.id;
        insert into request_events (request_id, actor_id, event_type, detail)
        values (req.id, null, 'sla_warning', jsonb_build_object(
          'due', req.sla_resolution_due,
          'notify_roles', coalesce(rule.actions -> 'notify_roles', '[]'::jsonb)));
        hits := hits + 1;
      end if;
    end if;
  end loop;
  return hits;
end $$;

-- ============ pg_cron: every 5 minutes ============
do $$ begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron unavailable in this environment (%) — the hosted project schedules sla_check()', sqlerrm;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- dynamic SQL so this block parses even where the cron schema is absent
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'cron' and c.relname = 'job'
    ) then
      return;
    end if;
    execute $q$
      select case when exists (select 1 from cron.job where jobname = 'sla-check-every-5-min')
        then 0 else cron.schedule('sla-check-every-5-min', '*/5 * * * *', 'select public.sla_check()') end
    $q$;
  end if;
end $$;
