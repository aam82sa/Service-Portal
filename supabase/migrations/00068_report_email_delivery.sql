-- 00068 — report email-once delivery: external allowlist + capability (W9 B4).
--
-- generate-report produces an artifact; send-notification (mode:'report')
-- emails it once, attaching the file when it is small enough or linking to it
-- otherwise. Internal recipients (a Services Hub profile) are always allowed;
-- external addresses are only permitted when BOTH hold:
--   * the requester has the report_external_delivery capability, and
--   * the address is on an admin-managed allowlist.
-- Every send is written to report_deliveries (00067) for the PDPL trail.

-- personal-data reports (e.g. employee performance, Branch 7) are flagged here
-- so deliveries can record it; the deferred secure-link hardening keys off it.
alter table report_definitions
  add column if not exists contains_personal_data boolean not null default false;

-- ---- external-delivery allowlist (admin-managed) ----
create table if not exists report_delivery_allowlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  note text,
  added_by uuid references profiles(id),
  tenant_id uuid,
  created_at timestamptz not null default now()
);
-- one row per address, case-insensitive
create unique index if not exists report_delivery_allowlist_email_idx
  on report_delivery_allowlist (lower(email));

alter table report_delivery_allowlist enable row level security;
-- admins manage; dept heads may read to see what's permitted
create policy rda_read on report_delivery_allowlist for select to authenticated
  using (has_role('system_admin') or has_role('dept_head'));
create policy rda_write on report_delivery_allowlist for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));

-- ---- capability grants (presence == report_external_delivery capability) ----
create table if not exists report_delivery_grants (
  profile_id uuid primary key references profiles(id) on delete cascade,
  granted_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
alter table report_delivery_grants enable row level security;
create policy rdg_read on report_delivery_grants for select to authenticated
  using (profile_id = auth.uid() or has_role('system_admin'));
create policy rdg_write on report_delivery_grants for all to authenticated
  using (has_role('system_admin')) with check (has_role('system_admin'));

-- ---- capability check for a specific profile (usable by UI + edge function) ----
-- has_role() reads auth.uid(); this resolves the capability for an arbitrary
-- profile (the run's requester), so it queries role_assignments directly.
create or replace function report_can_deliver_external(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    exists (select 1 from role_assignments where profile_id = p_profile and role = 'system_admin')
    or exists (select 1 from report_delivery_grants where profile_id = p_profile),
    false
  );
$$;
revoke all on function report_can_deliver_external(uuid) from public, anon;
grant execute on function report_can_deliver_external(uuid) to authenticated, service_role;
