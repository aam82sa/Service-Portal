-- Demo/practice data: requests for every user across every active service,
-- covering all lifecycle statuses and priorities. Runs once (skips if the
-- table already holds substantial data).
do $$
declare
  statuses request_status[] := array[
    'new', 'triaged', 'in_progress', 'pending_requester',
    'resolved', 'closed', 'escalated', 'cancelled'
  ]::request_status[];
  prios priority[] := array['P3', 'P2', 'P4', 'P1']::priority[];
  requesters uuid[] := array[
    '11111111-1111-4111-8111-111111111101',  -- Rana
    '11111111-1111-4111-8111-111111111102',  -- Ahmed
    '11111111-1111-4111-8111-111111111103',  -- Latifa
    '11111111-1111-4111-8111-111111111104',  -- Aziz
    '11111111-1111-4111-8111-111111111105'   -- Dana
  ]::uuid[];
  agents uuid[] := array[
    '11111111-1111-4111-8111-111111111102',  -- Ahmed
    '11111111-1111-4111-8111-111111111103'   -- Latifa
  ]::uuid[];
  svc record;
  uid uuid;
  st request_status;
  i int := 0;
begin
  if (select count(*) from requests) > 25 then
    raise notice 'demo data skipped — requests table already populated';
    return;
  end if;
  -- dev demo data only makes sense where the early tester profiles exist
  -- (fresh local resets never saw those sign-ins)
  if not exists (select 1 from profiles where id = requesters[1]) then
    raise notice 'demo data skipped — tester profiles not present on this stack';
    return;
  end if;
  for svc in select id, name from services where is_active loop
    foreach uid in array requesters loop
      i := i + 1;
      st := statuses[1 + (i % 8)];
      insert into requests (service_id, dept, requester_id, assignee_id, status,
                            priority, title, payload, amount, created_at)
      values (
        svc.id, 'IT', uid,
        case when st = 'new' then null else agents[1 + (i % 2)] end,
        st,
        prios[1 + (i % 4)],
        svc.name || ' — practice record ' || i,
        jsonb_build_object('demo', true),
        case when i % 3 = 0 then 4000 + (i * 1750) else null end,
        now() - make_interval(days => (i % 21), hours => (i % 11))
      );
    end loop;
  end loop;
  raise notice 'inserted % demo requests', i;
end $$;
