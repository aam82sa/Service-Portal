-- 00079 — WORKFL1 Part 2 (branch 8): config-change impact preview + apply.
--
-- The correctness half of edit / retire / delete. Two SECURITY DEFINER RPCs,
-- both admin-gated and search_path-pinned:
--
--   * preview_config_change(kind, id, change) — read-only. Returns the real
--     impact counts (never estimates): open requests, per-status breakdown,
--     historical total (which blocks hard delete), affected SLA clocks, whether
--     a clean hard delete is possible, and the first 10 affected REQ- refs.
--   * apply_config_change(kind, id, change, resolution, note) — one transaction:
--     re-runs the preview and ABORTS if the open-request count moved since the
--     dialog was shown (no TOCTOU surprise), applies the edit/retire/delete,
--     resolves affected open requests per `resolution`, and writes the
--     append-only config_changes audit row (branch 7).
--
-- Resolutions for affected OPEN requests:
--   finish_old — nothing closes; version pinning (00077) lets them finish.
--   migrate    — re-point open requests to a new version (form versions only,
--                and only when the target belongs to the same service).
--   close      — Ady's condition: status -> cancelled (never closed; they were
--                never fulfilled), reason config_change, mandatory note, a link
--                to the change record, one request_events row + one requester
--                notification each. Destructive, never the default, never silent.
--
-- Hard delete is a branch of apply that runs only when the row has zero
-- historical references — re-checked inside the transaction. Terminal requests
-- (resolved/closed/cancelled) are never touched: their history pages must keep
-- resolving the now-retired config.
--
-- The mass-closure path sets a transaction-local GUC that requests_guard_update
-- honours as an audited override, so a dept_head can close their own dept's
-- in-flight requests even when in_progress -> cancelled is not a graph edge.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) requests_guard_update: recognise the config-change closure override
-- ─────────────────────────────────────────────────────────────────────────
create or replace function requests_guard_update() returns trigger
language plpgsql security definer as $$
declare
  needs_approval boolean;
  wf jsonb;
  is_override boolean := false;
  guard_team uuid;
