-- Admin catalog v2, step 2 (run 00037 first): the Administration service
-- catalog (25 services, 6 categories), the data-driven Cybersecurity gate,
-- and role-based approval steps. Re-run safe.

-- ============ Schema: access gate + role-based steps ============
alter table services add column if not exists grants_system_access boolean not null default false;
alter table approvals add column if not exists approver_role platform_role;

-- ============ Chain generator: specificity wins + carries the role ============
-- Previously service-specific AND dept/platform-wide bands could match the
-- same request, colliding on unique (request, step). The most specific level
-- (service > department > platform) now supplies the whole chain, and each
-- step records which role must decide it.
create or replace function generate_doa_chain(
  p_subject_type text, p_subject_id uuid, p_dept dept_code,
  p_service uuid, p_amount numeric
) returns int language plpgsql security definer as $$
declare
  n int := 0;
  v_spec int;
begin
  -- fresh chain per submission; decision history lives in the event logs
  delete from approvals where subject_type = p_subject_type and subject_id = p_subject_id;
  select max(case when d.service_id is not null then 2
                  when d.dept is not null then 1 else 0 end)
  into v_spec
  from doa_matrix d
  where (d.dept is null or d.dept = p_dept)
    and (d.service_id is null or d.service_id = p_service)
    and coalesce(p_amount, 0) >= d.min_amount
    and (d.max_amount is null or coalesce(p_amount, 0) < d.max_amount);

  insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint, approver_role)
  select case when p_subject_type = 'request' then p_subject_id end,
         p_subject_type, p_subject_id, d.step_order, d.approver_hint, d.approver_role
  from doa_matrix d
  where (d.dept is null or d.dept = p_dept)
    and (d.service_id is null or d.service_id = p_service)
    and coalesce(p_amount, 0) >= d.min_amount
    and (d.max_amount is null or coalesce(p_amount, 0) < d.max_amount)
    and (case when d.service_id is not null then 2
              when d.dept is not null then 1 else 0 end) = v_spec
  order by d.step_order;
  get diagnostics n = row_count;
  return n;
end $$;

-- ============ The Cybersecurity gate (data-driven) ============
-- Any service flagged grants_system_access gets a final Cybersecurity step
-- appended to its chain — zero-config for tenants.
create or replace function create_approval_chain() returns trigger
language plpgsql security definer as $$
declare
  n int := 0;
begin
  if new.status = 'pending_approval' and old.status is distinct from new.status then
    n = generate_doa_chain('request', new.id, new.dept, new.service_id, new.amount);
    if n = 0 then
      insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint)
      values (new.id, 'request', new.id, 1, 'Line manager');
      n = 1;
    end if;
    if exists (select 1 from services s where s.id = new.service_id and s.grants_system_access) then
      insert into approvals (request_id, subject_type, subject_id, step_order, approver_hint, approver_role)
      select new.id, 'request', new.id, coalesce(max(a.step_order), 0) + 1, 'Cybersecurity', 'cybersecurity'
      from approvals a where a.subject_type = 'request' and a.subject_id = new.id;
      n = n + 1;
    end if;
    insert into request_events (request_id, actor_id, event_type, detail)
    values (new.id, auth.uid(), 'approval_requested',
            jsonb_build_object('steps', n, 'amount', new.amount));
  end if;
  return new;
end $$;

-- ============ Deciding: the step's role must decide it ============
create or replace function decide_approval(
  p_approval uuid, p_decision approval_decision, p_comment text default null
) returns void language plpgsql security definer as $$
declare
  a approvals%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;
  select * into a from approvals where id = p_approval for update;
  if not found or a.decision <> 'pending' then
    raise exception 'approval step is not pending';
  end if;
  if a.subject_type <> 'request' then
    raise exception 'project approvals are decided inside the PMO module';
  end if;
  if not has_role(coalesce(a.approver_role, 'approver')) then
    raise exception 'this step must be decided by %',
      case when a.approver_role is null or a.approver_role = 'approver'
           then 'an approver' else a.approver_role::text end;
  end if;
  if exists (
    select 1 from approvals
    where request_id = a.request_id and step_order < a.step_order and decision <> 'approved'
  ) then
    raise exception 'earlier steps in the chain are not approved yet';
  end if;

  update approvals
  set decision = p_decision, decided_at = now(), approver_id = auth.uid(), comment = p_comment
  where id = a.id;

  insert into request_events (request_id, actor_id, event_type, detail)
  values (a.request_id, auth.uid(), 'approval_decided',
          jsonb_build_object('step', a.step_order, 'decision', p_decision, 'comment', p_comment));

  if p_decision = 'rejected'
     or not exists (select 1 from approvals where request_id = a.request_id and decision = 'pending')
  then
    update requests set status = 'in_progress' where id = a.request_id;
  end if;
