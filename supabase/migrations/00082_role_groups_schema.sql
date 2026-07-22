-- 00082 — ACCESS1 branch 3: role groups — the model that ties page access to RLS.
--
-- Today `page_access` controls nav rendering and NOTHING else: it is never
-- referenced by any policy, function or trigger, so hiding a page is cosmetic
-- while the user's token can still fetch everything RLS allows. The fix is a
-- ROLE GROUP: a named bundle that grants platform roles (which RLS honours)
-- and page access (which controls nav) in one action, so the two can never
-- drift apart.
--
--   role_groups          the named bundle (7 seeded, mapping current reality)
--   role_group_roles     platform roles the group grants (dept-scoped or global)
--   app_pages            the page registry, seeded from the router's real ids —
--                        including detail sub-pages the old model couldn't gate;
--                        backed_by_role names the role RLS enforces (null ⇒ the
--                        toggle is cosmetic and the UI must say so)
--   role_group_pages     nav visibility per group ('visible'/'hidden';
--                        no row = inherited)
--   profile_role_groups  membership (optionally dept-scoped per member)
--
-- Enforcement stays in `role_assignments`: membership MATERIALISES into it via
-- SECURITY DEFINER triggers, so every existing RLS policy and has_role() call
-- keeps working unchanged. Materialised rows carry via_group_id so removing a
-- group (or a membership) removes exactly the grants it created — direct role
-- assignment stays possible for exceptions and is never touched.
--
-- `page_access` is left in place: canSee() still reads it until branch 5 cuts
-- the app over to this model. Its grants are preserved into role_group_pages,
-- including the dept_admin/approver/executive grants the old grid never showed.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) tables
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists role_groups (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  name        text not null,
  name_ar     text,
  description text,
  is_system   boolean not null default false,   -- seeded groups: renameable, not deletable
  tenant_id   uuid not null default current_tenant() references tenants(id),
  created_at  timestamptz not null default now()
);

create table if not exists role_group_roles (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references role_groups(id) on delete cascade,
  role      platform_role not null,
  dept_id   uuid references departments(id),     -- null = global
  tenant_id uuid not null default current_tenant() references tenants(id),
  unique nulls not distinct (group_id, role, dept_id)
);

create table if not exists app_pages (
  key            text primary key,
  label          text not null,
  label_ar       text,
  route          text not null,
  parent_key     text references app_pages(key),   -- detail pages under their section
  backed_by_role platform_role,                    -- null ⇒ cosmetic (amber in the UI)
  is_lockable    boolean not null default true,    -- admin console: cannot be granted away from sysadmin
  tenant_id      uuid not null default current_tenant() references tenants(id)
);

create table if not exists role_group_pages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references role_groups(id) on delete cascade,
  page_key   text not null references app_pages(key) on delete cascade,
  visibility text not null check (visibility in ('visible', 'hidden')),
  tenant_id  uuid not null default current_tenant() references tenants(id),
  unique (group_id, page_key)
);

create table if not exists profile_role_groups (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  group_id   uuid not null references role_groups(id) on delete cascade,
  dept_id    uuid references departments(id),     -- member-level scope for global group roles
  granted_by uuid references profiles(id),
  granted_at timestamptz not null default now(),
  tenant_id  uuid not null default current_tenant() references tenants(id),
  unique nulls not distinct (profile_id, group_id, dept_id)
);

-- role_assignments learns where a grant came from; deleting the group
-- cascades its materialised grants away.
alter table role_assignments
  add column if not exists via_group_id uuid references role_groups(id) on delete cascade;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) materialisation — group membership becomes role_assignments rows