begin
  new.requester_id = old.requester_id;
  new.ref = old.ref;
  new.service_id = old.service_id;
  new.dept = old.dept;
  new.created_at = old.created_at;
  new.workflow_id = old.workflow_id;   -- the pinned version is immutable

  if new.status is distinct from old.status then
    if nullif(current_setting('app.config_change', true), '') is not null then
      -- config-change mass-closure: an audited admin override, like below.
      is_override := true;
      insert into admin_events (actor_id, area, action, detail)
      values (auth.uid(), 'governance', 'config_change_status',
              jsonb_build_object('ref', new.ref, 'from', old.status, 'to', new.status,
                                 'config_change', current_setting('app.config_change', true)));
    elsif has_role('system_admin') then
      is_override := true;
      insert into admin_events (actor_id, area, action, detail)
      values (auth.uid(), 'governance', 'status_override',
              jsonb_build_object('ref', new.ref, 'from', old.status, 'to', new.status));
    else
      -- pinned version first (kept even after it is retired by a later
      -- publish — in-flight requests finish on the version they started on)
      select w.graph into wf from workflow_definitions w
      where w.id = old.workflow_id and w.status <> 'draft';
      if wf is null then
        select w.graph into wf from workflow_definitions w
        where w.service_id = new.service_id and w.status = 'published'
        order by w.version desc limit 1;
      end if;
      if wf is null then
        select w.graph into wf from workflow_definitions w
        join services s on s.id = new.service_id
        where w.service_id = s.parent_id and w.status = 'published'
        order by w.version desc limit 1;
      end if;

      if wf is not null then
        if not exists (
          select 1 from jsonb_array_elements(wf->'transitions') t
          where t->>'from' = old.status::text and t->>'to' = new.status::text
        ) then
          raise exception 'transition % -> % is not in this service''s published workflow',
            old.status, new.status;
        end if;
      elsif (old.status::text, new.status::text) not in (
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
    end if;

    -- governance: any change to a closed request alerts the IT head
    if old.status = 'closed' then
      insert into admin_events (actor_id, area, action, detail)
      values (auth.uid(), 'governance', 'closed_request_changed',
              jsonb_build_object('ref', new.ref, 'to', new.status));
    end if;
  end if;

  -- —— assignment & team governance (officers pull, leads and heads push) ——
  if auth.uid() is not null and not has_role('system_admin')
     and nullif(current_setting('app.config_change', true), '') is null then
    guard_team := coalesce(old.team_id, new.team_id);

    if new.team_id is distinct from old.team_id then
      if not (has_role('dept_head', new.dept) or has_role('dept_admin', new.dept)) then
        raise exception 'moving a request between teams needs the department head';
      end if;
      if new.team_id is not null and not exists (
        select 1 from teams t where t.id = new.team_id and t.dept = new.dept
      ) then
        raise exception 'target team is not in this department';
      end if;
    end if;

    if new.assignee_id is distinct from old.assignee_id then
      if has_role('dept_head', new.dept) or has_role('dept_admin', new.dept) then
        if new.assignee_id is not null and not exists (
          select 1 from team_members tm
          join teams t on t.id = tm.team_id
          where t.dept = new.dept and tm.profile_id = new.assignee_id
        ) then
          raise exception 'assignee must be a member of a team in this department';
        end if;
      elsif is_team_lead(guard_team) then
        if new.assignee_id is not null and not exists (
          select 1 from team_members tm
          where tm.team_id = guard_team and tm.profile_id = new.assignee_id
        ) then
          raise exception 'a team lead can only assign to members of that team';
        end if;
      else
        -- officer: claim (null -> self) or hand back (self -> null), nothing else
        if not ((old.assignee_id is null and new.assignee_id = auth.uid())
                or (old.assignee_id = auth.uid() and new.assignee_id is null)) then
          raise exception 'officers can claim or hand back — assigning to someone else needs a team lead or department head';
        end if;
      end if;
    end if;

    if new.priority is distinct from old.priority then
      if not (has_role('dept_head', new.dept) or has_role('dept_admin', new.dept)
              or is_team_lead(guard_team)) then
        raise exception 'priority can only be changed by a team lead or department head';
      end if;
    end if;
  end if;

  if not is_override and old.status = 'in_progress' and new.status = 'resolved'
     and new.parent_request_id is null then
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

-- ─────────────────────────────────────────────────────────────────────────
-- 2) owning dept + target code for a config target
-- ─────────────────────────────────────────────────────────────────────────
create or replace function _config_change_target(p_kind text, p_id uuid)
returns table(dept_id uuid, target_code text)
language sql stable security definer set search_path = public as $$
  select case p_kind
           when 'service' then (select s.dept_id from services s where s.id = p_id)
           when 'form'    then (select s.dept_id from form_versions fv join services s on s.id = fv.service_id where fv.id = p_id)
           else null::uuid
         end,
         case p_kind
           when 'service' then (select s.code from services s where s.id = p_id)
           when 'form'    then (select s.code || ' form v' || fv.version from form_versions fv join services s on s.id = fv.service_id where fv.id = p_id)
           when 'sla'     then (select sp.name from sla_profiles sp where sp.id = p_id)
         end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) impact — the shared count engine (preview + TOCTOU re-check)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function _config_change_impact(p_kind text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  terminal constant text[] := array['resolved', 'closed', 'cancelled'];
  result jsonb;
begin
  with affected as (
    select r.id, r.ref, r.status::text as status, r.sla_resolution_due
      from requests r
     where case p_kind
             when 'service' then r.service_id = p_id
             when 'form'    then r.form_version_id = p_id
             when 'sla'     then r.service_id in (select s.id from services s where s.sla_profile_id = p_id)
             else false
           end
  ),
  open_reqs as (select * from affected where status <> all(terminal))
  select jsonb_build_object(
    'open_requests',      (select count(*) from open_reqs),
    'in_flight_by_status',(select coalesce(jsonb_object_agg(status, c), '{}'::jsonb)
                             from (select status, count(*) c from open_reqs group by status) g),
    'scheduled_items',    0,   -- no recurring-request source in this schema yet
    'draft_submissions',  0,   -- request drafts are client-side, none persisted
    'historical_requests',(select count(*) from affected),
    'affected_sla_clocks',(select count(*) from open_reqs where sla_resolution_due is not null),
    'can_hard_delete',    ((select count(*) from affected) = 0),
    'sample_refs',        (select coalesce(array_agg(ref order by ref), '{}')
                             from (select ref from open_reqs order by ref limit 10) s)
  ) into result;
  return result;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) preview_config_change — read-only, admin-gated
