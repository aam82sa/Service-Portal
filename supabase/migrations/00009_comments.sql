-- Comments are immutable request events, written via a guarded RPC.
create or replace function add_comment(p_request uuid, p_body text)
returns void language plpgsql security definer as $$
declare
  r requests%rowtype;
begin
  select * into r from requests where id = p_request;
  if not found then
    raise exception 'unknown request';
  end if;
  if not (r.requester_id = auth.uid()
          or has_role('agent', r.dept) or has_role('team_lead', r.dept)
          or has_role('dept_admin', r.dept) or has_role('system_admin')) then
    raise exception 'not allowed to comment on this request';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'comment is empty';
  end if;
  insert into request_events (request_id, actor_id, event_type, detail)
  values (p_request, auth.uid(), 'comment', jsonb_build_object('body', p_body));
end $$;
