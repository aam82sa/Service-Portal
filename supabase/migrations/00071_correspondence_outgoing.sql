-- 00071 — Correspondence Phase B: outgoing lifecycle.
--
-- Builds the outgoing pipeline on top of the Phase A registry (00039):
-- draft → initials chain → signature (number issued here) → dispatch. Reuses
-- the existing numbering engine (issue_letter_number) and immutable
-- letter_events audit. Adds Hijri year tokens to the numbering renderer.

-- ============ Hijri year token (Saudi requirement) ============
-- Arithmetic Gregorian->Hijri (Kuwaiti algorithm); accurate to the year, which
-- is all the {hyyyy}/{hyy} tokens need. Umm al-Qura precision is a Phase D swap.
create or replace function gregorian_to_hijri_year(p_date date)
returns int language plpgsql immutable as $$
declare
  gy int := extract(year from p_date)::int;
  gm int := extract(month from p_date)::int;
  gd int := extract(day from p_date)::int;
  a int; y int; m int; jd bigint; l bigint; n bigint; j bigint;
begin
  a := (14 - gm) / 12;
  y := gy + 4800 - a;
  m := gm + 12 * a - 3;
  jd := gd + (153 * m + 2) / 5 + 365::bigint * y + y / 4 - y / 100 + y / 400 - 32045;
  l := jd - 1948440 + 10632;
  n := (l - 1) / 10631;
  l := l - 10631 * n + 354;
  j := ((10985 - l) / 5316) * ((50 * l) / 17719) + (l / 5670) * ((43 * l) / 15238);
  l := l - ((30 - j) / 15) * ((17719 * j) / 50) - (j / 16) * ((15238 * j) / 43) + 29;
  return (30 * n + j - 30)::int;
end $$;
grant execute on function gregorian_to_hijri_year(date) to authenticated, service_role;

create or replace function render_letter_number(
  p_format text, p_seq int, p_dept text, p_doctype text, p_on date default current_date
) returns text language plpgsql immutable as $$
declare out text := p_format; pad text; hy int := gregorian_to_hijri_year(p_on);
begin
  pad := substring(out from '\{seq:(\d+)\}');
  if pad is not null then
    out := regexp_replace(out, '\{seq:\d+\}', lpad(p_seq::text, pad::int, '0'));
  end if;
  out := replace(out, '{seq}', p_seq::text);
  out := replace(out, '{yyyy}', to_char(p_on, 'YYYY'));
  out := replace(out, '{yy}', to_char(p_on, 'YY'));
  out := replace(out, '{mm}', to_char(p_on, 'MM'));
  out := replace(out, '{dd}', to_char(p_on, 'DD'));
  out := replace(out, '{dept}', coalesce(p_dept, ''));
  out := replace(out, '{doctype}', coalesce(p_doctype, ''));
  out := replace(out, '{hyyyy}', hy::text);
  out := replace(out, '{hyy}', right(hy::text, 2));
  return out;
end $$;

-- ============ outgoing status states ============
alter table letters drop constraint if exists letters_status_check;
alter table letters add constraint letters_status_check check (
  status = any (array[
    'registered', 'in_review', 'answered', 'closed',        -- incoming
    'draft', 'in_initials', 'signed', 'dispatched', 'voided' -- outgoing
  ]));

-- ============ admin config: templates, initials paths, signatories ============
create table letter_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dept dept_code,
  doctype text not null default 'LTR',
  body_html text not null default '',
  is_active boolean not null default true,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table initials_paths (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dept dept_code,
  steps jsonb not null default '[]',   -- [{order, role, dept, label}]
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table signatories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  dept dept_code,
  title text,
  level int not null default 1,
  signature_path text,                 -- image in the private originals space
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (profile_id, dept)
);

-- 1:1 companion holding the outgoing-specific fields
create table letter_outgoing (
  letter_id uuid primary key references letters(id) on delete cascade,
  template_id uuid references letter_templates(id),
  initials_path_id uuid references initials_paths(id),
  signatory_id uuid references signatories(id),
  body_html text not null default '',
  signed_by uuid references profiles(id),
  signed_at timestamptz,
  signed_sha256 text,                  -- tamper-evident hash of the signed PDF
  signed_path text,
  qr_path text,
  dispatched_at timestamptz,
  dispatch_channel text check (dispatch_channel in ('courier', 'email', 'hand')),
  dispatch_ref text,
  dispatch_note text,
  updated_at timestamptz not null default now()
);

