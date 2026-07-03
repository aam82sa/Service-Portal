-- Agent workspace: department staff can work requests; the database enforces
-- which lifecycle transitions are legal and logs every change.

create policy req_agent_update on requests for update to authenticated
  using (has_role('agent', dept) or has_role('team_lead', dept) or has_role('dept_admin', dept))
  with check (has_role('agent', dept) or has_role('team_lead', dept) or has_role('dept_admin', dept));

-- Guard: immutable columns + legal transitions only
-- (interim rules; the per-service workflow engine replaces this table later)
create or replace function requests_guard_update() returns trigger
language plpgsql as $$
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
  return new;
end $$;
create trigger requests_guard before update on requests
  for each row execute function requests_guard_update();

-- Audit: status changes and assignments
create or replace function requests_log_update() returns trigger
language plpgsql security definer as $$
begin
  if new.status is distinct from old.status then
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.id, auth.uid(), 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.id, auth.uid(), 'assigned',
            jsonb_build_object('assignee_id', new.assignee_id));
  end if;
  return new;
end $$;
create trigger requests_log after update on requests
  for each row execute function requests_log_update();
