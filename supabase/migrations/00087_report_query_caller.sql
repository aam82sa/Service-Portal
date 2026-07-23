-- 00087 — REPORTING v2 branch 2: the caller-RLS live query path.
--
-- The one engine change that unlocks run-time interactivity: dashboards need
-- instant filter changes with no report_runs row and no artifact. Unlike
-- report_run_query (owner impersonation, for scheduled/exported documents),
-- this function is SECURITY INVOKER — it runs under the CALLER's own JWT, so
-- every RLS policy applies exactly as if the viewer had queried the table
-- directly. A dept-scoped agent gets only their department's rows; there is
-- nothing to impersonate because the viewer is present.
--
-- Guards mirror report_fetch_rows: single read-only SELECT/CTE, no statement
-- chaining, a 15s statement timeout, and a hard 5000-row wrap. The SQL text
-- itself is produced only by the allowlist compiler in the query-live edge
-- function — but even a hand-crafted call cannot read anything the caller's
-- RLS does not already allow, which is what makes granting this to
-- `authenticated` safe.

create or replace function report_query_caller(p_sql text)
returns jsonb
language plpgsql
-- SECURITY INVOKER (the default) is the point: caller's JWT, caller's RLS.
set search_path = public
as $$
declare
  q text := btrim(p_sql);
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  if left(lower(q), 6) <> 'select' and left(lower(q), 4) <> 'with' then
    raise exception 'live query must be a SELECT';
  end if;
  if position(';' in q) > 0 then
    raise exception 'live query must be a single statement';
  end if;

  perform set_config('statement_timeout', '15000', true);
  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (select * from (%s) _q limit 5000) t',
    q
  ) into result;
  return result;
end $$;

revoke all on function report_query_caller(text) from public, anon;
grant execute on function report_query_caller(text) to authenticated;
