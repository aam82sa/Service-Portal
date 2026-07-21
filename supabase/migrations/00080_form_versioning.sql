-- 00080 — WORKFL1 Part 2 follow-up: the form-versioning pipeline.
--
-- form_versions has existed since 00002 and requests.form_version_id since the
-- same migration — but nothing ever WROTE them: the form builder saves straight
-- to services.form_schema and requests never recorded which form they were
-- submitted on. That left the Part-2 lifecycle (retire/delete a form version,
-- "migrate to the new version") with a table that was always empty, and it
-- means editing a form silently rewrites how CLOSED requests render their
-- answers (request detail reads the live schema).
--
-- This migration mirrors what 00077 did for workflows:
--
--   * publishing a form (any change to services.form_schema, including the
--     schema a new service is created with) mints a form_versions row —
--     version = max+1, status 'published', the exact schema as shipped;
--   * a one-time backfill mints v1 for every service that already has a
--     non-empty form but no version rows;
--   * requests_before_insert stamps requests.form_version_id with the current
--     published version (the parent's when the child inherits its form), so a
--     request permanently records the form it was actually submitted on;
--   * fv_read lets any authenticated user read non-draft versions — a
--     requester's history must keep rendering a version that was later
--     superseded or retired (drafts stay admin-only).
--
-- Older versions keep status 'published' (they are history; "current" is the
-- highest version). status 'retired' + retired_at is the explicit lifecycle
-- action (00078/00079), which also drops the version out of "current".

-- ─────────────────────────────────────────────────────────────────────────
-- 1) mint a version whenever a service's form schema is published
-- ─────────────────────────────────────────────────────────────────────────
create or replace function services_mint_form_version()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  latest jsonb;
begin
  -- an empty schema is "no own form" (children inherit) — nothing to version
  if new.form_schema is null or jsonb_typeof(new.form_schema) <> 'array'
     or new.form_schema = '[]'::jsonb then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.form_schema is not distinct from new.form_schema then
    return new;
  end if;

  -- idempotence: skip when the latest version already holds this exact schema
  select fv.schema into latest from form_versions fv
   where fv.service_id = new.id order by fv.version desc limit 1;
  if latest is not distinct from new.form_schema then
    return new;
  end if;

  insert into form_versions (service_id, version, schema, status, created_by, published_at)
  values (
    new.id,
    coalesce((select max(version) from form_versions where service_id = new.id), 0) + 1,
    new.form_schema,
    'published',
    auth.uid(),
    now()
  );
  return new;
end $$;

drop trigger if exists services_mint_form_version_t on services;
create trigger services_mint_form_version_t
  after insert or update of form_schema on services
  for each row execute function services_mint_form_version();

-- ─────────────────────────────────────────────────────────────────────────
-- 2) backfill v1 for services that already have a form but no versions
-- ─────────────────────────────────────────────────────────────────────────
insert into form_versions (service_id, version, schema, status, published_at)
select s.id, 1, s.form_schema, 'published', now()
  from services s
 where jsonb_typeof(s.form_schema) = 'array'
   and s.form_schema <> '[]'::jsonb
   and not exists (select 1 from form_versions fv where fv.service_id = s.id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) stamp requests.form_version_id at insert (00077 body + form pinning)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function requests_before_insert()
returns trigger language plpgsql security definer as $$
declare
  svc services%rowtype;
  resp int;
  reso int;
begin
  select * into svc from services where id = new.service_id and is_active;
  if not found then
    raise exception 'unknown or inactive service';
  end if;
  new.dept = svc.dept;         -- legacy denormalised code (null for dynamic streams)
  new.dept_id = svc.dept_id;   -- canonical department reference
  new.workflow_id = coalesce(
    (select w.id from workflow_definitions w
      where w.service_id = new.service_id and w.status = 'published'
      order by w.version desc limit 1),
    (select w.id from workflow_definitions w
      where w.service_id = svc.parent_id and w.status = 'published'
      order by w.version desc limit 1)
  );
  -- pin the form as submitted: the service's own current version, or the
  -- parent's when the child has no form of its own (inheritance)
  if jsonb_typeof(svc.form_schema) = 'array' and svc.form_schema <> '[]'::jsonb then
    new.form_version_id = (
      select fv.id from form_versions fv
       where fv.service_id = new.service_id and fv.status = 'published' and fv.retired_at is null
       order by fv.version desc limit 1);
  else
    new.form_version_id = (
      select fv.id from form_versions fv
       where fv.service_id = svc.parent_id and fv.status = 'published' and fv.retired_at is null
       order by fv.version desc limit 1);
  end if;
  select o_response, o_resolution into resp, reso from sla_minutes_for(new.service_id, new.priority);
  if resp is not null then new.sla_response_due = add_business_minutes(now(), resp); end if;
  if reso is not null then new.sla_resolution_due = add_business_minutes(now(), reso); end if;
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) fv_read: history must keep resolving superseded/retired versions
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists fv_read on form_versions;
create policy fv_read on form_versions for select to authenticated using (
  status <> 'draft' or has_role('system_admin')
  or has_role('dept_admin', (select s.dept_id from services s where s.id = form_versions.service_id))
);
