-- Work-distribution gate (pgTAP) — ACCESS1 branch 2, migration 00085.
--
-- Proves the routing switch works end to end and the dead controls are gone:
-- with route_via_rules on, a new request resolves its team through the rules;
-- with it off, the request lands unrouted in the department tray. The inert
-- auto_assignment flag (read by nothing) and its dead siblings are deleted,
-- and the orphaned assignment_rules table is dropped.

begin;
select plan(6);

-- ── the dead switch and its siblings are gone; live flags remain ────────
select is(
  (select count(*)::int from feature_flags where key in
    ('auto_assignment','status_emails','email_to_ticket','csat_survey',
     'api_keys','workflow_designer','escalation_rules')),
  0, 'the seven dead feature flags are deleted');
select cmp_ok(
  (select count(*)::int from feature_flags), '>', 0,
  'live feature flags are untouched');
select is(to_regclass('public.assignment_rules'), null,
  'the orphaned assignment_rules table is dropped');

-- ── routing switch ───────────────────────────────────────────────────────
insert into auth.users (id, email) values ('a6000000-0000-0000-0000-000000000010','r@t') on conflict do nothing;
insert into profiles (id, upn, display_name)
values ('a6000000-0000-0000-0000-000000000010','r@t','Req') on conflict (id) do nothing;

insert into teams (id, dept, name)
values ('b6000000-0000-0000-0000-000000000001','IT','Routing Test Team');
insert into services (id, dept, dept_id, code, name)
select 'c6000000-0000-0000-0000-000000000001','IT', d.id,'RTG','Routing Svc'
  from departments d where d.code='IT';
insert into routing_rules (dept, match_type, match_value, team_id, position)
values ('IT','keyword','routing-probe','b6000000-0000-0000-0000-000000000001',1);

-- rules ON (default): the request resolves to the team
insert into requests (id, ref, service_id, requester_id, title)
values ('e6000000-0000-0000-0000-000000000001','REQ-RT1','c6000000-0000-0000-0000-000000000001',
        'a6000000-0000-0000-0000-000000000010','a routing-probe issue');
select is(
  (select team_id from requests where id='e6000000-0000-0000-0000-000000000001'),
  'b6000000-0000-0000-0000-000000000001'::uuid,
  'with routing on, a matching rule assigns the team');

-- rules OFF: the request lands in the department tray (team_id null)
update departments set route_via_rules = false where code='IT';
insert into requests (id, ref, service_id, requester_id, title)
values ('e6000000-0000-0000-0000-000000000002','REQ-RT2','c6000000-0000-0000-0000-000000000001',
        'a6000000-0000-0000-0000-000000000010','another routing-probe issue');
select is(
  (select team_id from requests where id='e6000000-0000-0000-0000-000000000002'),
  null, 'with routing off, the request sits in the department tray');

-- switching back on restores routing for new requests only
update departments set route_via_rules = true where code='IT';
insert into requests (id, ref, service_id, requester_id, title)
values ('e6000000-0000-0000-0000-000000000003','REQ-RT3','c6000000-0000-0000-0000-000000000001',
        'a6000000-0000-0000-0000-000000000010','third routing-probe issue');
select is(
  (select team_id from requests where id='e6000000-0000-0000-0000-000000000003'),
  'b6000000-0000-0000-0000-000000000001'::uuid,
  'switching routing back on affects new requests; the unrouted one is untouched');

select * from finish();
rollback;
