-- 00046 — migration-managed dispatch trigger: request_events INSERT posts to
-- the send-notification Edge Function via pg_net, replacing the
-- dashboard-configured Database Webhook so the wiring lives in the repo.
--
-- The X-Hook-Secret value is read from Vault at send time and is NOT stored
-- in this file (this repo is public). REQUIRED SETUP — ONCE PER ENVIRONMENT
-- (Vault contents cannot be seeded by migrations); run in the SQL editor:
--
--   select vault.create_secret('<HOOK_SECRET value>', 'hook_secret');
--
-- Use the same value as the function's HOOK_SECRET secret. See
-- docs/deploy-runbook.md §3. Stacks without the secret (fresh local/CI
-- resets) skip silently, so no test traffic ever reaches the hosted function.

do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net unavailable here (%) — request-event dispatch disabled', sqlerrm;
end $$;

do $$ begin
  create extension if not exists supabase_vault;
exception when others then
  raise notice 'vault unavailable here (%)', sqlerrm;
end $$;

create or replace function notify_request_event() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'hook_secret'
    limit 1;
  exception when others then
    v_secret := null; -- no vault on this stack
  end;
  if v_secret is null then
    return new; -- dispatch not configured here — skip silently
  end if;

  begin
    perform net.http_post(
      url := 'https://dmuesqmmbxxnxuheuopx.supabase.co/functions/v1/send-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Hook-Secret', v_secret
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'request_events',
        'record', row_to_json(new)
      )
    );
  exception when others then
    -- notification transport must never block the event write itself
    raise warning 'send-notification dispatch failed for request_event %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists request_events_notify on request_events;
create trigger request_events_notify
  after insert on request_events
  for each row execute function notify_request_event();
