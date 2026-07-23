-- 00088 — Reporting rebuild branch 5: dashboards of widgets.
--
-- The builder (Zone 2) writes these two tables; the analytics landing reads
-- them. A dashboard is presentation config only — every widget still fetches
-- through query-live under the VIEWER's own RLS, so nothing stored here can
-- widen access. RLS mirrors report_definitions (00067): owner / dept / org
-- visibility for reads, owner-or-admin for writes, builtin admin-only.
-- Department scope uses dept_id (departments.id — the post-00074 canonical
-- form) with the uuid has_role overload.

create table report_dashboards (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  name_ar text,
  kind text not null default 'custom' check (kind in ('builtin', 'custom')),
  visibility text not null default 'private' check (visibility in ('private', 'dept', 'org')),
  dept_id uuid references departments(id),
  owner_id uuid references profiles(id),
  layout jsonb not null default '{}',            -- grid positions / builder state
  is_active boolean not null default true,
  tenant_id uuid not null default current_tenant() references tenants(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on report_dashboards (owner_id);
create index on report_dashboards (visibility) where is_active;

create trigger report_dashboards_touch before update on report_dashboards
  for each row execute function touch_updated_at();

-- widget_type is the builder palette; data_source is the SAME vocabulary as
-- report_definitions (00086) — the parity test asserts both CHECKs against
-- the allowlist module, so the three can never drift.
create table report_widgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references report_dashboards(id) on delete cascade,
  position int not null default 0,
  widget_type text not null check (widget_type in ('kpi', 'line', 'bar', 'donut', 'stacked', 'table', 'pivot')),
  data_source text not null check (data_source in (
    'requests', 'sla', 'assets', 'letters', 'pmo_projects', 'pmo_risks',
    'audit', 'dept_performance', 'employee_performance')),
  config jsonb not null default '{}',            -- {measure, group_by, split_by, filters, period, sort, limit}
  title text not null,
  title_ar text,
  tenant_id uuid not null default current_tenant() references tenants(id),
  created_at timestamptz not null default now()
);
create index on report_widgets (dashboard_id, position);

-- ============ RLS ============
alter table report_dashboards enable row level security;
alter table report_widgets enable row level security;

-- dashboards: owner, dept-scoped, org-wide, or admin can read; builtin is
-- readable per visibility but only admins write it (mirror of rd_read/rd_write)
create policy rdash_read on report_dashboards for select to authenticated
  using (
    is_active and (
      owner_id = auth.uid()
      or visibility = 'org'
      or (visibility = 'dept' and dept_id is not null and (
            has_role('agent', dept_id) or has_role('team_lead', dept_id)
            or has_role('dept_head', dept_id)))
      or has_role('executive') or has_role('system_admin')
    )
  );
create policy rdash_write on report_dashboards for all to authenticated
  using (
    (kind = 'custom' and owner_id = auth.uid()) or has_role('system_admin')
  )
  with check (
    (kind = 'custom' and owner_id = auth.uid()) or has_role('system_admin')
  );

-- widgets follow their dashboard: the subquery runs under the caller's own
-- RLS on report_dashboards, so a widget is exactly as visible/writable as
-- its parent. employee_performance additionally carries the 00070 personal-
-- data gate — the widget row itself is hidden from roles that may not see
-- that source, matching rd_read_employee_perf.
create policy rw_read on report_widgets for select to authenticated
  using (
    exists (select 1 from report_dashboards d where d.id = dashboard_id)
    and (
      data_source <> 'employee_performance'
      or has_role('dept_head') or has_role('team_lead')
      or has_role('executive') or has_role('system_admin')
    )
  );
create policy rw_write on report_widgets for all to authenticated
  using (
    exists (
      select 1 from report_dashboards d
      where d.id = dashboard_id
        and ((d.kind = 'custom' and d.owner_id = auth.uid()) or has_role('system_admin'))
    )
  )
  with check (
    exists (
      select 1 from report_dashboards d
      where d.id = dashboard_id
        and ((d.kind = 'custom' and d.owner_id = auth.uid()) or has_role('system_admin'))
    )
  );

-- tenant isolation (restrictive, same shape as every domain table)
create policy tenant_isolation on report_dashboards as restrictive
  using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
create policy tenant_isolation on report_widgets as restrictive
  using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
