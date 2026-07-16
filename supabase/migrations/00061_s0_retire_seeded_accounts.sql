-- 00061 — S0 security hardening (2/4): stop shipping usable seeded accounts.
--
-- Migrations 00020/00028/00035/00038 create password sign-in accounts
-- (*@dev.abccorp.com) as part of the replayable history, so every fresh
-- environment — including production — got accounts with shared, documented
-- passwords. Fail closed instead: unless the database explicitly opts in to
-- dev seeds (alter database ... set app.seed_demo = 'on'; supabase/seed.sql
-- does this on local resets), scramble their passwords and remove their
-- email identities so password sign-in is impossible. Profiles and demo data
-- remain (demo requests/letters reference them); only the credentials die.
--
-- Production rollout still includes the two manual dashboard actions from
-- the hardening brief: delete the *@dev.abccorp.com users outright and
-- disable the email/password provider.

do $$
begin
  if coalesce(current_setting('app.seed_demo', true), '') = 'on' then
    raise notice '00061: app.seed_demo = on — dev database, seeded accounts left usable';
    return;
  end if;

  update auth.users
     set encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf'))
   where email like '%@dev.abccorp.com';

  delete from auth.identities
   where provider = 'email'
     and user_id in (select id from auth.users where email like '%@dev.abccorp.com');
end $$;
