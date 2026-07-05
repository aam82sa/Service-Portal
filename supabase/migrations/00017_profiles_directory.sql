-- Internal directory: any signed-in user may see active colleagues' names
-- (needed for the self-service delegation picker). Inactive profiles stay
-- visible only to admins via the existing policies.
create policy prof_directory on profiles for select to authenticated
  using (is_active);
