-- ABC Services Hub — IT Service Catalog v2 (spec v2, Phase 1)
-- Three schema changes + the full 24-service IT catalog seeded as a tenant
-- template. Engine features (conditional rules, orchestration, priority
-- matrix, picker fields, date-driven SLA) are Phase 2 — the catalog works
-- without them. Every statement is re-run safe.

-- ============ Schema change 1: incident vs request ============
do $$ begin
  create type request_type as enum ('incident', 'request');
exception when duplicate_object then null; end $$;

alter table services add column if not exists request_type request_type not null default 'request';
-- Per-service defaults the seed needs a home for: default priority and
-- restricted-visibility marking (inherited by requests on insert).
alter table services add column if not exists default_priority priority not null default 'P3';
alter table services add column if not exists is_restricted boolean not null default false;

-- ============ Schema change 2: request hierarchy ============
alter table requests add column if not exists parent_request_id uuid references requests(id);
create index if not exists requests_parent_idx on requests (parent_request_id);

-- Requester of a parent can read its children. Self-referencing policies on
-- the same table recurse under RLS, so the lookup is a definer function.
create or replace function req_is_parent_requester(p_parent uuid) returns boolean
language sql stable security definer as $$
  select exists (select 1 from requests where id = p_parent and requester_id = auth.uid())
$$;
drop policy if exists req_child_of_mine on requests;
create policy req_child_of_mine on requests for select to authenticated
  using (parent_request_id is not null and req_is_parent_requester(parent_request_id));

-- ============ Schema change 3: restricted visibility ============
alter table requests add column if not exists restricted boolean not null default false;

-- Restricted requests (security incidents): visible to the requester
-- (req_own), the assignee, and IT leadership — not the whole department queue.
drop policy if exists req_dept_scope on requests;
create policy req_dept_scope on requests for select using (
  case when restricted then
    assignee_id = auth.uid()
    or has_role('team_lead', dept) or has_role('dept_head', dept)
    or has_role('system_admin')
  else
    has_role('agent', dept) or has_role('team_lead', dept)
    or has_role('dept_admin', dept)
    or has_role('executive') or has_role('system_admin')
  end
);

drop policy if exists req_agent_update on requests;
create policy req_agent_update on requests for update to authenticated
  using (
    (not restricted and (has_role('agent', dept) or has_role('team_lead', dept) or has_role('dept_admin', dept)))
    or (restricted and (assignee_id = auth.uid() or has_role('team_lead', dept)
                        or has_role('dept_head', dept) or has_role('system_admin')))
  )
  with check (
    (not restricted and (has_role('agent', dept) or has_role('team_lead', dept) or has_role('dept_admin', dept)))
    or (restricted and (assignee_id = auth.uid() or has_role('team_lead', dept)
                        or has_role('dept_head', dept) or has_role('system_admin')))
  );

-- Requests inherit the service's default priority and restricted flag.
create or replace function requests_inherit_service_defaults() returns trigger
language plpgsql security definer as $$
declare
  s services%rowtype;
begin
  select * into s from services where id = new.service_id;
  if s.is_restricted then
    new.restricted = true;
  end if;
  if new.priority = 'P3' then                -- requesters cannot set priority
    new.priority = s.default_priority;
  end if;
  return new;
end $$;
drop trigger if exists requests_service_defaults on requests;
create trigger requests_service_defaults before insert on requests
  for each row execute function requests_inherit_service_defaults();

-- ============ Retire the placeholder IT catalog ============
update services set is_active = false where dept = 'IT' and code in ('HW', 'AC');

-- ============ The catalog: 24 services, 6 categories ============
-- SLA minutes follow the existing convention (h*60, d*1440), computed against
-- business hours by the SLA engine. Incidents never require approval.
insert into services (dept, code, name, description, request_type, default_priority,
                      sla_response_minutes, sla_resolution_minutes, requires_approval,
                      is_restricted, form_schema) values

