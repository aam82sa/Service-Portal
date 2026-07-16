-- Restore password sign-in for the seeded *@dev.abccorp.com demo accounts.
--
-- Migration 00061_s0_retire_seeded_accounts.sql intentionally retires those
-- accounts on any database that has NOT opted into demo seeds — it scrambles
-- their passwords and deletes their email identities so password sign-in is
-- impossible. This script reverses that for a local/dev database: it sets one
-- known password for every dev account and recreates the email identity row
-- (mirroring the shape the seed migrations use).
--
--   *** DEV / LOCAL ONLY — never run this against production. ***
--   Production is Entra ID SSO only by design; there are no password accounts.
--
-- Usage (defaults the password to AbcHub!2026):
--   npm run db:demo-logins
--   -- or --
--   psql "$DATABASE_URL" -f scripts/reset-demo-passwords.sql
--
-- Choose a different password:
--   psql "$DATABASE_URL" -v pw="'MyPass!2026'" -f scripts/reset-demo-passwords.sql
--
-- Remember the sign-in form only shows the password field when the frontend is
-- built with VITE_AUTH_MODE=dev; otherwise it goes straight to SSO.

\if :{?pw}
\else
\set pw '''AbcHub!2026'''
\endif

-- 1) reset the password on every dev account
update auth.users
   set encrypted_password = crypt(:pw, gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at = now()
 where email like '%@dev.abccorp.com';

-- 2) recreate the email identity that 00061 removed (only when missing)
insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                             last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email', now(), now(), now()
  from auth.users u
 where u.email like '%@dev.abccorp.com'
   and not exists (
     select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
   );

-- 3) report what was restored
select u.email, (i.id is not null) as has_email_identity
  from auth.users u
  left join auth.identities i on i.user_id = u.id and i.provider = 'email'
 where u.email like '%@dev.abccorp.com'
 order by u.email;
