-- Demo activity data for the timeline: dates, statuses, multi-assignees and
-- FS dependencies on the 00029 demo projects. Remove before go-live.
do $$
declare
  pm uuid; t1 uuid; t2 uuid;
begin
  select id into pm from profiles where upn = 'pm@dev.abccorp.com';
  if pm is null or not exists (select 1 from projects where code = 'PJ-1004') then
    raise notice 'PMO demo activities skipped — apply 00028/00029 first';
    return;
  end if;
  select id into t1 from profiles where upn like 'tester1@%';
  select id into t2 from profiles where upn like 'tester2@%';

  -- PJ-1004 Data Center Migration: child activities with a dependency chain
  insert into wbs_elements (id, project_id, parent_wbs_id, code, title, level, sequence,
                            planned_start, planned_end, status, is_milestone, created_by) values
    ('77777777-0000-4000-8000-000000000141', '44444444-0000-4000-8000-000000000004',
     '77777777-0000-4000-8000-000000000041', '1.1', 'Order rack hardware', 2, 1,
     current_date - 30, current_date - 16, 'done', false, pm),
    ('77777777-0000-4000-8000-000000000142', '44444444-0000-4000-8000-000000000004',
     '77777777-0000-4000-8000-000000000041', '1.2', 'Rack and cabling install', 2, 2,
     current_date - 15, current_date - 5, 'done', false, pm),
    ('77777777-0000-4000-8000-000000000143', '44444444-0000-4000-8000-000000000004',
     '77777777-0000-4000-8000-000000000042', '2.1', 'Migration wave 1', 2, 1,
     current_date - 4, current_date + 10, 'in_progress', false, pm),
    ('77777777-0000-4000-8000-000000000144', '44444444-0000-4000-8000-000000000004',
     '77777777-0000-4000-8000-000000000042', '2.2', 'Migration wave 2', 2, 2,
     current_date + 11, current_date + 30, 'todo', false, pm),
    ('77777777-0000-4000-8000-000000000145', '44444444-0000-4000-8000-000000000004',
     '77777777-0000-4000-8000-000000000043', '3.1', 'Final cutover and decommission', 2, 1,
     current_date + 31, current_date + 45, 'todo', false, pm),
    ('77777777-0000-4000-8000-000000000146', '44444444-0000-4000-8000-000000000004',
     '77777777-0000-4000-8000-000000000043', '3.2', 'Facility handover', 2, 2,
     current_date + 60, current_date + 60, 'todo', true, pm)
  on conflict do nothing;

  -- endpoints may have been skipped above (code collisions), so guard the FKs
  insert into wbs_dependencies (predecessor_id, successor_id)
  select v.p, v.s from (values
    ('77777777-0000-4000-8000-000000000141'::uuid, '77777777-0000-4000-8000-000000000142'::uuid),
    ('77777777-0000-4000-8000-000000000142', '77777777-0000-4000-8000-000000000143'),
    ('77777777-0000-4000-8000-000000000143', '77777777-0000-4000-8000-000000000144'),
    ('77777777-0000-4000-8000-000000000144', '77777777-0000-4000-8000-000000000145'),
    ('77777777-0000-4000-8000-000000000145', '77777777-0000-4000-8000-000000000146')
  ) as v(p, s)
  where exists (select 1 from wbs_elements where id = v.p)
    and exists (select 1 from wbs_elements where id = v.s)
  on conflict do nothing;

  insert into wbs_assignments (wbs_element_id, user_id, created_by)
  select v.w, v.u, pm from (values
    ('77777777-0000-4000-8000-000000000143'::uuid, t1),
    ('77777777-0000-4000-8000-000000000144', t1),
    ('77777777-0000-4000-8000-000000000143', t2),
    ('77777777-0000-4000-8000-000000000145', t2)
  ) as v(w, u)
  where v.u is not null
    and exists (select 1 from wbs_elements where id = v.w)
  on conflict do nothing;

  -- PJ-1003 ERP Rollout (planning): future-dated activities
  update wbs_elements set planned_start = current_date + 14, planned_end = current_date + 44
  where id = '77777777-0000-4000-8000-000000000032';
  update wbs_elements set planned_start = current_date + 45, planned_end = current_date + 89
  where id = '77777777-0000-4000-8000-000000000033';
  update wbs_elements set planned_start = current_date + 90, planned_end = current_date + 180
  where id = '77777777-0000-4000-8000-000000000034';
  insert into wbs_dependencies (predecessor_id, successor_id) values
    ('77777777-0000-4000-8000-000000000032', '77777777-0000-4000-8000-000000000033'),
    ('77777777-0000-4000-8000-000000000033', '77777777-0000-4000-8000-000000000034')
  on conflict do nothing;
end $$;
