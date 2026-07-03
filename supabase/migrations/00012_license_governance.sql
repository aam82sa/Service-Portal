-- License approval flow (IT department head), system-admin status override
-- with audit, and closed-request change governance.

-- ============ Licenses need IT head approval ============
alter table licenses add column status text not null default 'active'
  check (status in ('pending', 'active', 'rejected'));
alter table licenses add column requested_by uuid references profiles(id);

-- direct writes restricted to IT head / system admin; agents use the RPC
drop policy if exists lic_write on licenses;
create policy lic_manage on licenses for all to authenticated
  using (has_role('team_lead', 'IT') or has_role('system_admin'))
  with check (has_role('team_lead', 'IT') or has_role('system_admin'));

create or replace function request_license(
  p_name text, p_vendor text, p_seats int, p_expires date default null
) returns uuid language plpgsql security definer as $$
declare
  lid uuid;
begin
  if not is_it_staff() then raise exception 'only IT staff can request licenses'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(p_seats, 0) < 1 then
    raise exception 'license needs a name and at least one seat';
  end if;
  insert into licenses (name, vendor, seats, expires_on, status, requested_by)
  values (trim(p_name), nullif(trim(p_vendor), ''), p_seats, p_expires, 'pending', auth.uid())
  returning id into lid;
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'licenses', 'requested', jsonb_build_object('name', p_name, 'seats', p_seats));
  return lid;
end $$;

create or replace function decide_license(p_license uuid, p_approve boolean)
returns void language plpgsql security definer as $$
declare
  lname text;
begin
  if not (has_role('team_lead', 'IT') or has_role('system_admin')) then
    raise exception 'only the IT department head can approve new licenses';
  end if;
  update licenses set status = case when p_approve then 'active' else 'rejected' end
  where id = p_license and status = 'pending'
  returning name into lname;
  if not found then raise exception 'license is not awaiting approval'; end if;
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'licenses', case when p_approve then 'approved' else 'rejected' end,
          jsonb_build_object('license_id', p_license, 'name', lname));
end $$;

-- seats only on active licenses
create or replace function assign_license(p_license uuid, p_profile uuid)
returns void language plpgsql security definer as $$
declare
  cap int;
  used int;
begin
  if not is_it_staff() then raise exception 'only IT staff can assign licenses'; end if;
  select seats into cap from licenses where id = p_license and status = 'active';
  if not found then raise exception 'license is not active (pending approval or rejected)'; end if;
  select count(*) into used from license_assignments where license_id = p_license;
  if used >= cap then raise exception 'no seats left on this license (% of %)', used, cap; end if;
  insert into license_assignments (license_id, profile_id, assigned_by)
  values (p_license, p_profile, auth.uid());
  insert into asset_events (license_id, actor_id, event_type, detail)
  values (p_license, auth.uid(), 'seat_assigned', jsonb_build_object('profile_id', p_profile));
exception when unique_violation then
  raise exception 'this user already has a seat on this license';
end $$;

-- ============ System admin request override + closed-change governance ============
create policy req_sysadmin_update on requests for update to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));

create or replace function requests_guard_update() returns trigger
language plpgsql security definer as $$
declare
  needs_approval boolean;
  wf jsonb;
  is_override boolean := false;
begin
  new.requester_id = old.requester_id;
  new.ref = old.ref;
  new.service_id = old.service_id;
  new.dept = old.dept;
  new.created_at = old.created_at;

  if new.status is distinct from old.status then
    if has_role('system_admin') then
      is_override := true;
      insert into admin_events (actor_id, area, action, detail)
      values (auth.uid(), 'governance', 'status_override',
              jsonb_build_object('ref', new.ref, 'from', old.status, 'to', new.status));
    else
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

    -- governance: any change to a closed request alerts the IT head
    if old.status = 'closed' then
      insert into admin_events (actor_id, area, action, detail)
      values (auth.uid(), 'governance', 'closed_request_changed',
              jsonb_build_object('ref', new.ref, 'to', new.status));
    end if;
  end if;

  if not is_override and old.status = 'in_progress' and new.status = 'resolved' then
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

-- IT head reads governance alerts (admin_events was system_admin/executive only)
drop policy if exists ae_read on admin_events;
create policy ae_read on admin_events for select to authenticated
  using (has_role('system_admin') or has_role('executive') or has_role('team_lead', 'IT'));
