-- Builtin-dashboard migration (pgTAP) — REPORTING v2 branch 8, migration 00089.
--
-- The 7 builtin templates became widgets on three org-visible builtin
-- dashboards; the employee_performance widget keeps its personal-data gate;
-- builtin boards stay read-only for non-admins; and reporting_diagnostics()
-- answers the three gates for admins only.

begin;
select plan(8);

insert into auth.users (id, email) values
  ('e9000000-0000-0000-0000-000000000001','plain@t'),
  ('e9000000-0000-0000-0000-000000000002','lead@t'),
  ('e9000000-0000-0000-0000-000000000003','admin@t') on conflict do nothing;
insert into profiles (id, upn, display_name) values
  ('e9000000-0000-0000-0000-000000000001','plain@t','Plain'),
  ('e9000000-0000-0000-0000-000000000002','lead@t','Lead'),
  ('e9000000-0000-0000-0000-000000000003','admin@t','Admin') on conflict (id) do nothing;
insert into role_assignments (profile_id, role) values
  ('e9000000-0000-0000-0000-000000000002','team_lead'),
  ('e9000000-0000-0000-0000-000000000003','system_admin');

set local role authenticated;
select set_config('request.jwt.claims','{"tenant_id":"11111111-1111-1111-1111-111111111111"}', true);

-- the three builtin boards are org-visible to everyone
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*)::int from report_dashboards where kind = 'builtin'
    and slug in ('service-operations','assets-and-projects','workforce-performance')),
  3, 'the three builtin dashboards exist and are org-visible');

-- a role-less user sees the widgets EXCEPT employee_performance (8 of 9)
select is(
  (select count(*)::int from report_widgets w
    join report_dashboards d on d.id = w.dashboard_id where d.kind = 'builtin'),
  8, 'a role-less user sees every builtin widget except employee performance');
select is(
  (select count(*)::int from report_widgets where data_source = 'employee_performance'),
  0, 'the employee_performance widget row is hidden from a role-less user');

-- a team_lead sees all 9, including employee performance
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::int from report_widgets w
    join report_dashboards d on d.id = w.dashboard_id where d.kind = 'builtin'),
  9, 'a team_lead sees all nine builtin widgets');

-- builtin boards are read-only for non-admins
do $upd$ declare n int; begin
  update report_dashboards set name = 'hijacked' where slug = 'service-operations';
  get diagnostics n = row_count;
  perform set_config('test.upd_count', n::text, true);
end $upd$;
select is(
  current_setting('test.upd_count', true)::int,
  0, 'a non-admin cannot rename a builtin dashboard');

-- diagnostics: admin-only, answers the three gates
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000003', true);
select is(
  (select reporting_diagnostics() ?& array['reporting','reporting_scheduled','hook_secret']),
  true, 'reporting_diagnostics answers all three gates for an admin');
select is(
  (select jsonb_typeof(reporting_diagnostics() -> 'hook_secret')),
  'boolean', 'each gate is a boolean, never the secret itself');
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000001', true);
select throws_ok(
  'select reporting_diagnostics()',
  '42501', null, 'diagnostics are refused for non-admins');

select * from finish();
rollback;
