-- 00075 — Phase 1 PR-B (2/2): move dept-scoped RLS + routing onto dept_id.
--
-- 00074 added dept_id everywhere and the uuid has_role overloads. This
-- migration repoints the 28 dept-scoped policies and the request
-- routing/ref/approver helpers from the legacy enum `dept` column to
-- `dept_id`, so a dynamic stream's rows (whose enum dept is null) are scoped
-- and routed correctly. Existing departments are unaffected — their dept_id
-- was backfilled, so every predicate resolves exactly as before.
--
-- The tenant-isolation gate is untouched (these are permissive dept policies;
-- the restrictive tenant_isolation policies from 00073 remain in force).

-- Resolve a department code to its id within the caller's tenant. Used for the
-- handful of policies that scope to a fixed department (IT asset/cloud mgmt).
create or replace function dept_uuid(p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from departments where code = p_code and tenant_id = current_tenant()
$$;
grant execute on function dept_uuid(text) to authenticated, anon, service_role;

-- ── requests: derive dept_id from the service; route on dept_id ────────────
create or replace function requests_before_insert()
returns trigger language plpgsql security definer as $$
declare
  svc services%rowtype;
  resp int;
  reso int;
begin
  select * into svc from services where id = new.service_id and is_active;
  if not found then
    raise exception 'unknown or inactive service';
  end if;
  new.dept = svc.dept;         -- legacy denormalised code (null for dynamic streams)
  new.dept_id = svc.dept_id;   -- canonical department reference
  select o_response, o_resolution into resp, reso from sla_minutes_for(new.service_id, new.priority);
  if resp is not null then new.sla_response_due = add_business_minutes(now(), resp); end if;
  if reso is not null then new.sla_resolution_due = add_business_minutes(now(), reso); end if;
  return new;
end $$;

-- routing rules keyed on dept_id
create or replace function resolve_team(p_dept uuid, p_service uuid, p_title text)
returns uuid language sql stable security definer as $$
  select team_id from (
    select r.team_id,
           case r.match_type when 'service' then 0 when 'keyword' then 1 else 2 end as tier,
           r.position
    from routing_rules r
    where r.dept_id = p_dept
      and (
        (r.match_type = 'service' and r.match_value = (select s.code from services s where s.id = p_service))
        or (r.match_type = 'keyword' and r.match_value is not null
            and position(lower(r.match_value) in lower(coalesce(p_title, ''))) > 0)
        or r.match_type = 'default'
      )
    order by tier, r.position, r.created_at
    limit 1
  ) best
$$;

create or replace function requests_route_team_fn()
returns trigger language plpgsql security definer as $$
declare
  svc_dept uuid;
begin
  if new.team_id is not null then return new; end if;
  select s.dept_id into svc_dept from services s where s.id = new.service_id;
  new.team_id = resolve_team(svc_dept, new.service_id, new.title);
  return new;
end $$;

-- dept_head resolution keyed on dept_id (approval chains for dynamic streams)
create or replace function resolve_approver(p_hint text, p_dept uuid, p_requester uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  h text := lower(coalesce(p_hint, ''));
  who uuid;
begin
  if p_requester is null then return null; end if;
  if h like '%line manager%' or h = 'manager' or h like '%reporting manager%' then
    return resolve_line_manager(p_requester);
  end if;
  if h like '%department head%' or h like '%dept head%' then
    select ra.profile_id into who
    from role_assignments ra join profiles p on p.id = ra.profile_id
    where ra.role = 'dept_head' and (ra.dept_id is null or ra.dept_id = p_dept) and p.is_active
    order by (ra.dept_id = p_dept) desc, ra.profile_id
    limit 1;
    return who;
  end if;
  return null;
end $$;

-- ── recreate the 28 dept-scoped policies on dept_id ────────────────────────
drop policy if exists ae_read on admin_events;
create policy ae_read on admin_events for select to authenticated using (
  has_role('system_admin') or has_role('executive') or has_role('team_lead', dept_uuid('IT')) or has_role('dept_head')
);

drop policy if exists apr_read on approvals;
create policy apr_read on approvals for select to authenticated using (
  has_role('approver') or has_role('cybersecurity') or (assigned_approver_id = auth.uid())
  or ((subject_type = 'request') and exists (
    select 1 from requests r where r.id = approvals.request_id
      and (r.requester_id = auth.uid() or has_role('agent', r.dept_id) or has_role('team_lead', r.dept_id)
           or has_role('dept_admin', r.dept_id) or has_role('executive') or has_role('system_admin'))))
);

drop policy if exists aow_write on asset_ownership;
create policy aow_write on asset_ownership for all to authenticated
  using (has_role('agent', dept_uuid('IT')) or has_role('team_lead', dept_uuid('IT')) or has_role('dept_head', dept_uuid('IT')) or has_role('system_admin'))
  with check (has_role('agent', dept_uuid('IT')) or has_role('team_lead', dept_uuid('IT')) or has_role('dept_head', dept_uuid('IT')) or has_role('system_admin'));

drop policy if exists azc_read on azure_credit;
create policy azc_read on azure_credit for select to authenticated using (
  has_role('agent', dept_uuid('IT')) or has_role('team_lead', dept_uuid('IT')) or has_role('dept_head', dept_uuid('IT')) or has_role('executive') or has_role('system_admin')
);
drop policy if exists azc_write on azure_credit;
create policy azc_write on azure_credit for all to authenticated
  using (has_role('agent', dept_uuid('IT')) or has_role('team_lead', dept_uuid('IT')) or has_role('dept_head', dept_uuid('IT')) or has_role('system_admin'))
  with check (has_role('agent', dept_uuid('IT')) or has_role('team_lead', dept_uuid('IT')) or has_role('dept_head', dept_uuid('IT')) or has_role('system_admin'));

drop policy if exists clr_read on cloud_resources;
create policy clr_read on cloud_resources for select to authenticated using (
  has_role('agent', dept_uuid('IT')) or has_role('team_lead', dept_uuid('IT')) or has_role('dept_head', dept_uuid('IT')) or has_role('executive') or has_role('system_admin')
);
drop policy if exists clr_write on cloud_resources;
create policy clr_write on cloud_resources for all to authenticated
  using (has_role('agent', dept_uuid('IT')) or has_role('team_lead', dept_uuid('IT')) or has_role('dept_head', dept_uuid('IT')) or has_role('system_admin'))
  with check (has_role('agent', dept_uuid('IT')) or has_role('team_lead', dept_uuid('IT')) or has_role('dept_head', dept_uuid('IT')) or has_role('system_admin'));

drop policy if exists fv_read on form_versions;
create policy fv_read on form_versions for select to authenticated using (
  status = 'published' or has_role('system_admin')
  or has_role('dept_admin', (select s.dept_id from services s where s.id = form_versions.service_id))
);
drop policy if exists fv_write on form_versions;
create policy fv_write on form_versions for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin', (select s.dept_id from services s where s.id = form_versions.service_id)))
  with check (has_role('system_admin') or has_role('dept_admin', (select s.dept_id from services s where s.id = form_versions.service_id)));

drop policy if exists ltr_insert on letters;
create policy ltr_insert on letters for insert to authenticated with check (
  (has_role('agent', dept_id) or has_role('team_lead', dept_id) or has_role('dept_head', dept_id) or has_role('system_admin'))
  and (created_by = auth.uid())
);
drop policy if exists ltr_update on letters;
create policy ltr_update on letters for update to authenticated
  using ((owner_id = auth.uid()) or has_role('dept_head', dept_id) or has_role('system_admin'))
  with check (owner_id is not null);

drop policy if exists lic_manage on licenses;
create policy lic_manage on licenses for all to authenticated
  using (has_role('team_lead', dept_uuid('IT')) or has_role('system_admin'))
  with check (has_role('team_lead', dept_uuid('IT')) or has_role('system_admin'));

drop policy if exists pja_read on project_approvals;
create policy pja_read on project_approvals for select to authenticated using (
  (exists (select 1 from projects p where p.id = project_approvals.project_id))
  or ((step = 'dept_head'::project_approval_step) and has_role('dept_head', target_dept_id))
  or ((step = 'committee'::project_approval_step) and is_committee_member())
);

drop policy if exists pcr_decide on project_conversion_requests;
create policy pcr_decide on project_conversion_requests for update to authenticated
  using (has_role('dept_head', source_department_id) or has_role('system_admin'));
drop policy if exists pcr_insert on project_conversion_requests;
create policy pcr_insert on project_conversion_requests for insert to authenticated with check (
  (requested_by = auth.uid())
  and (has_role('agent', source_department_id) or has_role('team_lead', source_department_id) or has_role('dept_head', source_department_id))
);
drop policy if exists pcr_read on project_conversion_requests;
create policy pcr_read on project_conversion_requests for select to authenticated using (
  (requested_by = auth.uid()) or has_role('dept_head', source_department_id) or has_role('pmo_admin') or has_role('executive') or has_role('system_admin')
);

drop policy if exists prj_read on projects;
create policy prj_read on projects for select to authenticated using (
  (created_by = auth.uid()) or (project_manager_id = auth.uid()) or (sponsor_id = auth.uid()) or is_assigned_to_project(id)
  or ((project_type = 'company'::project_type) and (
        has_role('system_admin') or has_role('executive') or has_role('pmo_admin')
        or pmo_has_permission('view_all_projects')
        or has_dept_role_any('dept_head'::platform_role, department_scope)
        or ((origin_department_id is not null) and has_role('dept_head', origin_department_id))))
);

drop policy if exists rd_read on report_definitions;
create policy rd_read on report_definitions for select to authenticated using (
  is_active and ((owner_id = auth.uid()) or (visibility = 'org')
    or ((visibility = 'dept') and (dept_id is not null)
        and (has_role('agent', dept_id) or has_role('team_lead', dept_id) or has_role('dept_head', dept_id)))
    or has_role('executive') or has_role('system_admin'))
);

drop policy if exists ev_read on request_events;
create policy ev_read on request_events for select to authenticated using (
  (exists (select 1 from requests r where r.id = request_events.request_id
     and (r.requester_id = auth.uid() or has_role('agent', r.dept_id) or has_role('team_lead', r.dept_id)
          or has_role('dept_admin', r.dept_id) or has_role('executive') or has_role('system_admin'))))
  and ((not ((event_type = 'comment') and coalesce((detail ->> 'internal')::boolean, false)))
       or (exists (select 1 from requests r2 where r2.id = request_events.request_id
             and (has_role('agent', r2.dept_id) or has_role('team_lead', r2.dept_id) or has_role('dept_admin', r2.dept_id)
                  or has_role('dept_head', r2.dept_id) or has_role('executive') or has_role('system_admin')))))
);

drop policy if exists req_agent_update on requests;
create policy req_agent_update on requests for update to authenticated
  using (has_role('system_admin')
    or ((not restricted) and (has_role('dept_head', dept_id) or has_role('dept_admin', dept_id) or has_role('team_lead', dept_id)
         or (has_role('agent', dept_id) and (team_id is not null) and is_team_member(team_id))))
    or (restricted and ((assignee_id = auth.uid()) or has_role('team_lead', dept_id) or has_role('dept_head', dept_id))))
  with check (has_role('system_admin')
    or ((not restricted) and (has_role('dept_head', dept_id) or has_role('dept_admin', dept_id) or has_role('team_lead', dept_id)
         or (has_role('agent', dept_id) and (team_id is not null) and is_team_member(team_id))))
    or (restricted and ((assignee_id = auth.uid()) or has_role('team_lead', dept_id) or has_role('dept_head', dept_id))));

drop policy if exists req_dept_scope on requests;
create policy req_dept_scope on requests for select using (
  case when restricted
    then ((assignee_id = auth.uid()) or has_role('team_lead', dept_id) or has_role('dept_head', dept_id) or has_role('system_admin'))
    else (has_role('agent', dept_id) or has_role('team_lead', dept_id) or has_role('dept_admin', dept_id) or has_role('executive') or has_role('system_admin'))
  end
);

drop policy if exists rr_write on routing_rules;
create policy rr_write on routing_rules for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin', dept_id))
  with check (has_role('system_admin') or has_role('dept_admin', dept_id));

drop policy if exists svc_write on services;
create policy svc_write on services for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin', dept_id))
  with check (has_role('system_admin') or has_role('dept_admin', dept_id));

drop policy if exists sla_all on sla_policies;
create policy sla_all on sla_policies for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin', (select s.dept_id from services s where s.id = sla_policies.service_id)))
  with check (has_role('system_admin') or has_role('dept_admin', (select s.dept_id from services s where s.id = sla_policies.service_id)));

drop policy if exists tm_dept_admin_write on team_members;
create policy tm_dept_admin_write on team_members for all to authenticated
  using (has_role('dept_admin', (select t.dept_id from teams t where t.id = team_members.team_id)))
  with check (has_role('dept_admin', (select t.dept_id from teams t where t.id = team_members.team_id)));

drop policy if exists teams_dept_admin_write on teams;
create policy teams_dept_admin_write on teams for all to authenticated
  using (has_role('dept_admin', dept_id))
  with check (has_role('dept_admin', dept_id));

drop policy if exists wf_read on workflow_definitions;
create policy wf_read on workflow_definitions for select to authenticated using (
  status = 'published' or has_role('system_admin')
  or has_role('dept_admin', (select s.dept_id from services s where s.id = workflow_definitions.service_id))
);
drop policy if exists wf_write on workflow_definitions;
create policy wf_write on workflow_definitions for all to authenticated
  using (has_role('system_admin') or has_role('dept_admin', (select s.dept_id from services s where s.id = workflow_definitions.service_id)))
  with check (has_role('system_admin') or has_role('dept_admin', (select s.dept_id from services s where s.id = workflow_definitions.service_id)));
