-- 00069 — scheduled reporting: cron matcher + dispatcher (W9 B5).
--
-- report_schedules (00067) hold a cron cadence + timezone. A pg_cron sweep runs
-- report_dispatch() every 5 minutes (gated on the reporting_scheduled flag,
-- exactly like sla_check/00043): it turns each due schedule into a report_run,
-- advances next_run_at, invokes generate-report via pg_net, retries failures
-- with backoff, and alerts the owner once when a run finally gives up.
--
-- next_run_at is computed by a small, bounded 5-field cron matcher — no
-- extension parsing, correct for standard '* * * * *' expressions.

-- ============ cron matcher (pure, testable) ============
-- one field ('*', 'a', 'a,b', 'a-b', '*/n', 'a-b/n') against a value
create or replace function cron_field_match(p_field text, p_val int, p_min int, p_max int)
returns boolean language plpgsql immutable as $$
declare part text; lo int; hi int; step int; body text; rng text;
begin
  foreach part in array string_to_array(p_field, ',') loop
    part := btrim(part);
    step := 1;
    if position('/' in part) > 0 then
      step := split_part(part, '/', 2)::int;
      body := split_part(part, '/', 1);
    else
      body := part;
    end if;
    if step < 1 then step := 1; end if;

    if body = '*' then
      lo := p_min; hi := p_max;
    elsif position('-' in body) > 0 then
      lo := split_part(body, '-', 1)::int; hi := split_part(body, '-', 2)::int;
    else
      lo := body::int; hi := lo;
    end if;

    if p_val between lo and hi and ((p_val - lo) % step) = 0 then
      return true;
    end if;
  end loop;
  return false;
exception when others then
  return false;  -- a malformed field never matches (dispatcher parks the schedule)
end $$;

-- whole 5-field expression against a local wall-clock timestamp
create or replace function cron_matches(p_expr text, p_ts timestamp)
returns boolean language plpgsql immutable as $$
declare f text[]; dom_r boolean; dow_r boolean; dom_m boolean; dow_m boolean; dowv int;
begin
  f := regexp_split_to_array(btrim(p_expr), '\s+');
  if array_length(f, 1) <> 5 then return false; end if;

  if not cron_field_match(f[1], extract(minute from p_ts)::int, 0, 59) then return false; end if;
  if not cron_field_match(f[2], extract(hour from p_ts)::int, 0, 23) then return false; end if;
  if not cron_field_match(f[4], extract(month from p_ts)::int, 1, 12) then return false; end if;

  dowv := extract(dow from p_ts)::int;  -- 0=Sun .. 6=Sat
  dom_m := cron_field_match(f[3], extract(day from p_ts)::int, 1, 31);
  dow_m := cron_field_match(f[5], dowv, 0, 6) or (dowv = 0 and cron_field_match(f[5], 7, 0, 7));

  -- standard cron: if BOTH day-of-month and day-of-week are restricted, either
  -- may match; otherwise they AND with the rest.
  dom_r := btrim(f[3]) <> '*';
  dow_r := btrim(f[5]) <> '*';
  if dom_r and dow_r then
    return dom_m or dow_m;
  end if;
  return dom_m and dow_m;
end $$;

-- next firing after `p_after`, evaluated in the schedule's timezone
create or replace function report_next_run(p_expr text, p_tz text, p_after timestamptz)
returns timestamptz language plpgsql stable as $$
declare cand timestamp; i int;
begin
  cand := date_trunc('minute', (p_after at time zone p_tz)) + interval '1 minute';
  for i in 1..527040 loop   -- up to 366 days of minutes
    if cron_matches(p_expr, cand) then
      return cand at time zone p_tz;
    end if;
    cand := cand + interval '1 minute';
  end loop;
  return null;  -- no match within a year (malformed / impossible expression)
end $$;
grant execute on function report_next_run(text, text, timestamptz) to authenticated, service_role;

