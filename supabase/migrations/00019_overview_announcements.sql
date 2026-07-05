-- Overview becomes the top-level landing page for every role, and
-- announcements get an explicit on/off status independent of dates.
alter table announcements add column is_active boolean not null default true;

update page_access set name = 'Overview',
  allowed = array['requester','agent','team_lead','dept_head','user_admin','system_admin']::platform_role[]
where page = 'home';
