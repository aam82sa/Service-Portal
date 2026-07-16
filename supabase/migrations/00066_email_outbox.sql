-- 00066 — durable email delivery: outbox + retry/DLQ (Wave 2.3).
--
-- Before this, a request_events INSERT fired a single fire-and-forget
-- net.http_post to send-notification (00046); if the function returned 5xx or
-- the SMTP/Graph send failed, the notification was silently dropped — the
-- trigger swallowed the error to protect the event write. Now every mail-worthy
-- event is written to a durable outbox in the same transaction as the event,
-- and a drainer sends with bounded retries and a dead-letter state.

-- ---- the queue ----
create table if not exists email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id bigint not null references request_events(id) on delete cascade,
  payload jsonb not null,                    -- the request_events record
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'dead')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),
  recipients text[],
  last_error text,
  provider_detail jsonb,
  tenant_id uuid,                            -- forward-compat for per-tenant endpoints
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id)                          -- one queue row per event (idempotent enqueue)
);
create index if not exists email_outbox_due_idx
  on email_outbox (next_attempt_at) where status in ('queued', 'failed', 'sending');

alter table email_outbox enable row level security;
-- observability only: dept heads and admins can watch the queue; no client
-- writes — the drainer moves rows via service-role RPCs below.
create policy eo_read on email_outbox for select to authenticated
  using (has_role('dept_head') or has_role('system_admin'));

create or replace function email_outbox_touch() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists email_outbox_touch_t on email_outbox;
create trigger email_outbox_touch_t before update on email_outbox
  for each row execute function email_outbox_touch();

-- ---- fire the drainer (best-effort, low-latency nudge) ----
create or replace function email_drain_nudge() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'hook_secret' limit 1;
  exception when others then v_secret := null;
  end;
  if v_secret is null then return; end if;   -- dispatch not configured here
  begin
    perform net.http_post(
      url := 'https://dmuesqmmbxxnxuheuopx.supabase.co/functions/v1/send-notification',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Hook-Secret', v_secret),
      body := jsonb_build_object('mode', 'drain')
    );
  exception when others then
    raise warning 'email drain nudge failed: %', sqlerrm;  -- cron will catch up
  end;
end $$;

-- ---- enqueue on event, then nudge (replaces the direct post in 00046) ----
create or replace function notify_request_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- durable: the queue row commits with the event; nothing can be dropped
  insert into email_outbox (event_id, payload)
  values (new.id, row_to_json(new)::jsonb)
  on conflict (event_id) do nothing;
  perform email_drain_nudge();
  return new;
end $$;
-- trigger itself is unchanged (request_events_notify from 00046 still points here)

-- ---- claim a batch to send (service-role only) ----
-- Locks due rows FOR UPDATE SKIP LOCKED so concurrent drains never double-send;
-- also reclaims 'sending' rows whose worker died (stale lease > 5 min).
create or replace function claim_email_batch(p_limit int default 20)
returns setof email_outbox language plpgsql security definer set search_path = public as $$
begin
  return query
  update email_outbox o
  set status = 'sending', attempts = o.attempts + 1
  where o.id in (
    select id from email_outbox
    where (status in ('queued', 'failed') and next_attempt_at <= now())
       or (status = 'sending' and updated_at < now() - interval '5 minutes')
    order by next_attempt_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  returning o.*;
end $$;
revoke all on function claim_email_batch(int) from public, anon, authenticated;

-- ---- record a send result (service-role only) ----
create or replace function mark_email_result(
  p_id uuid, p_ok boolean, p_recipients text[] default null,
  p_error text default null, p_detail jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  o email_outbox%rowtype;
  wait int;
begin
  select * into o from email_outbox where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    update email_outbox set status = 'sent', recipients = coalesce(p_recipients, recipients),
      last_error = null, provider_detail = p_detail where id = p_id;
  elsif o.attempts >= o.max_attempts then
    update email_outbox set status = 'dead', last_error = p_error,
      recipients = coalesce(p_recipients, recipients), provider_detail = p_detail where id = p_id;
    insert into admin_events (actor_id, area, action, detail)
    values (null, 'notifications', 'email_dead_lettered',
            jsonb_build_object('outbox_id', p_id, 'event_id', o.event_id,
                               'attempts', o.attempts, 'error', p_error));
  else
    -- backoff mirrors backoffMinutes() in outbox.ts: 1/5/15/60/240
    wait := (array[1, 5, 15, 60, 240])[least(o.attempts, 5)];
    update email_outbox set status = 'failed', last_error = p_error,
      recipients = coalesce(p_recipients, recipients), provider_detail = p_detail,
      next_attempt_at = now() + make_interval(mins => wait) where id = p_id;
  end if;
end $$;
revoke all on function mark_email_result(uuid, boolean, text[], text, jsonb) from public, anon, authenticated;

-- ---- schedule the drainer every minute (mirrors the sla-check cron scaffold) ----
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
      select case when exists (select 1 from cron.job where jobname = 'email-drain-every-min')
        then 0 else cron.schedule('email-drain-every-min', '* * * * *', 'select public.email_drain_nudge()') end
    $q$;
  end if;
end $$;
