-- 00086 — REPORTING v2 branch 1: one vocabulary for report data sources.
--
-- The report_definitions CHECK allowed pmo_evm, pmo_risks and audit, but the
-- compiler's allowlist never knew them — a definition using any of the three
-- was accepted by the database and then failed with a guaranteed compile
-- error. The fix, mirroring the app_pages parity gate:
--
--   * pmo_risks and audit get REAL allowlist entries (the PMI risk register
--     and the admin_events governance trail);
--   * pmo_evm is REMOVED from the CHECK — no tabular EVM source exists
--     (baselines are JSONB snapshots), so it could only ever error. Nothing
--     references it: no builtin template, no seed, no code path.
--
-- The canonical list lives in generate-report/allowlist.ts
-- (ALL_DATA_SOURCES); allowlist.parity.test.ts parses this migration and
-- asserts the two never diverge again.

alter table report_definitions drop constraint if exists report_definitions_data_source_check;
alter table report_definitions add constraint report_definitions_data_source_check
  check (data_source in (
    'requests', 'sla', 'assets', 'letters', 'pmo_projects', 'pmo_risks',
    'audit', 'dept_performance', 'employee_performance'));
