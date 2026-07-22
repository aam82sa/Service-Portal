-- 00085 — ACCESS1 branch 2: work distribution — keep the engine, delete the switch.
--
-- The audit's verdict, verified: the global `auto_assignment` feature flag is
-- read by NOTHING (a repo-wide grep finds exactly one hit — its own seed line).
-- Flipping it changed nothing except an admin_events row. The real control is
-- per-team teams.assignment_strategy, read by auto_assign_member(), which
-- correctly skips inactive profiles and anyone with an active out-of-office
-- delegation. That engine stays untouched.
--
-- What this migration does:
--   * departments.route_via_rules — the missing routing switch. Today there is
--     no way to stop routing without deleting every rule (at which point
--     requests land unrouted and are visible only in a manager-gated tab).
--     When false, requests skip resolve_team and land in the department tray.
--   * requests_route_team_fn honours it.
--   * drops the orphaned assignment_rules table — RLS'd, dragged through the
--     dept_id migration, never read or written by anything.
--   * deletes the six dead feature flags (each appears only in its own seed):
--     auto_assignment, status_emails, email_to_ticket, csat_survey, api_keys,
--     workflow_designer, escalation_rules. Live flags (sla_engine, auto_close,
--     reporting, reporting_scheduled, announcements) are untouched.

-- ── the routing switch ──────────────────────────────────────────────────
alter table departments add column if not exists route_via_rules boolean not null default true;

create or replace function requests_route_team_fn()
returns trigger language plpgsql security definer as $$
declare
  svc_dept uuid;
  use_rules boolean;
begin
  if new.team_id is not null then return new; end if;
  select s.dept_id into svc_dept from services s where s.id = new.service_id;
  select d.route_via_rules into use_rules from departments d where d.id = svc_dept;
  if coalesce(use_rules, true) then
    new.team_id = resolve_team(svc_dept, new.service_id, new.title);
  end if;
  -- routing off: team_id stays null — the request sits in the department tray
  return new;
end $$;

-- ── delete the meaningless switch and its dead siblings ────────────────
delete from feature_flags where key in (
  'auto_assignment', 'status_emails', 'email_to_ticket',
  'csat_survey', 'api_keys', 'workflow_designer', 'escalation_rules'
);

-- ── drop the fully orphaned table ──────────────────────────────────────
drop table if exists assignment_rules;
