-- 00067 — Reporting module, branch 1: schema + the security core (Wave "W9").
--
-- Reports are data, not code: a report_definitions config table drives an Edge
-- Function that fetches rows, renders, stores an artifact, and delivers it.
-- The one hard security property — a report may only ever contain rows the
-- owner is allowed to see — is enforced by report_fetch_rows(), which runs the
-- compiled query UNDER THE OWNER'S OWN RLS via impersonation, never a god-mode
-- service read. SECURITY-EXPERT REVIEW REQUIRED on report_fetch_rows before merge.

-- ---- report definitions (the "report as config") ----
create table report_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  kind text not null default 'custom' check (kind in ('builtin', 'custom')),
  data_source text not null check (data_source in (
    'requests', 'sla', 'assets', 'pmo_projects', 'pmo_evm', 'pmo_risks',
    'letters', 'audit', 'dept_performance', 'employee_performance')),
  config jsonb not null default '{}',           -- {columns,filters,group_by,aggregations,chart,sort}
  output_formats text[] not null default '{pdf,csv,xlsx}',
  version int not null default 1,
  is_current boolean not null default true,
  visibility text not null default 'private' check (visibility in ('private', 'dept', 'org')),
  dept dept_code,
  owner_id uuid references profiles(id),
  is_active boolean not null default true,
  tenant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on report_definitions (data_source) where is_active;
create index on report_definitions (owner_id);

-- ---- schedules (Branch 5 drives these; table lives here with the schema) ----
create table report_schedules (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references report_definitions(id) on delete cascade,
  definition_version int not null default 1,
  cadence text not null,                         -- cron expression
  timezone text not null default 'Asia/Riyadh',
  filters_snapshot jsonb not null default '{}',
  format text not null default 'pdf',
  recipients jsonb not null default '{}',        -- {profile_ids:[],external:[]}
  run_as_owner uuid not null references profiles(id),
  enabled boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  tenant_id uuid,
  created_at timestamptz not null default now()
);
create index on report_schedules (next_run_at) where enabled;

-- ---- runs (append-only history; status transitions are service-role only) ----
create table report_runs (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references report_definitions(id),
  definition_version int not null default 1,
  schedule_id uuid references report_schedules(id) on delete set null,
  trigger text not null check (trigger in ('download', 'email', 'schedule')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  requested_by uuid references profiles(id),
  run_as_owner uuid not null references profiles(id),
  params jsonb not null default '{}',
  format text not null default 'pdf',
  row_count int,
  artifact_path text,
  artifact_bytes int,
  signed_url_expires_at timestamptz,
  attempts int not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  tenant_id uuid,
  created_at timestamptz not null default now()
);
create index on report_runs (definition_id, created_at desc);
create index on report_runs (status) where status in ('queued', 'running');

-- ---- deliveries (who a run was sent to; PDPL trail) ----
create table report_deliveries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references report_runs(id) on delete cascade,
  channel text not null default 'email',
  "to" jsonb not null default '[]',
  contains_personal_data boolean not null default false,
  external boolean not null default false,
  status text not null default 'queued',
  provider_detail jsonb,
  created_at timestamptz not null default now()
);
create index on report_deliveries (run_id);

-- ============ RLS ============
alter table report_definitions enable row level security;
alter table report_schedules enable row level security;
alter table report_runs enable row level security;
alter table report_deliveries enable row level security;

-- definitions: owner, dept-scoped, org-wide, or admin can read; builtin is
-- readable per visibility but only admins write it
create policy rd_read on report_definitions for select to authenticated
  using (
    is_active and (
      owner_id = auth.uid()
      or visibility = 'org'
      or (visibility = 'dept' and dept is not null and (
            has_role('agent', dept) or has_role('team_lead', dept)
            or has_role('dept_head', dept)))
      or has_role('executive') or has_role('system_admin')
    )
  );
create policy rd_write on report_definitions for all to authenticated
  using (
    (kind = 'custom' and owner_id = auth.uid()) or has_role('system_admin')
  )
  with check (
    (kind = 'custom' and owner_id = auth.uid()) or has_role('system_admin')
  );

-- schedules: owner + admin
create policy rs_rw on report_schedules for all to authenticated
  using (run_as_owner = auth.uid() or has_role('system_admin'))
  with check (run_as_owner = auth.uid() or has_role('system_admin'));

-- runs: readable by the person who asked, the owner, or an admin; insert only
-- as yourself; NO update/delete for authenticated (service-role transitions it)
create policy rr_read on report_runs for select to authenticated
  using (requested_by = auth.uid() or run_as_owner = auth.uid() or has_role('system_admin'));
create policy rr_insert on report_runs for insert to authenticated
  with check (requested_by = auth.uid() and run_as_owner = auth.uid());

-- deliveries: visible if you can see the run
create policy rdel_read on report_deliveries for select to authenticated
  using (exists (
    select 1 from report_runs r where r.id = run_id
      and (r.requested_by = auth.uid() or r.run_as_owner = auth.uid() or has_role('system_admin'))
  ));

