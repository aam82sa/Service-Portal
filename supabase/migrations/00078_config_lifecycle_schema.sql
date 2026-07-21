-- 00078 — WORKFL1 Part 2 (branch 7): config lifecycle foundation.
--
-- Part 2 gives admins a safe way to Edit / Retire / Delete services, forms
-- and SLA profiles. This migration is the SCHEMA half — the append-only audit
-- trail and the "retired" markers the RPCs (branch 8) and UI (branch 9) build
-- on. It is purely additive and behaviour-preserving.
--
--   * `config_changes` — an append-only audit row for every edit/retire/delete,
--     carrying the impact snapshot, the chosen resolution and the exact set of
--     affected request ids. This is what makes Ady's mass-closure defensible:
--     PDPL/NCA require the paper trail, and closed requests still resolve the
--     retired config for their history pages.
--   * `retired_at / retired_by / retire_reason` on `services`, `form_versions`
--     and `sla_profiles`. Catalog/portal queries filter
--     `is_active and retired_at is null`; request-detail keeps resolving retired
--     rows so closed history still renders the (now retired) service name.
--
-- The brief predates the Phase-1 enum→dept_id sweep (00074/00075) and names
-- `form_definitions`; the live tables are `form_versions` and dept scoping is
-- by `dept_id`, so this follows that sweep (brief note, line 122).
--
-- RLS: `config_changes` is append-only — no UPDATE/DELETE policy exists, and
-- rows are written only by the SECURITY DEFINER `apply_config_change` RPC
-- (branch 8). Read is system_admin, or the dept_head of the owning dept.
-- The restrictive `tenant_isolation` policy (00073 pattern) is applied by hand
-- because 00073's catalog sweep already ran and won't see this new table; the
-- pgTAP gate asserts every table carries it.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) retire markers on the three config tables
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['services', 'form_versions', 'sla_profiles'] loop
    execute format('alter table public.%I add column if not exists retired_at    timestamptz', t);
    execute format('alter table public.%I add column if not exists retired_by    uuid references profiles(id)', t);
    execute format('alter table public.%I add column if not exists retire_reason text', t);
  end loop;
end $$;

-- Partial indexes so the "live" catalog filter stays cheap.
create index if not exists services_live_idx      on services      (id) where retired_at is null;
create index if not exists form_versions_live_idx  on form_versions  (id) where retired_at is null;
create index if not exists sla_profiles_live_idx   on sla_profiles   (id) where retired_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) config_changes — append-only audit trail
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists config_changes (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('service', 'form', 'sla')),
  target_id            uuid not null,
  target_code          text,
  action               text not null check (action in ('edit', 'retire', 'delete')),
  from_version         int,
  to_version           int,
  impact               jsonb not null default '{}'::jsonb,   -- the preview snapshot
  resolution           text check (resolution in ('finish_old', 'migrate', 'close')),
  affected_request_ids uuid[] not null default '{}',
  note                 text not null,
  dept_id              uuid references departments(id),       -- owning dept (null = org-level, e.g. SLA)
  actor_id             uuid not null references profiles(id),
  tenant_id            uuid not null default current_tenant() references tenants(id),
  created_at           timestamptz not null default now()
);

comment on table config_changes is
  'Append-only audit of service/form/SLA edit/retire/delete actions (WORKFL1 '
  'Part 2). Written only by apply_config_change (SECURITY DEFINER). No '
  'UPDATE/DELETE — the paper trail that makes mass-closure defensible.';

create index if not exists config_changes_target_idx  on config_changes (kind, target_id);
create index if not exists config_changes_created_idx  on config_changes (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) RLS — read only (append-only; writes go through the branch-8 RPC)
-- ─────────────────────────────────────────────────────────────────────────
alter table config_changes enable row level security;

-- Read: platform admins see everything; a dept_head sees changes for their
-- own dept. Org-level rows (dept_id null, e.g. SLA profiles) stay admin-only.
drop policy if exists config_changes_read on config_changes;
create policy config_changes_read on config_changes for select to authenticated
  using (
    has_role('system_admin')
    or (dept_id is not null and has_role('dept_head', dept_id))
  );

-- No INSERT/UPDATE/DELETE policies: only SECURITY DEFINER functions (which
-- run as owner and bypass RLS) may write, keeping the table append-only for
-- every ordinary caller.

-- Restrictive tenant isolation, matching every other domain table (00073).
drop policy if exists tenant_isolation on config_changes;
create policy tenant_isolation on config_changes as restrictive
  using (tenant_id = current_tenant())
  with check (tenant_id = current_tenant());

grant select on config_changes to authenticated;
