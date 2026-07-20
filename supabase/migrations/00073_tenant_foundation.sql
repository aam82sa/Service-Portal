-- 00073 — Phase 1 (Final Build): tenant foundation + department enrichment.
--
-- This is the schema half of turning the hub into a multi-tenant "service
-- engine". It is deliberately ADDITIVE and behaviour-preserving for the
-- current single-tenant deployment:
--
--   * a `tenants` table with one seeded row (the current org);
--   * `current_tenant()` — reads the `tenant_id` JWT claim, falling back to
--     the single seeded tenant while we are still single-tenant;
--   * `tenant_id` on every domain table, backfilled to the seeded tenant,
--     defaulting to `current_tenant()` for new rows;
--   * a RESTRICTIVE `tenant_isolation` policy on every one of those tables.
--     Restrictive policies AND with the existing permissive policies, so
--     cross-tenant rows become invisible/unwritable *everywhere* without
--     rewriting the 212 permissive policies by hand — and nothing changes
--     for the seeded tenant, whose rows all match `current_tenant()`.
--   * `departments` gains a uuid identity + display columns (color, rail,
--     icon, Arabic name, ordering, active flag) so the dynamic "service
--     streams" UI and the enum→dept_id cutover (next PR) can build on it.
--
-- The `dept_code` enum is intentionally left in place: the cutover of
-- dept_code columns to `dept_id` references, and the department auto-code
-- generator/trigger, land in the following migration once every reference
-- has moved. Do not drop the enum here.
--
-- The pgTAP gate `supabase/tests/tenant_isolation_test.sql` proves the
-- isolation this migration establishes and is wired as a CI PR gate.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) current_tenant() — JWT claim with single-tenant fallback
-- ─────────────────────────────────────────────────────────────────────────
create or replace function current_tenant()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id',
    '11111111-1111-1111-1111-111111111111'
  )::uuid
$$;

comment on function current_tenant() is
  'Resolves the caller''s tenant from the tenant_id JWT claim; falls back to '
  'the single seeded tenant while the platform is single-tenant. Remove the '
  'fallback when every issued JWT carries tenant_id.';

grant execute on function current_tenant() to authenticated, anon, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Tenants
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- The single seeded org. Fixed id so backfills and current_tenant() agree.
insert into tenants (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'ABC Corporation', 'abc')
on conflict (id) do nothing;

alter table tenants enable row level security;
-- Every authenticated user may read their own tenant row; only service_role
-- (edge functions / provisioning) writes tenants.
drop policy if exists tenants_read on tenants;
create policy tenants_read on tenants for select to authenticated
  using (id = current_tenant());

-- ─────────────────────────────────────────────────────────────────────────
-- 3) departments — uuid identity + display metadata
-- ─────────────────────────────────────────────────────────────────────────
alter table departments add column if not exists id uuid not null default gen_random_uuid();
alter table departments add column if not exists name_ar text;
alter table departments add column if not exists color text;
alter table departments add column if not exists rail_color text;
alter table departments add column if not exists icon text;
alter table departments add column if not exists is_active boolean not null default true;
alter table departments add column if not exists position int;
alter table departments add column if not exists created_by uuid;
alter table departments add column if not exists created_at timestamptz not null default now();

-- id must be uniquely addressable so dept_id FKs (next PR) can target it.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'departments_id_key') then
    alter table departments add constraint departments_id_key unique (id);
  end if;
end $$;

-- Seed display metadata from the legacy color and known department identities.
update departments set color = coalesce(color, color_hex),
                       rail_color = coalesce(rail_color, color_hex)
 where color is null or rail_color is null;

update departments set name_ar = m.ar, icon = coalesce(departments.icon, m.icon), position = coalesce(departments.position, m.pos)
  from (values
    ('IT',    'تقنية المعلومات', 'cpu',       1),
    ('ADMIN', 'الشؤون الإدارية', 'building',  2),
    ('LOG',   'الخدمات اللوجستية', 'truck',   3),
    ('PROC',  'المشتريات',        'cart',     4)
  ) as m(code, ar, icon, pos)
 where departments.code::text = m.code;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) tenant_id on every domain table + restrictive isolation policy
-- ─────────────────────────────────────────────────────────────────────────
-- Driven from the catalog so no table is missed and the migration stays
-- idempotent. `tenants` is the anchor and is excluded.
do $$
declare
  r record;
  seed constant text := '11111111-1111-1111-1111-111111111111';
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname <> 'tenants'
       and not c.relispartition
     order by c.relname
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = r.relname and column_name = 'tenant_id'
    ) then
      execute format('alter table public.%I add column tenant_id uuid', r.relname);
    end if;

    execute format('update public.%I set tenant_id = %L where tenant_id is null', r.relname, seed);
    execute format('alter table public.%I alter column tenant_id set default current_tenant()', r.relname);
    execute format('alter table public.%I alter column tenant_id set not null', r.relname);

    if not exists (select 1 from pg_constraint where conname = r.relname || '_tenant_fk') then
      execute format(
        'alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id)',
        r.relname, r.relname || '_tenant_fk'
      );
    end if;

    execute format('alter table public.%I enable row level security', r.relname);
    execute format('drop policy if exists tenant_isolation on public.%I', r.relname);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())',
      r.relname
    );
  end loop;
end $$;
