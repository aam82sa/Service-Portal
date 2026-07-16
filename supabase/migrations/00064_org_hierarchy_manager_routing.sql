-- 00064 — org hierarchy + manager approval routing (Wave 2.1).
--
-- Before this, every "Line manager" DoA step routed to the generic approver
-- pool: anyone with the approver/dept_head role could decide it, and nobody
-- was specifically responsible. Now profiles carry a reporting line, and each
-- request approval step resolves to a concrete person where the hint allows.
-- Steps with no resolvable person (Finance controller, Executive committee,
-- Cybersecurity, …) keep the legacy role-pool behaviour, so nothing regresses.
-- Layered on the 00038 chain engine (generate_doa_chain + the cybersecurity
-- gate + subject_type), not the original 00006 version.

-- ---- reporting line (mastered in Entra ID; null = top of chain) ----
alter table profiles add column if not exists manager_id uuid references profiles(id);
create index if not exists profiles_manager_idx on profiles (manager_id);

-- ---- the concrete person a step is routed to (null = role pool) ----
alter table approvals add column if not exists assigned_approver_id uuid references profiles(id);
create index if not exists approvals_assigned_pending_idx
  on approvals (assigned_approver_id) where decision = 'pending';

-- Resolve the requester's line manager: climb past inactive managers and never
-- return the requester themselves (a manager loop or self-report yields null).
create or replace function resolve_line_manager(p_requester uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  cur uuid;
  hit uuid;
  hops int := 0;
begin
  select manager_id into cur from profiles where id = p_requester;
  while cur is not null and hops < 10 loop
    select p.id into hit from profiles p
    where p.id = cur and p.is_active and p.id <> p_requester;
    if hit is not null then
      return hit;
    end if;
    select manager_id into cur from profiles where id = cur;  -- climb
    hops := hops + 1;
  end loop;
  return null;
end $$;

-- Resolve a DoA step hint to a concrete approver, or null to keep pool routing.
create or replace function resolve_approver(p_hint text, p_dept dept_code, p_requester uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  h text := lower(coalesce(p_hint, ''));
  who uuid;
begin
  if p_requester is null then
    return null;
  end if;
  if h like '%line manager%' or h = 'manager' or h like '%reporting manager%' then
    return resolve_line_manager(p_requester);
  end if;
  if h like '%department head%' or h like '%dept head%' then
    -- the active dept_head for this department (dept-specific wins over global)
    select ra.profile_id into who
    from role_assignments ra join profiles p on p.id = ra.profile_id
    where ra.role = 'dept_head' and (ra.dept is null or ra.dept = p_dept) and p.is_active
    order by (ra.dept = p_dept) desc, ra.profile_id
    limit 1;
    return who;
  end if;
  return null;  -- Finance controller, Executive committee, Cybersecurity → pool
end $$;

-- Definer helper so the requests policy can consult approvals without the
-- mutual policy recursion the original chain migration warned about.
create or replace function is_assigned_pending_approver(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from approvals
    where request_id = p_request and decision = 'pending'
      and assigned_approver_id = auth.uid()
  )
$$;

-- ---- chain generator records the resolved approver on request steps ----
create or replace function generate_doa_chain(
  p_subject_type text, p_subject_id uuid, p_dept dept_code,
  p_service uuid, p_amount numeric
) returns int language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  v_spec int;
  v_requester uuid;
begin
  delete from approvals where subject_type = p_subject_type and subject_id = p_subject_id;
  if p_subject_type = 'request' then
    select requester_id into v_requester from requests where id = p_subject_id;
  end if;
  -- most specific band wins (service > dept > global)
  select max(case when d.service_id is not null then 2
                  when d.dept is not null then 1 else 0 end)
  into v_spec
  from doa_matrix d
  where (d.dept is null or d.dept = p_dept)
    and (d.service_id is null or d.service_id = p_service)
    and coalesce(p_amount, 0) >= d.min_amount
    and (d.max_amount is null or coalesce(p_amount, 0) < d.max_amount);

  insert into approvals (request_id, subject_type, subject_id, step_order,
                         approver_hint, approver_role, assigned_approver_id)
  select case when p_subject_type = 'request' then p_subject_id end,
         p_subject_type, p_subject_id, d.step_order, d.approver_hint, d.approver_role,
         resolve_approver(d.approver_hint, p_dept, v_requester)
  from doa_matrix d
  where (d.dept is null or d.dept = p_dept)
    and (d.service_id is null or d.service_id = p_service)
    and coalesce(p_amount, 0) >= d.min_amount
    and (d.max_amount is null or coalesce(p_amount, 0) < d.max_amount)
    and (case when d.service_id is not null then 2
              when d.dept is not null then 1 else 0 end) = v_spec
  order by d.step_order;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- request chain: fallback Line-manager step now resolves too ----
create or replace function create_approval_chain() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
begin
  if new.status = 'pending_approval' and old.status is distinct from new.status then
    n = generate_doa_chain('request', new.id, new.dept, new.service_id, new.amount);
    if n = 0 then
      insert into approvals (request_id, subject_type, subject_id, step_order,
                             approver_hint, assigned_approver_id)
      values (new.id, 'request', new.id, 1, 'Line manager',
              resolve_line_manager(new.requester_id));
      n = 1;
    end if;
    if exists (select 1 from services s where s.id = new.service_id and s.grants_system_access) then
      insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint, approver_role)
      select new.id, 'request', new.id, coalesce(max(a.step_order), 0) + 1, 'Cybersecurity', 'cybersecurity'
      from approvals a where a.subject_type = 'request' and a.subject_id = new.id;
      n = n + 1;
    end if;
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.id, auth.uid(), 'approval_requested',
            jsonb_build_object('steps', n, 'amount', new.amount));
  end if;
  return new;