-- ─────────────────────────────────────────────────────────────────────────
-- The dept for a grant: the group-role's own scope wins; a global group role
-- takes the member's scope; both null = global. The legacy enum column is
-- kept in step when the code is an enum value (has_role's enum overload reads
-- it), exactly as direct grants behave today.
create or replace function materialise_group_member(p_profile uuid, p_group uuid, p_member_dept uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into role_assignments (profile_id, role, dept, dept_id, via_group_id)
  select p_profile, gr.role,
         case when d.code in ('IT', 'ADMIN', 'LOG', 'PROC') then d.code::dept_code end,
         coalesce(gr.dept_id, p_member_dept),
         p_group
    from role_group_roles gr
    left join departments d on d.id = coalesce(gr.dept_id, p_member_dept)
   where gr.group_id = p_group
     and not exists (
       select 1 from role_assignments ra
        where ra.profile_id = p_profile and ra.role = gr.role
          and ra.dept_id is not distinct from coalesce(gr.dept_id, p_member_dept)
     );
end $$;

create or replace function profile_role_groups_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform materialise_group_member(new.profile_id, new.group_id, new.dept_id);
    return new;
  elsif tg_op = 'DELETE' then
    delete from role_assignments
     where profile_id = old.profile_id and via_group_id = old.group_id;
    return old;
  end if;
  return new;
end $$;

drop trigger if exists profile_role_groups_sync_t on profile_role_groups;
create trigger profile_role_groups_sync_t
  after insert or delete on profile_role_groups
  for each row execute function profile_role_groups_sync();

-- changing a group's role bundle re-materialises every member
create or replace function role_group_roles_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  gid uuid := coalesce(new.group_id, old.group_id);
  m record;
begin
  -- drop everything the group materialised, then rebuild from the new bundle
  delete from role_assignments where via_group_id = gid;
  for m in select profile_id, dept_id from profile_role_groups where group_id = gid loop
    perform materialise_group_member(m.profile_id, gid, m.dept_id);
  end loop;
  return coalesce(new, old);
end $$;

drop trigger if exists role_group_roles_sync_t on role_group_roles;
create trigger role_group_roles_sync_t
  after insert or update or delete on role_group_roles
  for each row execute function role_group_roles_sync();

-- ─────────────────────────────────────────────────────────────────────────
-- 3) RLS — read for all signed-in users (nav needs it), writes admin-gated
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['role_groups','role_group_roles','app_pages','role_group_pages','profile_role_groups'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I as restrictive using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', t);
  end loop;
end $$;

-- group definitions: system_admin only
drop policy if exists role_groups_write on role_groups;
create policy role_groups_write on role_groups for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
drop policy if exists role_group_roles_write on role_group_roles;
create policy role_group_roles_write on role_group_roles for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
drop policy if exists app_pages_write on app_pages;
create policy app_pages_write on app_pages for update to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));
drop policy if exists role_group_pages_write on role_group_pages;
create policy role_group_pages_write on role_group_pages for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));

-- membership: user_admin manages people (matches Users & roles today)
drop policy if exists profile_role_groups_write on profile_role_groups;
create policy profile_role_groups_write on profile_role_groups for all to authenticated
  using (has_role('system_admin') or has_role('user_admin'))
  with check (has_role('system_admin') or has_role('user_admin'));

-- audit every membership change alongside the existing role-change audit
create or replace function log_group_membership() returns trigger
language plpgsql security definer as $$
begin
  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'access',
          case tg_op when 'INSERT' then 'group_member_added' else 'group_member_removed' end,
          jsonb_build_object(
            'profile_id', coalesce(new.profile_id, old.profile_id),
            'group_id', coalesce(new.group_id, old.group_id),
            'dept_id', coalesce(new.dept_id, old.dept_id)));
  return coalesce(new, old);
end $$;
drop trigger if exists profile_role_groups_audit_t on profile_role_groups;
create trigger profile_role_groups_audit_t
  after insert or delete on profile_role_groups
  for each row execute function log_group_membership();

-- ─────────────────────────────────────────────────────────────────────────
-- 4) seed — app_pages from the router's REAL page ids (App.tsx `see` map)
-- ─────────────────────────────────────────────────────────────────────────
insert into app_pages (key, label, label_ar, route, parent_key, backed_by_role, is_lockable) values
  ('home',     'Overview',        'نظرة عامة',        '/',              null, 'requester',       false),
  ('portal',   'Service portal',  'بوابة الخدمات',    '/portal',        null, 'requester',       false),
  ('requests', 'My requests',     'طلباتي',           '/requests',      null, 'requester',       false),
  ('work',     'Work',            'العمل',            '/work',          null, 'agent',           false),
  ('pmo',      'Projects',        'المشاريع',         '/projects',      null, 'project_manager', false),
  ('letters',  'Correspondence',  'المراسلات',        '/correspondence',null, 'agent',           false),
  ('insights', 'Insights',        'التحليلات',        '/insights',      null, null,              false),
  ('reports',  'Reports',         'التقارير',         '/reports',       null, null,              false),
  ('assets',   'IT assets',       'الأصول',           '/assets',        null, 'agent',           false),
  ('admin',    'Admin console',   'وحدة الإدارة',     '/admin',         null, 'system_admin',    true),
  ('pmoadmin', 'PMO admin',       'إدارة المشاريع',   '/pmoadmin',      null, 'pmo_admin',       true)
