-- PMO module test accounts (dev password, same convention as the seeded
-- dev users). Remove before production go-live.
-- Paula = PMO Admin (console + committee management), Peter = Project
-- Manager, Carla = committee member with no platform role at all —
-- she can decide committee steps and nothing else.
do $$
declare
  u record;
begin
  for u in select * from (values
    ('33333333-3333-4333-8333-333333333301'::uuid, 'pmo.admin@dev.abccorp.com', 'Paula PMO Admin'),
    ('33333333-3333-4333-8333-333333333302'::uuid, 'pm@dev.abccorp.com', 'Peter PM'),
    ('33333333-3333-4333-8333-333333333303'::uuid, 'committee@dev.abccorp.com', 'Carla Committee')
  ) as t(id, email, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.email, crypt('RlcDev!2026', gen_salt('bf')), now(),
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

insert into role_assignments (profile_id, role, dept) values
  ('33333333-3333-4333-8333-333333333301', 'pmo_admin', null),
  ('33333333-3333-4333-8333-333333333302', 'project_manager', null)
on conflict do nothing;

-- Carla sits on the committee without holding any platform role
insert into pmo_committee_members (user_id)
values ('33333333-3333-4333-8333-333333333303')
on conflict do nothing;
