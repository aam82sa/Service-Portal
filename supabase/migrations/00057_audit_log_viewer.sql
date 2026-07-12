-- 00057 — audit log viewer (SPRINT3 branch 5): one read-only RPC over the
-- three existing audit streams (admin_events, request_events,
-- letter_events). No new audit data — this only surfaces what exists.
--
-- Access: system_admin sees everything; a dept_admin sees their own
-- department's request/letter events only (admin_events are global
-- platform config, so they stay system_admin-only).

create or replace function audit_log_entries(
  p_source text default null,                -- 'admin' | 'request' | 'letter' | null = all
  p_actor uuid default null,
  p_area text default null,                  -- admin_events.area / event_type for the others
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_ref text default null,                   -- request REF / letter ref, exact or partial
  p_limit int default 50,
  p_offset int default 0
) returns table (
  source text,
  event_id bigint,
  created_at timestamptz,
  actor_name text,
  area text,
  action text,
  ref text,
  detail jsonb
) language plpgsql stable security definer as $$
declare
  is_sys boolean := has_role('system_admin');
begin
  if not is_sys and not exists (
    select 1 from role_assignments
    where profile_id = auth.uid() and role in ('dept_admin', 'dept_head')
  ) then
    raise exception 'the audit log is for system and department admins';
  end if;

  return query
  with scoped as (
    select 'admin'::text as src, ae.id as eid, ae.created_at as at,
           ae.actor_id, ae.area as ar, ae.action as act,
           coalesce(ae.detail ->> 'ref', ae.detail ->> 'service', ae.detail ->> 'key') as rf,
           ae.detail as det
    from admin_events ae
    where is_sys

    union all
    select 'request', re.id, re.created_at, re.actor_id,
           r.dept::text, re.event_type, r.ref, re.detail
    from request_events re
    join requests r on r.id = re.request_id
    where is_sys or exists (
      select 1 from role_assignments ra
      where ra.profile_id = auth.uid()
        and ra.role in ('dept_admin', 'dept_head') and ra.dept = r.dept
    )

    union all
    select 'letter', le.id, le.created_at, le.actor_id,
           l.dept::text, le.event_type, coalesce(l.ref_ours, l.ref_theirs, l.subject), le.detail
    from letter_events le
    join letters l on l.id = le.letter_id
    where is_sys or exists (
      select 1 from role_assignments ra
      where ra.profile_id = auth.uid()
        and ra.role in ('dept_admin', 'dept_head') and ra.dept = l.dept
    )
  )
  select s.src, s.eid, s.at,
         coalesce(p.display_name, 'System') as actor_name,
         s.ar, s.act, s.rf, s.det
  from scoped s
  left join profiles p on p.id = s.actor_id
  where (p_source is null or s.src = p_source)
    and (p_actor is null or s.actor_id = p_actor)
    and (p_area is null or s.ar = p_area or s.act = p_area)
    and (p_from is null or s.at >= p_from)
    and (p_to is null or s.at < p_to)
    and (p_ref is null or s.rf ilike '%' || p_ref || '%')
  order by s.at desc, s.eid desc
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;
