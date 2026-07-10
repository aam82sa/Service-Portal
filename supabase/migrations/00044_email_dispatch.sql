-- 00044 — email dispatch: feature flag + default templates for the events the
-- send-notification function handles. The function itself lives in
-- supabase/functions/send-notification (deployed via
-- `supabase functions deploy send-notification --no-verify-jwt`; protected by
-- the X-Hook-Secret shared secret instead of JWT).

insert into feature_flags (key, name, description, category, is_enabled)
values ('email_notifications', 'Email notifications',
        'Outbound email on request events via the send-notification function (SMTP/Mailtrap or Microsoft Graph).',
        'channels', false)
on conflict (key) do nothing;

-- platform-default templates for every event the function handles; the first
-- four ship in seed.sql but seeds are not guaranteed to have run on hosted
-- projects, so all inserts are guarded and idempotent
insert into notification_templates (key, subject, body_html)
select v.key, v.subject, v.body_html
from (values
  ('request_created', 'Your request {{ref}} has been received',
   '<p>Dear {{requester_name}},</p><p>Request <b>{{ref}}</b> — {{title}} has been received and will be triaged shortly.</p>'),
  ('resolved', 'Your request {{ref}} has been resolved',
   '<p>Dear {{requester_name}},</p><p>Request <b>{{ref}}</b> — {{title}} is now resolved. Reply to this email to reopen it.</p>'),
  ('pending_approval', 'Approval needed: {{ref}} ({{amount}} SAR)',
   '<p>Request <b>{{ref}}</b> — {{title}} awaits your decision.</p>'),
  ('sla_warning', 'SLA warning: {{ref}} due {{sla_due}}',
   '<p>Request <b>{{ref}}</b> — {{title}} is approaching its SLA target.</p>'),
  ('assigned', 'Your request {{ref}} is being worked on',
   '<p>Dear {{requester_name}},</p><p>Request <b>{{ref}}</b> — {{title}} has been assigned and is now {{status}}.</p>'),
  ('approved', 'Request {{ref}} approved',
   '<p>Dear {{requester_name}},</p><p>An approval step on request <b>{{ref}}</b> — {{title}} has been approved.</p>'),
  ('rejected', 'Request {{ref}} rejected',
   '<p>Dear {{requester_name}},</p><p>Request <b>{{ref}}</b> — {{title}} was rejected at an approval step. The team will follow up with next steps.</p>'),
  ('sla_breached', 'SLA breached: {{ref}}',
   '<p>Request <b>{{ref}}</b> — {{title}} has passed its SLA target ({{sla_due}}). It has been escalated per the configured rules.</p>')
) as v(key, subject, body_html)
where not exists (
  select 1 from notification_templates t where t.key = v.key and t.dept is null
);
