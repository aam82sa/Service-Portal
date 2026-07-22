-- 00084 — ACCESS1 branch 5: complete the page-grant matrix.
--
-- Four nav pages never had a page_access row (work, pmo, reports, pmoadmin) —
-- App.tsx fell back to hardcoded role expressions, which is exactly what the
-- rewritten canSee() removes. 'work' was covered by the legacy 'mywork' row
-- (carried in 00082); this migration seeds role_group_pages for the other
-- three, translating today's hardcoded expressions verbatim so the cutover
-- changes no one's nav:
--
--   pmo      was project_manager|pmo_admin|executive|dept_head|isStaff|isSys
--            → pmo_manager, dept_head, it_officer, team_lead, system_admin
--              (isStaff = agent|team_lead|dept_admin)
--   reports  was isStaff|team_lead|dept_head|executive|isSys
--            → it_officer, team_lead, dept_head, system_admin
--   pmoadmin was pmo_admin|isSys
--            → pmo_manager, system_admin
--
-- (The committee-membership arm of the old pmo expression is data-driven, not
-- role-based; App.tsx keeps it as an explicit, documented exception.)

insert into role_group_pages (group_id, page_key, visibility)
select g.id, m.page, 'visible'
  from role_groups g
  join (values
    ('pmo_manager',  'pmo'),
    ('dept_head',    'pmo'),
    ('it_officer',   'pmo'),
    ('team_lead',    'pmo'),
    ('system_admin', 'pmo'),
    ('it_officer',   'reports'),
    ('team_lead',    'reports'),
    ('dept_head',    'reports'),
    ('system_admin', 'reports'),
    ('pmo_manager',  'pmoadmin'),
    ('system_admin', 'pmoadmin')
  ) as m(gkey, page) on m.gkey = g.key
on conflict (group_id, page_key) do nothing;
