-- Assignment dept_id sync gate (pgTAP) — ACCESS1 branch 1, migration 00081.
--
-- Proves the two live correctness bugs are fixed: teams and routing_rules
-- created with only the legacy dept code now derive dept_id at write time
-- (so resolve_team matches new rules and teams_dept_admin_write scopes
-- correctly), and pre-existing NULL rows were backfilled. Runs under
-- `supabase test db` in a rolled-back transaction.

begin;
select plan(5);

-- backfill coverage: no legacy-coded row is left without dept_id
select is(
  (select count(*)::int from teams where dept is not null and dept_id is null),
  0, 'backfill: every legacy-coded team has dept_id'
);
select is(
  (select count(*)::int from routing_rules where dept is not null and dept_id is null),
  0, 'backfill: every legacy-coded routing rule has dept_id'
);

-- the trigger derives dept_id when a writer supplies only the code
insert into teams (id, dept, name)
values ('b3000000-0000-0000-0000-000000000001', 'IT', 'Sync Test Team');
select is(
  (select t.dept_id from teams t where t.id = 'b3000000-0000-0000-0000-000000000001'),
  (select d.id from departments d where d.code = 'IT'),
  'inserting a team with only the dept code fills dept_id'
);

insert into routing_rules (id, dept, match_type, match_value, team_id, position)
values ('b3000000-0000-0000-0000-000000000002', 'IT', 'keyword', 'sync-test',
        'b3000000-0000-0000-0000-000000000001', 1);
select is(
  (select r.dept_id from routing_rules r where r.id = 'b3000000-0000-0000-0000-000000000002'),
  (select d.id from departments d where d.code = 'IT'),
  'inserting a routing rule with only the dept code fills dept_id'
);

-- the acceptance that matters: a rule created the way the UI creates it
-- is now actually matched by resolve_team
select is(
  resolve_team(
    (select d.id from departments d where d.code = 'IT'),
    null,
    'please help with a sync-test issue'
  ),
  'b3000000-0000-0000-0000-000000000001'::uuid,
  'resolve_team matches a rule created with only the legacy dept code'
);

select * from finish();
rollback;
