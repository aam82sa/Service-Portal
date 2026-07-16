-- 00070 — built-in report definitions (W9 B7).
--
-- Seven builtin report_definitions whose config compiles against the
-- generate-report allowlist (00067/B2). Idempotent by slug. The sensitive
-- Employee performance report is dept-visibility + personal-data flagged and
-- gets an extra read policy so a plain agent can't even see it in the library.

insert into report_definitions (slug, name, description, kind, data_source, config, visibility, dept, contains_personal_data)
select v.slug, v.name, v.description, 'builtin', v.data_source, v.config::jsonb, v.visibility, null, v.pd
from (values
  -- 1. SLA compliance — met vs breached per request, worst first
  ('sla-compliance', 'SLA compliance',
   'Every request with its resolution SLA, whether it was met, and whether it is currently breached — breaches first.',
   'sla',
   '{"columns":["ref","dept","priority","status","sla_resolution_due","sla_met","breached"],"sort":[{"col":"breached","dir":"desc"},{"col":"sla_resolution_due","dir":"asc"}]}',
   'org', false),

  -- 2. Request volume by department
  ('request-volume-by-dept', 'Request volume by department',
   'Counts of requests grouped by department and status.',
   'requests',
   '{"group_by":["dept","status"],"aggregations":[{"fn":"count"}],"sort":[{"col":"count_all","dir":"desc"}]}',
   'org', false),

  -- 3. Open-request aging — oldest first
  ('open-request-aging', 'Open-request aging',
   'Open requests (not resolved, closed, or cancelled) ordered by age, oldest first.',
   'requests',
   '{"columns":["ref","dept","priority","status","age_days","created_at"],"filters":[{"col":"status","op":"in","value":["new","triaged","in_progress","pending_approval","pending_requester","escalated"]}],"sort":[{"col":"age_days","dir":"desc"}]}',
   'org', false),

  -- 4. Asset inventory — counts by category and status
  ('asset-inventory', 'Asset inventory',
   'IT asset counts grouped by category and status.',
   'assets',
   '{"group_by":["category","status"],"aggregations":[{"fn":"count"}],"sort":[{"col":"count_all","dir":"desc"}]}',
   'org', false),

  -- 5. PMO project status — counts by stage and scope
  ('pmo-project-status', 'PMO project status',
   'Projects grouped by status and department scope.',
   'pmo_projects',
   '{"group_by":["status","department_scope"],"aggregations":[{"fn":"count"}],"sort":[{"col":"count_all","dir":"desc"}]}',
   'org', false),

  -- 6. Department performance (fixed aggregate source)
  ('department-performance', 'Department performance',
   'Per department: volume, resolved, backlog, breaches, SLA compliance %, average resolution, and reopens.',
   'dept_performance', '{}', 'org', false),

  -- 7. Employee performance (SENSITIVE — dept-gated + personal data)
  ('employee-performance', 'Employee performance',
   'Per agent: assigned, resolved, open load, SLA hit rate, average resolution, and reopens. Access is restricted; contains personal data (PDPL: performance management).',
   'employee_performance', '{}', 'dept', true)
) as v(slug, name, description, data_source, config, visibility, pd)
where not exists (select 1 from report_definitions d where d.slug = v.slug);

-- Employee performance is visibility='dept' with dept NULL, so the base rd_read
-- policy exposes it only to owner/executive/system_admin. Broaden to dept heads
-- and team leads (who legitimately review team performance) — a plain agent
-- still can't see it. Permissive policies are OR-ed together.
drop policy if exists rd_read_employee_perf on report_definitions;
create policy rd_read_employee_perf on report_definitions for select to authenticated
  using (
    is_active and kind = 'builtin' and data_source = 'employee_performance'
    and (has_role('dept_head') or has_role('team_lead') or has_role('executive') or has_role('system_admin'))
  );
