-- 00059 — internal notes (UX branch 7): staff can leave comments the
-- requester never sees. add_comment() gains p_internal (staff only) and
-- the events read policy hides internal comments from non-staff.

-- the old 2-arg signature must go, or 2-arg calls become ambiguous
drop function if exists add_comment(uuid, text);

create or replace function add_comment(p_request uuid, p_body text, p_internal boolean default false)
returns void language plpgsql security definer as $$
declare
  r requests%rowtype;
  is_staff boolean;
begin
  if has_role('system_admin') then
    raise exception 'system administrators manage the system and cannot participate in requests';
  end if;
  select * into r from requests where id = p_request;
  if not found then
    raise exception 'unknown request';
  end if;
  is_staff := has_role('agent', r.dept) or has_role('team_lead', r.dept)
              or has_role('dept_admin', r.dept) or has_role('dept_head', r.dept);
  if not (r.requester_id = auth.uid() or is_staff) then
    raise exception 'not allowed to comment on this request';
  end if;
  if p_internal and not is_staff then
    raise exception 'internal notes are for department staff';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'comment is empty';
  end if;
  insert into request_events (request_id, actor_id, event_type, detail)
  values (p_request, auth.uid(), 'comment',
          jsonb_build_object('body', p_body, 'internal', p_internal));
end $$;

-- events stay visible as before, EXCEPT internal comments: staff/oversight only
drop policy if exists ev_read on request_events;
create policy ev_read on request_events for select to authenticated
  using (
    exists (
      select 1 from requests r
      where r.id = request_id
        and (r.requester_id = auth.uid()
             or has_role('agent', r.dept) or has_role('team_lead', r.dept)
             or has_role('dept_admin', r.dept)
             or has_role('executive') or has_role('system_admin'))
    )
    and (
      not (event_type = 'comment' and coalesce((detail ->> 'internal')::boolean, false))
      or exists (
        select 1 from requests r2
        where r2.id = request_id
          and (has_role('agent', r2.dept) or has_role('team_lead', r2.dept)
               or has_role('dept_admin', r2.dept) or has_role('dept_head', r2.dept)
               or has_role('executive') or has_role('system_admin'))
      )
    )
  );
