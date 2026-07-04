-- Step 2 of the role-group model. Canonical roles:
-- requester, agent, team_lead, dept_head, user_admin, system_admin.
-- dept_head inherits the legacy approver + dept_admin powers everywhere,
-- because every policy resolves through has_role().

create or replace function has_role(r platform_role, d dept_code default null)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from role_assignments
    where profile_id = auth.uid()
      and (role = r or (role = 'dept_head' and r in ('approver', 'dept_admin')))
      and (dept is null or d is null or dept = d)
  )
$$;

-- Migrate existing assignments onto the new role
update role_assignments set role = 'dept_head'
where role in ('approver', 'dept_admin')
  and not exists (
    select 1 from role_assignments r2
    where r2.profile_id = role_assignments.profile_id
      and r2.role = 'dept_head'
      and r2.dept is not distinct from role_assignments.dept
  );

-- Page access: dept_head joins every page the legacy roles had
update page_access set allowed = array_append(allowed, 'dept_head')
where page in ('mywork', 'queue', 'approvals', 'insights', 'assets', 'admin')
  and not ('dept_head' = any(allowed));

-- License approval: the IT department head decides
create or replace function decide_license(p_license uuid, p_approve boolean)
returns void language plpgsql security definer as $$
declare
  lname text;
begin
  if not (has_role('team_lead', 'IT') or has_role('dept_head', 'IT') or has_role('system_admin')) then
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

-- Governance/audit visibility includes dept heads
drop policy if exists ae_read on admin_events;
create policy ae_read on admin_events for select to authenticated
  using (has_role('system_admin') or has_role('executive')
         or has_role('team_lead', 'IT') or has_role('dept_head'));

select role, count(*) from role_assignments group by role order by role;