end $$;

-- ---- decision authorization: assigned person, else the step's role pool ----
create or replace function decide_approval(
  p_approval uuid, p_decision approval_decision, p_comment text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  a approvals%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;
  select * into a from approvals where id = p_approval for update;
  if not found or a.decision <> 'pending' then
    raise exception 'approval step is not pending';
  end if;
  if a.subject_type <> 'request' then
    raise exception 'project approvals are decided inside the PMO module';
  end if;

  if a.assigned_approver_id is not null then
    if not (auth.uid() = a.assigned_approver_id or has_role('system_admin')) then
      raise exception 'this approval step is routed to a specific approver';
    end if;
  elsif not has_role(coalesce(a.approver_role, 'approver')) then
    raise exception 'this step must be decided by %',
      case when a.approver_role is null or a.approver_role = 'approver'
           then 'an approver' else a.approver_role::text end;
  end if;

  if exists (
    select 1 from approvals
    where request_id = a.request_id and step_order < a.step_order and decision <> 'approved'
  ) then
    raise exception 'earlier steps in the chain are not approved yet';
  end if;

  update approvals
  set decision = p_decision, decided_at = now(), approver_id = auth.uid(), comment = p_comment
  where id = a.id;

  insert into request_events (request_id, actor_id, event_type, detail)
  values (a.request_id, auth.uid(), 'approval_decided',
          jsonb_build_object('step', a.step_order, 'decision', p_decision, 'comment', p_comment));

  if p_decision = 'rejected'
     or not exists (select 1 from approvals where request_id = a.request_id and decision = 'pending')
  then
    update requests set status = 'in_progress' where id = a.request_id;
  end if;
end $$;

-- Reassign a stuck step (absent/OOO approver) — dept_head for the request's
-- department or a system admin. Audited; only the routing target changes.
create or replace function reassign_approval(p_approval uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a approvals%rowtype;
  rdept dept_code;
begin
  select * into a from approvals where id = p_approval for update;
  if not found or a.decision <> 'pending' then
    raise exception 'approval step is not pending';
  end if;
  if a.subject_type <> 'request' then
    raise exception 'project approvals are decided inside the PMO module';
  end if;
  select dept into rdept from requests where id = a.request_id;
  if not (has_role('dept_head', rdept) or has_role('system_admin')) then
    raise exception 'only a department head or system admin can reassign';
  end if;
  if not exists (select 1 from profiles where id = p_to and is_active) then
    raise exception 'the new approver is not an active user';
  end if;
  update approvals set assigned_approver_id = p_to where id = a.id;
  insert into request_events (request_id, actor_id, event_type, detail)
  values (a.request_id, auth.uid(), 'approval_reassigned',
          jsonb_build_object('step', a.step_order, 'to', p_to));
end $$;

-- ---- visibility: the assigned approver joins approvers + cybersecurity ----
drop policy if exists req_approver on requests;
create policy req_approver on requests for select to authenticated
  using (
    status = 'pending_approval'
    and (has_role('approver') or has_role('cybersecurity')
         or is_assigned_pending_approver(requests.id))
  );

drop policy if exists apr_read on approvals;
create policy apr_read on approvals for select to authenticated
  using (
    has_role('approver') or has_role('cybersecurity')
    or assigned_approver_id = auth.uid()
    or (subject_type = 'request' and exists (
      select 1 from requests r
      where r.id = request_id
        and (r.requester_id = auth.uid()
             or has_role('agent', r.dept) or has_role('team_lead', r.dept)
             or has_role('dept_admin', r.dept)
             or has_role('executive') or has_role('system_admin'))
    ))
  );

-- ---- demo reporting line for the standard matrix (no-op on real tenants) ----
-- agents → their team lead, leads → their dept head, business requesters →
-- a dept head; heads sit at the top with no manager.
update profiles set manager_id = m.mgr
from (values
  ('44444444-4444-4444-8444-444444444410'::uuid, '44444444-4444-4444-8444-444444444406'::uuid), -- IT agent → IT lead
  ('44444444-4444-4444-8444-444444444411', '44444444-4444-4444-8444-444444444407'), -- Admin officer → Admin lead
  ('44444444-4444-4444-8444-444444444412', '44444444-4444-4444-8444-444444444408'), -- Proc officer → Proc lead
  ('44444444-4444-4444-8444-444444444406', '44444444-4444-4444-8444-444444444402'), -- IT lead → IT head
  ('44444444-4444-4444-8444-444444444407', '44444444-4444-4444-8444-444444444403'), -- Admin lead → Admin head
  ('44444444-4444-4444-8444-444444444408', '44444444-4444-4444-8444-444444444404'), -- Proc lead → Proc head
  ('44444444-4444-4444-8444-444444444414', '44444444-4444-4444-8444-444444444403'), -- biz1 → Admin head
  ('44444444-4444-4444-8444-444444444415', '44444444-4444-4444-8444-444444444403'), -- biz2 → Admin head
  ('44444444-4444-4444-8444-444444444416', '44444444-4444-4444-8444-444444444402'), -- biz3 → IT head
  ('44444444-4444-4444-8444-444444444417', '44444444-4444-4444-8444-444444444402')  -- biz4 → IT head
) as m(uid, mgr)
where profiles.id = m.uid and profiles.manager_id is null;
