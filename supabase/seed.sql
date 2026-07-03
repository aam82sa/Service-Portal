-- DEV SEED — local/dev projects only, never production.
-- Creates password-login test users (password: RlcDev!2026), sample services,
-- and starter templates so the app is testable before Entra SSO is connected.

-- ============ Test users ============
-- 1 requester, agent/team lead/dept admin (IT), approver, user admin, system admin
do $$
declare
  u record;
begin
  for u in select * from (values
    ('11111111-1111-4111-8111-111111111101'::uuid, 'requester@dev.rlc.sa',  'Rana Requester'),
    ('11111111-1111-4111-8111-111111111102'::uuid, 'agent.it@dev.rlc.sa',   'Ahmed Agent'),
    ('11111111-1111-4111-8111-111111111103'::uuid, 'lead.it@dev.rlc.sa',    'Latifa Lead'),
    ('11111111-1111-4111-8111-111111111104'::uuid, 'approver@dev.rlc.sa',   'Aziz Approver'),
    ('11111111-1111-4111-8111-111111111105'::uuid, 'deptadmin.it@dev.rlc.sa', 'Dana DeptAdmin'),
    ('11111111-1111-4111-8111-111111111106'::uuid, 'useradmin@dev.rlc.sa',  'Umar UserAdmin'),
    ('11111111-1111-4111-8111-111111111107'::uuid, 'sysadmin@dev.rlc.sa',   'Sara SysAdmin')
  ) as t(id, email, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.email, crypt('RlcDev!2026', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', u.name), now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now())
    on conflict do nothing;

    insert into profiles (id, upn, display_name, is_active)
    values (u.id, u.email, u.name, true)
    on conflict (id) do nothing;
  end loop;
end $$;

insert into role_assignments (profile_id, role, dept, source_ad_group) values
  ('11111111-1111-4111-8111-111111111102', 'agent',        'IT', 'SG-RLC-ServiceDesk-IT'),
  ('11111111-1111-4111-8111-111111111103', 'team_lead',    'IT', 'SG-RLC-TeamLeads-IT'),
  ('11111111-1111-4111-8111-111111111104', 'approver',     null, 'SG-RLC-DoA-Approvers'),
  ('11111111-1111-4111-8111-111111111105', 'dept_admin',   'IT', 'SG-RLC-Dept-Admins-IT'),
  ('11111111-1111-4111-8111-111111111106', 'user_admin',   null, 'SG-RLC-User-Admins'),
  ('11111111-1111-4111-8111-111111111107', 'system_admin', null, 'SG-RLC-System-Admins')
on conflict do nothing;

-- ============ Sample services ============
insert into services (dept, code, name, description, sla_response_minutes, sla_resolution_minutes, requires_approval, form_schema) values
  ('IT',    'HW', 'Hardware request',   'Laptops, monitors, peripherals', 240, 2880, true,
   '[{"key":"asset_type","label":"Asset type","type":"dropdown","options":["Laptop","Monitor","Phone","Other"],"visible":true,"required":true},
     {"key":"justification","label":"Business justification","type":"longtext","visible":true,"required":true},
     {"key":"amount","label":"Estimated amount","type":"amount","visible":true,"required":true}]'),
  ('IT',    'AC', 'Access request',     'Systems, shared folders, VPN',   120, 1440, false,
   '[{"key":"system","label":"System or resource","type":"text","visible":true,"required":true},
     {"key":"duration","label":"Access duration","type":"dropdown","options":["Permanent","Temporary"],"visible":true,"required":true}]'),
  ('ADMIN', 'TR', 'Travel request',     'Business travel arrangements',   480, 4320, true,
   '[{"key":"destination","label":"Destination","type":"text","visible":true,"required":true},
     {"key":"amount","label":"Estimated cost","type":"amount","visible":true,"required":true}]'),
  ('LOG',   'FL', 'Fleet booking',      'Vehicle booking and dispatch',   240, 1440, false,
   '[{"key":"date","label":"Date needed","type":"date","visible":true,"required":true}]')
on conflict do nothing;

-- ============ Starter email templates ============
insert into notification_templates (key, subject, body_html) values
  ('request_created', 'Your request {{ref}} has been received',
   '<p>Dear {{requester_name}},</p><p>Request <b>{{ref}}</b> — {{title}} has been received and will be triaged shortly.</p>'),
  ('resolved', 'Your request {{ref}} has been resolved',
   '<p>Dear {{requester_name}},</p><p>Request <b>{{ref}}</b> — {{title}} is now resolved. Reply to this email to reopen it, or rate the service: {{rating_link}}</p>'),
  ('pending_approval', 'Approval needed: {{ref}} ({{amount}} SAR)',
   '<p>Request <b>{{ref}}</b> — {{title}} awaits your decision.</p>'),
  ('sla_warning', 'SLA warning: {{ref}} due {{sla_due}}',
   '<p>Request <b>{{ref}}</b> — {{title}} is approaching its SLA target.</p>'),
  ('unknown_sender', 'Your message could not be processed',
   '<p>This mailbox only accepts requests from registered RLC staff. Contact the service desk if you believe this is an error.</p>')
on conflict do nothing;

-- ============ Inbound routing ============
insert into inbound_routes (mailbox, dept, is_catch_all) values
  ('it-support@rlc.sa', 'IT', true),
  ('facilities@rlc.sa', 'ADMIN', false),
  ('fleet@rlc.sa', 'LOG', false)
on conflict do nothing;

-- ============ DoA matrix (SAR bands) ============
insert into doa_matrix (dept, min_amount, max_amount, step_order, approver_hint) values
  (null, 0,      25000,  1, 'Line manager'),
  (null, 25000,  100000, 1, 'Department head'),
  (null, 25000,  100000, 2, 'Finance controller'),
  (null, 100000, null,   1, 'Department head'),
  (null, 100000, null,   2, 'Finance controller'),
  (null, 100000, null,   3, 'Executive committee')
on conflict do nothing;
