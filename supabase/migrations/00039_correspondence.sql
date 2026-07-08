-- ABC Services Hub — Correspondence Management (الصادر والوارد), Phase A.
-- Searchable letter archive: private storage, registry with full-text search,
-- AI-reading support tables (extraction feedback + usage metering),
-- owner routing / shares / comments, immutable audit events, the
-- tenant-configurable numbering engine, and the DLP model (confidentiality
-- levels, per-viewer watermark events, owner-only clear view).

create extension if not exists pg_trgm;

-- ============ Types ============
create type letter_direction as enum ('incoming', 'outgoing');
create type letter_confidentiality as enum ('general', 'restricted', 'confidential');

-- ============ Letters registry ============
create table letters (
  id uuid primary key default gen_random_uuid(),
  direction letter_direction not null,
  doctype text not null default 'LTR',       -- feeds the {doctype} numbering token
  ref_ours text unique,                      -- issued by the numbering engine, never at draft
  ref_theirs text,
  letter_date date,
  received_on date not null default current_date,
  sender text,
  addressee text,
  subject text not null,
  brief_ar text,
  brief_en text,
  ocr_text text,
  confidentiality letter_confidentiality not null default 'general',
  dept dept_code not null,
  owner_id uuid not null references profiles(id),
  status text not null default 'registered'
    check (status in ('registered', 'in_review', 'answered', 'closed')),
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tsv tsvector generated always as (to_tsvector('simple',
    coalesce(subject, '') || ' ' || coalesce(sender, '') || ' ' || coalesce(addressee, '')
    || ' ' || coalesce(ref_ours, '') || ' ' || coalesce(ref_theirs, '')
    || ' ' || coalesce(brief_ar, '') || ' ' || coalesce(brief_en, '')
    || ' ' || coalesce(ocr_text, ''))) stored
);
create index letters_tsv on letters using gin (tsv);
create index letters_subject_trgm on letters using gin (subject gin_trgm_ops);
create index letters_dept on letters (dept);
create trigger letters_touch before update on letters
  for each row execute function touch_updated_at();

