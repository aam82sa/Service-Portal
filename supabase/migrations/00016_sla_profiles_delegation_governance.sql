-- Batch: system-generated service codes, named SLA profiles, self-service
-- delegation with dept-head approval + notification queue, and system-admin
-- containment (manages the system, never participates in requests).

-- ============ A) System-generated service codes ============
create sequence if not exists service_code_seq start 100;
create or replace function services_autocode() returns trigger
language plpgsql as $$
begin
  if new.code is null or trim(new.code) = '' then
    new.code = 'S' || nextval('service_code_seq')::text;
  end if;
  return new;
end $$;
create trigger services_autocode before insert on services
  for each row execute function services_autocode();

-- ============ B) Named SLA profiles (multiple SLAs, linked to services) ============
create table sla_profiles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  response_minutes int not null check (response_minutes > 0),
  resolution_minutes int not null check (resolution_minutes > 0),
  created_at timestamptz not null default now()
);
insert into sla_profiles (name, description, response_minutes, resolution_minutes) values
  ('Standard', 'Default service level for routine requests', 480, 2880),
  ('Priority', 'Business-critical services', 120, 1440),
  ('VIP', 'Executive and time-critical processes', 60, 480);
alter table services add column sla_profile_id uuid references sla_profiles(id);

alter table sla_profiles enable row level security;
create policy slp_read on sla_profiles for select to authenticated using (true);
create policy slp_write on sla_profiles for all to authenticated
  using (has_role('system_admin') or has_role('dept_head'))
  with check (has_role('system_admin') or has_role('dept_head'));

-- SLA stamping: profile targets override per-service minutes
create or replace function requests_before_insert() returns trigger
language plpgsql security definer as $$
declare
  svc services%rowtype;
  resp int;
  reso int;
begin
  select * into svc from services where id = new.service_id and is_active;
  if not found then
    raise exception 'unknown or inactive service';
  end if;
  new.dept = svc.dept;
  resp = svc.sla_response_minutes;
  reso = svc.sla_resolution_minutes;
  if svc.sla_profile_id is not null then
    select response_minutes, resolution_minutes into resp, reso
    from sla_profiles where id = svc.sla_profile_id;
  end if;
  if resp is not null then
    new.sla_response_due = now() + make_interval(mins => resp);
  end if;
  if reso is not null then
    new.sla_resolution_due = now() + make_interval(mins => reso);
  end if;
  return new;
end $$;

-- ============ C) Self-service delegation + dept-head approval ============
alter table approval_delegations add column status text not null default 'approved'
  check (status in ('pending', 'approved', 'rejected'));

drop policy if exists del_write on approval_delegations;
drop policy if exists del_read on approval_delegations;
create policy del_read on approval_delegations for select to authenticated
  using (delegator_id = auth.uid() or delegate_id = auth.uid()
         or has_role('user_admin') or has_role('dept_head'));
create policy del_self_insert on approval_delegations for insert to authenticated
  with check (delegator_id = auth.uid() or has_role('user_admin'));
create policy del_admin_write on approval_delegations for update to authenticated
  using (has_role('user_admin')) with check (has_role('user_admin'));
create policy del_admin_del on approval_delegations for delete to authenticated
  using (has_role('user_admin') or delegator_id = auth.uid());

-- non-admin submissions always await dept-head approval
create or replace function delegations_before_insert() returns trigger
language plpgsql security definer as $$
begin
  if not has_role('user_admin') then
    new.status = 'pending';
  end if;
  return new;
end $$;
create trigger delegations_pending before insert on approval_delegations
  for each row execute function delegations_before_insert();

create or replace function decide_delegation(p_id uuid, p_approve boolean)
returns void language plpgsql security definer as $$
begin
  if not (has_role('dept_head') or has_role('user_admin') or has_role('system_admin')) then
    raise exception 'only a department head can approve delegations';
  end if;
  update approval_delegations
  set status = case when p_approve then 'approved' else 'rejected' end
  where id = p_id and status = 'pending';
  if not found then raise exception 'delegation is not awaiting approval'; end if;
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'delegation', case when p_approve then 'approved' else 'rejected' end,
          jsonb_build_object('delegation_id', p_id));
end $$;

-- ============ Notification queue (drained by the Graph mailer when connected) ============
create table notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references profiles(id) on delete cascade,
  subject text not null,
  body text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table notifications enable row level security;
create policy notif_own on notifications for select to authenticated
  using (recipient_id = auth.uid() or has_role('system_admin'));

-- both parties are notified whenever a delegation is created or its status changes
create or replace function delegations_notify() returns trigger
language plpgsql security definer as $$
declare
  d_name text;
  g_name text;
  what text;
begin
  select display_name into d_name from profiles where id = new.delegator_id;
  select display_name into g_name from profiles where id = new.delegate_id;
  what = case
    when tg_op = 'INSERT' then 'created (' || new.status || ')'
    else 'updated to ' || new.status
  end;
  insert into notifications (recipient_id, subject, body) values
    (new.delegator_id, 'Delegation ' || what,
     'Your delegation to ' || g_name || ' (' || new.starts_on || ' to ' || new.ends_on || ') was ' || what || '.'),
    (new.delegate_id, 'Delegation ' || what,
     d_name || ' delegated to you (' || new.starts_on || ' to ' || new.ends_on || ') — ' || what || '.');
  return new;
end $$;
create trigger delegations_notify_t after insert or update of status on approval_delegations
  for each row execute function delegations_notify();

-- ============ D) System admin containment ============
drop policy if exists req_insert on requests;
create policy req_insert on requests for insert to authenticated
  with check (requester_id = auth.uid() and not has_role('system_admin'));

create or replace function add_comment(p_request uuid, p_body text)
returns void language plpgsql security definer as $$
declare
  r requests%rowtype;
begin
  if has_role('system_admin') then
    raise exception 'system administrators manage the system and cannot participate in requests';
  end if;
  select * into r from requests where id = p_request;
  if not found then
    raise exception 'unknown request';
  end if;
  if not (r.requester_id = auth.uid()
          or has_role('agent', r.dept) or has_role('team_lead', r.dept)
          or has_role('dept_admin', r.dept)) then
    raise exception 'not allowed to comment on this request';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'comment is empty';
  end if;
  insert into request_events (request_id, actor_id, event_type, detail)
  values (p_request, auth.uid(), 'comment', jsonb_build_object('body', p_body));
end $$;