-- ============ invoke generate-report over pg_net (shared secret) ============
create or replace function report_invoke(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'hook_secret' limit 1;
  exception when others then v_secret := null;
  end;
  if v_secret is null then return; end if;   -- dispatch not configured here
  begin
    perform net.http_post(
      url := 'https://dmuesqmmbxxnxuheuopx.supabase.co/functions/v1/generate-report',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Hook-Secret', v_secret),
      body := jsonb_build_object('run_id', p_run::text)
    );
  exception when others then
    raise warning 'report_invoke failed: %', sqlerrm;   -- next sweep retries
  end;
end $$;
revoke all on function report_invoke(uuid) from public, anon, authenticated;

-- ============ owner alert on a run that exhausted its retries ============
create or replace function report_alert_failed(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r report_runs%rowtype; dname text; ownerupn text; subj text; bodyh text; v_secret text;
begin
  select * into r from report_runs where id = p_run;
  if not found then return; end if;
  select name into dname from report_definitions where id = r.definition_id;
  select upn into ownerupn from profiles where id = r.run_as_owner;

  insert into admin_events (actor_id, area, action, detail)
  values (null, 'reporting', 'report_schedule_failed',
          jsonb_build_object('run_id', p_run, 'schedule_id', r.schedule_id,
                             'owner', r.run_as_owner, 'attempts', r.attempts, 'error', r.error));

  select subject, body_html into subj, bodyh
  from notification_templates where key = 'report_delivery_failed' and dept is null limit 1;
  if ownerupn is null or subj is null then return; end if;
  dname := coalesce(dname, 'report');
  subj := replace(subj, '{{report_name}}', dname);
  bodyh := replace(replace(replace(bodyh, '{{report_name}}', dname),
             '{{run_ref}}', left(p_run::text, 8)), '{{period}}', 'the scheduled period');

  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'hook_secret' limit 1;
  exception when others then v_secret := null;
  end;
  if v_secret is null then return; end if;
  begin
    perform net.http_post(
      url := 'https://dmuesqmmbxxnxuheuopx.supabase.co/functions/v1/send-notification',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Hook-Secret', v_secret),
      body := jsonb_build_object('mode', 'send', 'to', ownerupn, 'subject', subj, 'html', bodyh)
    );
  exception when others then raise warning 'report_alert_failed post: %', sqlerrm;
  end;
end $$;
revoke all on function report_alert_failed(uuid) from public, anon, authenticated;

-- ============ the dispatcher ============
create or replace function report_dispatch() returns int
language plpgsql security definer set search_path = public as $$
declare s record; r record; new_run uuid; n int := 0; v_active boolean;
begin
  if not exists (select 1 from feature_flags where key = 'reporting_scheduled' and is_enabled) then
    return 0;  -- scheduling dormant
  end if;

  -- 1) due schedules -> a fresh run (re-verify the owner is still active)
  for s in select * from report_schedules
           where enabled and next_run_at is not null and next_run_at <= now() loop
    select is_active into v_active from profiles where id = s.run_as_owner;
    if not coalesce(v_active, false) then
      update report_schedules set enabled = false where id = s.id;
      insert into admin_events (actor_id, area, action, detail)
      values (null, 'reporting', 'report_schedule_owner_inactive',
              jsonb_build_object('schedule_id', s.id, 'owner', s.run_as_owner));
      continue;
    end if;

    insert into report_runs (definition_id, definition_version, schedule_id, trigger, status,
                             requested_by, run_as_owner, params, format)
    values (s.definition_id, s.definition_version, s.id, 'schedule', 'queued',
            s.run_as_owner, s.run_as_owner, s.filters_snapshot, s.format)
    returning id into new_run;

    update report_schedules
      set last_run_at = now(), next_run_at = report_next_run(cadence, timezone, now())
      where id = s.id;
    perform report_invoke(new_run);
    n := n + 1;
  end loop;

  -- 2) re-invoke runs whose invoke was lost (still queued after 2 min), attempts < 3
  for r in select * from report_runs
           where status = 'queued' and created_at < now() - interval '2 minutes' and attempts < 3 loop
    perform report_invoke(r.id);
    n := n + 1;
  end loop;

  -- 3) retry failed schedule runs with 5/15/60-minute backoff, attempts < 3
  for r in select * from report_runs
           where status = 'failed' and trigger = 'schedule' and attempts < 3
             and coalesce(finished_at, created_at)
                 < now() - ((array[5, 15, 60])[least(greatest(attempts, 1), 3)] || ' minutes')::interval loop
    perform report_invoke(r.id);
    n := n + 1;
  end loop;

  -- 4) alert the owner once for runs that exhausted their retries
  for r in select rr.* from report_runs rr
           where rr.status = 'failed' and rr.trigger = 'schedule' and rr.attempts >= 3
             and not exists (select 1 from admin_events a
                             where a.action = 'report_schedule_failed' and a.detail->>'run_id' = rr.id::text) loop
    perform report_alert_failed(r.id);
  end loop;

  return n;
end $$;
revoke all on function report_dispatch() from public, anon, authenticated;

-- ============ pg_cron: every 5 minutes (mirrors sla-check/00043) ============
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
      select case when exists (select 1 from cron.job where jobname = 'report-dispatch-every-5-min')
        then 0 else cron.schedule('report-dispatch-every-5-min', '*/5 * * * *', 'select public.report_dispatch()') end
    $q$;
  end if;
end $$;
