-- Form-versioning gate (pgTAP) — WORKFL1 Part 2 follow-up, migration 00080.
--
-- Proves the pipeline that makes the form lifecycle real: publishing a form
-- mints a form_versions row, requests pin the version they were submitted on
-- (the parent's when a child inherits), pinning survives later edits, and a
-- retired current version is skipped at stamp time. Runs under
-- `supabase test db` in a rolled-back transaction.

begin;
select plan(8);

-- backfill: every seeded service with a non-empty form has version rows
select is(
  (select count(*)::int from services s
    where jsonb_typeof(s.form_schema) = 'array' and s.form_schema <> '[]'::jsonb
      and not exists (select 1 from form_versions fv where fv.service_id = s.id)),
  0,
  'backfill: every service with a form has at least one version'
);

-- fixtures: parent with its own form, child that inherits
insert into auth.users (id, email) values ('a2000000-0000-0000-0000-000000000010','req@t') on conflict do nothing;
insert into profiles (id, upn, display_name)
values ('a2000000-0000-0000-0000-000000000010','req@t','Req') on conflict (id) do nothing;

insert into services (id, dept, dept_id, code, name, form_schema)
select 'c2000000-0000-0000-0000-000000000001','IT', d.id,'PAR','Parent',
       '[{"key":"a","label":"A","type":"text"}]'::jsonb
  from departments d where d.code='IT';
insert into services (id, dept, dept_id, code, name, form_schema, parent_id)
select 'c2000000-0000-0000-0000-000000000002','IT', d.id,'CHD','Child','[]'::jsonb,
       'c2000000-0000-0000-0000-000000000001'
  from departments d where d.code='IT';

select is(
  (select count(*)::int from form_versions where service_id='c2000000-0000-0000-0000-000000000001'),
  1, 'creating a service with a form mints v1'
);
select is(
  (select count(*)::int from form_versions where service_id='c2000000-0000-0000-0000-000000000002'),
  0, 'a child with an empty (inherited) form mints nothing'
);

-- edit → v2; a no-op save mints nothing
update services set form_schema='[{"key":"a","label":"A","type":"text"},{"key":"b","label":"B","type":"text"}]'
 where id='c2000000-0000-0000-0000-000000000001';
update services set form_schema=form_schema where id='c2000000-0000-0000-0000-000000000001';
select is(
  (select max(version)::int from form_versions where service_id='c2000000-0000-0000-0000-000000000001'),
  2, 'editing the form mints v2; a no-op save mints nothing'
);

-- request pins the current version
insert into requests (id, ref, service_id, requester_id, title)
values ('e2000000-0000-0000-0000-000000000001','REQ-FV1','c2000000-0000-0000-0000-000000000001',
        'a2000000-0000-0000-0000-000000000010','r1');
select is(
  (select fv.version::int from requests r join form_versions fv on fv.id=r.form_version_id
    where r.id='e2000000-0000-0000-0000-000000000001'),
  2, 'a new request is stamped with the current form version'
);

-- child inheritance pins the parent's version
insert into requests (id, ref, service_id, requester_id, title)
values ('e2000000-0000-0000-0000-000000000002','REQ-FV2','c2000000-0000-0000-0000-000000000002',
        'a2000000-0000-0000-0000-000000000010','r2');
select is(
  (select fv.service_id from requests r join form_versions fv on fv.id=r.form_version_id
    where r.id='e2000000-0000-0000-0000-000000000002'),
  'c2000000-0000-0000-0000-000000000001'::uuid,
  'a request on an inheriting child pins the parent''s form version'
);

-- pinning survives a later edit
update services set form_schema='[{"key":"c","label":"C","type":"text"}]'
 where id='c2000000-0000-0000-0000-000000000001';
select is(
  (select fv.version::int from requests r join form_versions fv on fv.id=r.form_version_id
    where r.id='e2000000-0000-0000-0000-000000000001'),
  2, 'publishing v3 does not move an existing request off v2'
);

-- a retired current version is skipped at stamp time
update form_versions set status='retired', retired_at=now()
 where service_id='c2000000-0000-0000-0000-000000000001' and version=3;
insert into requests (id, ref, service_id, requester_id, title)
values ('e2000000-0000-0000-0000-000000000004','REQ-FV4','c2000000-0000-0000-0000-000000000001',
        'a2000000-0000-0000-0000-000000000010','r4');
select is(
  (select fv.version::int from requests r join form_versions fv on fv.id=r.form_version_id
    where r.id='e2000000-0000-0000-0000-000000000004'),
  2, 'a retired current version is skipped — the latest live version is pinned'
);

select * from finish();
rollback;
