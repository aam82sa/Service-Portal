-- Config-change RPC gate (pgTAP) — WORKFL1 Part 2, migration 00079.
--
-- Proves the branch-8 contract: preview counts, the hard-delete guard, the
-- TOCTOU re-check, and each of the three resolutions (finish_old / migrate /
-- close). Runs under `supabase test db` in a rolled-back transaction.

begin;
select plan(13);

-- ── fixtures ────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-000000000001','sa@t'),
  ('b0000000-0000-0000-0000-000000000010','req@t') on conflict do nothing;
insert into profiles (id, upn, display_name) values
  ('b0000000-0000-0000-0000-000000000001','sa@t','SA'),
  ('b0000000-0000-0000-0000-000000000010','req@t','Req') on conflict (id) do nothing;
insert into role_assignments (profile_id, role, dept_id) values
  ('b0000000-0000-0000-0000-000000000001','system_admin', null);

insert into services (id, dept, dept_id, code, name)
select v.id, 'IT', d.id, v.code, v.name
from (values ('c0000000-0000-0000-0000-000000000001'::uuid,'TST','Test'),
             ('c0000000-0000-0000-0000-000000000002'::uuid,'FRESH','Fresh')) v(id,code,name),
     (select id from departments where code='IT') d;
insert into form_versions (id, service_id, version, status) values
  ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',1,'published'),
  ('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001',2,'published');

insert into requests (id, ref, service_id, dept, dept_id, requester_id, status, title, form_version_id)
select v.id, v.ref, 'c0000000-0000-0000-0000-000000000001', 'IT', d.id,
       'b0000000-0000-0000-0000-000000000010', v.st::request_status, v.ref, 'd0000000-0000-0000-0000-000000000001'
from (values ('e0000000-0000-0000-0000-000000000001'::uuid,'REQ-T1','new'),
             ('e0000000-0000-0000-0000-000000000002'::uuid,'REQ-T2','in_progress'),
             ('e0000000-0000-0000-0000-000000000003'::uuid,'REQ-T3','triaged'),
             ('e0000000-0000-0000-0000-000000000004'::uuid,'REQ-T4','closed')) v(id,ref,st),
     (select id from departments where code='IT') d;

set local role authenticated;
select set_config('request.jwt.claims','{"tenant_id":"11111111-1111-1111-1111-111111111111"}', true);
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001', true);

-- ── preview ───────────────────────────────────────────────────────────
select is((preview_config_change('service','c0000000-0000-0000-0000-000000000001')->>'open_requests')::int,
          3, 'preview: 3 open requests on the service');
select is((preview_config_change('service','c0000000-0000-0000-0000-000000000001')->>'historical_requests')::int,
          4, 'preview: 4 historical (incl. the closed one)');
select is((preview_config_change('service','c0000000-0000-0000-0000-000000000001')->>'can_hard_delete')::boolean,
          false, 'preview: hard delete blocked while history exists');
select is((preview_config_change('service','c0000000-0000-0000-0000-000000000002')->>'can_hard_delete')::boolean,
          true, 'preview: fresh service can be hard-deleted');

-- ── delete guard ────────────────────────────────────────────────────────
select throws_ok(
  $$ select apply_config_change('service','c0000000-0000-0000-0000-000000000001','{"action":"delete"}','finish_old','n') $$,
  '23503', null, 'hard delete on a service with history is refused');

select lives_ok(
  $$ select apply_config_change('service','c0000000-0000-0000-0000-000000000002','{"action":"delete"}','finish_old','cleanup') $$,
  'hard delete on a zero-history service succeeds');
select is((select count(*)::int from services where id='c0000000-0000-0000-0000-000000000002'),
          0, 'the fresh service row is gone');

-- ── TOCTOU ────────────────────────────────────────────────────────────
select throws_ok(
  $$ select apply_config_change('service','c0000000-0000-0000-0000-000000000001',
       '{"action":"retire","impact":{"open_requests":99}}','finish_old','n') $$,
  '40001', null, 'apply aborts when the shown impact no longer matches');

-- ── migrate (form v1 -> v2) ─────────────────────────────────────────────
select lives_ok(
  $$ select apply_config_change('form','d0000000-0000-0000-0000-000000000001',
       '{"action":"retire","to_version_id":"d0000000-0000-0000-0000-000000000002","impact":{"open_requests":3}}',
       'migrate','to v2') $$, 'migrate re-points open requests to the new form version');
select is((select count(*)::int from requests
             where form_version_id='d0000000-0000-0000-0000-000000000002'
               and status not in ('resolved','closed','cancelled')),
          3, 'migrate: 3 open requests now on v2');
select is((select count(*)::int from requests where form_version_id='d0000000-0000-0000-0000-000000000001'),
          1, 'migrate: the closed request stays on v1');

-- ── close (Ady's condition) ─────────────────────────────────────────────
select lives_ok(
  $$ select apply_config_change('service','c0000000-0000-0000-0000-000000000001',
       '{"action":"retire","impact":{"open_requests":3}}','close','retired for showcase') $$,
  'close cancels the open requests and retires the service');
select is((select count(*)::int from requests
             where service_id='c0000000-0000-0000-0000-000000000001' and status='cancelled'),
          3, 'close: the 3 open requests are cancelled (the closed one untouched)');

reset role;
select * from finish();
rollback;