create table letter_files (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references letters(id) on delete cascade,
  path text not null,                        -- letters bucket: {letter_id}/{filename}
  filename text not null,
  mime text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on letter_files (letter_id);

create table letter_shares (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references letters(id) on delete cascade,
  user_id uuid references profiles(id),
  dept dept_code,
  shared_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (num_nonnulls(user_id, dept) = 1)
);
create index on letter_shares (letter_id);

-- Every correction teaches the reader: stored and replayed into the prompt
-- as tenant-specific examples.
create table extraction_feedback (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid references letters(id) on delete set null,
  field text not null,
  extracted text,
  corrected text,
  features jsonb not null default '{}',
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Per-tenant AI metering for billing
create table ai_usage (
  id bigint generated always as identity primary key,
  letter_id uuid references letters(id) on delete set null,
  user_id uuid references profiles(id) default auth.uid(),
  model text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

-- Module settings (AI key/model, clear-view policy). Key-value on purpose.
create table correspondence_settings (
  key text primary key,
  value text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
insert into correspondence_settings (key, value) values
  ('ai_model', 'claude-sonnet-5'),
  ('allow_owner_clear_view', 'true')
on conflict (key) do nothing;

-- Immutable audit: register, view, view_clear, download, share, transfer,
-- comment, print, number_issued, confidentiality_changed.
create table letter_events (
  id bigint generated always as identity primary key,
  letter_id uuid not null references letters(id) on delete cascade,
  actor_id uuid references profiles(id),
  event_type text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on letter_events (letter_id);

-- ============ Numbering engine ============
create table numbering_schemes (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  format text not null,                      -- e.g. {dept}/{yyyy}/{seq} or {seq:4}-{yy}-{mm}-{dept}
  seq_scope text not null default 'global' check (seq_scope in ('global', 'dept', 'doctype')),
  reset_policy text not null default 'yearly' check (reset_policy in ('never', 'yearly', 'monthly')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index numbering_one_default on numbering_schemes (is_default) where is_default;
create trigger numbering_schemes_touch before update on numbering_schemes
  for each row execute function touch_updated_at();

create table numbering_counters (
  scheme_id uuid not null references numbering_schemes(id) on delete cascade,
  scope_key text not null,
  period_key text not null,
  value int not null default 0,
  primary key (scheme_id, scope_key, period_key)
);

insert into numbering_schemes (name, format, seq_scope, reset_policy, is_default)
values ('Default', '{dept}/{yyyy}/{seq:4}', 'dept', 'yearly', true)
on conflict (name) do nothing;

-- Renders a scheme format for a given sequence value and letter context.
create or replace function render_letter_number(
  p_format text, p_seq int, p_dept text, p_doctype text, p_on date default current_date
) returns text language plpgsql immutable as $$
declare
  out text := p_format;
  pad text;
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
  return out;
end $$;

-- Concurrency-safe issuance: advisory lock per (scheme, scope, period), so
-- two letters can never share a number. Numbers are never reused; voided
-- letters keep theirs.
create or replace function issue_letter_number(p_letter uuid, p_scheme uuid default null)
returns text language plpgsql security definer as $$
declare
  l letters%rowtype;
  s numbering_schemes%rowtype;
  v_scope text;
  v_period text;
  v_seq int;
  v_ref text;
begin
  select * into l from letters where id = p_letter;
  if not found then raise exception 'unknown letter'; end if;
  if not (l.owner_id = auth.uid() or l.created_by = auth.uid()
          or has_role('agent', l.dept) or has_role('team_lead', l.dept)
          or has_role('dept_head', l.dept) or has_role('system_admin')) then
    raise exception 'not allowed to issue a number for this letter';
  end if;
  if l.ref_ours is not null then
    raise exception 'letter already has reference %', l.ref_ours;
  end if;

  if p_scheme is null then
    select * into s from numbering_schemes where is_default limit 1;
  else
    select * into s from numbering_schemes where id = p_scheme;
  end if;
  if not found then raise exception 'no numbering scheme configured'; end if;

  v_scope := case s.seq_scope
    when 'dept' then l.dept::text
    when 'doctype' then l.doctype
    else 'global' end;
  v_period := case s.reset_policy
    when 'yearly' then to_char(current_date, 'YYYY')
    when 'monthly' then to_char(current_date, 'YYYY-MM')
    else 'all' end;

  perform pg_advisory_xact_lock(hashtextextended(s.id::text || '|' || v_scope || '|' || v_period, 0));
  insert into numbering_counters (scheme_id, scope_key, period_key, value)
  values (s.id, v_scope, v_period, 1)
  on conflict (scheme_id, scope_key, period_key) do update set value = numbering_counters.value + 1
  returning value into v_seq;

  v_ref := render_letter_number(s.format, v_seq, l.dept::text, l.doctype);
  update letters set ref_ours = v_ref where id = p_letter;
  insert into letter_events (letter_id, actor_id, event_type, detail)
  values (p_letter, auth.uid(), 'number_issued',
          jsonb_build_object('ref', v_ref, 'scheme', s.name));
  return v_ref;
end $$;

-- ============ Access model ============
-- Confidential letters: owner, creator and explicitly shared users only —
-- not even admins. Others: department staff, shared users/departments, and
-- system admins (who still only ever see watermarked renditions in the UI).
create or replace function can_access_letter(l uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from letters t
    where t.id = l and (
      t.owner_id = auth.uid() or t.created_by = auth.uid()
      or exists (select 1 from letter_shares s where s.letter_id = l and s.user_id = auth.uid())
      or (t.confidentiality <> 'confidential' and (
        has_role('agent', t.dept) or has_role('team_lead', t.dept)
        or has_role('dept_head', t.dept) or has_role('system_admin')
        or exists (
          select 1 from letter_shares s
          where s.letter_id = l and s.dept is not null
            and (has_role('agent', s.dept) or has_role('team_lead', s.dept)
                 or has_role('dept_head', s.dept))
        )
      ))
    )
  )
$$;

alter table letters enable row level security;
alter table letter_files enable row level security;
alter table letter_shares enable row level security;
alter table letter_events enable row level security;
alter table extraction_feedback enable row level security;
alter table ai_usage enable row level security;
alter table correspondence_settings enable row level security;
alter table numbering_schemes enable row level security;
alter table numbering_counters enable row level security;

create policy ltr_read on letters for select to authenticated
  using (can_access_letter(id));
create policy ltr_insert on letters for insert to authenticated
  with check (
    (has_role('agent', dept) or has_role('team_lead', dept)
     or has_role('dept_head', dept) or has_role('system_admin'))
    and created_by = auth.uid()
  );
create policy ltr_update on letters for update to authenticated
  using (owner_id = auth.uid() or has_role('dept_head', dept) or has_role('system_admin'))
  with check (owner_id is not null);

-- Guard: identity fields immutable; ref only via the engine; confidentiality
-- changes are owner-only and audited; ownership transfers are audited.
create or replace function letters_guard_update() returns trigger
language plpgsql security definer as $$
begin
  new.created_by = old.created_by;
  new.created_at = old.created_at;
  new.direction = old.direction;
  new.dept = old.dept;
  if new.ref_ours is distinct from old.ref_ours and old.ref_ours is not null then
    raise exception 'issued reference numbers are permanent';
  end if;
  if new.confidentiality is distinct from old.confidentiality then
    if auth.uid() is not null and auth.uid() <> old.owner_id then
      raise exception 'only the letter owner can change confidentiality';
    end if;
    insert into letter_events (letter_id, actor_id, event_type, detail)
    values (old.id, auth.uid(), 'confidentiality_changed',
            jsonb_build_object('from', old.confidentiality, 'to', new.confidentiality));
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into letter_events (letter_id, actor_id, event_type, detail)
    values (old.id, auth.uid(), 'transferred',
            jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  return new;
end $$;
create trigger letters_guard before update on letters
  for each row execute function letters_guard_update();

create or replace function letters_log_insert() returns trigger
language plpgsql security definer as $$
begin
  insert into letter_events (letter_id, actor_id, event_type, detail)
  values (new.id, auth.uid(), 'registered',
          jsonb_build_object('direction', new.direction, 'subject', new.subject));
  return new;
end $$;
create trigger letters_registered after insert on letters
  for each row execute function letters_log_insert();

create policy lf_read on letter_files for select to authenticated
  using (can_access_letter(letter_id));
create policy lf_insert on letter_files for insert to authenticated
  with check (can_access_letter(letter_id));
create policy lf_delete on letter_files for delete to authenticated
  using (exists (select 1 from letters t where t.id = letter_id and t.owner_id = auth.uid()));

create policy ls_read on letter_shares for select to authenticated
  using (can_access_letter(letter_id));
-- Confidential letters cannot be shared — only ownership transfers.
create policy ls_write on letter_shares for insert to authenticated
  with check (exists (
    select 1 from letters t
    where t.id = letter_id and t.confidentiality <> 'confidential'
      and (t.owner_id = auth.uid() or has_role('system_admin'))
  ));
create policy ls_delete on letter_shares for delete to authenticated
  using (exists (
    select 1 from letters t
    where t.id = letter_id and (t.owner_id = auth.uid() or has_role('system_admin'))
  ));

create or replace function shares_log_insert() returns trigger
language plpgsql security definer as $$
begin
  insert into letter_events (letter_id, actor_id, event_type, detail)
  values (new.letter_id, auth.uid(), 'shared',
          jsonb_build_object('user_id', new.user_id, 'dept', new.dept));
  return new;
end $$;
create trigger letter_shares_log after insert on letter_shares
  for each row execute function shares_log_insert();

create policy lev_read on letter_events for select to authenticated
  using (can_access_letter(letter_id));
-- inserts only via definer functions; no update/delete policies ever

create policy ef_read on extraction_feedback for select to authenticated
  using (has_role('agent') or has_role('team_lead') or has_role('dept_head') or has_role('system_admin'));
create policy ef_insert on extraction_feedback for insert to authenticated
  with check (letter_id is null or can_access_letter(letter_id));

create policy aiu_read on ai_usage for select to authenticated
  using (user_id = auth.uid() or has_role('system_admin'));
create policy aiu_insert on ai_usage for insert to authenticated
  with check (user_id = auth.uid());

create policy cs_read on correspondence_settings for select to authenticated
  using (has_role('agent') or has_role('team_lead') or has_role('dept_head') or has_role('system_admin'));
create policy cs_write on correspondence_settings for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));

create policy ns_read on numbering_schemes for select to authenticated using (true);
create policy ns_write on numbering_schemes for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
create policy nc_read on numbering_counters for select to authenticated
  using (has_role('system_admin'));

-- UI-driven audit writer (viewed / view_clear / downloaded / printed)
create or replace function log_letter_event(p_letter uuid, p_type text, p_detail jsonb default '{}')
returns void language plpgsql security definer as $$
begin
  if not can_access_letter(p_letter) then
    raise exception 'no access to this letter';
  end if;
  if p_type not in ('viewed', 'view_clear', 'downloaded', 'printed') then
    raise exception 'unknown event type %', p_type;
  end if;
  insert into letter_events (letter_id, actor_id, event_type, detail)
  values (p_letter, auth.uid(), p_type, coalesce(p_detail, '{}'));
end $$;

-- Comments are immutable letter events (same pattern as request comments)
create or replace function add_letter_comment(p_letter uuid, p_body text)
returns void language plpgsql security definer as $$
begin
  if not can_access_letter(p_letter) then
    raise exception 'no access to this letter';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'comment is empty';
  end if;
  insert into letter_events (letter_id, actor_id, event_type, detail)
  values (p_letter, auth.uid(), 'comment', jsonb_build_object('body', p_body));
end $$;

-- ============ Storage: private letters bucket ============
insert into storage.buckets (id, name, public)
values ('letters', 'letters', false)
on conflict (id) do nothing;

-- Objects live at {letter_id}/{filename}; access mirrors the registry.
drop policy if exists letters_files_read on storage.objects;
create policy letters_files_read on storage.objects for select to authenticated
  using (bucket_id = 'letters'
         and can_access_letter(((storage.foldername(name))[1])::uuid));
drop policy if exists letters_files_insert on storage.objects;
create policy letters_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'letters'
              and can_access_letter(((storage.foldername(name))[1])::uuid));
drop policy if exists letters_files_delete on storage.objects;
create policy letters_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'letters' and exists (
    select 1 from letters t
    where t.id = ((storage.foldername(name))[1])::uuid and t.owner_id = auth.uid()
  ));

-- ============ Navigation ============
insert into page_access (page, name, allowed) values
  ('letters', 'Correspondence', '{agent,team_lead,dept_head,dept_admin,system_admin}')
on conflict (page) do nothing;