-- the sequential initials chain (one row per step)
create table letter_initials (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references letters(id) on delete cascade,
  step_order int not null,
  approver_role platform_role,
  approver_dept dept_code,
  label text,
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'rejected')),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  unique (letter_id, step_order)
);
create index on letter_initials (letter_id, step_order);

create or replace function letter_outgoing_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger letter_outgoing_touch_t before update on letter_outgoing
  for each row execute function letter_outgoing_touch();

-- ============ RLS ============
alter table letter_templates enable row level security;
alter table initials_paths enable row level security;
alter table signatories enable row level security;
alter table letter_outgoing enable row level security;
alter table letter_initials enable row level security;

-- config is readable by any signed-in user, writable by admins
create policy lt_read on letter_templates for select to authenticated using (is_active or has_role('system_admin') or has_role('dept_admin'));
create policy lt_write on letter_templates for all to authenticated using (has_role('dept_admin') or has_role('system_admin')) with check (has_role('dept_admin') or has_role('system_admin'));
create policy ip_read on initials_paths for select to authenticated using (true);
create policy ip_write on initials_paths for all to authenticated using (has_role('dept_admin') or has_role('system_admin')) with check (has_role('dept_admin') or has_role('system_admin'));
create policy sg_read on signatories for select to authenticated using (true);
create policy sg_write on signatories for all to authenticated using (has_role('dept_admin') or has_role('system_admin')) with check (has_role('dept_admin') or has_role('system_admin'));

-- may this user edit the outgoing letter? (owner/creator/dept staff/admin)
create or replace function can_edit_letter(p_letter uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from letters l where l.id = p_letter and (
      l.owner_id = auth.uid() or l.created_by = auth.uid()
      or has_role('agent', l.dept) or has_role('team_lead', l.dept)
      or has_role('dept_head', l.dept) or has_role('system_admin')));
$$;
grant execute on function can_edit_letter(uuid) to authenticated, service_role;

-- outgoing body + initials visible to anyone who can access the letter;
-- outgoing row is editable by the letter's editors; initials move via functions
create policy lo_read on letter_outgoing for select to authenticated using (can_access_letter(letter_id));
create policy lo_write on letter_outgoing for all to authenticated using (can_edit_letter(letter_id)) with check (can_edit_letter(letter_id));
create policy li_read on letter_initials for select to authenticated using (can_access_letter(letter_id));

-- ============ lifecycle functions ============

