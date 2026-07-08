-- Demo requests for the business requester accounts (biz1–biz4): one of
-- every type and lifecycle state, with real event history and approval
-- chains, so the portal, queues, approvals and the lifecycle bar all show
-- live-looking data. Skips itself entirely if already applied.

do $$
declare
  v_basma  uuid := '44444444-4444-4444-8444-444444444414';
  v_bandar uuid := '44444444-4444-4444-8444-444444444415';
  v_dana   uuid := '44444444-4444-4444-8444-444444444416';
  v_faisal uuid := '44444444-4444-4444-8444-444444444417';
  v_adel   uuid := '44444444-4444-4444-8444-444444444410'; -- IT agent
  v_afnan  uuid := '44444444-4444-4444-8444-444444444411'; -- Admin officer
  v_amjad  uuid := '44444444-4444-4444-8444-444444444412'; -- Procurement officer
  v_hatem  uuid := '44444444-4444-4444-8444-444444444403'; -- Admin dept head
  v_huda   uuid := '44444444-4444-4444-8444-444444444402'; -- IT dept head
  svc uuid;
  r record;
begin
  if exists (select 1 from requests where id = '66666666-6666-4666-8666-666666666601') then
    raise notice 'demo requests already seeded — nothing to do';
    return;
  end if;

  -- —— helper-free inserts; ids are fixed so the seed is self-guarding ——

  -- 1 · Basma · SA-01 pending approval, manager approved, Cybersecurity next
  select id into svc from services where dept = 'ADMIN' and code = 'SA-01';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, created_at)
  values ('66666666-6666-4666-8666-666666666601', svc, 'ADMIN', v_basma, v_afnan, 'pending_approval',
          'Access to the fleet system', '{"system":"Fleet system","access_level":"Read / write","duration":"Permanent"}',
          now() - interval '3 days');
  insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint, approver_role, decision, decided_at, approver_id) values
    ('66666666-6666-4666-8666-666666666601', 'request', '66666666-6666-4666-8666-666666666601', 1, 'Line manager', 'approver', 'approved', now() - interval '1 day', v_hatem),
    ('66666666-6666-4666-8666-666666666601', 'request', '66666666-6666-4666-8666-666666666601', 2, 'Cybersecurity', 'cybersecurity', 'pending', null, null);

  -- 2 · Basma · IT incident being worked
  select id into svc from services where dept = 'IT' and code = 'IN-01';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, created_at)
  values ('66666666-6666-4666-8666-666666666602', svc, 'IT', v_basma, v_adel, 'in_progress',
          'Laptop overheats and shuts down', '{"impact":"Just me","urgency":"Work degraded","description":"Shuts down after ~20 minutes of use."}',
          now() - interval '26 hours');

  -- 3 · Basma · visitor pass, resolved
  select id into svc from services where dept = 'ADMIN' and code = 'GP-01';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, created_at)
  values ('66666666-6666-4666-8666-666666666603', svc, 'ADMIN', v_basma, v_afnan, 'resolved',
          'Visitor pass for the external auditor', '{"visitor_name":"Omar Qahtani","company":"Audit partners","visit_date":"2026-07-09"}',
          now() - interval '2 days');

  -- 4 · Bandar · 32k workstation, Tier-1 DoA chain in progress
  select id into svc from services where dept = 'IT' and code = 'HW-01';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, amount, created_at)
  values ('66666666-6666-4666-8666-666666666604', svc, 'IT', v_bandar, v_adel, 'pending_approval',
          'CAD workstation for the design team', '{"asset_type":"Desktop","model":"HP Z6 G5","justification":"Rendering workloads"}',
          32000, now() - interval '4 days');
  insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint, approver_role, decision, decided_at, approver_id) values
    ('66666666-6666-4666-8666-666666666604', 'request', '66666666-6666-4666-8666-666666666604', 1, 'Line manager', 'approver', 'approved', now() - interval '2 days', v_huda),
    ('66666666-6666-4666-8666-666666666604', 'request', '66666666-6666-4666-8666-666666666604', 2, 'Department head', 'approver', 'pending', null, null),
    ('66666666-6666-4666-8666-666666666604', 'request', '66666666-6666-4666-8666-666666666604', 3, 'Executive (Tier 1 DoA)', 'approver', 'pending', null, null);

  -- 5 · Bandar · maintenance incident, escalated (overdue)
  select id into svc from services where dept = 'ADMIN' and code = 'FM-01';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, created_at)
  values ('66666666-6666-4666-8666-666666666605', svc, 'ADMIN', v_bandar, v_afnan, 'escalated',
          'AC failure in the archive room', '{"location":"HQ — Ground floor","issue_type":"AC / cooling","description":"Temperature rising near the archive shelves."}',
          now() - interval '2 days');

  -- 6 · Bandar · official letter, closed end-to-end
  select id into svc from services where dept = 'ADMIN' and code = 'DC-01';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, created_at)
  values ('66666666-6666-4666-8666-666666666606', svc, 'ADMIN', v_bandar, v_afnan, 'closed',
          'Salary letter for the bank', '{"letter_type":"Bank","addressed_to":"Saudi National Bank","language":"Arabic"}',
          now() - interval '8 days');
  insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint, approver_role, decision, decided_at, approver_id) values
    ('66666666-6666-4666-8666-666666666606', 'request', '66666666-6666-4666-8666-666666666606', 1, 'HR / Admin verification', 'approver', 'approved', now() - interval '6 days', v_hatem);

  -- 7 · Dana · ERP access change, Cybersecurity gate mid-flow (IT side)
  select id into svc from services where dept = 'IT' and code = 'AC-02';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, created_at)
  values ('66666666-6666-4666-8666-666666666607', svc, 'IT', v_dana, v_adel, 'pending_approval',
          'ERP write access for the finance module', '{"system":"ERP","access_level":"Read / write","duration":"Permanent","justification":"Month-end postings."}',
          now() - interval '2 days');
  insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint, approver_role, decision, decided_at, approver_id) values
    ('66666666-6666-4666-8666-666666666607', 'request', '66666666-6666-4666-8666-666666666607', 1, 'Line manager', 'approver', 'approved', now() - interval '1 day', v_huda),
    ('66666666-6666-4666-8666-666666666607', 'request', '66666666-6666-4666-8666-666666666607', 2, 'Cybersecurity', 'cybersecurity', 'pending', null, null);

  -- 8 · Dana · office supplies, waiting on the requester
  select id into svc from services where dept = 'ADMIN' and code = 'OS-02';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, created_at)
  values ('66666666-6666-4666-8666-666666666608', svc, 'ADMIN', v_dana, v_afnan, 'pending_requester',
          'Office supplies for the new wing', '{"items":"Whiteboards, markers, A4 paper","delivery_location":"2nd floor"}',
          now() - interval '3 days');

  -- 9 · Dana · meeting room setup, simple no-approval flow in progress
  select id into svc from services where dept = 'ADMIN' and code = 'FM-03';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, created_at)
  values ('66666666-6666-4666-8666-666666666609', svc, 'ADMIN', v_dana, v_afnan, 'in_progress',
          'Board room setup for Sunday', '{"room":"Board room","date_time":"2026-07-12","attendees":"14"}',
          now() - interval '20 hours');

  -- 10 · Faisal · travel request, manager approval pending
  select id into svc from services where dept = 'ADMIN' and code = 'TR-01';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, amount, created_at)
  values ('66666666-6666-4666-8666-666666666610', svc, 'ADMIN', v_faisal, v_afnan, 'pending_approval',
          'Business travel to the Jeddah conference', '{"destination":"Jeddah","departure":"2026-07-20","return":"2026-07-23","purpose":"Logistics conference."}',
          7500, now() - interval '1 day');
  insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint, approver_role, decision, decided_at, approver_id) values
    ('66666666-6666-4666-8666-666666666610', 'request', '66666666-6666-4666-8666-666666666610', 1, 'Line manager', 'approver', 'pending', null, null);

  -- 11 · Faisal · procurement purchase order, untouched in the queue
  select id into svc from services where dept = 'PROC' and name = 'Purchase order request' limit 1;
  if svc is not null then
    insert into requests (id, service_id, dept, requester_id, status, title, payload, amount, created_at)
    values ('66666666-6666-4666-8666-666666666611', svc, 'PROC', v_faisal, 'new',
            'Ergonomic chairs for the design studio', '{"item":"12 × ergonomic chairs","justification":"Replacement of worn seating"}',
            14400, now() - interval '5 hours');
  end if;

  -- 12 · Faisal · security incident (restricted visibility)
  select id into svc from services where dept = 'IT' and code = 'IN-03';
  insert into requests (id, service_id, dept, requester_id, status, title, payload, created_at)
  values ('66666666-6666-4666-8666-666666666612', svc, 'IT', v_faisal, 'new',
          'Suspicious email asking for my password', '{"incident_type":"Phishing email","details":"Email claims to be from IT support with a login link."}',
          now() - interval '3 hours');

  -- 13 · Faisal · onboarding, triaged
  select id into svc from services where dept = 'IT' and code = 'EL-01';
  insert into requests (id, service_id, dept, requester_id, assignee_id, status, title, payload, created_at)
  values ('66666666-6666-4666-8666-666666666613', svc, 'IT', v_faisal, v_adel, 'triaged',
          'IT onboarding — new logistics analyst', '{"employee_name":"Noura Alshehri","department":"Logistics","start_date":"2026-07-15","hardware_profile":"Standard laptop"}',
          now() - interval '10 hours');

  -- —— event history: the lifecycle bar reads completion times from these ——
  for r in select * from requests where id::text like '66666666-%' loop
    -- the insert trigger already logged 'created' with a null actor
    update request_events set actor_id = r.requester_id
    where request_id = r.id and event_type = 'created';

    if r.status <> 'new' then
      insert into request_events (request_id, actor_id, event_type, detail, created_at)
      values (r.id, r.assignee_id, 'status_changed',
              jsonb_build_object('from', 'new', 'to', 'triaged'), r.created_at + interval '2 hours');
    end if;
    if r.status not in ('new', 'triaged') then
      insert into request_events (request_id, actor_id, event_type, detail, created_at)
      values (r.id, r.assignee_id, 'status_changed',
              jsonb_build_object('from', 'triaged', 'to', 'in_progress'), r.created_at + interval '5 hours');
    end if;
    if r.status = 'pending_approval' then
      insert into request_events (request_id, actor_id, event_type, detail, created_at) values
        (r.id, r.assignee_id, 'status_changed',
         jsonb_build_object('from', 'in_progress', 'to', 'pending_approval'), r.created_at + interval '7 hours'),
        (r.id, r.assignee_id, 'approval_requested',
         jsonb_build_object('steps', (select count(*) from approvals a where a.request_id = r.id), 'amount', r.amount),
         r.created_at + interval '7 hours');
    end if;
    if r.status in ('pending_requester', 'escalated') then
      insert into request_events (request_id, actor_id, event_type, detail, created_at)
      values (r.id, r.assignee_id, 'status_changed',
              jsonb_build_object('from', 'in_progress', 'to', r.status), r.created_at + interval '9 hours');
    end if;
    if r.status in ('resolved', 'closed') then
      insert into request_events (request_id, actor_id, event_type, detail, created_at)
      values (r.id, r.assignee_id, 'status_changed',
              jsonb_build_object('from', 'in_progress', 'to', 'resolved'), r.created_at + interval '30 hours');
    end if;
    if r.status = 'closed' then
      insert into request_events (request_id, actor_id, event_type, detail, created_at)
      values (r.id, r.requester_id, 'status_changed',
              jsonb_build_object('from', 'resolved', 'to', 'closed'), r.created_at + interval '3 days');
    end if;
  end loop;

  -- decided approval steps appear in the timeline too
  insert into request_events (request_id, actor_id, event_type, detail, created_at)
  select a.request_id, a.approver_id, 'approval_decided',
         jsonb_build_object('step', a.step_order, 'decision', a.decision),
         a.decided_at
  from approvals a
  where a.request_id::text like '66666666-%' and a.decided_at is not null;

  -- SLA windows anchored to the demo timestamps instead of seed time
  update requests req
  set sla_response_due = req.created_at + make_interval(mins => s.sla_response_minutes),
      sla_resolution_due = req.created_at + make_interval(mins => s.sla_resolution_minutes)
  from services s
  where s.id = req.service_id and req.id::text like '66666666-%';

  raise notice 'seeded 13 demo requests across biz1–biz4';
end $$;