-- ─────────────────────────────────────────────────────────────────────────
create or replace function preview_config_change(p_kind text, p_id uuid, p_change jsonb default '{}')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t_dept uuid;
begin
  if p_kind not in ('service', 'form', 'sla') then
    raise exception 'unknown config kind: %', p_kind;
  end if;
  select dept_id into t_dept from _config_change_target(p_kind, p_id);
  if not (has_role('system_admin') or (t_dept is not null and has_role('dept_head', t_dept))) then
    raise exception 'not authorised to preview changes for this %', p_kind
      using errcode = '42501';
  end if;
  return _config_change_impact(p_kind, p_id);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) apply_config_change — the single transactional mutation
-- ─────────────────────────────────────────────────────────────────────────
create or replace function apply_config_change(
  p_kind text, p_id uuid, p_change jsonb, p_resolution text, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_action     text := coalesce(p_change->>'action', 'edit');
  v_dept       uuid;
  v_code       text;
  v_impact     jsonb;
  v_shown_open int;
  v_now_open   int;
  v_to_version uuid := nullif(p_change->>'to_version_id', '')::uuid;
  v_affected   uuid[] := '{}';
  v_change_id  uuid;
  rec          record;
begin
  -- validation
  if p_kind not in ('service', 'form', 'sla') then
    raise exception 'unknown config kind: %', p_kind;
  end if;
  if v_action not in ('edit', 'retire', 'delete') then
    raise exception 'unknown action: %', v_action;
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'a note is required for every config change' using errcode = '23514';
  end if;
  if p_resolution is not null and p_resolution not in ('finish_old', 'migrate', 'close') then
    raise exception 'unknown resolution: %', p_resolution;
  end if;

  select dept_id, target_code into v_dept, v_code from _config_change_target(p_kind, p_id);

  -- admin gate (org-level SLA changes are system_admin only)
  if not (has_role('system_admin') or (v_dept is not null and has_role('dept_head', v_dept))) then
    raise exception 'not authorised to change this %', p_kind using errcode = '42501';
  end if;

  -- TOCTOU: re-run the preview and abort if the open count moved
  v_impact := _config_change_impact(p_kind, p_id);
  v_now_open := (v_impact->>'open_requests')::int;
  if p_change ? 'impact' and (p_change->'impact' ? 'open_requests') then
    v_shown_open := (p_change->'impact'->>'open_requests')::int;
    if v_shown_open is distinct from v_now_open then
      raise exception 'impact changed since preview (was %, now %) — reopen the dialog',
        v_shown_open, v_now_open using errcode = '40001';
    end if;
  end if;

  -- hard delete: only when nothing ever referenced the row
  if v_action = 'delete' and not (v_impact->>'can_hard_delete')::boolean then
    raise exception 'cannot hard delete: % has % request(s) in history — retire instead',
      coalesce(v_code, p_id::text), (v_impact->>'historical_requests')
      using errcode = '23503';
  end if;

  -- resolve affected OPEN requests
  if p_resolution = 'migrate' then
    if p_kind <> 'form' or v_to_version is null then
      raise exception 'migrate is only available for form versions and needs to_version_id';
    end if;
    if not exists (
      select 1 from form_versions nv
      join form_versions ov on ov.service_id = nv.service_id
      where nv.id = v_to_version and ov.id = p_id
    ) then
      raise exception 'target form version is not part of the same service';
    end if;
    with moved as (
      update requests r set form_version_id = v_to_version
       where r.form_version_id = p_id
         and r.status not in ('resolved', 'closed', 'cancelled')
      returning r.id
    )
    select coalesce(array_agg(id), '{}') into v_affected from moved;
  elsif p_resolution = 'close' then
    -- audited override so the guard allows in_progress -> cancelled
    perform set_config('app.config_change', p_id::text, true);
    for rec in
      select r.id, r.ref, r.requester_id, r.status::text as status
        from requests r
       where case p_kind
               when 'service' then r.service_id = p_id
               when 'form'    then r.form_version_id = p_id
               when 'sla'     then r.service_id in (select s.id from services s where s.sla_profile_id = p_id)
             end
         and r.status not in ('resolved', 'closed', 'cancelled')
    loop
      update requests set status = 'cancelled', updated_at = now() where id = rec.id;
      insert into request_events (request_id, actor_id, event_type, detail)
      values (rec.id, auth.uid(), 'status_changed',
              jsonb_build_object('from', rec.status, 'to', 'cancelled',
                                 'source', 'config_change', 'reason', p_note));
      insert into notifications (recipient_id, subject, body)
      values (rec.requester_id,
              'Request ' || rec.ref || ' was cancelled',
              'Your request ' || rec.ref || ' was cancelled because the service it used was changed. Reason: ' || p_note);
      v_affected := v_affected || rec.id;
    end loop;
    perform set_config('app.config_change', '', true);
  end if;
  -- finish_old / null: nothing closes (version pinning carries them)

  -- apply the action itself
  if v_action = 'retire' then
    if p_kind = 'service' then
      update services set is_active = false,
             retired_at = now(), retired_by = auth.uid(), retire_reason = p_note
       where id = p_id;
    elsif p_kind = 'form' then
      update form_versions set status = 'retired',
             retired_at = now(), retired_by = auth.uid(), retire_reason = p_note
       where id = p_id;
    else
      update sla_profiles set retired_at = now(), retired_by = auth.uid(), retire_reason = p_note
       where id = p_id;
    end if;
  elsif v_action = 'delete' then
    if p_kind = 'service' then delete from services where id = p_id;
    elsif p_kind = 'form' then delete from form_versions where id = p_id;
    else delete from sla_profiles where id = p_id;
    end if;
  end if;
  -- edit: the new-version write is the caller's (form/workflow builders); this
  -- RPC records it and resolves the in-flight requests.

  -- append-only audit row
  insert into config_changes (
    kind, target_id, target_code, action, from_version, to_version,
    impact, resolution, affected_request_ids, note, dept_id, actor_id
  ) values (
    p_kind, p_id, v_code, v_action,
    nullif(p_change->>'from_version', '')::int, nullif(p_change->>'to_version', '')::int,
    v_impact, p_resolution, v_affected, p_note, v_dept, auth.uid()
  ) returning id into v_change_id;

  return v_change_id;
end $$;

-- internal helpers are reachable only through the admin-gated RPCs above
-- (which run as the definer), never directly by an authenticated caller.
revoke all on function _config_change_target(text, uuid) from public;
revoke all on function _config_change_impact(text, uuid) from public;

revoke all on function preview_config_change(text, uuid, jsonb) from public;
revoke all on function apply_config_change(text, uuid, jsonb, text, text) from public;
grant execute on function preview_config_change(text, uuid, jsonb) to authenticated;
grant execute on function apply_config_change(text, uuid, jsonb, text, text) to authenticated;
