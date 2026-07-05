-- User containers: department membership as a first-class unit, plus the
-- Procurement container linked into the catalog.

insert into departments (code, name, color_hex)
values ('PROC', 'Procurement', '#2E9E6B')
on conflict do nothing;

create table container_members (
  profile_id uuid references profiles(id) on delete cascade,
  dept dept_code not null,
  added_by uuid references profiles(id),
  added_at timestamptz not null default now(),
  primary key (profile_id, dept)
);
alter table container_members enable row level security;
create policy cm_read on container_members for select to authenticated
  using (profile_id = auth.uid() or has_role('user_admin')
         or has_role('system_admin') or has_role('dept_head'));
create policy cm_write on container_members for all to authenticated
  using (has_role('user_admin')) with check (has_role('user_admin'));

create or replace function log_membership() returns trigger
language plpgsql security definer as $$
begin
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'containers',
          case when tg_op = 'INSERT' then 'member_added' else 'member_removed' end,
          jsonb_build_object('profile_id', coalesce(new.profile_id, old.profile_id),
                             'dept', coalesce(new.dept, old.dept)));
  return coalesce(new, old);
end $$;
create trigger container_members_audit after insert or delete on container_members
  for each row execute function log_membership();

-- Seed memberships from existing department-scoped roles
insert into container_members (profile_id, dept)
select distinct profile_id, dept from role_assignments where dept is not null
on conflict do nothing;

-- Starter Procurement service (code auto-generated)
insert into services (dept, name, description, requires_approval,
                      sla_response_minutes, sla_resolution_minutes, form_schema)
values ('PROC', 'Purchase order request', 'Procure goods and services', true, 480, 4320,
  '[{"key":"item","label":"Item or service","type":"text","visible":true,"required":true},
    {"key":"justification","label":"Business justification","type":"longtext","visible":true,"required":true},
    {"key":"amount","label":"Estimated amount","type":"amount","visible":true,"required":true,"width":"half"},
    {"key":"needed_by","label":"Needed by","type":"date","visible":true,"required":false,"width":"half"}]')
on conflict do nothing;
