-- 00045 — explicit Data API grants for the public schema.
--
-- The hosted project was created when Supabase auto-exposed new public
-- tables to the API roles; newer CLI/cloud defaults do not, so a fresh
-- `supabase db reset` left anon/authenticated with no table privileges and
-- every portal query failed with "permission denied". Granting explicitly
-- (plus default privileges for future migrations) makes local stacks match
-- production. Row access is still governed entirely by RLS — these are the
-- standard platform grants, not a security change. No-op on hosted.

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;
grant all privileges on all routines in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all privileges on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all privileges on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all privileges on routines to anon, authenticated, service_role;
