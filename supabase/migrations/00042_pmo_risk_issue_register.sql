-- PMO — PMI-style Risk & Issue Register (project page v2, part 2).
-- Per-project risk register with 5x5 probability x impact scoring, response
-- strategies constrained by risk type, response-plan checklists, residual
-- assessment, contingency; issues with severity/aging and risk conversion.
-- Visibility mirrors the project (subqueries run under the caller's RLS);
-- writes are PM / creator / PMO Admin / system admin. Everything audited.

create type risk_category as enum ('technical', 'external', 'organizational', 'project_mgmt');
create type risk_type as enum ('threat', 'opportunity');
create type risk_response as enum ('avoid', 'transfer', 'mitigate', 'accept', 'exploit', 'share', 'enhance');
create type risk_status as enum ('identified', 'analyzing', 'response_planned', 'monitoring', 'occurred', 'closed');
create type issue_severity as enum ('low', 'medium', 'high', 'critical');
create type issue_status as enum ('open', 'in_progress', 'resolved', 'closed');

create table pmo_risks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  seq int not null,                          -- per-project, trigger-assigned -> "R-03"
  title text not null,
  description text,
  cause text,
  effect text,
  category risk_category not null default 'project_mgmt',
  type risk_type not null default 'threat',
  probability int not null default 3 check (probability between 1 and 5),
  impact_schedule int not null default 0 check (impact_schedule between 0 and 5),
  impact_cost int not null default 0 check (impact_cost between 0 and 5),
  impact_scope int not null default 0 check (impact_scope between 0 and 5),
  impact_quality int not null default 0 check (impact_quality between 0 and 5),
  impact int generated always as
    (greatest(impact_schedule, impact_cost, impact_scope, impact_quality)) stored,
  score int generated always as
    (probability * greatest(impact_schedule, impact_cost, impact_scope, impact_quality)) stored,
  response_strategy risk_response,
  owner_id uuid references profiles(id),
  trigger_note text,
  contingency_amount numeric,                -- SAR
  residual_probability int check (residual_probability between 1 and 5),
  residual_impact int check (residual_impact between 0 and 5),
  status risk_status not null default 'identified',
  next_review_date date,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, seq),
  -- PMI: strategy must match the risk type
  check (response_strategy is null
    or (type = 'threat' and response_strategy in ('avoid', 'transfer', 'mitigate', 'accept'))
    or (type = 'opportunity' and response_strategy in ('exploit', 'share', 'enhance', 'accept')))
);
create index on pmo_risks (project_id);
create trigger pmo_risks_touch before update on pmo_risks
  for each row execute function touch_updated_at();

create table pmo_risk_actions (
  id uuid primary key default gen_random_uuid(),
  risk_id uuid not null references pmo_risks(id) on delete cascade,
  label text not null,
  is_done boolean not null default false,
  done_at timestamptz,
  position int not null default 0
);
create index on pmo_risk_actions (risk_id);

create table pmo_issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  seq int not null,                          -- -> "I-02"
  title text not null,
  description text,
  severity issue_severity not null default 'medium',
  owner_id uuid references profiles(id),
  due_date date,
  status issue_status not null default 'open',
  resolution text,
  origin_risk_id uuid references pmo_risks(id) on delete set null,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, seq)
);
create index on pmo_issues (project_id);
create trigger pmo_issues_touch before update on pmo_issues
  for each row execute function touch_updated_at();

-- per-project sequence numbers
create or replace function pmo_next_seq() returns trigger
language plpgsql security definer as $$
begin
  if tg_table_name = 'pmo_risks' then
    select coalesce(max(seq), 0) + 1 into new.seq from pmo_risks where project_id = new.project_id;
  else
    select coalesce(max(seq), 0) + 1 into new.seq from pmo_issues where project_id = new.project_id;
  end if;
  return new;
end $$;
create trigger pmo_risks_seq before insert on pmo_risks
  for each row execute function pmo_next_seq();
create trigger pmo_issues_seq before insert on pmo_issues
  for each row execute function pmo_next_seq();

-- write access: the project's PM / creator, PMO Admin, system admin
create or replace function pmo_can_edit_project(p uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from projects t
    where t.id = p and (
      t.project_manager_id = auth.uid() or t.created_by = auth.uid()
      or has_role('pmo_admin') or has_role('system_admin')
    )
  )
$$;

alter table pmo_risks enable row level security;
alter table pmo_risk_actions enable row level security;
alter table pmo_issues enable row level security;

-- read mirrors project visibility: the subquery runs under the caller's RLS,
-- so team members, deciders and executives see exactly what they see today
create policy prk_read on pmo_risks for select to authenticated
  using (exists (select 1 from projects t where t.id = project_id));
