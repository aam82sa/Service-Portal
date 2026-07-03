-- DoA approvals engine: chain generation from doa_matrix, sequential
-- decisions via RPC, and resolution blocked until the chain is approved.

-- Approvers see requests that carry an approval chain (rows are unassigned
-- until decided, so the original approver_id-based policy never matched)
drop policy if exists req_approver on requests;
create policy req_approver on requests for select to authenticated
  using (has_role('approver') and exists (
    select 1 from approvals a where a.request_id = requests.id
  ));

-- Approvals visible to approvers, the requester, and department staff
create policy apr_read on approvals for select to authenticated
  using (
    has_role('approver')
    or exists (
      select 1 from requests r
      where r.id = request_id
        and (r.requester_id = auth.uid()
             or has_role('agent', r.dept) or has_role('team_lead', r.dept)
             or has_role('dept_admin', r.dept)
             or has_role('executive') or has_role('system_admin'))
    )
  );
-- Writes happen only via the definer trigger/RPC below.

-- Generate the chain when a request enters pending_approval
create or replace function create_approval_chain() returns trigger
language plpgsql security definer as $$
declare
  n int := 0;
begin
  if new.status = 'pending_approval' and old.status is distinct from new.status then
    -- fresh chain per submission; decision history lives in request_events
    delete from approvals where request_id = new.id;
    insert into approvals (request_id, step_order, approver_hint)
    select new.id, d.step_order, d.approver_hint
    from doa_matrix d
    where (d.dept is null or d.dept = new.dept)
      and (d.service_id is null or d.service_id = new.service_id)
      and coalesce(new.amount, 0) >= d.min_amount
      and (d.max_amount is null or coalesce(new.amount, 0) < d.max_amount)
    order by d.step_order;
    get diagnostics n = row_count;
    if n = 0 then
      insert into approvals (request_id, step_order, approver_hint)
      values (new.id, 1, 'Line manager');
    end if;
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.id, auth.uid(), 'approval_requested',
            jsonb_build_object('steps', greatest(n, 1), 'amount', new.amount));
  end if;
  return new;
end $$;
create trigger requests_approval_chain after update on requests
  for each row execute function create_approval_chain();

-- Sequential decision, RPC-only
create or replace function decide_approval(
  p_approval uuid, p_decision approval_decision, p_comment text default null
) returns void language plpgsql security definer as $$
declare
  a approvals%rowtype;
begin
  if not has_role('approver') then
    raise exception 'only approvers can decide';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;
  select * into a from approvals where id = p_approval for update;
  if not found or a.decision <> 'pending' then
    raise exception 'approval step is not pending';
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

-- Block resolving when approval is required but the chain is not fully approved
create or replace function requests_guard_update() returns trigger
language plpgsql security definer as $$
declare
  needs_approval boolean;
begin
  new.requester_id = old.requester_id;
  new.ref = old.ref;
  new.service_id = old.service_id;
  new.dept = old.dept;
  new.created_at = old.created_at;
  if new.status is distinct from old.status and (old.status::text, new.status::text) not in (
    ('new', 'triaged'), ('new', 'cancelled'),
    ('triaged', 'in_progress'),
    ('in_progress', 'pending_approval'), ('in_progress', 'pending_requester'),
    ('in_progress', 'resolved'), ('in_progress', 'escalated'),
    ('pending_requester', 'in_progress'),
    ('pending_approval', 'in_progress'),
    ('escalated', 'in_progress'),
    ('resolved', 'closed'), ('resolved', 'in_progress')
  ) then
    raise exception 'transition % -> % is not allowed', old.status, new.status;
  end if;
  if old.status = 'in_progress' and new.status = 'resolved' then
    select s.requires_approval into needs_approval from services s where s.id = new.service_id;
    if needs_approval and (
      not exists (select 1 from approvals where request_id = new.id)
      or exists (select 1 from approvals where request_id = new.id and decision <> 'approved')
    ) then
      raise exception 'this request requires an approved DoA chain before it can be resolved';
    end if;
  end if;
  return new;
end $$;
