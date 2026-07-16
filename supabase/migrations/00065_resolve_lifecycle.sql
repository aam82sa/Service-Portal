-- 00065 — resolve feedback window: requester reopen + rating + auto-close (Wave 2.2).
--
-- When an agent resolves a request, the requester now has a feedback window
-- (24h) to reopen it or rate the outcome. If they do neither, the request
-- auto-closes so the queue doesn't accumulate resolved-but-never-closed work.
-- The lifecycle already permits resolved→closed and resolved→in_progress
-- (00053 guard); this adds the timestamps, the requester-facing RPCs, and the
-- pg_cron sweep that closes stale resolved requests.

-- ---- window + satisfaction columns ----
alter table requests add column if not exists resolved_at timestamptz;
alter table requests add column if not exists closed_at timestamptz;
alter table requests add column if not exists reopened_count int not null default 0;
alter table requests add column if not exists rating smallint
  check (rating is null or rating between 1 and 5);
alter table requests add column if not exists rating_comment text;
alter table requests add column if not exists rated_at timestamptz;
create index if not exists requests_resolved_open_idx
  on requests (resolved_at) where status = 'resolved';

-- how long a resolved request waits before auto-close (hours)
insert into feature_flags (key, name, description, category, is_enabled)
values ('auto_close', 'Auto-close resolved requests',
        'Close resolved requests automatically after the 24-hour feedback window, unless the requester reopens or is still rating.',
        'operations', false)
on conflict (key) do nothing;

-- ---- stamp resolved_at / closed_at; reopening clears the window ----
create or replace function requests_stamp_resolution() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'resolved' then
      new.resolved_at := now();
    elsif old.status = 'resolved' and new.status = 'in_progress' then
      new.resolved_at := null;               -- reopened → window no longer runs
      new.reopened_count := old.reopened_count + 1;
    end if;
    if new.status = 'closed' then
      new.closed_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists requests_stamp_resolution_t on requests;
create trigger requests_stamp_resolution_t before update on requests
  for each row execute function requests_stamp_resolution();

-- ---- requester reopens within the window (or staff anytime) ----
create or replace function reopen_request(p_request uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r requests%rowtype;
  is_requester boolean;
  is_staff boolean;
begin
  select * into r from requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.status <> 'resolved' then
    raise exception 'only a resolved request can be reopened';
  end if;
  is_requester := (r.requester_id = auth.uid());
  is_staff := has_role('agent', r.dept) or has_role('team_lead', r.dept)
              or has_role('dept_head', r.dept) or has_role('system_admin');
  if not (is_requester or is_staff) then
    raise exception 'only the requester or department staff can reopen this request';
  end if;
  -- the requester's reopen right is bounded by the feedback window; staff may
  -- reopen a resolved request at any time until it closes
  if is_requester and not is_staff
     and r.resolved_at is not null and r.resolved_at < now() - interval '24 hours' then
    raise exception 'the feedback window has closed — please raise a new request';
  end if;

  update requests set status = 'in_progress' where id = p_request;
  insert into request_events (request_id, actor_id, event_type, detail)
  values (p_request, auth.uid(), 'reopened',
          jsonb_build_object('reason', p_reason, 'by', case when is_requester then 'requester' else 'staff' end));
end $$;

-- ---- requester rates a resolved/closed request ----
create or replace function rate_request(p_request uuid, p_rating smallint, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r requests%rowtype;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;
  select * into r from requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.requester_id <> auth.uid() then
    raise exception 'only the requester can rate this request';
  end if;
  if r.status not in ('resolved', 'closed') then
    raise exception 'a request can only be rated once resolved';
  end if;
  update requests
  set rating = p_rating, rating_comment = nullif(btrim(coalesce(p_comment, '')), ''), rated_at = now()
  where id = p_request;
  insert into request_events (request_id, actor_id, event_type, detail)
  values (p_request, auth.uid(), 'rated', jsonb_build_object('rating', p_rating));
end $$;

-- ---- pg_cron sweep: close resolved requests past the feedback window ----
create or replace function close_stale_resolved() returns int
language plpgsql security definer set search_path = public as $$
declare
  req record;
  hits int := 0;
begin
  if not exists (select 1 from feature_flags where key = 'auto_close' and is_enabled) then
    return 0;
  end if;
  for req in
    select id, ref from requests
    where status = 'resolved' and resolved_at is not null
      and resolved_at < now() - interval '24 hours'
    order by resolved_at
    limit 500
  loop
    -- a service whose published workflow forbids resolved→closed is skipped by
    -- the guard; swallow it so one odd workflow can't stall the whole sweep
    begin
      update requests set status = 'closed' where id = req.id;
      insert into request_events (request_id, actor_id, event_type, detail)
      values (req.id, null, 'auto_closed', jsonb_build_object('after', '24h feedback window'));
      hits := hits + 1;
    exception when others then
      insert into admin_events (actor_id, area, action, detail)
      values (null, 'governance', 'auto_close_skipped',
              jsonb_build_object('ref', req.ref, 'error', sqlerrm));
    end;
  end loop;
  return hits;
end $$;

-- ---- schedule the sweep hourly (mirrors the sla-check cron scaffold) ----
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'cron' and c.relname = 'job'
    ) then
      return;
    end if;
    execute $q$
      select case when exists (select 1 from cron.job where jobname = 'auto-close-resolved-hourly')
        then 0 else cron.schedule('auto-close-resolved-hourly', '7 * * * *', 'select public.close_stale_resolved()') end
    $q$;
  end if;
end $$;

-- backfill resolved_at for requests already sitting in resolved (best effort:
-- last resolved event, else now) so the window starts running for them
update requests r
set resolved_at = coalesce((
    select max(e.created_at) from request_events e
    where e.request_id = r.id and e.event_type in ('resolved', 'status_change')
  ), now())
where r.status = 'resolved' and r.resolved_at is null;
