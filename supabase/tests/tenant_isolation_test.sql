-- Tenant-isolation PR gate (pgTAP) — Final Build Phase 1, migration 00073.
--
-- Proves the deliverable the brief names: "tenant A must not see tenant B's
-- rows in any table." Two layers:
--   * structural — every domain table (all but `tenants`) carries a NOT NULL
--     tenant_id and a RESTRICTIVE `tenant_isolation` policy, so no table is
--     left ungated;
--   * functional — under the `authenticated` role, a tenant only sees its own
--     rows and cannot write a row into another tenant.
--
-- Run by `supabase test db` (see .github/workflows/db-tests.yml). The file
-- runs in a transaction that is rolled back, so its seed rows never persist.

begin;
select plan(7);

-- ── structural coverage ────────────────────────────────────────────────
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname <> 'tenants' and not c.relispartition
      and not exists (
        select 1 from information_schema.columns col
         where col.table_schema = 'public' and col.table_name = c.relname
           and col.column_name = 'tenant_id' and col.is_nullable = 'NO')),
  0,
  'every domain table has a NOT NULL tenant_id column'
);

select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname <> 'tenants' and not c.relispartition
      and not exists (
        select 1 from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname
           and p.policyname = 'tenant_isolation' and p.permissive = 'RESTRICTIVE')),
  0,
  'every domain table has a RESTRICTIVE tenant_isolation policy'
);

select cmp_ok(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'tenants' and not c.relispartition),
  '>', 50,
  'sanity: a non-trivial number of domain tables are covered'
);

-- ── functional isolation ───────────────────────────────────────────────
-- Seed a second tenant and one announcement per tenant as the superuser
-- test runner (RLS bypassed). `announcements` has a permissive `ann_read:
-- true`, so the only gate on cross-tenant reads is tenant_isolation.
insert into tenants (id, name, slug)
  values ('22222222-2222-2222-2222-222222222222', 'Beta Org', 'beta')
  on conflict (id) do nothing;
insert into announcements (title, tenant_id)
  values ('ISO-A', '11111111-1111-1111-1111-111111111111'),
         ('ISO-B', '22222222-2222-2222-2222-222222222222');

set local role authenticated;

select set_config('request.jwt.claims', '{"tenant_id":"11111111-1111-1111-1111-111111111111"}', true);
select is(
  (select string_agg(title, ',' order by title) from announcements where title like 'ISO-%'),
  'ISO-A',
  'tenant A sees only its own announcement'
);

select set_config('request.jwt.claims', '{"tenant_id":"22222222-2222-2222-2222-222222222222"}', true);
select is(
  (select string_agg(title, ',' order by title) from announcements where title like 'ISO-%'),
  'ISO-B',
  'tenant B sees only its own announcement'
);

select is(
  (select count(*)::int from announcements where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'tenant B cannot see any of tenant A''s rows'
);

-- Cross-tenant write is rejected by the policy WITH CHECK.
select set_config('request.jwt.claims', '{"tenant_id":"11111111-1111-1111-1111-111111111111"}', true);
select throws_ok(
  $$ insert into announcements (title, tenant_id)
       values ('ISO-EVIL', '22222222-2222-2222-2222-222222222222') $$,
  '42501',
  null,
  'tenant A cannot insert a row owned by tenant B'
);

reset role;
select * from finish();
rollback;
