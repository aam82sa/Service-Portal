-- External tester accounts (requester role, own shared password).
-- Remove before production go-live.
do $$
declare
  u record;
begin
  for u in select * from (values
    ('22222222-2222-4222-8222-222222222201'::uuid, 'tester1@dev.rlc.sa', 'Tester One'),
    ('22222222-2222-4222-8222-222222222202'::uuid, 'tester2@dev.rlc.sa', 'Tester Two'),
    ('22222222-2222-4222-8222-222222222203'::uuid, 'tester3@dev.rlc.sa', 'Tester Three')
  ) as t(id, email, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.email, crypt('RlcTest!2026', gen_salt('bf')), now(),
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
