-- 00054 — auto-assignment (SPRINT3 branch 2): per-team strategy applied
-- right after routing resolves the team on submit. round_robin cycles
-- active members (least-recently-assigned first, so it needs no pointer
-- state); load_based picks the member with the fewest open requests. Both
-- skip inactive profiles and anyone out-of-office (an active row in
-- approval_delegations = OOO, reusing the existing delegation model).
-- 'none' leaves the request for officers to claim.

alter table teams add column if not exists assignment_strategy text not null default 'none'
  check (assignment_strategy in ('none', 'round_robin', 'load_based'));

-- ============ member picker ============
create or replace function auto_assign_member(p_team uuid) returns uuid
language plpgsql stable security definer as $$
declare
  strat text;
  who uuid;
begin
  select assignment_strategy into strat from teams where id = p_team;
  if strat is null or strat = 'none' then return null; end if;

  if strat = 'round_robin' then
    -- least recently assigned active member first -> natural cycle
    select tm.profile_id into who
    from team_members tm
    join profiles p on p.id = tm.profile_id and p.is_active
    where tm.team_id = p_team
      and not exists (
        select 1 from approval_delegations d
        where d.delegator_id = tm.profile_id
          and current_date between d.starts_on and d.ends_on
      )
    order by (
      select max(r.created_at) from requests r
      where r.assignee_id = tm.profile_id and r.team_id = p_team
    ) asc nulls first, tm.profile_id
    limit 1;
  elsif strat = 'load_based' then
    select tm.profile_id into who
    from team_members tm
    join profiles p on p.id = tm.profile_id and p.is_active
    where tm.team_id = p_team
      and not exists (
        select 1 from approval_delegations d
        where d.delegator_id = tm.profile_id
          and current_date between d.starts_on and d.ends_on
      )
    order by (
      select count(*) from requests r
      where r.assignee_id = tm.profile_id
        and r.status not in ('resolved', 'closed', 'cancelled')
    ) asc, tm.profile_id
    limit 1;
  end if;
  return who;
end $$;

-- ============ apply on submit, after routing ============
-- BEFORE INSERT; the name sorts after requests_route_team so the team is
-- already resolved when this fires.
create or replace function requests_autoassign_fn() returns trigger
language plpgsql security definer as $$
begin
  if new.assignee_id is null and new.team_id is not null then
    new.assignee_id = auto_assign_member(new.team_id);
  end if;
  return new;
end $$;

drop trigger if exists requests_run_autoassign on requests;
create trigger requests_run_autoassign
  before insert on requests
  for each row execute function requests_autoassign_fn();

-- insert-time assignments are audit-visible like any other assignment
create or replace function requests_autoassign_log_fn() returns trigger
language plpgsql security definer as $$
begin
  if new.assignee_id is not null then
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.id, null, 'assigned',
            jsonb_build_object(
              'assignee_id', new.assignee_id,
              'to', (select display_name from profiles where id = new.assignee_id),
              'by', 'auto-assignment',
              'strategy', (select assignment_strategy from teams where id = new.team_id)));
  end if;
  return null;
end $$;

drop trigger if exists requests_run_autoassign_log on requests;
create trigger requests_run_autoassign_log
  after insert on requests
  for each row execute function requests_autoassign_log_fn();
