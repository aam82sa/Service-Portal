-- 00047 — SLA escalation must not mutate request status.
--
-- sla_check() used `update requests set status = 'escalated'`, which
-- requests_guard_update() rejects whenever the service's published workflow
-- does not include that transition — and one rejection aborted the whole
-- sweep. Escalation is now a marker, not a lifecycle move: the sweep stamps
-- escalated_at (+ escalation_note) and writes the sla_breached event, while
-- the request keeps its real workflow status. Each request's actions run in
-- their own exception block so a single failure can never abort the sweep.

alter table requests
  add column if not exists escalated_at timestamptz,
  add column if not exists escalation_note text;

create or replace function sla_check() returns int
language plpgsql security definer as $$
declare
  req record;
  rule record;
  hits int := 0;
  warn_at timestamptz;
  acted jsonb;
  v_roles jsonb;
begin
  if not exists (select 1 from feature_flags where key = 'sla_engine' and is_enabled) then
    return 0; -- engine dormant
  end if;

  for req in
    select * from requests
    where status not in ('resolved', 'closed', 'cancelled')
      and sla_resolution_due is not null
      and sla_paused_at is null
      and (sla_breached_at is null or sla_warned_at is null)
  loop
    begin -- one request's actions can never abort the sweep
      -- breach: past due, once (guarded by the stamp)
      if req.sla_breached_at is null and now() > req.sla_resolution_due then
        select * into rule from escalation_rules
        where trigger_on = 'sla_breached' and is_enabled
          and (dept is null or dept = req.dept)
          and (service_id is null or service_id = req.service_id)
        order by (service_id is not null)::int desc, (dept is not null)::int desc
        limit 1;

        v_roles := coalesce(rule.actions -> 'notify_roles', '[]'::jsonb);
        acted := jsonb_build_object(
          'due', req.sla_resolution_due,
          'notify_roles', v_roles,
          'priority_bumped', false, 'escalated', false);

        update requests set
          sla_breached_at = now(),
          sla_warned_at = coalesce(sla_warned_at, now())
        where id = req.id;

        if rule.id is not null and coalesce((rule.actions ->> 'bump_priority')::boolean, false)
           and req.priority <> 'P1' then
          update requests set priority = (case req.priority
            when 'P4' then 'P3' when 'P3' then 'P2' else 'P1' end)::priority
          where id = req.id;
          acted := jsonb_set(acted, '{priority_bumped}', 'true');
        end if;

        -- escalation marker: no status change, so the published-workflow
        -- guard never fires and the real lifecycle position is preserved
        if rule.id is not null and coalesce((rule.actions ->> 'escalate_status')::boolean, false) then
          update requests set
            escalated_at = coalesce(escalated_at, now()),
            escalation_note = coalesce(escalation_note,
              'SLA breached — escalated to ' ||
              coalesce(nullif(
                (select string_agg(replace(r.v, '_', ' '), ' + ')
                 from jsonb_array_elements_text(v_roles) as r(v)), ''), 'the team'))
          where id = req.id;
          acted := jsonb_set(acted, '{escalated}', 'true');
        end if;

        insert into request_events (request_id, actor_id, event_type, detail)
        values (req.id, null, 'sla_breached', acted);
        hits := hits + 1;

      -- warning: past 75% of the window, once
      elsif req.sla_warned_at is null then
        warn_at := req.created_at + (req.sla_resolution_due - req.created_at) * 0.75;
        if now() >= warn_at then
          select * into rule from escalation_rules
          where trigger_on = 'sla_warning' and is_enabled
            and (dept is null or dept = req.dept)
            and (service_id is null or service_id = req.service_id)
          order by (service_id is not null)::int desc, (dept is not null)::int desc
          limit 1;

          update requests set sla_warned_at = now() where id = req.id;
          insert into request_events (request_id, actor_id, event_type, detail)
          values (req.id, null, 'sla_warning', jsonb_build_object(
            'due', req.sla_resolution_due,
            'notify_roles', coalesce(rule.actions -> 'notify_roles', '[]'::jsonb)));
          hits := hits + 1;
        end if;
      end if;
    exception when others then
      raise warning 'sla_check: request % skipped — %', req.id, sqlerrm;
    end;
  end loop;
  return hits;
end $$;
