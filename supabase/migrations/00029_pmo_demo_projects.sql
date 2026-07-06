-- PMO demo projects across the lifecycle stages, owned by the seeded test
-- users (00028). Remove before production go-live.
-- Idempotent: fixed ids, on conflict do nothing; skips if 00028 not applied.
do $$
declare
  pm uuid;      -- Peter PM
  paula uuid;   -- PMO Admin
  carla uuid;   -- committee member
  dana uuid;    -- IT department head (dev user)
  t1 uuid;      -- Tester One (team member)
begin
  select id into pm from profiles where upn = 'pm@dev.abccorp.com';
  if pm is null then
    raise notice 'PMO demo skipped — apply 00028_pmo_test_users first';
    return;
  end if;
  select id into paula from profiles where upn = 'pmo.admin@dev.abccorp.com';
  select id into carla from profiles where upn = 'committee@dev.abccorp.com';
  select id into dana  from profiles where upn = 'deptadmin.it@dev.abccorp.com';
  select id into t1    from profiles where upn like 'tester1@%';

  -- 1) Draft company project with a draft charter (ready to submit)
  insert into projects (id, code, name, description, status, project_type, department_scope, project_manager_id, created_by)
  values ('44444444-0000-4000-8000-000000000001', 'PJ-1001', 'Website Redesign',
          'Refresh the corporate site and intranet landing pages', 'draft', 'company', '{ADMIN}', pm, pm)
  on conflict (id) do nothing;
  insert into project_charters (id, project_id, objective, business_case, estimated_budget, estimated_duration_days, status)
  values ('55555555-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001',
          'Modernize the public website and intranet', 'Current site is five years old and not mobile friendly', 45000, 90, 'draft')
  on conflict (id) do nothing;

  -- 2) Awaiting the committee: dept head already approved (Carla can decide this one live)
  insert into projects (id, code, name, description, status, project_type, department_scope, project_manager_id, created_by)
  values ('44444444-0000-4000-8000-000000000002', 'PJ-1002', 'Field Service App',
          'Mobile app for field technicians', 'charter_approval', 'company', '{IT}', pm, pm)
  on conflict (id) do nothing;
  insert into project_charters (id, project_id, objective, business_case, estimated_budget, estimated_duration_days, status, submitted_at)
  values ('55555555-0000-4000-8000-000000000002', '44444444-0000-4000-8000-000000000002',
          'Equip field technicians with a mobile work-order app', 'Cuts paperwork and reporting lag', 120000, 150, 'submitted', now() - interval '2 days')
  on conflict (id) do nothing;
  insert into project_approvals (id, project_id, charter_id, step, step_order, target_dept, decision, decided_by, decided_at, comment)
  values ('66666666-0000-4000-8000-000000000021', '44444444-0000-4000-8000-000000000002',
          '55555555-0000-4000-8000-000000000002', 'dept_head', 1, 'IT', 'approved', dana, now() - interval '1 day', 'IT supports this')
  on conflict (id) do nothing;
  insert into project_approvals (id, project_id, charter_id, step, step_order, decision)
  values ('66666666-0000-4000-8000-000000000022', '44444444-0000-4000-8000-000000000002',
          '55555555-0000-4000-8000-000000000002', 'committee', 2, 'pending')
  on conflict (id) do nothing;

  -- 3) Planning: fully approved charter, WBS being built
  insert into projects (id, code, name, description, status, project_type, department_scope, project_manager_id, created_by, planned_start, planned_end)
  values ('44444444-0000-4000-8000-000000000003', 'PJ-1003', 'ERP Rollout',
          'Finance and procurement ERP implementation', 'planning', 'company', '{IT,PROC}', pm, pm,
          current_date + 14, current_date + 194)
  on conflict (id) do nothing;
  insert into project_charters (id, project_id, objective, business_case, estimated_budget, estimated_duration_days, status, submitted_at, decided_at)
  values ('55555555-0000-4000-8000-000000000003', '44444444-0000-4000-8000-000000000003',
          'Deploy ERP across finance and procurement', 'Replace spreadsheet-driven purchasing', 350000, 180, 'approved',
          now() - interval '10 days', now() - interval '7 days')
  on conflict (id) do nothing;
  insert into project_approvals (id, project_id, charter_id, step, step_order, target_dept, decision, decided_by, decided_at)
  values
    ('66666666-0000-4000-8000-000000000031', '44444444-0000-4000-8000-000000000003',
     '55555555-0000-4000-8000-000000000003', 'dept_head', 1, 'IT', 'approved', dana, now() - interval '9 days'),
    ('66666666-0000-4000-8000-000000000032', '44444444-0000-4000-8000-000000000003',
     '55555555-0000-4000-8000-000000000003', 'committee', 2, null, 'approved', carla, now() - interval '7 days')
  on conflict (id) do nothing;
  insert into wbs_elements (id, project_id, code, title, level, sequence, created_by) values
    ('77777777-0000-4000-8000-000000000031', '44444444-0000-4000-8000-000000000003', '1', 'Foundation', 1, 1, pm),
    ('77777777-0000-4000-8000-000000000032', '44444444-0000-4000-8000-000000000003', '1.1', 'Infrastructure readiness', 2, 1, pm),
    ('77777777-0000-4000-8000-000000000033', '44444444-0000-4000-8000-000000000003', '1.2', 'Data migration', 2, 2, pm),
    ('77777777-0000-4000-8000-000000000034', '44444444-0000-4000-8000-000000000003', '2', 'Department rollout', 1, 2, pm)
  on conflict (id) do nothing;
  update wbs_elements set parent_wbs_id = '77777777-0000-4000-8000-000000000031'
  where id in ('77777777-0000-4000-8000-000000000032', '77777777-0000-4000-8000-000000000033');

  -- 4) Active: baselined, team assigned, budget lines ready for PO handoff
  insert into projects (id, code, name, description, status, project_type, department_scope, project_manager_id, created_by, planned_start, planned_end)
  values ('44444444-0000-4000-8000-000000000004', 'PJ-1004', 'Data Center Migration',
          'Move on-prem workloads to the new facility', 'active', 'company', '{IT}', pm, pm,
          current_date - 30, current_date + 60)
  on conflict (id) do nothing;
  insert into project_charters (id, project_id, objective, business_case, estimated_budget, estimated_duration_days, status, submitted_at, decided_at)
  values ('55555555-0000-4000-8000-000000000004', '44444444-0000-4000-8000-000000000004',
          'Relocate all production workloads with zero data loss', 'Current facility lease ends this year', 200000, 90, 'approved',
          now() - interval '40 days', now() - interval '35 days')
  on conflict (id) do nothing;
  insert into project_approvals (id, project_id, charter_id, step, step_order, target_dept, decision, decided_by, decided_at)
  values
    ('66666666-0000-4000-8000-000000000041', '44444444-0000-4000-8000-000000000004',
     '55555555-0000-4000-8000-000000000004', 'dept_head', 1, 'IT', 'approved', dana, now() - interval '38 days'),
    ('66666666-0000-4000-8000-000000000042', '44444444-0000-4000-8000-000000000004',
     '55555555-0000-4000-8000-000000000004', 'committee', 2, null, 'approved', carla, now() - interval '35 days')
  on conflict (id) do nothing;
  insert into wbs_elements (id, project_id, code, title, level, sequence, created_by) values
    ('77777777-0000-4000-8000-000000000041', '44444444-0000-4000-8000-000000000004', '1', 'Network and racks', 1, 1, pm),
    ('77777777-0000-4000-8000-000000000042', '44444444-0000-4000-8000-000000000004', '2', 'Workload waves', 1, 2, pm),
    ('77777777-0000-4000-8000-000000000043', '44444444-0000-4000-8000-000000000004', '3', 'Cutover and decommission', 1, 3, pm)
  on conflict (id) do nothing;
  insert into project_baselines (id, project_id, baseline_type, version, snapshot_json, locked_by)
  values
    ('88888888-0000-4000-8000-000000000041', '44444444-0000-4000-8000-000000000004', 'scope', 1, '{"wbs":["Network and racks","Workload waves","Cutover and decommission"]}', pm),
    ('88888888-0000-4000-8000-000000000042', '44444444-0000-4000-8000-000000000004', 'schedule', 1, '{"planned_days":90}', pm),
    ('88888888-0000-4000-8000-000000000043', '44444444-0000-4000-8000-000000000004', 'cost', 1, '{"estimated_budget":200000}', pm)
  on conflict (id) do nothing;
  if t1 is not null then
    insert into resource_assignments (id, project_id, user_id, role_on_project, allocation_percent, created_by)
    values ('99999999-0000-4000-8000-000000000041', '44444444-0000-4000-8000-000000000004', t1, 'Migration engineer', 80, pm)
    on conflict do nothing;
  end if;
  insert into budget_lines (id, project_id, description, planned_amount, cost_center, category)
  values
    ('aaaa1111-0000-4000-8000-000000000041', '44444444-0000-4000-8000-000000000004', 'Rack and cabling hardware', 65000, 'CC-IT-02', 'hardware'),
    ('aaaa1111-0000-4000-8000-000000000042', '44444444-0000-4000-8000-000000000004', 'Moving and installation partner', 40000, 'CC-IT-02', 'services')
  on conflict (id) do nothing;

  -- 5) On hold
  insert into projects (id, code, name, description, status, project_type, department_scope, project_manager_id, created_by)
  values ('44444444-0000-4000-8000-000000000005', 'PJ-1005', 'Office Relocation',
          'Move the Administration wing to the new floor', 'on_hold', 'company', '{ADMIN}', pm, pm)
  on conflict (id) do nothing;
  insert into project_charters (id, project_id, objective, estimated_budget, status, submitted_at, decided_at)
  values ('55555555-0000-4000-8000-000000000005', '44444444-0000-4000-8000-000000000005',
          'Relocate 40 staff with minimal downtime', 80000, 'approved', now() - interval '60 days', now() - interval '55 days')
  on conflict (id) do nothing;
  insert into project_baselines (id, project_id, baseline_type, version, snapshot_json, locked_by)
  values
    ('88888888-0000-4000-8000-000000000051', '44444444-0000-4000-8000-000000000005', 'scope', 1, '{}', pm),
    ('88888888-0000-4000-8000-000000000052', '44444444-0000-4000-8000-000000000005', 'schedule', 1, '{}', pm),
    ('88888888-0000-4000-8000-000000000053', '44444444-0000-4000-8000-000000000005', 'cost', 1, '{"estimated_budget":80000}', pm)
  on conflict (id) do nothing;

  -- 6) Closed
  insert into projects (id, code, name, description, status, project_type, department_scope, project_manager_id, created_by)
  values ('44444444-0000-4000-8000-000000000006', 'PJ-1006', 'Wi-Fi Upgrade',
          'Replace access points across HQ', 'closed', 'company', '{IT}', pm, pm)
  on conflict (id) do nothing;
  insert into project_charters (id, project_id, objective, estimated_budget, status, submitted_at, decided_at)
  values ('55555555-0000-4000-8000-000000000006', '44444444-0000-4000-8000-000000000006',
          'Full coverage Wi-Fi 6 across headquarters', 55000, 'approved', now() - interval '120 days', now() - interval '115 days')
  on conflict (id) do nothing;

  -- 7) Personal tracker for Peter (invisible to everyone else)
  insert into projects (id, code, name, description, status, project_type, project_manager_id, created_by)
  values ('44444444-0000-4000-8000-000000000007', 'PJ-1007', 'My Certifications Plan',
          'PMP renewal and cloud certifications', 'active', 'personal', pm, pm)
  on conflict (id) do nothing;
  insert into wbs_elements (id, project_id, code, title, level, sequence, created_by) values
    ('77777777-0000-4000-8000-000000000071', '44444444-0000-4000-8000-000000000007', '1', 'PMP renewal PDUs', 1, 1, pm),
    ('77777777-0000-4000-8000-000000000072', '44444444-0000-4000-8000-000000000007', '2', 'Cloud architect exam', 1, 2, pm)
  on conflict (id) do nothing;
end $$;