create or replace function report_definitions_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger report_definitions_touch_t before update on report_definitions
  for each row execute function report_definitions_touch();

-- ============ Storage: private reports bucket ============
insert into storage.buckets (id, name, public, file_size_limit)
values ('reports', 'reports', false, 52428800)   -- 50 MB artifact cap
on conflict (id) do nothing;

-- path: {owner_id}/{run_id}/{name}.{ext} — owner or admin may read (signed
-- URLs are minted server-side and bypass this; the policy is defence in depth).
-- Writes happen only via the service role (generate-report), so no
-- authenticated insert/delete policy is granted.
drop policy if exists reports_read on storage.objects;
create policy reports_read on storage.objects for select to authenticated
  using (bucket_id = 'reports' and (
    ((storage.foldername(name))[1])::uuid = auth.uid() or has_role('system_admin')
  ));

-- ============ notification templates (idempotent, like 00044) ============
insert into notification_templates (key, subject, body_html)
select v.key, v.subject, v.body_html
from (values
  ('report_delivery', 'Your report is ready: {{report_name}}',
   '<p>The report <b>{{report_name}}</b> for {{period}} is ready.</p><p>Run {{run_ref}}. <a href="{{download_link}}">Download it here</a> (sign-in required).</p>'),
  ('report_delivery_failed', 'Report failed: {{report_name}}',
   '<p>The scheduled report <b>{{report_name}}</b> ({{run_ref}}) could not be generated for {{period}}. The service desk has been notified.</p>')
) as v(key, subject, body_html)
where not exists (select 1 from notification_templates t where t.key = v.key and t.dept is null);

-- ============ feature flags (default off, like sla_engine) ============
insert into feature_flags (key, name, description, category, is_enabled)
values
  ('reporting', 'Reporting module',
   'The Reports library: run built-in and saved reports, preview, download PDF/CSV/XLSX, and email once.', 'operations', false),
  ('reporting_scheduled', 'Scheduled reporting',
   'Recurring report schedules dispatched by pg_cron, with run history and failure alerts.', 'operations', false)
on conflict (key) do nothing;

-- ============ THE SECURITY CORE — owner-impersonation row fetch ============
-- Postgres forbids SET ROLE inside a SECURITY DEFINER function, and the
-- service role (or postgres) bypasses RLS — so a single definer function can't
-- both load the run AND run the report under the owner's RLS. Split in two:
--
--  * report_run_query() is SECURITY DEFINER owned by `authenticated` (a role
--    WITHOUT bypassrls). Whoever calls it, its body runs as authenticated, so
--    RLS is enforced; it sets auth.uid() to the owner via the jwt claim and
--    executes the COMPILER-PRODUCED query. This is where the isolation lives.
--  * report_fetch_rows() is SECURITY DEFINER owned by postgres (bypasses RLS):
--    it loads the run to resolve + validate the owner, applies the SELECT-only
--    guard, then hands the query to report_run_query under that owner.
--
-- p_sql is compiler output (allowlisted tables/columns, escaped literals) —
-- never raw user input. SECURITY-EXPERT REVIEW REQUIRED before merge.

create or replace function report_run_query(p_sql text, p_owner uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  result jsonb;
begin
  -- auth.uid() now resolves to the owner; because this function is owned by a
  -- non-bypassrls role, every policy is evaluated as if the owner ran it
  perform set_config('request.jwt.claim.sub', p_owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_owner)::text, true);
  perform set_config('statement_timeout', '15000', true);   -- 15s runaway cap
  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (select * from (%s) _q limit 5000) t',
    p_sql
  ) into result;
  return result;
end $$;
-- own it by the non-privileged role so RLS binds; only the outer function
-- (running as postgres) reaches it — callers cannot invoke it directly
alter function report_run_query(text, uuid) owner to authenticated;
revoke all on function report_run_query(text, uuid) from public, anon, authenticated;

create or replace function report_fetch_rows(p_run uuid, p_sql text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  q text := btrim(p_sql);
begin
  -- only a single read-only SELECT/CTE is ever executed
  if left(lower(q), 6) <> 'select' and left(lower(q), 4) <> 'with' then
    raise exception 'report query must be a SELECT';
  end if;
  if position(';' in q) > 0 then
    raise exception 'report query must be a single statement';
  end if;

  select run_as_owner into owner from report_runs where id = p_run;
  if owner is null then raise exception 'report run not found or has no owner'; end if;
  if not exists (select 1 from profiles where id = owner and is_active) then
    raise exception 'report owner is not an active user';
  end if;

  return report_run_query(q, owner);
end $$;
-- only the service role (generate-report) may call it; end users never do
revoke all on function report_fetch_rows(uuid, text) from public, anon, authenticated;
grant execute on function report_fetch_rows(uuid, text) to service_role;
