-- Service hierarchy (main/child), two-portal model (Logistics folded into
-- Administration), and the IT asset management module with dev dummy data.

-- ============ Service hierarchy ============
alter table services add column parent_id uuid references services(id);

-- ============ Fold Logistics under Administration ============
-- requests_guard forces dept immutable; disable it for the data fold only
alter table requests disable trigger requests_guard;
update requests set dept = 'ADMIN' where dept = 'LOG';
alter table requests enable trigger requests_guard;
update services set dept = 'ADMIN' where dept = 'LOG';
update inbound_routes set dept = 'ADMIN' where dept = 'LOG';
update role_assignments set dept = 'ADMIN' where dept = 'LOG';

-- ============ Workflow inheritance: child falls back to parent ============
create or replace function requests_guard_update() returns trigger
language plpgsql security definer as $$
declare
  needs_approval boolean;
  wf jsonb;
begin
  new.requester_id = old.requester_id;
  new.ref = old.ref;
  new.service_id = old.service_id;
  new.dept = old.dept;
  new.created_at = old.created_at;

  if new.status is distinct from old.status then
    select w.graph into wf from workflow_definitions w
    where w.service_id = new.service_id and w.status = 'published'
    order by w.version desc limit 1;
    if wf is null then
      select w.graph into wf from workflow_definitions w
      join services s on s.id = new.service_id
      where w.service_id = s.parent_id and w.status = 'published'
      order by w.version desc limit 1;
    end if;

    if wf is not null then
      if not exists (
        select 1 from jsonb_array_elements(wf->'transitions') t
        where t->>'from' = old.status::text and t->>'to' = new.status::text
      ) then
        raise exception 'transition % -> % is not in this service''s published workflow',
          old.status, new.status;
      end if;
    elsif (old.status::text, new.status::text) not in (
      ('new', 'triaged'), ('new', 'cancelled'),
      ('triaged', 'in_progress'),
      ('in_progress', 'pending_approval'), ('in_progress', 'pending_requester'),
      ('in_progress', 'resolved'), ('in_progress', 'escalated'),
      ('pending_requester', 'in_progress'),
      ('pending_approval', 'in_progress'),
      ('escalated', 'in_progress'),
      ('resolved', 'closed'), ('resolved', 'in_progress')
    ) then
      raise exception 'transition % -> % is not allowed', old.status, new.status;
    end if;
  end if;

  if old.status = 'in_progress' and new.status = 'resolved' then
    select s.requires_approval into needs_approval from services s where s.id = new.service_id;
    if needs_approval and (
      not exists (select 1 from approvals where request_id = new.id)
      or exists (select 1 from approvals where request_id = new.id and decision <> 'approved')
    ) then
      raise exception 'this request requires an approved DoA chain before it can be resolved';
    end if;
  end if;
  return new;
end $$;

-- ============ Asset management ============
create type asset_status as enum ('in_stock', 'assigned', 'repair', 'retired');

create table assets (
  id uuid primary key default gen_random_uuid(),
  tag text unique not null,                  -- ABC-LT-0001
  category text not null default 'laptop',   -- laptop, monitor, phone, printer, accessory
  model text,
  serial text,
  status asset_status not null default 'in_stock',
  assigned_to uuid references profiles(id),
  request_id uuid references requests(id),   -- procuring request, if any
  purchased_on date,
  notes text,
  created_at timestamptz not null default now()
);

create table licenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vendor text,
  seats int not null default 1 check (seats > 0),
  expires_on date,
  notes text,
  created_at timestamptz not null default now()
);

