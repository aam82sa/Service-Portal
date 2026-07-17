-- 00072 — hosted-runtime grant for the reporting security core.
--
-- report_fetch_rows() (SECURITY DEFINER, owner postgres) calls
-- report_run_query() (owner authenticated, so RLS binds). 00067 revoked
-- execute on report_run_query from public/anon/authenticated, leaving only the
-- service_role entry that 00045's default privileges added. On a local stack
-- postgres is a superuser and bypasses the ACL, but on hosted Supabase
-- postgres is NOT a superuser — so the definer chain could be denied at the
-- inner call. Grant the definer role explicit execute; end users still cannot
-- call report_run_query (anon/authenticated remain revoked), so the
-- owner-impersonation surface is unchanged.

grant execute on function report_run_query(text, uuid) to postgres;
