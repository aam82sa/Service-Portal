-- 00049 — form field types (SPRINT2 branch 2): cost centers, staged
-- attachment uploads, and the server-side submission validator the form
-- builder has always promised ("validation is enforced server-side").
--
-- New field types: yesno (boolean), costcenter (admin-maintained list),
-- attachment (paths in the attachments bucket), asset_picker (requester's
-- own assets), employee_picker (profiles).

-- ============ cost centers ============
create table if not exists cost_centers (
  code text primary key,
  name text not null,
  dept dept_code,                       -- null = shared / cross-department
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table cost_centers enable row level security;
drop policy if exists cc_read on cost_centers;
create policy cc_read on cost_centers for select to authenticated using (true);
drop policy if exists cc_admin_write on cost_centers;
create policy cc_admin_write on cost_centers for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin'))
  with check (has_role('system_admin') or has_role('dept_admin'));

insert into cost_centers (code, name, dept) values
  ('CC-IT-01',   'IT operations',            'IT'),
  ('CC-IT-02',   'IT projects',              'IT'),
  ('CC-ADM-01',  'Facilities & workplace',   'ADMIN'),
  ('CC-ADM-02',  'Travel & events',          'ADMIN'),
  ('CC-PROC-01', 'Procurement operations',   'PROC'),
  ('CC-GEN-01',  'General & administrative', null)
on conflict (code) do nothing;

-- ============ staged uploads (attachment fields) ============
-- The request form uploads files BEFORE the request row exists (the client
-- pre-generates the request UUID). A definer helper — deliberately bypassing
-- requests RLS — confirms no request claims the folder yet, so files can
-- only be staged into genuinely unused folders, never into some other
-- user's existing (merely invisible) request.
create or replace function can_stage_attachment(p_folder uuid) returns boolean
language sql stable security definer as $$
  select not exists (select 1 from requests r where r.id = p_folder)
$$;

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (
    owner = auth.uid()
    or exists (select 1 from requests r where r.id = ((storage.foldername(name))[1])::uuid)
  ));

drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (
    (owner = auth.uid() and can_stage_attachment(((storage.foldername(name))[1])::uuid))
    or exists (
      select 1 from requests r
      where r.id = ((storage.foldername(name))[1])::uuid
        and (r.requester_id = auth.uid()
             or has_role('agent', r.dept) or has_role('team_lead', r.dept)
             or has_role('dept_head', r.dept) or has_role('system_admin'))
    )
  ));

drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (
    owner = auth.uid()
    or exists (
      select 1 from requests r
      where r.id = ((storage.foldername(name))[1])::uuid
        and (has_role('agent', r.dept) or has_role('team_lead', r.dept) or has_role('system_admin'))
    )
  ));

-- ============ server-side submission validation ============
-- Runs BEFORE INSERT (after the service-defaults and stamp triggers, which
-- sort earlier alphabetically). Child requests spawned by orchestration
-- (parent_request_id set) are system work orders, not user submissions —
-- they are exempt.
create or replace function validate_request_payload() returns trigger
language plpgsql security definer as $$
declare
  schema jsonb;
  f jsonb;
  v jsonb;
  k text;
  t text;
  lbl text;
  vis boolean;
  req boolean;
begin
  if new.parent_request_id is not null then
    return new;
  end if;
  select coalesce(s.form_schema, '[]'::jsonb) into schema
  from services s where s.id = new.service_id;
  if schema is null or jsonb_typeof(schema) <> 'array' then
    return new;
  end if;

  for f in select * from jsonb_array_elements(schema) loop
    k := f ->> 'key';
    t := coalesce(f ->> 'type', 'text');
    lbl := coalesce(f ->> 'label', k);
    vis := coalesce((f ->> 'visible')::boolean, true);
    req := coalesce((f ->> 'required')::boolean, false);
    if k is null or not vis then continue; end if;

    v := new.payload -> k;

    if req and (
      v is null or v = 'null'::jsonb
      or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
      or (t = 'attachment' and (jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0))
    ) then
      raise exception 'field "%" is required', lbl;
    end if;

    if v is null or v = 'null'::jsonb then continue; end if;

    if t = 'yesno' then
      if jsonb_typeof(v) <> 'boolean' then
        raise exception 'field "%" must be a yes/no value', lbl;
      end if;
    elsif t = 'costcenter' then
      if not exists (select 1 from cost_centers c where c.code = v #>> '{}' and c.is_active) then
        raise exception 'field "%": unknown or inactive cost center %', lbl, v #>> '{}';
      end if;
    elsif t = 'attachment' then
      if jsonb_typeof(v) <> 'array' then
        raise exception 'field "%" must be a list of attachment paths', lbl;
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(v) p(path)
        where p.path not like new.id::text || '/%'
      ) then
        raise exception 'field "%": attachment paths must live under this request', lbl;
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(v) p(path)
        where not exists (
          select 1 from storage.objects o
          where o.bucket_id = 'attachments' and o.name = p.path and o.owner = new.requester_id
        )
      ) then
        raise exception 'field "%": attachment missing or not uploaded by the requester', lbl;
      end if;
    elsif t = 'asset_picker' then
      if not exists (
        select 1 from assets a
        where a.id = (v #>> '{}')::uuid and a.assigned_to = new.requester_id
      ) then
        raise exception 'field "%": asset is not assigned to the requester', lbl;
      end if;
    elsif t = 'employee_picker' then
      if not exists (select 1 from profiles p where p.id = (v #>> '{}')::uuid) then
        raise exception 'field "%": unknown employee', lbl;
      end if;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists requests_validate_payload on requests;
create trigger requests_validate_payload
  before insert on requests
  for each row execute function validate_request_payload();
