-- Request submission: insert policy, dept/SLA stamping, created audit event,
-- and read access to request_events for involved parties.

-- Requesters create their own requests
create policy req_insert on requests for insert to authenticated
  with check (requester_id = auth.uid());

-- Stamp dept + SLA due dates from the service before insert
create or replace function requests_before_insert() returns trigger
language plpgsql security definer as $$
declare
  svc services%rowtype;
begin
  select * into svc from services where id = new.service_id and is_active;
  if not found then
    raise exception 'unknown or inactive service';
  end if;
  new.dept = svc.dept;
  if svc.sla_response_minutes is not null then
    new.sla_response_due = now() + make_interval(mins => svc.sla_response_minutes);
  end if;
  if svc.sla_resolution_minutes is not null then
    new.sla_resolution_due = now() + make_interval(mins => svc.sla_resolution_minutes);
  end if;
  return new;
end $$;
create trigger requests_stamp before insert on requests
  for each row execute function requests_before_insert();

-- Immutable audit event on creation
create or replace function requests_after_insert() returns trigger
language plpgsql security definer as $$
begin
  insert into request_events (request_id, actor_id, event_type, detail)
  values (new.id, auth.uid(), 'created',
          jsonb_build_object('ref', new.ref, 'service_id', new.service_id));
  return new;
end $$;
create trigger requests_created after insert on requests
  for each row execute function requests_after_insert();

-- Events readable by the requester, their department's staff, and oversight roles
create policy ev_read on request_events for select to authenticated
  using (exists (
    select 1 from requests r
    where r.id = request_id
      and (r.requester_id = auth.uid()
           or has_role('agent', r.dept) or has_role('team_lead', r.dept)
           or has_role('dept_admin', r.dept)
           or has_role('executive') or has_role('system_admin'))
  ));
