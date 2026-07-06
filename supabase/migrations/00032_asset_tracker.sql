-- ABC Services Hub — advanced asset tracker
-- Extends hardware with procurement/warranty/location data and ownership
-- history, licenses with subscription tracking, and adds cloud inventory
-- (servers, VMs, Azure resources) plus monthly Azure credit. Modeled on the
-- IT assets tracker workbook; core assign/return/QR/governance unchanged.

-- ============ A) Hardware: tracker fields ============
alter table assets
  add column manufacturer text,
  add column vendor text,
  add column po_number text,
  add column cost numeric,                   -- SAR
  add column delivery_date date,
  add column warranty_start date,
  add column warranty_end date,
  add column location text,                  -- e.g. Tasama Store
  add column assigned_at date,
  add column assigned_name text;             -- holder name when not in profiles

-- ============ B) Ownership history ============
-- Replaces the sheet's fixed "Previous Owner 1/2" columns with n rows.
create table asset_ownership (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  profile_id uuid references profiles(id),
  owner_name text,                           -- fallback when not in profiles
  assigned_at date,
  returned_at date,
  created_at timestamptz not null default now()
);
create index on asset_ownership (asset_id);

alter table asset_ownership enable row level security;
create policy aow_read on asset_ownership for select to authenticated
  using (exists (select 1 from assets a where a.id = asset_id));
create policy aow_write on asset_ownership for all to authenticated
  using (has_role('agent', 'IT') or has_role('team_lead', 'IT')
         or has_role('dept_head', 'IT') or has_role('system_admin'))
  with check (has_role('agent', 'IT') or has_role('team_lead', 'IT')
              or has_role('dept_head', 'IT') or has_role('system_admin'));

-- ============ C) Licenses: subscription tracking ============
-- subscription_status is the vendor-side state (Active/Expired sheets);
-- the existing governance status (pending/active/rejected) is untouched.
alter table licenses
  add column po_number text,
  add column billing_profile text,
  add column purchase_date date,
  add column owner_email text,
  add column subscription_status text not null default 'active'
    check (subscription_status in ('active', 'expired'));

-- ============ D) Cloud inventory ============
create type cloud_kind as enum ('server', 'vm', 'azure_resource');

create table cloud_resources (
  id uuid primary key default gen_random_uuid(),
  kind cloud_kind not null,
  name text not null,
  os_or_type text,                           -- OS for servers, resource type for Azure
  serial text,
  manufacturer text,
  environment text,                          -- Dev / Prod
  priority text,                             -- Low / High
  status text,                               -- Running / Shutdown / ...
  owner_name text,
  owner_email text,
  location text,                             -- Azure region
  resource_group text,
  subscription text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, name)
);
create trigger cloud_resources_touch before update on cloud_resources
  for each row execute function touch_updated_at();

-- ============ E) Azure credit (monthly burn) ============
create table azure_credit (
  id uuid primary key default gen_random_uuid(),
  month date not null unique,                -- first of month
  starting_credit numeric,
  new_credit numeric,
  adjustments numeric,
  forecast_charges numeric,
  forecast_ending numeric,
  applied_charges numeric,
  ending_credit numeric,
  created_at timestamptz not null default now()
);

alter table cloud_resources enable row level security;
alter table azure_credit enable row level security;

create policy clr_read on cloud_resources for select to authenticated
  using (has_role('agent', 'IT') or has_role('team_lead', 'IT')
         or has_role('dept_head', 'IT') or has_role('executive') or has_role('system_admin'));
create policy clr_write on cloud_resources for all to authenticated
  using (has_role('agent', 'IT') or has_role('team_lead', 'IT')
         or has_role('dept_head', 'IT') or has_role('system_admin'))
  with check (has_role('agent', 'IT') or has_role('team_lead', 'IT')
              or has_role('dept_head', 'IT') or has_role('system_admin'));

create policy azc_read on azure_credit for select to authenticated
  using (has_role('agent', 'IT') or has_role('team_lead', 'IT')
         or has_role('dept_head', 'IT') or has_role('executive') or has_role('system_admin'));
create policy azc_write on azure_credit for all to authenticated
  using (has_role('agent', 'IT') or has_role('team_lead', 'IT')
         or has_role('dept_head', 'IT') or has_role('system_admin'))
  with check (has_role('agent', 'IT') or has_role('team_lead', 'IT')
              or has_role('dept_head', 'IT') or has_role('system_admin'));