create policy prk_write on pmo_risks for all to authenticated
  using (pmo_can_edit_project(project_id))
  with check (pmo_can_edit_project(project_id));

create policy pra_read on pmo_risk_actions for select to authenticated
  using (exists (select 1 from pmo_risks r where r.id = risk_id));
create policy pra_write on pmo_risk_actions for all to authenticated
  using (exists (select 1 from pmo_risks r where r.id = risk_id and pmo_can_edit_project(r.project_id)))
  with check (exists (select 1 from pmo_risks r where r.id = risk_id and pmo_can_edit_project(r.project_id)));

create policy pis_read on pmo_issues for select to authenticated
  using (exists (select 1 from projects t where t.id = project_id));
create policy pis_write on pmo_issues for all to authenticated
  using (pmo_can_edit_project(project_id))
  with check (pmo_can_edit_project(project_id));

-- audited like every other PMO correction
create or replace function pmo_risk_audit() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    insert into pmo_audit_events (project_id, actor_id, area, action, detail)
    values (new.project_id, auth.uid(), 'risk', 'created',
            jsonb_build_object('code', 'R-' || lpad(new.seq::text, 2, '0'), 'title', new.title,
                               'score', new.score, 'type', new.type));
  elsif old.status is distinct from new.status then
    insert into pmo_audit_events (project_id, actor_id, area, action, detail)
    values (new.project_id, auth.uid(), 'risk', 'status_changed',
            jsonb_build_object('code', 'R-' || lpad(new.seq::text, 2, '0'),
                               'from', old.status, 'to', new.status));
  end if;
  return new;
end $$;
create trigger pmo_risks_audit_ins after insert on pmo_risks
  for each row execute function pmo_risk_audit();
create trigger pmo_risks_audit_upd after update on pmo_risks
  for each row when (old.status is distinct from new.status)
  execute function pmo_risk_audit();

create or replace function pmo_issue_audit() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    insert into pmo_audit_events (project_id, actor_id, area, action, detail)
    values (new.project_id, auth.uid(), 'issue', 'created',
            jsonb_build_object('code', 'I-' || lpad(new.seq::text, 2, '0'), 'title', new.title,
                               'severity', new.severity,
                               'from_risk', new.origin_risk_id is not null));
  elsif old.status is distinct from new.status then
    insert into pmo_audit_events (project_id, actor_id, area, action, detail)
    values (new.project_id, auth.uid(), 'issue', 'status_changed',
            jsonb_build_object('code', 'I-' || lpad(new.seq::text, 2, '0'),
                               'from', old.status, 'to', new.status));
  end if;
  return new;
end $$;
create trigger pmo_issues_audit_ins after insert on pmo_issues
  for each row execute function pmo_issue_audit();
create trigger pmo_issues_audit_upd after update on pmo_issues
  for each row when (old.status is distinct from new.status)
  execute function pmo_issue_audit();

-- a risk that materializes becomes an issue, in one audited transaction
create or replace function pmo_convert_risk_to_issue(p_risk uuid)
returns uuid language plpgsql security definer as $$
declare
  r pmo_risks%rowtype;
  v_issue uuid;
begin
  select * into r from pmo_risks where id = p_risk;
  if not found then raise exception 'unknown risk'; end if;
  if not pmo_can_edit_project(r.project_id) then
    raise exception 'only the project manager or PMO admin can convert a risk';
  end if;
  if r.status = 'occurred' and exists (select 1 from pmo_issues where origin_risk_id = p_risk) then
    raise exception 'this risk was already converted';
  end if;

  update pmo_risks set status = 'occurred' where id = p_risk;
  insert into pmo_issues (project_id, title, description, severity, owner_id, origin_risk_id)
  values (r.project_id, r.title,
          coalesce(r.effect, r.description),
          case when r.score >= 15 then 'critical' when r.score >= 10 then 'high'
               when r.score >= 5 then 'medium' else 'low' end::issue_severity,
          r.owner_id, p_risk)
  returning id into v_issue;

  insert into pmo_audit_events (project_id, actor_id, area, action, detail)
  values (r.project_id, auth.uid(), 'risk', 'converted_to_issue',
          jsonb_build_object('risk', 'R-' || lpad(r.seq::text, 2, '0'), 'issue_id', v_issue));
  return v_issue;
end $$;

