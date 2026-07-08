-- ABC Services Hub — test-user cleanup + standard role matrix.
-- Retires every previous test account (dev seed, external testers, PMO test
-- users) without touching their history, then creates the approved matrix:
-- 1 system admin · dept head / team lead / agent for IT, Admin, Procurement
-- and PMO · 4 business requesters. Also renames the cloud inventory rows the
-- asset-tracker import brought in under the old brand (the string literals
-- below exist only as search patterns to remove it). Re-run safe.

-- ============ A) Retire all previous test accounts ============
do $$
declare
  uid uuid;
begin
  foreach uid in array array[
    '11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111104',
    '11111111-1111-4111-8111-111111111105', '11111111-1111-4111-8111-111111111106',
    '11111111-1111-4111-8111-111111111107',
    '22222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222202',
    '22222222-2222-4222-8222-222222222203',
    '33333333-3333-4333-8333-333333333301', '33333333-3333-4333-8333-333333333302',
    '33333333-3333-4333-8333-333333333303'
  ]::uuid[]
  loop
    -- Requests, assets and projects reference these profiles, so the rows
    -- stay; the login dies (scrambled password, identities removed) and the
    -- profile is deactivated under a neutral retired address.
    update auth.users
      set email = 'retired.' || substr(uid::text, 1, 8) || right(uid::text, 2)
                  || '@retired.abccorp.com',
          encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf'))
      where id = uid;
    delete from auth.identities where user_id = uid;
    update profiles
      set upn = 'retired.' || substr(uid::text, 1, 8) || right(uid::text, 2)
                || '@retired.abccorp.com',
          is_active = false
      where id = uid;
    delete from role_assignments where profile_id = uid;
    delete from pmo_group_members where user_id = uid;
    delete from pmo_committee_members where user_id = uid;
    delete from container_members where profile_id = uid;
  end loop;
end $$;

-- ============ B) The standard matrix (password: AbcHub!2026) ============
do $$
declare
  u record;
