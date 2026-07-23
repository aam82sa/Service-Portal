-- Live-query gate (pgTAP) — REPORTING v2 branch 2, migration 00087.
--
-- Proves the caller-RLS contract: report_query_caller runs the compiled SQL
-- under the CALLER's own JWT, so a requester sees only their own requests and
-- a dept-scoped agent only their department's — with no impersonation and no
-- report_runs row. The select-only and single-statement guards are the same
-- ones report_fetch_rows enforces.

begin;
select plan(6);

-- fixtures: a requester with one request, an IT agent, an ADMIN request by someone else
insert into auth.users (id, email) values
  ('a7000000-0000-0000-0000-000000000001','req@t'),
  ('a7000000-0000-0000-0000-000000000002','agent@t'),
  ('a7000000-0000-0000-0000-000000000003','other@t') on conflict do nothing;
insert into profiles (id, upn, display_name) values
  ('a7000000-0000-0000-0000-000000000001','req@t','Req'),
  ('a7000000-0000-0000-0000-000000000002','agent@t','Agent'),
  ('a7000000-0000-0000-0000-000000000003','other@t','Other') on conflict (id) do nothing;
insert into role_assignments (profile_id, role, dept, dept_id)
select 'a7000000-0000-0000-0000-000000000002','agent','IT', id from departments where code='IT';

insert into services (id, dept, dept_id, code, name)
select 'c7000000-0000-0000-0000-000000000001','IT', d.id,'LQI','Live IT' from departments d where d.code='IT';
insert into services (id, dept, dept_id, code, name)
select 'c7000000-0000-0000-0000-000000000002','ADMIN', d.id,'LQA','Live Admin' from departments d where d.code='ADMIN';

insert into requests (id, ref, service_id, requester_id, title) values
  ('e7000000-0000-0000-0000-000000000001','REQ-LQ1','c7000000-0000-0000-0000-000000000001',
   'a7000000-0000-0000-0000-000000000001','mine'),
  ('e7000000-0000-0000-0000-000000000002','REQ-LQ2','c7000000-0000-0000-0000-000000000002',
   'a7000000-0000-0000-0000-000000000003','someone else, other dept');

set local role authenticated;
select set_config('request.jwt.claims','{"tenant_id":"11111111-1111-1111-1111-111111111111"}', true);

-- a requester sees ONLY their own request through the live path
select set_config('request.jwt.claim.sub','a7000000-0000-0000-0000-000000000001', true);
select is(
  (select jsonb_array_length(report_query_caller(
    $$select r.ref as "ref" from requests r where r.ref like 'REQ-LQ%'$$))),
  1, 'a requester''s live query returns only their own rows');

-- an IT agent sees the IT request but never the ADMIN one
select set_config('request.jwt.claim.sub','a7000000-0000-0000-0000-000000000002', true);
select is(
  (select report_query_caller(
    $$select r.ref as "ref" from requests r where r.ref like 'REQ-LQ%'$$) -> 0 ->> 'ref'),
  'REQ-LQ1', 'a dept-scoped agent''s live query is scoped to their department');
select is(
  (select jsonb_array_length(report_query_caller(
    $$select r.ref as "ref" from requests r where r.ref like 'REQ-LQ%'$$))),
  1, 'the other department''s request is invisible to the agent');

-- guards
select throws_ok(
  $$select report_query_caller('update requests set title = ''x''')$$,
  null, null, 'non-SELECT statements are refused');
select throws_ok(
  $$select report_query_caller('select 1; select 2')$$,
  null, null, 'statement chaining is refused');

-- signed-out callers are refused
select set_config('request.jwt.claim.sub','', true);
select throws_ok(
  $$select report_query_caller('select 1 as x')$$,
  null, null, 'a call without a signed-in user is refused');

reset role;
select * from finish();
rollback;
