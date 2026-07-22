-- 00083 — ACCESS1 branch 4: app_pages becomes a living registry.
--
-- 00082 seeded app_pages from the router's real ids, but the table was
-- UPDATE-only — the same freeze that broke page_access (00013 defined SELECT
-- and UPDATE policies only, so no page could ever be added and the row set
-- fossilised at whatever migrations seeded). This migration adds the write
-- paths, and the accompanying CI parity gate (appPages.parity.test.ts +
-- role_groups_test.sql) asserts the router, the frontend registry and the
-- seeds can never diverge again.

-- register a page / retire a page: system_admin only, audited
drop policy if exists app_pages_insert on app_pages;
create policy app_pages_insert on app_pages for insert to authenticated
  with check (has_role('system_admin'));

drop policy if exists app_pages_delete on app_pages;
create policy app_pages_delete on app_pages for delete to authenticated
  using (has_role('system_admin') and not is_lockable);

create or replace function log_app_page_change() returns trigger
language plpgsql security definer as $$
begin
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'access',
          case tg_op when 'INSERT' then 'app_page_registered'
                     when 'DELETE' then 'app_page_removed'
                     else 'app_page_updated' end,
          jsonb_build_object('key', coalesce(new.key, old.key),
                             'route', coalesce(new.route, old.route)));
  return coalesce(new, old);
end $$;

drop trigger if exists app_pages_audit_t on app_pages;
create trigger app_pages_audit_t
  after insert or update or delete on app_pages
  for each row execute function log_app_page_change();