create table license_assignments (
  license_id uuid references licenses(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references profiles(id),
  primary key (license_id, profile_id)
);

create table asset_events (
  id bigint generated always as identity primary key,
  asset_id uuid references assets(id) on delete cascade,
  license_id uuid references licenses(id) on delete cascade,
  actor_id uuid references profiles(id),
  event_type text not null,                  -- created, assigned, returned, status_changed, seat_assigned, seat_revoked
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (asset_id is not null or license_id is not null)
);

create or replace function is_it_staff() returns boolean
language sql stable security definer as $$
  select has_role('agent', 'IT') or has_role('team_lead', 'IT')
      or has_role('dept_admin', 'IT') or has_role('system_admin')
$$;

alter table assets enable row level security;
alter table licenses enable row level security;
alter table license_assignments enable row level security;
alter table asset_events enable row level security;

create policy assets_read on assets for select to authenticated
  using (assigned_to = auth.uid() or is_it_staff() or has_role('executive'));
create policy assets_write on assets for all to authenticated
  using (is_it_staff()) with check (is_it_staff());
create policy lic_read on licenses for select to authenticated
  using (is_it_staff() or has_role('executive') or exists (
    select 1 from license_assignments la
    where la.license_id = id and la.profile_id = auth.uid()
  ));
create policy lic_write on licenses for all to authenticated
  using (is_it_staff()) with check (is_it_staff());
create policy la_read on license_assignments for select to authenticated
  using (profile_id = auth.uid() or is_it_staff() or has_role('executive'));
create policy ae_read2 on asset_events for select to authenticated
  using (is_it_staff() or has_role('executive'));
-- assignment writes go through the RPCs below

create or replace function assign_asset(p_asset uuid, p_profile uuid)
returns void language plpgsql security definer as $$
begin
  if not is_it_staff() then raise exception 'only IT staff can assign assets'; end if;
  update assets set assigned_to = p_profile, status = 'assigned'
  where id = p_asset and status in ('in_stock', 'assigned');
  if not found then raise exception 'asset is not available for assignment'; end if;
  insert into asset_events (asset_id, actor_id, event_type, detail)
  values (p_asset, auth.uid(), 'assigned', jsonb_build_object('profile_id', p_profile));
end $$;

create or replace function return_asset(p_asset uuid)
returns void language plpgsql security definer as $$
begin
  if not is_it_staff() then raise exception 'only IT staff can return assets'; end if;
  update assets set assigned_to = null, status = 'in_stock' where id = p_asset;
  insert into asset_events (asset_id, actor_id, event_type, detail)
  values (p_asset, auth.uid(), 'returned', '{}');
end $$;

create or replace function assign_license(p_license uuid, p_profile uuid)
returns void language plpgsql security definer as $$
declare
  cap int;
  used int;
begin
  if not is_it_staff() then raise exception 'only IT staff can assign licenses'; end if;
  select seats into cap from licenses where id = p_license;
  if not found then raise exception 'unknown license'; end if;
  select count(*) into used from license_assignments where license_id = p_license;
  if used >= cap then raise exception 'no seats left on this license (% of %)', used, cap; end if;
  insert into license_assignments (license_id, profile_id, assigned_by)
  values (p_license, p_profile, auth.uid());
  insert into asset_events (license_id, actor_id, event_type, detail)
  values (p_license, auth.uid(), 'seat_assigned', jsonb_build_object('profile_id', p_profile));
exception when unique_violation then
  raise exception 'this user already has a seat on this license';
end $$;

create or replace function revoke_license(p_license uuid, p_profile uuid)
returns void language plpgsql security definer as $$
begin
  if not is_it_staff() then raise exception 'only IT staff can revoke licenses'; end if;
  delete from license_assignments where license_id = p_license and profile_id = p_profile;
  insert into asset_events (license_id, actor_id, event_type, detail)
  values (p_license, auth.uid(), 'seat_revoked', jsonb_build_object('profile_id', p_profile));
end $$;

-- ============ Dev dummy data (visualization) ============
insert into assets (tag, category, model, serial, status, assigned_to, request_id, purchased_on) values
  ('ABC-LT-0001', 'laptop',  'Dell Latitude 7440',   'DL7440-8842', 'assigned', '11111111-1111-4111-8111-111111111101', (select id from requests where ref = 'REQ-2500'), '2026-07-01'),
  ('ABC-LT-0002', 'laptop',  'ThinkPad X1 Carbon',   'TP-X1-2231',  'assigned', '11111111-1111-4111-8111-111111111102', null, '2025-03-14'),
  ('ABC-LT-0003', 'laptop',  'Dell Latitude 5540',   'DL5540-1190', 'assigned', '11111111-1111-4111-8111-111111111103', null, '2025-01-20'),
  ('ABC-LT-0004', 'laptop',  'ThinkPad T14',         'TP-T14-7765', 'repair',   '11111111-1111-4111-8111-111111111104', null, '2024-09-02'),
  ('ABC-LT-0005', 'laptop',  'Dell Latitude 5540',   'DL5540-1191', 'in_stock', null, null, '2025-01-20'),
  ('ABC-MN-0001', 'monitor', 'Dell U2723QE 27"',     'U27-55821',   'assigned', '11111111-1111-4111-8111-111111111101', null, '2025-05-05'),
  ('ABC-MN-0002', 'monitor', 'Dell U2723QE 27"',     'U27-55822',   'assigned', '11111111-1111-4111-8111-111111111107', null, '2025-05-05'),
  ('ABC-MN-0003', 'monitor', 'LG 34WN80C 34"',       'LG34-00318',  'in_stock', null, null, '2025-08-11'),
  ('ABC-PH-0001', 'phone',   'iPhone 15',            'IP15-90332',  'assigned', '11111111-1111-4111-8111-111111111102', null, '2025-11-30'),
  ('ABC-PH-0002', 'phone',   'Samsung Galaxy S24',   'SG24-11208',  'in_stock', null, null, '2025-11-30'),
  ('ABC-PR-0001', 'printer', 'HP LaserJet Pro M479', 'HPM479-2210', 'retired',  null, null, '2021-02-15')
on conflict do nothing;

insert into licenses (name, vendor, seats, expires_on) values
  ('Microsoft 365 E3',     'Microsoft', 50, '2027-06-30'),
  ('Adobe Creative Cloud', 'Adobe',      5, '2027-01-31'),
  ('AutoCAD',              'Autodesk',   3, '2026-09-30'),
  ('Zoom Pro',             'Zoom',      10, '2026-12-31')
on conflict do nothing;

insert into license_assignments (license_id, profile_id)
select l.id, p.id from licenses l, profiles p where l.name = 'Microsoft 365 E3'
on conflict do nothing;
insert into license_assignments (license_id, profile_id)
select l.id, p.id from licenses l
join profiles p on p.upn in ('requester@dev.abccorp.com', 'deptadmin.it@dev.abccorp.com')
where l.name = 'Adobe Creative Cloud'
on conflict do nothing;
insert into license_assignments (license_id, profile_id)
select l.id, p.id from licenses l
join profiles p on p.upn = 'lead.it@dev.abccorp.com'
where l.name = 'AutoCAD'
on conflict do nothing;
insert into license_assignments (license_id, profile_id)
select l.id, p.id from licenses l
join profiles p on p.upn in ('agent.it@dev.abccorp.com', 'sysadmin@dev.abccorp.com')
where l.name = 'Zoom Pro'
on conflict do nothing;
