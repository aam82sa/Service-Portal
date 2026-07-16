-- 00060 — S0 security hardening (1/4): RLS enablement + anon privileges.
--
-- 1) pmo_committee_members shipped with policies (00027: pcm_read/pcm_write)
--    but RLS was never enabled, so those policies were inert — and the 00045
--    blanket API grants left the committee roster readable and writable by
--    any API role, including anon. Enable RLS; the existing policies take
--    effect unchanged.
--
-- 2) The anon role needs no Data API access at all: every feature of the hub
--    requires a signed-in user, and nothing is served pre-login. Revoke the
--    00045 blanket grants from anon and stop granting to it by default.
--    authenticated/service_role keep the platform grants, with row access
--    still governed entirely by RLS.

alter table pmo_committee_members enable row level security;

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke all privileges on all routines in schema public from anon;

alter default privileges in schema public revoke all privileges on tables from anon;
alter default privileges in schema public revoke all privileges on sequences from anon;
alter default privileges in schema public revoke all privileges on routines from anon;
