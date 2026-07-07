-- ABC Services Hub — audit coverage for the admin overview redesign (7b)
-- The audit log now surfaces USER and DELEG event types; roles, licenses and
-- settings (feature flags / page access) were already recorded. This adds the
-- missing writers: user created / enabled / disabled and delegation created.

create or replace function log_profile_audit() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    insert into admin_events (actor_id, area, action, detail)
    values (auth.uid(), 'users', 'created',
            jsonb_build_object('profile_id', new.id, 'upn', new.upn,
                               'name', new.display_name));
  elsif old.is_active is distinct from new.is_active then
    insert into admin_events (actor_id, area, action, detail)
    values (auth.uid(), 'users',
            case when new.is_active then 'enabled' else 'disabled' end,
            jsonb_build_object('profile_id', new.id, 'upn', new.upn,
                               'name', new.display_name));
  end if;
  return new;
end $$;

create trigger profiles_audit_ins after insert on profiles
  for each row execute function log_profile_audit();
create trigger profiles_audit_upd after update on profiles
  for each row when (old.is_active is distinct from new.is_active)
  execute function log_profile_audit();

-- Names are denormalized into detail so the log reads without joins even if
-- the delegation row is later deleted.
create or replace function log_delegation_created() returns trigger
language plpgsql security definer as $$
declare
  v_delegator text;
  v_delegate text;
begin
  select display_name into v_delegator from profiles where id = new.delegator_id;
  select display_name into v_delegate from profiles where id = new.delegate_id;
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'delegation', 'created',
          jsonb_build_object('delegation_id', new.id,
                             'delegator', v_delegator, 'delegate', v_delegate,
                             'starts_on', new.starts_on, 'ends_on', new.ends_on));
  return new;
end $$;

create trigger delegations_created_audit after insert on approval_delegations
  for each row execute function log_delegation_created();
