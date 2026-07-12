-- 00058 — queue saved views (SPRINT3 branch 6): named queue filters,
-- personal by default; a team lead can share a view with their team.

create table if not exists saved_views (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  scope text not null default 'personal' check (scope in ('personal', 'team')),
  team_id uuid references teams(id) on delete cascade,
  filter jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (scope = 'personal' or team_id is not null)
);

alter table saved_views enable row level security;

-- visible: your own views + views shared with a team you belong to
drop policy if exists sv_read on saved_views;
create policy sv_read on saved_views for select to authenticated
  using (owner_id = auth.uid() or (scope = 'team' and is_team_member(team_id)));

-- create: always as yourself; sharing to a team requires being its lead
drop policy if exists sv_insert on saved_views;
create policy sv_insert on saved_views for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (scope = 'personal' or is_team_lead(team_id))
  );

-- change/remove: the owner, or a lead of the team it is shared with
drop policy if exists sv_update on saved_views;
create policy sv_update on saved_views for update to authenticated
  using (owner_id = auth.uid() or (scope = 'team' and is_team_lead(team_id)))
  with check (
    owner_id = auth.uid() and (scope = 'personal' or is_team_lead(team_id))
    or (scope = 'team' and is_team_lead(team_id))
  );
drop policy if exists sv_delete on saved_views;
create policy sv_delete on saved_views for delete to authenticated
  using (owner_id = auth.uid() or (scope = 'team' and is_team_lead(team_id)));
