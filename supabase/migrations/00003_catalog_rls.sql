-- Catalog RLS: services, departments, and the DoA matrix previously had RLS
-- disabled (rows public) or enabled without policies (rows invisible).
-- Explicit policies: everyone signed in can read the catalog; only
-- system_admin (or the dept's admin, for services) can change it.

alter table services enable row level security;
alter table departments enable row level security;
alter table doa_matrix enable row level security;

create policy svc_read on services for select to authenticated using (true);
create policy svc_write on services for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin', dept))
  with check (has_role('system_admin') or has_role('dept_admin', dept));
create policy dept_read on departments for select to authenticated using (true);
create policy doa_read on doa_matrix for select to authenticated using (true);
create policy doa_write on doa_matrix for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