-- —— Category 1 · Access & Identity (AC) ——
('IT', 'AC-01', 'New user account', 'Domain, email and core-system account for a new colleague', 'request', 'P3', 240, 1440, true, false,
 '[{"key":"employee_name","label":"Employee name","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"department","label":"Department","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"job_title","label":"Job title","type":"text","visible":true,"required":false,"width":"half"},
   {"key":"start_date","label":"Start date","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"systems","label":"Systems needed","type":"longtext","visible":true,"required":false}]'),

('IT', 'AC-02', 'Permission / access change', 'Change access to a system, share or application', 'request', 'P3', 240, 1440, true, false,
 '[{"key":"system","label":"System","type":"dropdown","options":["ERP","Email / M365","File shares","GIS","HR system","Finance system","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"access_level","label":"Access level","type":"dropdown","options":["Read","Read / write","Admin"],"visible":true,"required":true,"width":"half"},
   {"key":"duration","label":"Duration","type":"dropdown","options":["Permanent","Temporary"],"visible":true,"required":true,"width":"half"},
   {"key":"end_date","label":"End date (required if temporary)","type":"date","visible":true,"required":false,"width":"half"},
   {"key":"justification","label":"Business justification","type":"longtext","visible":true,"required":true}]'),

('IT', 'AC-03', 'Password / MFA reset', 'Reset a forgotten password or re-enrol MFA', 'request', 'P2', 30, 240, false, false,
 '[{"key":"account","label":"Account or email","type":"text","visible":true,"required":true},
   {"key":"reset_type","label":"What needs resetting","type":"dropdown","options":["Password","MFA device","Both"],"visible":true,"required":true}]'),

('IT', 'AC-04', 'Access revocation (offboarding)', 'HR-initiated. Fulfillment: disable account, revoke licenses, reassign assets, set mail forwarding.', 'request', 'P1', 60, 240, false, false,
 '[{"key":"employee_name","label":"Employee name","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"last_day","label":"Last working day","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"mail_forwarding","label":"Mail forwarding","type":"dropdown","options":["Yes","No"],"visible":true,"required":true,"width":"half"},
   {"key":"forward_to","label":"Forward mail to (if yes)","type":"text","visible":true,"required":false,"width":"half"}]'),

('IT', 'AC-05', 'Shared mailbox / distribution list', 'Create or change a shared mailbox or distribution list', 'request', 'P4', 480, 4320, true, false,
 '[{"key":"kind","label":"Type","type":"dropdown","options":["Shared mailbox","Distribution list"],"visible":true,"required":true,"width":"half"},
   {"key":"address","label":"Desired address","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"owner","label":"Mailbox owner","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"members","label":"Initial members","type":"longtext","visible":true,"required":false}]'),

('IT', 'AC-06', 'VPN / remote access', 'Remote connectivity to company resources', 'request', 'P3', 240, 2880, true, false,
 '[{"key":"device","label":"Device (company / personal)","type":"dropdown","options":["Company laptop","Personal device"],"visible":true,"required":true,"width":"half"},
   {"key":"duration","label":"Duration","type":"dropdown","options":["Permanent","Temporary"],"visible":true,"required":true,"width":"half"},
   {"key":"justification","label":"Business justification","type":"longtext","visible":true,"required":true}]'),

-- —— Category 2 · Hardware (HW) ——
('IT', 'HW-01', 'New hardware request', 'Laptops, desktops, phones and other devices. Fulfillment ends with register + assign in Assets.', 'request', 'P3', 480, 7200, true, false,
 '[{"key":"asset_type","label":"Asset type","type":"dropdown","options":["Laptop","Desktop","Phone","Tablet","Printer","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"model","label":"Model / specification","type":"text","visible":true,"required":false,"width":"half"},
   {"key":"amount","label":"Estimated amount","type":"amount","visible":true,"required":true,"width":"half"},
   {"key":"needed_by","label":"Needed by","type":"date","visible":true,"required":false,"width":"half"},
   {"key":"justification","label":"Business justification","type":"longtext","visible":true,"required":true}]'),

('IT', 'HW-02', 'Hardware repair', 'Something is broken — no approval, fast lane', 'incident', 'P2', 120, 2880, false, false,
 '[{"key":"asset_tag","label":"Asset tag (e.g. LT-00042)","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"asset_type","label":"Asset type","type":"dropdown","options":["Laptop","Desktop","Monitor","Phone","Printer","Dock","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"issue","label":"What is wrong","type":"longtext","visible":true,"required":true}]'),

('IT', 'HW-03', 'Hardware replacement', 'Replace an aging or damaged device', 'request', 'P3', 480, 7200, true, false,
 '[{"key":"asset_tag","label":"Current asset tag","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"asset_type","label":"Asset type","type":"dropdown","options":["Laptop","Desktop","Monitor","Phone","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"reason","label":"Reason for replacement","type":"longtext","visible":true,"required":true}]'),

('IT', 'HW-04', 'Peripheral request', 'Monitors, docks, keyboards and other accessories', 'request', 'P4', 480, 4320, true, false,
 '[{"key":"peripheral","label":"Peripheral","type":"dropdown","options":["Monitor","Docking station","Keyboard","Mouse","Headset","Webcam","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"quantity","label":"Quantity","type":"number","visible":true,"required":true,"width":"half"},
   {"key":"justification","label":"Justification","type":"longtext","visible":true,"required":false}]'),

('IT', 'HW-05', 'Hardware return / transfer', 'Return a device to stock or hand it to a colleague', 'request', 'P4', 480, 2880, false, false,
 '[{"key":"asset_tag","label":"Asset tag","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"action","label":"Action","type":"dropdown","options":["Return to stock","Transfer to colleague"],"visible":true,"required":true,"width":"half"},
   {"key":"recipient","label":"Transfer to (name)","type":"text","visible":true,"required":false}]'),

-- —— Category 3 · Software & Licenses (SW) ——
('IT', 'SW-01', 'Software installation (standard)', 'Install from the approved-software list — no approval needed; anything else goes through Non-standard software', 'request', 'P3', 240, 2880, false, false,
 '[{"key":"software","label":"Approved software","type":"dropdown","options":["Microsoft 365 apps","Adobe Acrobat Reader","7-Zip","Google Chrome","VLC","Power BI Desktop","Microsoft Visio Viewer","Notepad++"],"visible":true,"required":true,"width":"half"},
   {"key":"device_tag","label":"Device asset tag","type":"text","visible":true,"required":true,"width":"half"}]'),

('IT', 'SW-02', 'License request', 'Seat on an existing license pool, or a new purchase', 'request', 'P3', 480, 4320, true, false,
 '[{"key":"product","label":"Product / license","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"seats","label":"Seats","type":"number","visible":true,"required":true,"width":"half"},
   {"key":"amount","label":"Annual cost if new purchase","type":"amount","visible":true,"required":false,"width":"half"},
   {"key":"justification","label":"Business justification","type":"longtext","visible":true,"required":true}]'),

('IT', 'SW-03', 'Non-standard software', 'Software outside the approved list — includes IT security review', 'request', 'P3', 480, 7200, true, false,
 '[{"key":"software","label":"Software name","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"vendor","label":"Vendor","type":"text","visible":true,"required":false,"width":"half"},
   {"key":"amount","label":"Cost (if paid)","type":"amount","visible":true,"required":false,"width":"half"},
   {"key":"justification","label":"Business justification","type":"longtext","visible":true,"required":true}]'),

('IT', 'SW-04', 'SaaS subscription request', 'New cloud service subscription', 'request', 'P3', 480, 7200, true, false,
 '[{"key":"service_name","label":"Service","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"users","label":"Number of users","type":"number","visible":true,"required":true,"width":"half"},
   {"key":"amount","label":"Annual cost","type":"amount","visible":true,"required":true,"width":"half"},
   {"key":"justification","label":"Business justification","type":"longtext","visible":true,"required":true}]'),

-- —— Category 4 · Incidents & Outages (IN) ——
('IT', 'IN-01', 'Report an IT issue', 'Anything not working as it should', 'incident', 'P3', 120, 1440, false, false,
 '[{"key":"impact","label":"Who is affected","type":"dropdown","options":["Just me","My team","Whole department","Company-wide"],"visible":true,"required":true,"width":"half"},
   {"key":"urgency","label":"How badly","type":"dropdown","options":["I can work","Work degraded","I am blocked"],"visible":true,"required":true,"width":"half"},
   {"key":"description","label":"Describe the issue","type":"longtext","visible":true,"required":true}]'),

('IT', 'IN-02', 'System / service outage', 'A system or service is down', 'incident', 'P1', 15, 240, false, false,
 '[{"key":"system","label":"Affected system / service","type":"text","visible":true,"required":true},
   {"key":"details","label":"What is happening","type":"longtext","visible":true,"required":true}]'),

('IT', 'IN-03', 'Security incident', 'Phishing, malware, lost device — visible only to you and IT security', 'incident', 'P1', 15, 240, false, true,
 '[{"key":"incident_type","label":"Incident type","type":"dropdown","options":["Phishing email","Malware / virus","Lost or stolen device","Data exposure","Suspicious activity","Other"],"visible":true,"required":true,"width":"half"},
   {"key":"occurred_on","label":"When did it happen","type":"date","visible":true,"required":false,"width":"half"},
   {"key":"details","label":"What happened","type":"longtext","visible":true,"required":true}]'),

-- —— Category 5 · Network & Connectivity (NW) ——
('IT', 'NW-01', 'Wi-Fi / guest network access', 'Staff device or sponsored guest access', 'request', 'P3', 120, 1440, false, false,
 '[{"key":"access_type","label":"Access type","type":"dropdown","options":["Staff device","Guest (I am the sponsor)"],"visible":true,"required":true,"width":"half"},
   {"key":"date_needed","label":"Date needed","type":"date","visible":true,"required":false,"width":"half"},
   {"key":"guest_name","label":"Guest name / device","type":"text","visible":true,"required":false}]'),

('IT', 'NW-02', 'Network port / connectivity', 'Activate a port or fix connectivity at a location', 'request', 'P3', 480, 4320, false, false,
 '[{"key":"location","label":"Location (building / room / desk)","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"ports","label":"Number of ports","type":"number","visible":true,"required":false,"width":"half"},
   {"key":"details","label":"Details","type":"longtext","visible":true,"required":false}]'),

('IT', 'NW-03', 'Firewall rule / port opening', 'Requires IT security approval, justification and an expiry date', 'request', 'P3', 480, 4320, true, false,
 '[{"key":"source","label":"Source (IP / network)","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"destination","label":"Destination (IP / host)","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"port_protocol","label":"Port / protocol","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"expiry","label":"Rule expiry date","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"justification","label":"Business justification","type":"longtext","visible":true,"required":true}]'),

-- —— Category 6 · Employee IT Lifecycle (EL) ——
('IT', 'EL-01', 'IT onboarding (new joiner)', 'HR trigger. Fulfillment: account (AC-01), hardware (HW-01), licenses (SW-02), access profile.', 'request', 'P2', 240, 7200, false, false,
 '[{"key":"employee_name","label":"New joiner name","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"department","label":"Department","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"start_date","label":"Start date","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"hardware_profile","label":"Hardware profile","type":"dropdown","options":["Standard laptop","Engineering laptop","Desktop","No hardware needed"],"visible":true,"required":true,"width":"half"},
   {"key":"notes","label":"Systems / notes","type":"longtext","visible":true,"required":false}]'),

('IT', 'EL-02', 'IT offboarding (leaver)', 'HR trigger. Fulfillment: revoke access (AC-04), collect hardware (HW-05), release licenses.', 'request', 'P1', 60, 2880, false, false,
 '[{"key":"employee_name","label":"Leaver name","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"last_day","label":"Last working day","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"mail_forwarding","label":"Mail forwarding","type":"dropdown","options":["Yes","No"],"visible":true,"required":true,"width":"half"},
   {"key":"notes","label":"Notes","type":"longtext","visible":true,"required":false}]'),

('IT', 'EL-03', 'Internal transfer', 'Access re-profiling when moving departments — both managers approve', 'request', 'P3', 480, 7200, true, false,
 '[{"key":"employee_name","label":"Employee name","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"effective_date","label":"Effective date","type":"date","visible":true,"required":true,"width":"half"},
   {"key":"from_dept","label":"From department","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"to_dept","label":"To department","type":"text","visible":true,"required":true,"width":"half"},
   {"key":"access_changes","label":"Access to add / remove","type":"longtext","visible":true,"required":true}]')

on conflict (dept, code) do nothing;

-- ============ DoA wiring ============
-- The engine falls back to a single "Line manager" step when no band matches,
-- which covers AC-01/02/06, HW-03/04 and SW-02's owner-as-line-manager case.
-- Explicit chains only where the spec differs from that default.
do $$
declare
  v_hw1 uuid; v_sw3 uuid; v_sw4 uuid; v_ac5 uuid; v_sw2 uuid; v_nw3 uuid; v_el3 uuid;
begin
  select id into v_hw1 from services where dept = 'IT' and code = 'HW-01';
  select id into v_sw2 from services where dept = 'IT' and code = 'SW-02';
  select id into v_sw3 from services where dept = 'IT' and code = 'SW-03';
  select id into v_sw4 from services where dept = 'IT' and code = 'SW-04';
  select id into v_ac5 from services where dept = 'IT' and code = 'AC-05';
  select id into v_nw3 from services where dept = 'IT' and code = 'NW-03';
  select id into v_el3 from services where dept = 'IT' and code = 'EL-03';

  insert into doa_matrix (dept, service_id, min_amount, max_amount, step_order, approver_hint) values
    -- 2.1 New hardware: manager below Tier 1; full chain at ≥ 25k SAR
    ('IT', v_hw1, 0, 25000, 1, 'Line manager'),
    ('IT', v_hw1, 25000, null, 1, 'Line manager'),
    ('IT', v_hw1, 25000, null, 2, 'Department head'),
    ('IT', v_hw1, 25000, null, 3, 'Executive (Tier 1 DoA)'),
    -- 3.4 SaaS subscription: DoA by annual cost
    ('IT', v_sw4, 0, 25000, 1, 'Line manager'),
    ('IT', v_sw4, 25000, null, 1, 'Line manager'),
    ('IT', v_sw4, 25000, null, 2, 'Department head'),
    ('IT', v_sw4, 25000, null, 3, 'Executive (Tier 1 DoA)'),
    -- 1.5 Shared mailbox: the mailbox owner decides
    ('IT', v_ac5, 0, null, 1, 'Mailbox owner'),
    -- 3.2 License request: the license owner decides
    ('IT', v_sw2, 0, null, 1, 'License owner'),
    -- 3.3 Non-standard software: manager, then IT security review
    ('IT', v_sw3, 0, null, 1, 'Line manager'),
    ('IT', v_sw3, 0, null, 2, 'IT security'),
    -- 5.3 Firewall rule: IT security only
    ('IT', v_nw3, 0, null, 1, 'IT security'),
    -- 6.3 Internal transfer: both managers
    ('IT', v_el3, 0, null, 1, 'Current manager'),
    ('IT', v_el3, 0, null, 2, 'New manager')
  on conflict (dept, service_id, min_amount, step_order) do nothing;
end $$;
