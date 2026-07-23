-- 00089 — Reporting rebuild branch 8: the 7 builtin report templates become
-- widgets on three builtin dashboards (they are no longer a parallel static
-- library). The report_definitions rows from 00070 are KEPT — schedules and
-- exports still run off them — but the UI stops listing them as a library.
-- Also: reporting_diagnostics(), the admin RPC behind the in-UI "why is this
-- module dark?" panel (the three gates: reporting flag, reporting_scheduled
-- flag, vault hook_secret).
--
-- Idempotent by slug, like 00070. Widget configs use the builder vocabulary
-- ({measure, group_by, filters, period}) and only widget types the dashboard
-- renderer draws today (kpi/bar/donut/table).

with dash(slug, name, name_ar, position_note) as (
  values
    ('service-operations', 'Service Operations', 'عمليات الخدمة', 'volume + SLA + intake'),
    ('assets-and-projects', 'Assets & Projects', 'الأصول والمشاريع', 'asset + project mix'),
    ('workforce-performance', 'Workforce performance', 'أداء القوى العاملة', 'dept + employee performance')
)
insert into report_dashboards (slug, name, name_ar, kind, visibility, dept_id, owner_id, layout)
select d.slug, d.name, d.name_ar, 'builtin', 'org', null, null, '{}'::jsonb
from dash d
where not exists (select 1 from report_dashboards x where x.slug = d.slug);

-- widgets, keyed (dashboard slug, position); insert-if-absent keeps re-runs safe
with w(dash_slug, position, widget_type, data_source, config, title, title_ar) as (
  values
    -- Service Operations ← request-volume-by-dept, sla-compliance, open-request-aging
    ('service-operations', 0, 'bar', 'requests',
     '{"measure":"count","group_by":"dept","period":{"preset":"last30"},"filters":[{"col":"status","op":"neq","value":"cancelled"}]}',
     'Volume by department', 'الحجم حسب الإدارة'),
    ('service-operations', 1, 'donut', 'requests',
     '{"measure":"count","group_by":"priority","period":{"preset":"last30"},"filters":[{"col":"status","op":"neq","value":"cancelled"}]}',
     'By priority', 'حسب الأولوية'),
    ('service-operations', 2, 'table', 'sla',
     '{"period":{"preset":"last30"}}',
     'SLA compliance', 'الالتزام باتفاقية مستوى الخدمة'),
    ('service-operations', 3, 'kpi', 'requests',
     '{"measure":"count","period":{"preset":"last30"},"filters":[{"col":"status","op":"neq","value":"cancelled"}]}',
     'Requests · last 30 days', 'الطلبات · آخر 30 يوماً'),
    -- Assets & Projects ← asset-inventory, pmo-project-status
    ('assets-and-projects', 0, 'bar', 'assets',
     '{"measure":"count","group_by":"category"}',
     'Asset inventory by category', 'جرد الأصول حسب الفئة'),
    ('assets-and-projects', 1, 'donut', 'assets',
     '{"measure":"count","group_by":"status"}',
     'Assets by status', 'الأصول حسب الحالة'),
    ('assets-and-projects', 2, 'bar', 'pmo_projects',
     '{"measure":"count","group_by":"status"}',
     'Projects by status', 'المشاريع حسب الحالة'),
    -- Workforce performance ← department-performance + employee-performance
    -- (the EP widget row itself is RLS-hidden from roles that may not see it)
    ('workforce-performance', 0, 'table', 'dept_performance',
     '{"period":{"preset":"quarter"}}',
     'Department performance', 'أداء الإدارات'),
    ('workforce-performance', 1, 'table', 'employee_performance',
     '{"period":{"preset":"quarter"}}',
     'Employee performance', 'أداء الموظفين')
)
insert into report_widgets (dashboard_id, position, widget_type, data_source, config, title, title_ar)
select d.id, w.position, w.widget_type, w.data_source, w.config::jsonb, w.title, w.title_ar
from w join report_dashboards d on d.slug = w.dash_slug
where not exists (
  select 1 from report_widgets x where x.dashboard_id = d.id and x.position = w.position
);

-- ── the three gates, on screen ──────────────────────────────────────────
-- Why each gate exists: `reporting` opens the UI at all; `reporting_scheduled`
-- lets report_dispatch() fire (00069); the vault `hook_secret` is what the
-- dispatcher signs its edge-function calls with — any one of them off/absent
-- makes the module look dead with no explanation. Admin-only: the flags are
-- readable anyway, but secret PRESENCE is operational detail.
create or replace function reporting_diagnostics()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_secret boolean;
begin
  if not has_role('system_admin') then
    raise insufficient_privilege using message = 'reporting diagnostics are admin-only';
  end if;
  select exists (select 1 from vault.decrypted_secrets where name = 'hook_secret') into v_secret;
  return jsonb_build_object(
    'reporting',
      exists (select 1 from feature_flags where key = 'reporting' and is_enabled),
    'reporting_scheduled',
      exists (select 1 from feature_flags where key = 'reporting_scheduled' and is_enabled),
    'hook_secret', v_secret
  );
end $$;

revoke all on function reporting_diagnostics() from public;
grant execute on function reporting_diagnostics() to authenticated;
