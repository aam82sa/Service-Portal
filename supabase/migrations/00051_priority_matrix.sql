-- 00051 — priority matrix (SPRINT2 branch 4): impact × urgency → P1–P4,
-- applied server-side on incident submission so the UI can't spoof priority.
-- First consumer: IT incident IN-01 (its impact/urgency dropdowns already
-- capture the two axes as human labels).

-- ============ the matrix ============
-- 00002 scaffolded a priority_matrix with the INVERTED convention
-- (1 = high, 3 = low) and no consumers anywhere in the app. The spec and
-- the incident forms use 1 = low … 3 = high, so — like escalation_rules
-- in 00043 — the unused scaffold is dropped and rebuilt.
drop table if exists priority_matrix cascade;
create table priority_matrix (
  impact smallint not null check (impact between 1 and 3),
  urgency smallint not null check (urgency between 1 and 3),
  priority priority not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  primary key (impact, urgency)
);

alter table priority_matrix enable row level security;
drop policy if exists pm_read on priority_matrix;
create policy pm_read on priority_matrix for select to authenticated using (true);
drop policy if exists pm_admin_write on priority_matrix;
create policy pm_admin_write on priority_matrix for all to authenticated
  using (has_role('system_admin'))
  with check (has_role('system_admin'));

-- standard ITIL-style mapping (1 = low, 3 = high)
insert into priority_matrix (impact, urgency, priority) values
  (3, 3, 'P1'),
  (3, 2, 'P2'), (2, 3, 'P2'),
  (3, 1, 'P3'), (2, 2, 'P3'), (1, 3, 'P3'),
  (2, 1, 'P4'), (1, 2, 'P4'), (1, 1, 'P4')
on conflict (impact, urgency) do nothing;

-- matrix edits are audited like every other admin change
create or replace function log_priority_matrix_change() returns trigger
language plpgsql security definer as $$
begin
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'priority_matrix', 'updated',
          jsonb_build_object('impact', new.impact, 'urgency', new.urgency,
                             'priority', new.priority, 'was', old.priority));
  new.updated_by = auth.uid();
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists priority_matrix_audit on priority_matrix;
create trigger priority_matrix_audit before update on priority_matrix
  for each row when (old.priority is distinct from new.priority)
  execute function log_priority_matrix_change();

-- ============ resolver ============
-- Strict: anything outside the 3×3 grid returns null (caller keeps the
-- service default).
create or replace function resolve_priority(p_impact int, p_urgency int) returns priority
language sql stable as $$
  select m.priority from priority_matrix m
  where m.impact = p_impact and m.urgency = p_urgency
$$;

-- Payload value → 1..3 level. Accepts numbers ("2", 2) and the standard
-- incident-form labels; anything unrecognized is null so the matrix simply
-- doesn't apply.
create or replace function priority_level(v jsonb) returns int
language plpgsql immutable as $$
declare
  t text;
  n numeric;
begin
  if v is null or v = 'null'::jsonb then return null; end if;
  t := lower(btrim(v #>> '{}'));
  if t in ('1', 'low', 'just me', 'i can work') then return 1; end if;
  if t in ('2', 'medium', 'my team', 'work degraded') then return 2; end if;
  if t in ('3', 'high', 'whole department', 'company-wide', 'i am blocked', 'blocked') then return 3; end if;
  begin
    n := t::numeric;
  exception when others then
    return null;
  end;
  if n = floor(n) and n between 1 and 3 then return n::int; end if;
  return null;
end $$;

-- ============ apply on incident submit ============
-- BEFORE INSERT triggers fire alphabetically; the name is chosen to land
-- between requests_service_defaults (sets the service default priority)
-- and requests_stamp (computes SLA due dates FROM new.priority):
--   requests_service_defaults < requests_set_priority_matrix < requests_stamp
create or replace function requests_apply_priority_matrix() returns trigger
language plpgsql security definer as $$
declare
  i int;
  u int;
  p priority;
begin
  if new.parent_request_id is not null then
    return new;                              -- orchestration work orders keep their priority
  end if;
  if not exists (
    select 1 from services s
    where s.id = new.service_id and s.request_type = 'incident'
  ) then
    return new;
  end if;
  i := priority_level(new.payload -> 'impact');
  u := priority_level(new.payload -> 'urgency');
  if i is null or u is null then return new; end if;
  p := resolve_priority(i, u);
  if p is not null then
    new.priority = p;
  end if;
  return new;
end $$;

drop trigger if exists requests_set_priority_matrix on requests;
create trigger requests_set_priority_matrix before insert on requests
  for each row execute function requests_apply_priority_matrix();

-- ============ standard impact/urgency on the other incident forms ============
-- IN-01 already captures both. Give IN-02 / IN-03 the same optional fields
-- so the matrix can apply there too; skipped if a form already has them.
update services
set form_schema = form_schema
  || '[{"key":"impact","label":"Who is affected","type":"dropdown","options":["Just me","My team","Whole department","Company-wide"],"visible":true,"required":false,"width":"half"},
       {"key":"urgency","label":"How badly","type":"dropdown","options":["I can work","Work degraded","I am blocked"],"visible":true,"required":false,"width":"half"}]'::jsonb
where request_type = 'incident'
  and jsonb_typeof(form_schema) = 'array'
  and not jsonb_path_exists(form_schema, '$[*] ? (@.key == "impact")')
  and not jsonb_path_exists(form_schema, '$[*] ? (@.key == "urgency")');