-- ============ Demo register on the existing demo projects ============
do $$
declare
  v_p1 uuid; v_p2 uuid; v_pm1 uuid; v_pm2 uuid;
  v_r1 uuid := '77777777-7777-4777-8777-777777777701';
  v_r2 uuid := '77777777-7777-4777-8777-777777777702';
  v_r3 uuid := '77777777-7777-4777-8777-777777777703';
  v_r4 uuid := '77777777-7777-4777-8777-777777777704';
begin
  if exists (select 1 from pmo_risks where id = v_r1) then
    raise notice 'demo risks already seeded';
    return;
  end if;
  select id, coalesce(project_manager_id, created_by) into v_p1, v_pm1
  from projects where project_type = 'company' and status in ('active', 'baselined', 'planning')
  order by created_at limit 1;
  select id, coalesce(project_manager_id, created_by) into v_p2, v_pm2
  from projects where project_type = 'company' and id is distinct from v_p1
  order by created_at limit 1;
  if v_p1 is null then
    raise notice 'no company projects found — demo register skipped';
    return;
  end if;
  v_p2 := coalesce(v_p2, v_p1);
  v_pm2 := coalesce(v_pm2, v_pm1);

  insert into pmo_risks (id, project_id, title, description, cause, effect, category, type,
                         probability, impact_schedule, impact_cost, impact_scope, impact_quality,
                         response_strategy, owner_id, trigger_note, contingency_amount,
                         residual_probability, residual_impact, status, next_review_date, created_by) values
  (v_r1, v_p1, 'Key vendor delivery slips past integration window',
   'The integration vendor has a history of late milestone delivery on similar engagements.',
   'Vendor capacity is shared across three concurrent clients.',
   'Integration testing starts late; go-live slips by up to four weeks.',
   'external', 'threat', 4, 4, 2, 0, 1, 'mitigate', v_pm1,
   'Vendor misses the first drop scheduled for the 20th.', 45000, 2, 3,
   'response_planned', current_date + 7, v_pm1),
  (v_r2, v_p1, 'Scope creep from department change requests',
   'Departments keep raising enhancement requests directly to developers.',
   'No enforced change-control path for mid-sprint requests.',
   'Uncontrolled effort growth; the cost baseline becomes unreliable.',
   'project_mgmt', 'threat', 3, 2, 4, 5, 2, 'avoid', v_pm1,
   'Any request accepted without a change request record.', null, 2, 2,
   'monitoring', current_date - 3, v_pm1),
  (v_r3, v_p1, 'Early framework upgrade could cut rework',
   'The new platform version ships a native module we currently hand-build.',
   'Release timing aligns with our build phase.',
   'Roughly three weeks of planned effort could be avoided.',
   'technical', 'opportunity', 3, 3, 3, 0, 2, 'exploit', v_pm1,
   'Stable release published before our phase 2 starts.', null, null, null,
   'analyzing', current_date + 14, v_pm1),
  (v_r4, v_p2, 'Field staff resist the new mobile workflow',
   'Previous rollouts saw low adoption without early field involvement.',
   'Training was classroom-only; no champions in the field teams.',
   'Adoption below 50% keeps the paper process alive in parallel.',
   'organizational', 'threat', 4, 3, 1, 2, 4, 'mitigate', v_pm2,
   'Pilot week feedback scores below 3/5.', 12000, 2, 2,
   'identified', current_date + 10, v_pm2);

  insert into pmo_risk_actions (risk_id, label, is_done, done_at, position) values
  (v_r1, 'Weekly vendor delivery checkpoint with penalties clause review', true, now() - interval '5 days', 1),
  (v_r1, 'Line up second integration contractor on retainer', false, null, 2),
  (v_r1, 'Pull integration test cases forward into vendor drops', false, null, 3),
  (v_r2, 'Publish the change-request path to all department heads', true, now() - interval '10 days', 1),
  (v_r2, 'Route all enhancement asks through the PMO board', false, null, 2),
  (v_r4, 'Recruit two field champions per region for the pilot', false, null, 1);

  -- one issue converted from a risk, one standalone
  update pmo_risks set status = 'occurred' where id = v_r2;
  insert into pmo_issues (project_id, title, description, severity, owner_id, due_date, status, origin_risk_id, created_by) values
  (v_p1, 'Scope creep from department change requests',
   'Three untracked enhancements were merged during sprint 4; baseline no longer matches delivered scope.',
   'high', v_pm1, current_date + 5, 'in_progress', v_r2, v_pm1),
  (v_p2, 'Pilot devices arrived without SIM provisioning',
   'Batch of 15 field tablets shipped unprovisioned; pilot start blocked.',
   'medium', v_pm2, current_date + 2, 'open', null, v_pm2);

  raise notice 'seeded demo risk register';
end $$;
