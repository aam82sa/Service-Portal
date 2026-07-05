-- Rebrand: RLC -> ABC Corp across all stored data.
-- Sign-in emails move to @dev.abccorp.com (the sign-in picker matches).

update profiles set upn = replace(upn, 'dev.rlc.sa', 'dev.abccorp.com')
where upn like '%dev.rlc.sa';

update auth.users set email = replace(email, 'dev.rlc.sa', 'dev.abccorp.com')
where email like '%dev.rlc.sa';

update auth.identities
set identity_data = jsonb_set(
  identity_data, '{email}',
  to_jsonb(replace(identity_data->>'email', 'dev.rlc.sa', 'dev.abccorp.com')))
where identity_data->>'email' like '%dev.rlc.sa';

update assets set tag = replace(tag, 'RLC-', 'ABC-') where tag like 'RLC-%';

update inbound_routes set mailbox = replace(mailbox, 'rlc.sa', 'abccorp.com')
where mailbox like '%rlc.sa';

update notification_templates
set subject = replace(subject, 'RLC', 'ABC Corp'),
    body_html = replace(body_html, 'RLC', 'ABC Corp')
where subject like '%RLC%' or body_html like '%RLC%';

update role_assignments set source_ad_group = replace(source_ad_group, 'SG-RLC-', 'SG-ABC-')
where source_ad_group like 'SG-RLC-%';
