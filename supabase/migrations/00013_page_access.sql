-- Page access control: which roles can open which pages, managed in the
-- admin console. Every signed-in user implicitly holds the requester role.
-- Also: role grant/revoke auditing (Users & roles becomes editable).

create table page_access (
  page text primary key,
  name text not null,
  allowed platform_role[] not null default '{}'
);

insert into page_access (page, name, allowed) values
  ('home',      'Home',             '{requester}'),
  ('portal',    'Service portal',   '{requester}'),
  ('requests',  'My requests',      '{requester}'),
  ('mywork',    'My work',          '{agent,team_lead,dept_admin,approver}'),
  ('queue',     'Department queue', '{agent,team_lead,dept_admin}'),
  ('approvals', 'Approvals',        '{approver}'),
  ('insights',  'Insights',         '{team_lead,dept_admin,executive,system_admin}'),
  ('assets',    'IT assets',        '{agent,team_lead,dept_admin,system_admin}'),
  ('admin',     'Admin console',    '{dept_admin,user_admin,system_admin}');

alter table page_access enable row level security;
create policy pa_read on page_access for select to authenticated using (true);
create policy pa_write on page_access for update to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));

create or replace function log_page_access() returns trigger
language plpgsql security definer as $$
begin
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'access', 'page_access_updated',
          jsonb_build_object('page', new.page, 'allowed', to_jsonb(new.allowed)));
  return new;
end $$;
create trigger page_access_audit after update on page_access
  for each row execute function log_page_access();

-- Audit role grants and revocations (user_admin edits via Users & roles)
create or replace function log_role_change() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    insert into admin_events (actor_id, area, action, detail)
    values (auth.uid(), 'roles', 'granted',
            jsonb_build_object('profile_id', new.profile_id, 'role', new.role, 'dept', new.dept));
    return new;
  else
    insert into admin_events (actor_id, area, action, detail)
    values (auth.uid(), 'roles', 'revoked',
            jsonb_build_object('profile_id', old.profile_id, 'role', old.role, 'dept', old.dept));
    return old;
  end if;
end $$;
create trigger role_assignments_audit after insert or delete on role_assignments
  for each row execute function log_role_change();
