-- DEV SEED — local/dev projects only, never production.
-- Creates password-login test users (see migration 00035), sample services,
-- and starter templates so the app is testable before Entra SSO is connected.

-- ============ Test users ============
-- The standard test-user matrix (system admin, dept heads, team leads,
-- agents, business requesters) is created by migration 00035.
--
-- Migration 00061 fails closed: it scrambles seeded-account passwords and
-- strips their email identities so fresh *production* replays never ship
-- usable shared credentials. seed.sql runs on local `supabase db reset`
-- only, so restoring the dev matrix here keeps local and e2e sign-in
-- working — production never executes this file. The database flag stops
-- later partial migration runs from re-neutralizing this database.
do $$
begin
  execute format('alter database %I set app.seed_demo = ''on''', current_database());
end $$;

update auth.users
   set encrypted_password = crypt('AbcTest!2026', gen_salt('bf'))
 where email like 'tester%@dev.abccorp.com';
update auth.users
   set encrypted_password = crypt('AbcHub!2026', gen_salt('bf'))
 where email like '%@dev.abccorp.com' and email not like 'tester%';

insert into auth.identities (id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
  from auth.users u
 where u.email like '%@dev.abccorp.com'
   and not exists (
     select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
   );

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
   '<p>This mailbox only accepts requests from registered ABC Corp staff. Contact the service desk if you believe this is an error.</p>')
on conflict do nothing;

-- ============ Inbound routing ============
insert into inbound_routes (mailbox, dept, is_catch_all) values
  ('it-support@abccorp.com', 'IT', true),
  ('facilities@abccorp.com', 'ADMIN', false),
  ('fleet@abccorp.com', 'LOG', false)
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
