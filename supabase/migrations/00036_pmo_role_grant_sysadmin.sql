-- The PMO Admin console is open to pmo_admin and system_admin, and every
-- module-admin write policy (role groups, group members, committee) covers
-- both — except the module-role grants on role_assignments, which covered
-- pmo_admin only. A system admin granting Project Manager therefore hit
-- "new row violates row-level security policy for table role_assignments".
drop policy if exists ra_pmo_admin on role_assignments;
create policy ra_pmo_admin on role_assignments for all to authenticated
  using ((has_role('pmo_admin') or has_role('system_admin'))
         and role in ('project_manager', 'pmo_admin'))
  with check ((has_role('pmo_admin') or has_role('system_admin'))
              and role in ('project_manager', 'pmo_admin'));
