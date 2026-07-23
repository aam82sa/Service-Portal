-- Dashboard RLS (pgTAP) — REPORTING v2 branch 5, migration 00088.
--
-- Proves the report_definitions mirror on report_dashboards/report_widgets:
-- private is owner-only, dept follows the uuid-scoped roles, org is visible
-- to everyone, builtin writes are admin-only, widgets are exactly as visible
-- and writable as their parent dashboard, and employee_performance widgets
-- carry the 00070 personal-data role gate.

begin;
select plan(12);

-- fixtures
insert into auth.users (id, email) values
  ('d8000000-0000-0000-0000-000000000001','owner@t'),
  ('d8000000-0000-0000-0000-000000000002','other@t'),
  ('d8000000-0000-0000-0000-000000000003','itagent@t'),
  ('d8000000-0000-0000-0000-000000000004','adagent@t'),
  ('d8000000-0000-0000-0000-000000000005','lead@t') on conflict do nothing;
insert into profiles (id, upn, display_name) values
  ('d8000000-0000-0000-0000-000000000001','owner@t','Owner'),
  ('d8000000-0000-0000-0000-000000000002','other@t','Other'),
  ('d8000000-0000-0000-0000-000000000003','itagent@t','IT Agent'),
  ('d8000000-0000-0000-0000-000000000004','adagent@t','Admin Agent'),
  ('d8000000-0000-0000-0000-000000000005','lead@t','Lead') on conflict (id) do nothing;
insert into role_assignments (profile_id, role, dept, dept_id)
select 'd8000000-0000-0000-0000-000000000003','agent','IT', id from departments where code='IT';
insert into role_assignments (profile_id, role, dept, dept_id)
select 'd8000000-0000-0000-0000-000000000004','agent','ADMIN', id from departments where code='ADMIN';
insert into role_assignments (profile_id, role) values
  ('d8000000-0000-0000-0000-000000000005','team_lead');

insert into report_dashboards (id, slug, name, kind, visibility, dept_id, owner_id) values
  ('f8000000-0000-0000-0000-000000000001','t-private','My private board','custom','private',null,
   'd8000000-0000-0000-0000-000000000001'),
  ('f8000000-0000-0000-0000-000000000003','t-org','Org board','custom','org',null,
   'd8000000-0000-0000-0000-000000000001'),
  ('f8000000-0000-0000-0000-000000000004','t-builtin','Builtin board','builtin','org',null,null);
insert into report_dashboards (id, slug, name, kind, visibility, dept_id, owner_id)
select 'f8000000-0000-0000-0000-000000000002','t-dept','IT dept board','custom','dept', d.id,
       'd8000000-0000-0000-0000-000000000001'
  from departments d where d.code='IT';

insert into report_widgets (id, dashboard_id, position, widget_type, data_source, title) values
  ('a9000000-0000-0000-0000-000000000001','f8000000-0000-0000-0000-000000000001',0,'kpi','requests','Private KPI'),
  ('a9000000-0000-0000-0000-000000000002','f8000000-0000-0000-0000-000000000003',0,'table','employee_performance','People table');

set local role authenticated;
select set_config('request.jwt.claims','{"tenant_id":"11111111-1111-1111-1111-111111111111"}', true);

-- reads: owner sees everything they own plus org-visible boards
select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*)::int from report_dashboards where slug like 't-%'),
  4, 'the owner sees their private/dept/org boards and the builtin');

-- a role-less user sees only org-visible boards
select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::int from report_dashboards where slug like 't-%'),
  2, 'a role-less user sees only org-visible boards');

-- dept visibility follows the uuid-scoped role
select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000003', true);
select is(
  (select count(*)::int from report_dashboards where slug = 't-dept'),
  1, 'an IT agent sees the IT dept board');
select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000004', true);
select is(
  (select count(*)::int from report_dashboards where slug = 't-dept'),
  0, 'an ADMIN agent does not see the IT dept board');

-- widgets follow their dashboard
select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*)::int from report_widgets where title = 'Private KPI'),
  1, 'the owner sees the widget on their private board');
select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::int from report_widgets where title = 'Private KPI'),
  0, 'a private board''s widget is invisible to everyone else');

-- employee_performance widgets carry the personal-data role gate (00070)
select is(
  (select count(*)::int from report_widgets where title = 'People table'),
  0, 'an employee_performance widget is hidden from a role-less user even on an org board');
select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000005', true);
select is(
  (select count(*)::int from report_widgets where title = 'People table'),
  1, 'a team_lead may see the employee_performance widget');

-- writes: only the owner (or admin) touches a custom board
select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000002', true);
do $upd$ declare n int; begin
  update report_dashboards set name = 'hijacked' where slug = 't-org';
  get diagnostics n = row_count;
  perform set_config('test.upd_count', n::text, true);
end $upd$;
select is(
  current_setting('test.upd_count', true)::int,
  0, 'a non-owner cannot update someone else''s custom board');
select throws_ok(
  $$insert into report_dashboards (slug, name, kind, visibility, owner_id)
    values ('t-evil-builtin','Evil','builtin','org','d8000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'a non-admin cannot create a builtin board');
select throws_ok(
  $$insert into report_widgets (dashboard_id, position, widget_type, data_source, title)
    values ('f8000000-0000-0000-0000-000000000001',1,'bar','requests','Sneaky widget')$$,
  '42501', null, 'a non-owner cannot attach widgets to someone else''s board');

-- the owner can build: insert their own board + widget
select set_config('request.jwt.claim.sub','d8000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $q$do $mine$ begin
    insert into report_dashboards (slug, name, kind, visibility, owner_id)
    values ('t-mine-2','Second board','custom','private','d8000000-0000-0000-0000-000000000001');
    insert into report_widgets (dashboard_id, position, widget_type, data_source, title)
    select id, 0, 'bar', 'requests', 'My widget' from report_dashboards where slug = 't-mine-2';
  end $mine$$q$,
  'an owner can create their own board and widgets');

select * from finish();
rollback;