on conflict (key) do nothing;

-- detail sub-pages — the routes the old model could never gate
insert into app_pages (key, label, label_ar, route, parent_key, backed_by_role, is_lockable) values
  ('request_detail', 'Request detail', 'تفاصيل الطلب',    '/requests/:id', 'requests', 'requester',       false),
  ('project_detail', 'Project detail', 'تفاصيل المشروع',  '/projects/:id', 'pmo',      'project_manager', false)
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) seed — the 7 groups mapping current reality (brief's list)
-- ─────────────────────────────────────────────────────────────────────────
insert into role_groups (key, name, name_ar, description, is_system) values
  ('requester',     'Requester (everyone)',    'مقدم الطلب',        'Every signed-in employee. Submits and tracks their own requests.', true),
  ('it_officer',    'IT Officer',              'موظف تقنية',        'Front-line IT staff who work the department queue and approve low-value requests.', true),
  ('team_lead',     'Team Lead',               'قائد فريق',         'Runs a team queue: assigns, reprioritises and escalates within the team.', true),
  ('dept_head',     'Department Head',         'رئيس القسم',        'Owns a department: approvals, correspondence sign-off, insights.', true),
  ('cyber_reviewer','Cybersecurity Reviewer',  'مراجع أمن سيبراني', 'Reviews security-flagged requests and catalog changes.', true),
  ('pmo_manager',   'PMO Manager',             'مدير مكتب المشاريع','Runs the project portfolio and PMO administration.', true),
  ('system_admin',  'System Administrator',    'مدير النظام',       'Full platform administration.', true)
on conflict (key) do nothing;

-- role bundles (dept_id null = global / scoped at membership time)
insert into role_group_roles (group_id, role, dept_id)
select g.id, r.role::platform_role, null
  from role_groups g
  join (values
    ('requester',      'requester'),
    ('it_officer',     'agent'),
    ('it_officer',     'approver'),
    ('team_lead',      'team_lead'),
    ('team_lead',      'agent'),
    ('team_lead',      'approver'),
    ('dept_head',      'dept_head'),
    ('dept_head',      'approver'),
    ('dept_head',      'executive'),
    ('cyber_reviewer', 'cybersecurity'),
    ('cyber_reviewer', 'approver'),
    ('pmo_manager',    'project_manager'),
    ('pmo_manager',    'pmo_admin'),
    ('system_admin',   'system_admin'),
    ('system_admin',   'user_admin'),
    ('system_admin',   'dept_admin')
  ) as r(gkey, role) on r.gkey = g.key
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) preserve page_access grants into role_group_pages
-- ─────────────────────────────────────────────────────────────────────────
-- A page is visible to a group when the legacy allowed-roles array intersects
-- the group's role bundle (requester is implicit for every non-sysadmin group,
-- matching canSee's behaviour). This carries over the dept_admin / approver /
-- executive grants the old grid never displayed.
insert into role_group_pages (group_id, page_key, visibility)
select distinct g.id, ap.key, 'visible'
  from page_access pa
  -- the router's id for the legacy 'mywork' row is 'work'; rows for routes
  -- that no longer exist (queue, approvals) simply don't join and are dropped
  join app_pages ap on ap.key = case pa.page when 'mywork' then 'work' else pa.page end
  join role_groups g on true
 where exists (
   select 1 from role_group_roles gr
    where gr.group_id = g.id and gr.role::text = any(pa.allowed::text[])
 )
    or ('requester' = any(pa.allowed::text[]) and g.key <> 'system_admin')
on conflict (group_id, page_key) do nothing;