end $$;

-- Cybersecurity sees pending-approval requests and their chains, like approvers
drop policy if exists req_approver on requests;
create policy req_approver on requests for select to authenticated
  using ((has_role('approver') or has_role('cybersecurity')) and status = 'pending_approval');
drop policy if exists apr_read on approvals;
create policy apr_read on approvals for select to authenticated
  using (
    has_role('approver') or has_role('cybersecurity')
    or (subject_type = 'request' and exists (
      select 1 from requests r
      where r.id = request_id
        and (r.requester_id = auth.uid()
             or has_role('agent', r.dept) or has_role('team_lead', r.dept)
             or has_role('dept_admin', r.dept)
             or has_role('executive') or has_role('system_admin'))
    ))
  );
update page_access set allowed = array_append(allowed, 'cybersecurity')
where page = 'approvals' and not ('cybersecurity' = any(allowed));

-- ============ Cybersecurity test account (joins the 00035 matrix) ============
do $$
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444418',
    'authenticated', 'authenticated', 'cyber@dev.abccorp.com',
    crypt('AbcHub!2026', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Cyra Cybersecurity"}', now(), now(), '', '', '', '')
  on conflict (id) do nothing;
  insert into auth.identities (id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), '44444444-4444-4444-8444-444444444418',
    '44444444-4444-4444-8444-444444444418',
    '{"sub":"44444444-4444-4444-8444-444444444418","email":"cyber@dev.abccorp.com"}',
    'email', now(), now(), now())
  on conflict do nothing;
  insert into profiles (id, upn, display_name, is_active)
  values ('44444444-4444-4444-8444-444444444418', 'cyber@dev.abccorp.com', 'Cyra Cybersecurity', true)
  on conflict (id) do nothing;
  insert into role_assignments (profile_id, role)
  select '44444444-4444-4444-8444-444444444418', 'cybersecurity'
  where not exists (
    select 1 from role_assignments
    where profile_id = '44444444-4444-4444-8444-444444444418' and role = 'cybersecurity'
  );
end $$;

-- ============ IT catalog amendments (same rule) ============
-- Access-granting IT services pass the gate; AC-03 reset and AC-04 revocation
-- stay out — revocation reduces access and must never be slowed.
update services set grants_system_access = true
where dept = 'IT' and code in ('AC-01', 'AC-02', 'AC-06');

-- ============ Retire the placeholder Administration catalog ============
update services set is_active = false where dept = 'ADMIN' and code = 'TR';

-- ============ The catalog: 25 services, 6 categories ============
insert into services (dept, code, name, description, request_type, default_priority,
                      sla_response_minutes, sla_resolution_minutes, requires_approval,
                      grants_system_access, form_schema) values

-- —— TR · Travel & Transport ——
('ADMIN', 'TR-01', 'Business travel request', 'Flights, hotels and per-diem for business trips', 'request', 'P3', 480, 4320, true, false,
 '[{"key":"destination","label":"Destination","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"cost_center","label":"Cost center","type":"dropdown","options":["1000 — Corporate","2000 — Operations","3000 — Projects","4000 — Shared services"],"visible":true,"required":true,"width":"half"},
   {"key":"departure","label":"Departure","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"return","label":"Return","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"amount","label":"Estimated cost","type":"amount","visible":true,"required":true,"width":"half"},
   {"key":"purpose","label":"Purpose of travel","type":"longtext","visible":true,"required":true}]'),

('ADMIN', 'TR-02', 'Visa support letter', 'Introduction letter for embassy visa applications', 'request', 'P3', 480, 2880, false, false,
 '[{"key":"country","label":"Country / embassy","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"travel_date","label":"Travel date","type":"date","visible":true,"required":false,"width":"half"},
   {"key":"notes","label":"Notes","type":"longtext","visible":true,"required":false}]'),

('ADMIN', 'TR-03', 'Daily transport / taxi', 'Company transport or taxi voucher for business errands', 'request', 'P4', 240, 1440, true, false,
 '[{"key":"date_needed","label":"Date needed","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"pickup","label":"Pickup location","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"destination","label":"Destination","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"purpose","label":"Purpose","type":"text","visible":true,"required":false,"width":"half"}]'),

