-- 00081 — ACCESS1 branch 1: keep teams/routing_rules dept_id in sync.
--
-- The dept_id cutover (00074/00075) repointed all READS to dept_id, but the
-- admin UI kept writing only the legacy dept code, and the 00074 backfill was
-- a one-time UPDATE. Consequences, live today:
--
--   * every routing rule created since the cutover has dept_id NULL, and
--     resolve_team filters `where r.dept_id = p_dept` — the rule saves, lists,
--     and can never match. Only backfilled rules actually route.
--   * every team created since the cutover has dept_id NULL, which makes
--     teams_dept_admin_write's has_role('dept_admin', dept_id) pass for a
--     dept_admin of ANY department (the uuid overload treats a null scope as
--     "any"), so any dept admin could edit those teams.
--
-- Fix at the database layer so every writer is safe, not just the UI: a
-- BEFORE INSERT/UPDATE trigger that derives dept_id from the legacy code, and
-- a backfill for the rows already broken. RLS WITH CHECK runs after BEFORE
-- triggers, so the filled dept_id is what the policy verifies — this closes
-- the any-dept-admin hole for new rows too.

create or replace function dept_id_from_code_sync()
returns trigger language plpgsql as $$
begin
  if new.dept_id is null and new.dept is not null then
    select d.id into new.dept_id from departments d where d.code = new.dept::text;
  end if;
  return new;
end $$;

drop trigger if exists teams_dept_id_sync_t on teams;
create trigger teams_dept_id_sync_t
  before insert or update on teams
  for each row execute function dept_id_from_code_sync();

drop trigger if exists routing_rules_dept_id_sync_t on routing_rules;
create trigger routing_rules_dept_id_sync_t
  before insert or update on routing_rules
  for each row execute function dept_id_from_code_sync();

-- backfill the rows created since the cutover
update teams t set dept_id = d.id
  from departments d
 where t.dept_id is null and t.dept is not null and d.code = t.dept::text;

update routing_rules r set dept_id = d.id
  from departments d
 where r.dept_id is null and r.dept is not null and d.code = r.dept::text;
