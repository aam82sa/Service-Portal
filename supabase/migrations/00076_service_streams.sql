-- 00076 — Phase 1 PR-C: dynamic "service streams" (departments) from the console.
--
-- 00074/00075 made departments uuid-addressable and moved RLS/routing onto
-- dept_id. This migration exposes department lifecycle to the System-admin
-- console: create a stream (auto-generated code), rename it (code immutable
-- once it has services/requests), and activate/deactivate it. Writes go
-- through SECURITY DEFINER RPCs (system_admin only); everyone authenticated
-- may read the department list so nav/queues/reports/colours are driven from
-- the table instead of a hardcoded map.

-- Departments are readable by any signed-in user (tenant_isolation still
-- scopes to the caller's tenant). Writes are RPC-only.
drop policy if exists dept_read on departments;
create policy dept_read on departments for select to authenticated using (true);

-- Auto-generate a stream code from its name: uppercase alphanumerics, first 3
-- chars (padded to 3), with a numeric suffix on collision within the tenant.
-- "Facilities Management" → FAC, then FAC2, FAC3, …
create or replace function generate_dept_code(p_name text, p_tenant uuid)
returns text language plpgsql stable as $$
declare
  base text;
  candidate text;
  n int := 1;
begin
  base := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(base) = 0 then base := 'DEP'; end if;
  base := substr(base, 1, 3);
  if length(base) < 3 then base := rpad(base, 3, 'X'); end if;
  candidate := base;
  while exists (select 1 from departments where code = candidate and tenant_id = p_tenant) loop
    n := n + 1;
    candidate := base || n::text;
  end loop;
  return candidate;
end $$;

create or replace function create_department(p_name text, p_name_ar text, p_color text, p_icon text)
returns departments language plpgsql security definer set search_path = public as $$
declare
  d departments;
  t uuid := current_tenant();
  c text;
  clr text := coalesce(nullif(btrim(p_color), ''), '#64748B');
begin
  if not has_role('system_admin') then
    raise exception 'only system_admin may create a service stream';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a stream name is required';
  end if;
  c := generate_dept_code(p_name, t);
  insert into departments (code, name, name_ar, color, rail_color, color_hex, icon, is_active,
                           position, created_by, tenant_id)
  values (c, btrim(p_name), nullif(btrim(p_name_ar), ''), clr, clr, clr, nullif(btrim(p_icon), ''), true,
          coalesce((select max(position) + 1 from departments where tenant_id = t), 1),
          auth.uid(), t)
  returning * into d;
  return d;
end $$;

create or replace function rename_department(p_id uuid, p_name text, p_code text)
returns departments language plpgsql security definer set search_path = public as $$
declare
  d departments;
  t uuid := current_tenant();
  in_use boolean;
begin
  if not has_role('system_admin') then
    raise exception 'only system_admin may edit a service stream';
  end if;
  select * into d from departments where id = p_id and tenant_id = t;
  if not found then raise exception 'stream not found'; end if;

  if p_code is not null and upper(btrim(p_code)) <> d.code then
    select exists (select 1 from services where dept_id = p_id)
        or exists (select 1 from requests where dept_id = p_id) into in_use;
    if in_use then
      raise exception 'the code is immutable once the stream has services or requests';
    end if;
    if exists (select 1 from departments where code = upper(btrim(p_code)) and tenant_id = t and id <> p_id) then
      raise exception 'that code is already in use';
    end if;
    update departments set code = upper(btrim(p_code)) where id = p_id;
  end if;

  update departments set name = coalesce(nullif(btrim(p_name), ''), name)
   where id = p_id returning * into d;
  return d;
end $$;

create or replace function set_department_meta(p_id uuid, p_name_ar text, p_color text, p_icon text, p_active boolean)
returns departments language plpgsql security definer set search_path = public as $$
declare d departments; t uuid := current_tenant();
begin
  if not has_role('system_admin') then
    raise exception 'only system_admin may edit a service stream';
  end if;
  update departments
     set name_ar = coalesce(p_name_ar, name_ar),
         color = coalesce(nullif(btrim(p_color), ''), color),
         rail_color = coalesce(nullif(btrim(p_color), ''), rail_color),
         color_hex = coalesce(nullif(btrim(p_color), ''), color_hex),
         icon = coalesce(p_icon, icon),
         is_active = coalesce(p_active, is_active)
   where id = p_id and tenant_id = t
   returning * into d;
  if not found then raise exception 'stream not found'; end if;
  return d;
end $$;

revoke all on function create_department(text, text, text, text) from public, anon;
revoke all on function rename_department(uuid, text, text) from public, anon;
revoke all on function set_department_meta(uuid, text, text, text, boolean) from public, anon;
grant execute on function create_department(text, text, text, text) to authenticated, service_role;
grant execute on function rename_department(uuid, text, text) to authenticated, service_role;
grant execute on function set_department_meta(uuid, text, text, text, boolean) to authenticated, service_role;
