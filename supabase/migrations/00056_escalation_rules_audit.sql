-- 00056 — escalation rules UI (SPRINT3 branch 4): the admin console gets
-- CRUD over escalation_rules (00043 shape; the sla_check sweep consumes
-- them, 00047 semantics — "escalate" sets the escalated_at marker, never
-- status). This migration adds the audit trail for those edits; the
-- screen itself lives in the SLA console.

create or replace function log_escalation_rule_change() returns trigger
language plpgsql security definer as $$
declare
  act text := lower(tg_op);
  row_data jsonb;
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
  else
    row_data := to_jsonb(new);
  end if;
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'escalation_rules',
          case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end,
          row_data - 'created_at');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists escalation_rules_audit on escalation_rules;
create trigger escalation_rules_audit
  after insert or update or delete on escalation_rules
  for each row execute function log_escalation_rule_change();