begin
  for u in select * from (values
    ('44444444-4444-4444-8444-444444444401'::uuid, 'sysadmin@dev.abccorp.com',   'Sami SysAdmin'),
    ('44444444-4444-4444-8444-444444444402'::uuid, 'head.it@dev.abccorp.com',    'Huda IT Head'),
    ('44444444-4444-4444-8444-444444444403'::uuid, 'head.admin@dev.abccorp.com', 'Hatem Admin Head'),
    ('44444444-4444-4444-8444-444444444404'::uuid, 'head.proc@dev.abccorp.com',  'Hala Procurement Head'),
    ('44444444-4444-4444-8444-444444444405'::uuid, 'head.pmo@dev.abccorp.com',   'Hani PMO Head'),
    ('44444444-4444-4444-8444-444444444406'::uuid, 'lead.it@dev.abccorp.com',    'Layla IT Lead'),
    ('44444444-4444-4444-8444-444444444407'::uuid, 'lead.admin@dev.abccorp.com', 'Lama Admin Lead'),
    ('44444444-4444-4444-8444-444444444408'::uuid, 'lead.proc@dev.abccorp.com',  'Loay Procurement Lead'),
    ('44444444-4444-4444-8444-444444444409'::uuid, 'lead.pmo@dev.abccorp.com',   'Lina PMO Lead'),
    ('44444444-4444-4444-8444-444444444410'::uuid, 'agent.it@dev.abccorp.com',   'Adel IT Agent'),
    ('44444444-4444-4444-8444-444444444411'::uuid, 'agent.admin@dev.abccorp.com','Afnan Admin Officer'),
    ('44444444-4444-4444-8444-444444444412'::uuid, 'agent.proc@dev.abccorp.com', 'Amjad Procurement Officer'),
    ('44444444-4444-4444-8444-444444444413'::uuid, 'agent.pmo@dev.abccorp.com',  'Areej PMO Officer'),
    ('44444444-4444-4444-8444-444444444414'::uuid, 'biz1@dev.abccorp.com',       'Basma Business'),
    ('44444444-4444-4444-8444-444444444415'::uuid, 'biz2@dev.abccorp.com',       'Bandar Business'),
    ('44444444-4444-4444-8444-444444444416'::uuid, 'biz3@dev.abccorp.com',       'Dana Business'),
    ('44444444-4444-4444-8444-444444444417'::uuid, 'biz4@dev.abccorp.com',       'Faisal Business')
  ) as t(id, email, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.email, crypt('AbcHub!2026', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', u.name), now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now())
    on conflict do nothing;

    insert into profiles (id, upn, display_name, is_active)
    values (u.id, u.email, u.name, true)
    on conflict (id) do nothing;
  end loop;
end $$;

-- ============ C) Platform roles ============
-- dept_head inherits approver + dept_admin through has_role (00015), so the
-- heads can decide DoA approvals with no extra rows.
-- role_assignments has no unique constraint, so idempotency comes from the
-- not-exists guard rather than on conflict.
insert into role_assignments (profile_id, role, dept)
select v.pid, v.r, v.d
from (values
  ('44444444-4444-4444-8444-444444444401'::uuid, 'system_admin'::platform_role, null::dept_code),
  ('44444444-4444-4444-8444-444444444402', 'dept_head', 'IT'),
  ('44444444-4444-4444-8444-444444444403', 'dept_head', 'ADMIN'),
  ('44444444-4444-4444-8444-444444444404', 'dept_head', 'PROC'),
  ('44444444-4444-4444-8444-444444444405', 'pmo_admin', null),
  ('44444444-4444-4444-8444-444444444406', 'team_lead', 'IT'),
  ('44444444-4444-4444-8444-444444444407', 'team_lead', 'ADMIN'),
  ('44444444-4444-4444-8444-444444444408', 'team_lead', 'PROC'),
  ('44444444-4444-4444-8444-444444444409', 'project_manager', null),
  ('44444444-4444-4444-8444-444444444410', 'agent', 'IT'),
  ('44444444-4444-4444-8444-444444444411', 'agent', 'ADMIN'),
  ('44444444-4444-4444-8444-444444444412', 'agent', 'PROC'),
  ('44444444-4444-4444-8444-444444444413', 'project_manager', null)
) as v(pid, r, d)
where not exists (
  select 1 from role_assignments ra
  where ra.profile_id = v.pid and ra.role = v.r and ra.dept is not distinct from v.d
);
-- biz1–biz4 hold no roles: they are plain requesters.

-- The user-management console groups people by department container.
insert into container_members (profile_id, dept)
select profile_id, dept from role_assignments
where profile_id::text like '44444444-%' and dept is not null
on conflict do nothing;

-- ============ D) PMO module wiring ============
-- The PMO head runs the console and sits on the approval committee; the PMO
-- lead and officer work projects through the Project Managers role group.
insert into pmo_committee_members (user_id)
values ('44444444-4444-4444-8444-444444444405')
on conflict do nothing;

insert into pmo_group_members (group_id, user_id)
select g.id, p.id
from pmo_role_groups g, profiles p
where g.name = 'Project Managers'
  and p.id in ('44444444-4444-4444-8444-444444444409',
               '44444444-4444-4444-8444-444444444413')
on conflict do nothing;

-- ============ E) Old brand: sweep data created after the 00023 rebrand ============
update cloud_resources set name = replace(name, 'RLC', 'ABC') where name like '%RLC%';
update cloud_resources set resource_group = replace(resource_group, 'RLC', 'ABC')
where resource_group like '%RLC%';
update cloud_resources set subscription = replace(subscription, 'RLC', 'ABC')
where subscription like '%RLC%';
update assets set tag = replace(tag, 'RLC-', 'ABC-') where tag like '%RLC%';
update assets set location = replace(location, 'RLC', 'ABC') where location like '%RLC%';
update licenses set billing_profile = replace(billing_profile, 'RLC', 'ABC')
where billing_profile like '%RLC%';
update notification_templates
set subject = replace(subject, 'RLC', 'ABC Corp'),
    body_html = replace(body_html, 'RLC', 'ABC Corp')
where subject like '%RLC%' or body_html like '%RLC%';
update role_assignments set source_ad_group = replace(source_ad_group, 'SG-RLC-', 'SG-ABC-')
where source_ad_group like '%RLC%';
update profiles set upn = replace(upn, 'rlc.sa', 'abccorp.com') where upn like '%rlc%';
update auth.users set email = replace(email, 'rlc.sa', 'abccorp.com') where email like '%rlc%';
