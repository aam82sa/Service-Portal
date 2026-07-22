-- Role-groups gate (pgTAP) — ACCESS1 branch 3, migration 00082.
--
-- Proves the model that ties page access to RLS: the five tables exist and
-- are seeded, membership materialises into role_assignments (so every
-- existing policy and has_role() call keeps working), removal deletes only
-- what the group created, and bundle changes re-materialise members.
-- Runs under `supabase test db` in a rolled-back transaction.

begin;
select plan(10);

-- ── seeds ────────────────────────────────────────────────────────────────
select is((select count(*)::int from role_groups where is_system), 7,
  'the 7 system groups are seeded');
select is((select count(*)::int from app_pages), 13,
  'app_pages holds the 11 router pages + 2 detail sub-pages');
select is(
  (select count(*)::int from role_group_pages rgp
    join role_groups g on g.id = rgp.group_id
   where rgp.page_key = 'work' and g.key = 'it_officer'),
  1, 'the legacy mywork grant carried over to the work page');

-- ── materialisation ──────────────────────────────────────────────────────
insert into auth.users (id, email) values ('a4000000-0000-0000-0000-000000000001','m@t') on conflict do nothing;
insert into profiles (id, upn, display_name)
values ('a4000000-0000-0000-0000-000000000001','m@t','Member') on conflict (id) do nothing;

insert into profile_role_groups (profile_id, group_id, dept_id)
select 'a4000000-0000-0000-0000-000000000001', g.id, d.id
  from role_groups g, departments d where g.key='it_officer' and d.code='IT';

select is(
  (select count(*)::int from role_assignments
    where profile_id='a4000000-0000-0000-0000-000000000001' and via_group_id is not null),
  2, 'membership materialises the group''s 2 roles into role_assignments');

select is(
  (select ra.dept_id from role_assignments ra
    where ra.profile_id='a4000000-0000-0000-0000-000000000001' and ra.role='agent'),
  (select id from departments where code='IT'),
  'a global group role takes the member''s department scope');

select set_config('request.jwt.claim.sub','a4000000-0000-0000-0000-000000000001', true);
select is(has_role('agent', (select id from departments where code='IT')), true,
  'has_role (uuid overload) honours the materialised grant');
select is(has_role('agent', 'IT'::dept_code), true,
  'has_role (enum overload) honours the materialised grant');

-- ── removal deletes only what the group created ─────────────────────────
insert into role_assignments (profile_id, role, dept, dept_id)
select 'a4000000-0000-0000-0000-000000000001','team_lead','IT',id from departments where code='IT';
delete from profile_role_groups where profile_id='a4000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from role_assignments
    where profile_id='a4000000-0000-0000-0000-000000000001' and via_group_id is not null),
  0, 'removing the membership removes the materialised grants');
select is(
  (select count(*)::int from role_assignments
    where profile_id='a4000000-0000-0000-0000-000000000001' and role='team_lead'),
  1, 'a direct (non-group) grant survives the removal');

-- ── bundle change re-materialises members ────────────────────────────────
insert into profile_role_groups (profile_id, group_id)
select 'a4000000-0000-0000-0000-000000000001', id from role_groups where key='cyber_reviewer';
insert into role_group_roles (group_id, role)
select id, 'executive' from role_groups where key='cyber_reviewer';

select is(
  (select count(*)::int from role_assignments
    where profile_id='a4000000-0000-0000-0000-000000000001'
      and role='executive' and via_group_id is not null),
  1, 'adding a role to the bundle materialises it for existing members');

select * from finish();
rollback;
