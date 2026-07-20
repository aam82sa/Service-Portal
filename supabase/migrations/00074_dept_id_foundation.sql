-- 00074 — Phase 1 PR-B (1/2): dept_id foundation for the service engine.
--
-- The dept_code enum blocks user-created "service streams": you cannot add an
-- enum value per tenant or from the admin console. This migration lays the
-- uuid foundation to replace it, WITHOUT breaking the enum path — it is purely
-- additive, so every existing policy, function and trigger keeps working and
-- the tenant-isolation gate stays green:
--
--   * departments.code becomes text, so new stream codes (e.g. FAC) are
--     insertable. departments already has a uuid id (00073).
--   * every dept_code-typed column gets a sibling dept_id uuid referencing
--     departments(id), backfilled from the existing code. The legacy enum
--     column stays (denormalised, now nullable where it was NOT NULL) so old
--     rows and old code are untouched.
--   * has_role / has_dept_role_any gain uuid overloads keyed on
--     role_assignments.dept_id, so RLS can move to dept_id in the next
--     migration (00075) which recreates the 28 dept-scoped policies and the
--     request-ref/routing helpers. The enum overloads remain during the
--     transition.
--
-- The enum type itself is intentionally NOT dropped yet (brief: not until all
-- references are migrated and tests pass).

-- ── 1) departments.code → text (drop the enum FK from services first) ──────
alter table services drop constraint if exists services_dept_fkey;
alter table departments alter column code type text using code::text;

-- `color` (00073) is the canonical display colour now; the legacy color_hex
-- becomes optional so dynamically-created streams need only set `color`.
alter table departments alter column color_hex drop not null;

-- ── 2) dept_id sibling columns, backfilled from the legacy code ────────────
do $$
declare
  m record;
begin
  for m in
    select * from (values
      ('assignment_rules',            'dept',               'dept_id'),
      ('container_members',           'dept',               'dept_id'),
      ('cost_centers',                'dept',               'dept_id'),
      ('doa_matrix',                  'dept',               'dept_id'),
      ('escalation_rules',            'dept',               'dept_id'),
      ('inbound_routes',              'dept',               'dept_id'),
      ('initials_paths',              'dept',               'dept_id'),
      ('letter_initials',            'approver_dept',      'approver_dept_id'),
      ('letter_shares',               'dept',               'dept_id'),
      ('letter_templates',            'dept',               'dept_id'),
      ('letters',                     'dept',               'dept_id'),
      ('notification_templates',      'dept',               'dept_id'),
      ('project_approvals',           'target_dept',        'target_dept_id'),
      ('project_conversion_requests', 'source_department',  'source_department_id'),
      ('projects',                    'origin_department',  'origin_department_id'),
      ('report_definitions',          'dept',               'dept_id'),
      ('requests',                    'dept',               'dept_id'),
      ('role_assignments',            'dept',               'dept_id'),
      ('routing_rules',               'dept',               'dept_id'),
      ('services',                    'dept',               'dept_id'),
      ('signatories',                 'dept',               'dept_id'),
      ('teams',                       'dept',               'dept_id')
    ) as t(tbl, dept_col, id_col)
  loop
    execute format('alter table public.%I add column if not exists %I uuid', m.tbl, m.id_col);
    execute format(
      'update public.%1$I s set %2$I = d.id from departments d where s.%3$I::text = d.code and s.%2$I is null',
      m.tbl, m.id_col, m.dept_col
    );
    if not exists (select 1 from pg_constraint where conname = m.tbl || '_' || m.id_col || '_fk') then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references departments(id)',
        m.tbl, m.tbl || '_' || m.id_col || '_fk', m.id_col
      );
    end if;
    execute format('create index if not exists %I on public.%I (%I)',
      m.tbl || '_' || m.id_col || '_idx', m.tbl, m.id_col);
  end loop;
end $$;

-- ── 3) legacy enum columns become nullable so new-stream rows can omit them
--    (the code for a dynamic stream is not an enum value). dept_id is the key.
-- container_members.dept is part of its primary key, so it stays NOT NULL;
-- dynamic streams don't create container_members rows.
alter table assignment_rules            alter column dept              drop not null;
alter table inbound_routes              alter column dept              drop not null;
alter table letters                     alter column dept              drop not null;
alter table project_conversion_requests alter column source_department drop not null;
alter table requests                    alter column dept              drop not null;
alter table routing_rules               alter column dept              drop not null;
alter table services                    alter column dept              drop not null;
alter table teams                       alter column dept              drop not null;

-- ── 4) uuid overloads of the RLS helpers (enum overloads stay during move) ─
create or replace function has_role(r platform_role, d uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from role_assignments
    where profile_id = auth.uid()
      and (role = r or (role = 'dept_head' and r in ('approver', 'dept_admin')))
      and (dept_id is null or d is null or dept_id = d)
  )
$$;

create or replace function has_dept_role_any(r platform_role, depts uuid[])
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from role_assignments
    where profile_id = auth.uid()
      and role = r
      and (dept_id is null or dept_id = any(depts))
  )
$$;