-- populate the initials chain from a path and move to in_initials
create or replace function start_letter_initials(p_letter uuid, p_path uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l letters%rowtype; step jsonb;
begin
  select * into l from letters where id = p_letter;
  if not found then raise exception 'unknown letter'; end if;
  if not can_edit_letter(p_letter) then raise exception 'not allowed to route this letter'; end if;
  if l.direction <> 'outgoing' then raise exception 'not an outgoing letter'; end if;
  if l.status not in ('draft') then raise exception 'letter is not a draft'; end if;

  delete from letter_initials where letter_id = p_letter;
  for step in select * from jsonb_array_elements(coalesce((select steps from initials_paths where id = p_path), '[]'::jsonb)) loop
    insert into letter_initials (letter_id, step_order, approver_role, approver_dept, label)
    values (p_letter, (step->>'order')::int, (step->>'role')::platform_role,
            nullif(step->>'dept', '')::dept_code, step->>'label');
  end loop;

  update letter_outgoing set initials_path_id = p_path where letter_id = p_letter;
  update letters set status = 'in_initials' where id = p_letter;
  insert into letter_events (letter_id, actor_id, event_type, detail)
  values (p_letter, auth.uid(), 'initials_started', jsonb_build_object('path', p_path));
end $$;
revoke all on function start_letter_initials(uuid, uuid) from public, anon;
grant execute on function start_letter_initials(uuid, uuid) to authenticated;

-- decide the current pending initials step
create or replace function decide_letter_initial(p_letter uuid, p_decision text, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare step letter_initials%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'decision must be approved or rejected'; end if;
  select * into step from letter_initials
    where letter_id = p_letter and decision = 'pending' order by step_order limit 1;
  if not found then raise exception 'no pending initials step'; end if;
  if not (has_role(step.approver_role, step.approver_dept) or has_role('system_admin')) then
    raise exception 'you are not the approver for this step';
  end if;

  update letter_initials set decision = p_decision, decided_by = auth.uid(),
    decided_at = now(), comment = p_comment where id = step.id;

  if p_decision = 'rejected' then
    update letters set status = 'draft' where id = p_letter;
    insert into letter_events (letter_id, actor_id, event_type, detail)
    values (p_letter, auth.uid(), 'initial_rejected', jsonb_build_object('step', step.step_order, 'comment', p_comment));
  else
    insert into letter_events (letter_id, actor_id, event_type, detail)
    values (p_letter, auth.uid(), 'initial_approved', jsonb_build_object('step', step.step_order));
  end if;
end $$;
revoke all on function decide_letter_initial(uuid, text, text) from public, anon;
grant execute on function decide_letter_initial(uuid, text, text) to authenticated;

-- record a signature: verify the chain is clear + caller is the signatory,
-- issue the reference number, stamp the tamper hash, move to signed
create or replace function record_letter_signature(p_letter uuid, p_sha256 text, p_signed_path text, p_qr_path text default null)
returns text language plpgsql security definer set search_path = public as $$
declare o letter_outgoing%rowtype; is_sig boolean; v_ref text;
begin
  select * into o from letter_outgoing where letter_id = p_letter;
  if not found then raise exception 'no outgoing record for this letter'; end if;
  if exists (select 1 from letter_initials where letter_id = p_letter and decision <> 'approved') then
    raise exception 'initials are not complete';
  end if;
  select (s.profile_id = auth.uid()) into is_sig from signatories s where s.id = o.signatory_id;
  if not coalesce(is_sig, false) and not has_role('system_admin') then
    raise exception 'only the assigned signatory may sign';
  end if;

  v_ref := issue_letter_number(p_letter);   -- number is born at signature (00039)

  update letter_outgoing set signed_by = auth.uid(), signed_at = now(),
    signed_sha256 = p_sha256, signed_path = p_signed_path, qr_path = p_qr_path
    where letter_id = p_letter;
  update letters set status = 'signed' where id = p_letter;
  insert into letter_events (letter_id, actor_id, event_type, detail)
  values (p_letter, auth.uid(), 'signed', jsonb_build_object('ref', v_ref, 'sha256', p_sha256));
  return v_ref;
end $$;
revoke all on function record_letter_signature(uuid, text, text, text) from public, anon;
grant execute on function record_letter_signature(uuid, text, text, text) to authenticated, service_role;

-- dispatch a signed letter
create or replace function dispatch_letter(p_letter uuid, p_channel text, p_ref text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l letters%rowtype;
begin
  select * into l from letters where id = p_letter;
  if not found then raise exception 'unknown letter'; end if;
  if not can_edit_letter(p_letter) then raise exception 'not allowed to dispatch this letter'; end if;
  if l.status <> 'signed' then raise exception 'letter is not signed'; end if;
  if p_channel not in ('courier', 'email', 'hand') then raise exception 'invalid dispatch channel'; end if;

  update letter_outgoing set dispatched_at = now(), dispatch_channel = p_channel,
    dispatch_ref = p_ref, dispatch_note = p_note where letter_id = p_letter;
  update letters set status = 'dispatched' where id = p_letter;
  insert into letter_events (letter_id, actor_id, event_type, detail)
  values (p_letter, auth.uid(), 'dispatched', jsonb_build_object('channel', p_channel, 'ref', p_ref));
end $$;
revoke all on function dispatch_letter(uuid, text, text, text) from public, anon;
grant execute on function dispatch_letter(uuid, text, text, text) to authenticated;

-- ============ a default initials path + template (idempotent) ============
insert into initials_paths (name, steps)
select 'Department head sign-off',
  '[{"order":1,"role":"team_lead","label":"Team lead review"},{"order":2,"role":"dept_head","label":"Department head"}]'::jsonb
where not exists (select 1 from initials_paths where name = 'Department head sign-off');

insert into letter_templates (name, body_html)
select 'Official letter (blank)', '<p>&nbsp;</p>'
where not exists (select 1 from letter_templates where name = 'Official letter (blank)');