('ADMIN', 'TR-04', 'Expense claim', 'Reimbursement of business expenses', 'request', 'P3', 480, 7200, true, false,
 '[{"key":"expense_type","label":"Expense type","type":"dropdown","options":["Travel","Meals","Supplies","Communication","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"amount","label":"Amount","type":"amount","visible":true,"required":true,"width":"half"},
   {"key":"incurred_on","label":"Date incurred","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"description","label":"Description (receipts to be attached on fulfilment)","type":"longtext","visible":true,"required":true}]'),

-- —— FM · Facilities & Maintenance ——
('ADMIN', 'FM-01', 'Maintenance issue', 'Something is broken in the building — fast lane, no approval. Safety hazards are escalated to P1 by the facilities team.', 'incident', 'P2', 120, 1440, false, false,
 '[{"key":"location","label":"Location","type":"dropdown","options":["HQ — Ground floor","HQ — 1st floor","HQ — 2nd floor","Warehouse","Other site"],"visible":true,"required":true,"width":"half"},
   {"key":"issue_type","label":"Issue type","type":"dropdown","options":["AC / cooling","Electrical","Plumbing","Furniture","Doors / locks","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"description","label":"Describe the issue","type":"longtext","visible":true,"required":true}]'),

('ADMIN', 'FM-02', 'Office / desk move', 'Relocate a person or team within the building', 'request', 'P3', 480, 7200, true, false,
 '[{"key":"from_location","label":"From (floor / desk)","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"to_location","label":"To (floor / desk)","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"move_date","label":"Preferred move date","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"people","label":"Number of people","type":"number","visible":true,"required":true,"width":"half"},
   {"key":"notes","label":"Notes (equipment, special needs)","type":"longtext","visible":true,"required":false}]'),

('ADMIN', 'FM-03', 'Meeting room setup', 'Room arrangement, equipment and layout for a meeting', 'request', 'P4', 240, 1440, false, false,
 '[{"key":"room","label":"Room","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"date_time","label":"Date","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"attendees","label":"Attendees","type":"number","visible":true,"required":false,"width":"half"},
   {"key":"setup","label":"Setup needed","type":"longtext","visible":true,"required":false}]'),

('ADMIN', 'FM-04', 'Cleaning request', 'Ad-hoc cleaning beyond the regular schedule', 'request', 'P4', 240, 1440, false, false,
 '[{"key":"location","label":"Location","type":"text","visible":true,"required":true},
   {"key":"details","label":"Details","type":"longtext","visible":true,"required":false}]'),

-- —— GP · Access & Site Security ——
('ADMIN', 'GP-01', 'Visitor gate pass', 'Day pass for a visitor — you are the sponsor of record', 'request', 'P3', 120, 1440, false, false,
 '[{"key":"visitor_name","label":"Visitor name","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"company","label":"Company","type":"text","visible":true,"required":false,"width":"half"},
   {"key":"visit_date","label":"Visit date","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"purpose","label":"Purpose","type":"text","visible":true,"required":false,"width":"half"}]'),

('ADMIN', 'GP-02', 'Contractor site access', 'Multi-day site access for contractors. Includes Cybersecurity review while access requests are not yet field-conditional.', 'request', 'P3', 480, 2880, true, true,
 '[{"key":"contractor","label":"Contractor company","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"workers","label":"Number of workers","type":"number","visible":true,"required":true,"width":"half"},
   {"key":"access_from","label":"Access from","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"access_to","label":"Access to","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"network_access","label":"Network / system access needed?","type":"dropdown","options":["No","Yes"],"visible":true,"required":true,"width":"half"},
   {"key":"work_description","label":"Work description","type":"longtext","visible":true,"required":true}]'),

('ADMIN', 'GP-03', 'Employee badge (new / replacement)', 'Access badge for a new joiner or replacing a lost or damaged card', 'request', 'P4', 480, 2880, false, false,
 '[{"key":"badge_type","label":"Badge type","type":"dropdown","options":["New badge","Replacement — lost","Replacement — damaged"],"visible":true,"required":true,"width":"half"},
   {"key":"notes","label":"Notes","type":"text","visible":true,"required":false,"width":"half"}]'),

('ADMIN', 'GP-04', 'Parking permit', 'Assigned or temporary parking at company premises', 'request', 'P4', 480, 4320, false, false,
 '[{"key":"plate","label":"Vehicle plate","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"car","label":"Car make / model","type":"text","visible":true,"required":false,"width":"half"},
   {"key":"permit_type","label":"Permit type","type":"dropdown","options":["Employee","Visitor","Temporary"],"visible":true,"required":true,"width":"half"}]'),

-- —— DC · Documents & Letters ——
('ADMIN', 'DC-01', 'Official letter (bank / embassy / landlord)', 'Salary certificate or introduction letter, HR-verified', 'request', 'P3', 480, 2880, true, false,
 '[{"key":"letter_type","label":"Letter type","type":"dropdown","options":["Bank","Embassy","Landlord","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"addressed_to","label":"Addressed to","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"language","label":"Language","type":"dropdown","options":["Arabic","English","Both"],"visible":true,"required":true,"width":"half"},
   {"key":"notes","label":"Notes","type":"longtext","visible":true,"required":false}]'),

('ADMIN', 'DC-02', 'Document attestation', 'Stamping and attestation of company documents', 'request', 'P3', 480, 4320, false, false,
 '[{"key":"document_type","label":"Document type","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"copies","label":"Copies","type":"number","visible":true,"required":false,"width":"half"},
   {"key":"needed_by","label":"Needed by","type":"date","visible":true,"required":false,"width":"half"}]'),

('ADMIN', 'DC-03', 'Courier & mail dispatch', 'Send documents or parcels via courier', 'request', 'P4', 240, 1440, false, false,
 '[{"key":"package_type","label":"Package type","type":"dropdown","options":["Documents","Parcel"],"visible":true,"required":true,"width":"half"},
   {"key":"urgency","label":"Urgency","type":"dropdown","options":["Standard","Express"],"visible":true,"required":true,"width":"half"},
   {"key":"address","label":"Destination address","type":"longtext","visible":true,"required":true}]'),

('ADMIN', 'DC-04', 'Archive retrieval', 'Retrieve a document from the company archive', 'request', 'P4', 480, 2880, true, false,
 '[{"key":"reference","label":"Document reference","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"needed_by","label":"Needed by","type":"date","visible":true,"required":false,"width":"half"},
   {"key":"reason","label":"Reason","type":"longtext","visible":true,"required":false}]'),

-- —— GR · Government Relations ——
('ADMIN', 'GR-01', 'Iqama / work permit renewal support', 'Renewal processing for residence and work permits — HR-verified', 'request', 'P2', 240, 7200, false, false,
 '[{"key":"employee_name","label":"Employee name","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"iqama_expiry","label":"Iqama expiry","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"notes","label":"Notes","type":"longtext","visible":true,"required":false}]'),

('ADMIN', 'GR-02', 'Exit re-entry visa', 'Exit re-entry visa issuance for travel', 'request', 'P2', 240, 2880, true, false,
 '[{"key":"visa_type","label":"Visa type","type":"dropdown","options":["Single","Multiple"],"visible":true,"required":true,"width":"half"},
   {"key":"travel_date","label":"Travel date","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"return_date","label":"Return date","type":"date","visible":true,"required":false,"width":"half"},
   {"key":"notes","label":"Notes","type":"text","visible":true,"required":false,"width":"half"}]'),

('ADMIN', 'GR-03', 'Government portal transaction (Qiwa, Muqeem, GOSI…)', 'Transactions on government platforms handled by Government Relations', 'request', 'P3', 480, 4320, false, false,
 '[{"key":"portal","label":"Portal","type":"dropdown","options":["Qiwa","Muqeem","GOSI","Absher Business","Mudad","Balady","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"transaction","label":"Transaction needed","type":"longtext","visible":true,"required":true}]'),

('ADMIN', 'GR-04', 'Chamber of Commerce attestation', 'Attestation of documents at the Chamber of Commerce', 'request', 'P3', 480, 4320, false, false,
 '[{"key":"document_type","label":"Document type","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"copies","label":"Copies","type":"number","visible":true,"required":false,"width":"half"},
   {"key":"needed_by","label":"Needed by","type":"date","visible":true,"required":false,"width":"half"}]'),

-- —— OS · Office Services ——
('ADMIN', 'OS-01', 'Business cards & stationery', 'Printed business cards, letterhead and stamps', 'request', 'P4', 480, 7200, true, false,
 '[{"key":"item","label":"Item","type":"dropdown","options":["Business cards","Letterhead","Envelopes","Stamps","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"quantity","label":"Quantity","type":"number","visible":true,"required":true,"width":"half"},
   {"key":"details","label":"Details (name / title as it should appear)","type":"longtext","visible":true,"required":false}]'),

('ADMIN', 'OS-02', 'Office supplies', 'Standard office supplies from the stock catalog', 'request', 'P4', 480, 4320, false, false,
 '[{"key":"items","label":"Items needed","type":"longtext","visible":true,"required":true},
   {"key":"delivery_location","label":"Deliver to","type":"text","visible":true,"required":false}]'),

('ADMIN', 'OS-03', 'Catering / hospitality', 'Catering for meetings and guests', 'request', 'P3', 480, 2880, true, false,
 '[{"key":"event_date","label":"Event date","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"attendees","label":"Attendees","type":"number","visible":true,"required":true,"width":"half"},
   {"key":"amount","label":"Estimated cost","type":"amount","visible":true,"required":false,"width":"half"},
   {"key":"requirements","label":"Requirements","type":"longtext","visible":true,"required":false}]'),

('ADMIN', 'OS-04', 'Event support', 'Logistics and setup for company events', 'request', 'P3', 480, 7200, true, false,
 '[{"key":"event_name","label":"Event","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"event_date","label":"Date","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"amount","label":"Estimated budget","type":"amount","visible":true,"required":false,"width":"half"},
   {"key":"support","label":"Support needed","type":"longtext","visible":true,"required":true}]'),

-- —— SA · System Access (cross-department flagship) ——
('ADMIN', 'SA-01', 'System access request (Admin-owned systems)', 'Access to Administration-owned systems. Manager approval, then Cybersecurity, then IT implements (manual handoff until orchestration lands).', 'request', 'P3', 240, 4320, true, true,
 '[{"key":"system","label":"System","type":"dropdown","options":["Facilities system","Fleet system","Document archive","Visitor management","Other Admin system"],"visible":true,"required":true,"width":"half"},
   {"key":"access_level","label":"Access level","type":"dropdown","options":["Read","Read / write","Admin"],"visible":true,"required":true,"width":"half"},
   {"key":"duration","label":"Duration","type":"dropdown","options":["Permanent","Temporary"],"visible":true,"required":true,"width":"half"},
   {"key":"end_date","label":"End date (required if temporary)","type":"date","visible":true,"required":false,"width":"half"},
   {"key":"justification","label":"Business justification","type":"longtext","visible":true,"required":true}]')

on conflict (dept, code) do nothing;

-- ============ DoA wiring (service level beats the platform bands) ============
do $$
declare
  v_tr1 uuid; v_fm2 uuid; v_gp2 uuid; v_dc1 uuid; v_dc4 uuid; v_sa1 uuid;
begin
  select id into v_tr1 from services where dept = 'ADMIN' and code = 'TR-01';
  select id into v_fm2 from services where dept = 'ADMIN' and code = 'FM-02';
  select id into v_gp2 from services where dept = 'ADMIN' and code = 'GP-02';
  select id into v_dc1 from services where dept = 'ADMIN' and code = 'DC-01';
  select id into v_dc4 from services where dept = 'ADMIN' and code = 'DC-04';
  select id into v_sa1 from services where dept = 'ADMIN' and code = 'SA-01';

  insert into doa_matrix (dept, service_id, min_amount, max_amount, step_order, approver_hint) values
    -- TR-01: manager below Tier 1; full chain at >= 25k SAR
    ('ADMIN', v_tr1, 0, 25000, 1, 'Line manager'),
    ('ADMIN', v_tr1, 25000, null, 1, 'Line manager'),
    ('ADMIN', v_tr1, 25000, null, 2, 'Department head'),
    ('ADMIN', v_tr1, 25000, null, 3, 'Executive (Tier 1 DoA)'),
    -- FM-02: manager, then the facilities lead
    ('ADMIN', v_fm2, 0, null, 1, 'Line manager'),
    ('ADMIN', v_fm2, 0, null, 2, 'Facilities lead'),
    -- GP-02: facilities lead (Cybersecurity appended by the gate)
    ('ADMIN', v_gp2, 0, null, 1, 'Facilities lead'),
    -- DC-01: HR / Admin verification
    ('ADMIN', v_dc1, 0, null, 1, 'HR / Admin verification'),
    -- DC-04: the document owner decides
    ('ADMIN', v_dc4, 0, null, 1, 'Document owner'),
    -- SA-01: manager first (Cybersecurity appended by the gate)
    ('ADMIN', v_sa1, 0, null, 1, 'Line manager')
  on conflict (dept, service_id, min_amount, step_order) do nothing;
end $$;
-- TR-03/TR-04, GR-02, OS-01, OS-03, OS-04 intentionally have no service rows:
-- the platform-wide DoA bands already deliver "manager, escalating by amount".
