-- Config-lifecycle schema gate (pgTAP) — WORKFL1 Part 2, migration 00078.
--
-- Proves the branch-7 deliverables that the RPCs (branch 8) and UI (branch 9)
-- depend on:
--   * `services`, `form_versions`, `sla_profiles` each carry the three retire
--     markers (retired_at / retired_by / retire_reason);
--   * `config_changes` exists, is tenant-gated (so the isolation gate stays
--     green), and is APPEND-ONLY — it has a SELECT read policy but no
--     permissive INSERT/UPDATE/DELETE policy, so only the SECURITY DEFINER
--     apply_config_change RPC can write it;
--   * read is scoped: a dept_head sees only their own dept's changes and never
--     org-level (dept-null) rows; system_admin sees everything.
--
-- Runs under `supabase test db`, in a rolled-back transaction.

begin;
select plan(9);

-- ── structural: retire markers ─────────────────────────────────────────
select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public'
      and table_name in ('services','form_versions','sla_profiles')
      and column_name in ('retired_at','retired_by','retire_reason')),
  9,
  'services / form_versions / sla_profiles each have the 3 retire columns'
);

-- ── structural: config_changes shape ───────────────────────────────────
select has_table('config_changes', 'config_changes table exists');

select col_not_null('config_changes', 'note',
  'config_changes.note is mandatory (the audit reason)');

select col_not_null('config_changes', 'tenant_id',
  'config_changes.tenant_id is NOT NULL (isolation gate)');

select is(
  (select permissive from pg_policies
    where schemaname='public' and tablename='config_changes' and policyname='tenant_isolation'),
  'RESTRICTIVE',
  'config_changes has a RESTRICTIVE tenant_isolation policy'
);

-- append-only: exactly one SELECT read policy, no permissive write policy
select is(
  (select count(*)::int from pg_policies
    where schemaname='public' and tablename='config_changes'
      and permissive='PERMISSIVE' and cmd in ('INSERT','UPDATE','DELETE','ALL')),
  0,
  'config_changes has no permissive write policy (append-only)'
);

-- ── functional: read scoping ───────────────────────────────────────────
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001','sa@t'),
  ('a0000000-0000-0000-0000-000000000002','it@t'),
  ('a0000000-0000-0000-0000-000000000003','adm@t')
on conflict do nothing;
insert into profiles (id, upn, display_name) values
  ('a0000000-0000-0000-0000-000000000001','sa@t','SA'),
  ('a0000000-0000-0000-0000-000000000002','it@t','IT'),
  ('a0000000-0000-0000-0000-000000000003','adm@t','ADM')
on conflict (id) do nothing;

insert into role_assignments (profile_id, role, dept_id)
select 'a0000000-0000-0000-0000-000000000001','system_admin', null;
insert into role_assignments (profile_id, role, dept_id)
select 'a0000000-0000-0000-0000-000000000002','dept_head', id from departments where code='IT';
insert into role_assignments (profile_id, role, dept_id)
select 'a0000000-0000-0000-0000-000000000003','dept_head', id from departments where code='ADMIN';

insert into config_changes (kind, target_id, target_code, action, note, dept_id, actor_id)
select 'service', gen_random_uuid(), 'IT-SVC', 'retire', 'n', id, 'a0000000-0000-0000-0000-000000000001'
  from departments where code='IT';
insert into config_changes (kind, target_id, target_code, action, note, dept_id, actor_id)
values ('sla', gen_random_uuid(), 'SLA-STD', 'edit', 'n', null, 'a0000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"tenant_id":"11111111-1111-1111-1111-111111111111"}', true);

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select is(
  (select string_agg(target_code, ',' order by target_code) from config_changes),
  'IT-SVC',
  'IT dept_head sees only their dept change, not the org-level SLA'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', true);
select is(
  (select count(*)::int from config_changes),
  0,
  'ADMIN dept_head sees none of IT''s or the org-level changes'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*)::int from config_changes),
  2,
  'system_admin sees every change'
);

reset role;
select * from finish();
rollback;
