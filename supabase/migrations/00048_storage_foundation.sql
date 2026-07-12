-- 00048 — storage foundation (SPRINT2 branch 1): private buckets for request
-- attachments plus the originals/renditions pair reserved for the
-- correspondence module (created now, unused until Phase B).
--
-- Objects in `attachments` live at {request_id}/{filename}. Access mirrors
-- request visibility: the policy subquery on `requests` runs under the
-- caller's own RLS (invoker), so whoever can see the request can read its
-- files — requester, parent requester, dept agents, approvers, admins —
-- with zero duplicated predicates. No public access; the frontend downloads
-- via 60-second signed URLs only.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('attachments', 'attachments', false, 10485760), -- 10 MB server-side cap
  ('originals',   'originals',   false, null),
  ('renditions',  'renditions',  false, null)
on conflict (id) do nothing;

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and exists (
    select 1 from requests r
    where r.id = ((storage.foldername(name))[1])::uuid
  ));

drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and exists (
    select 1 from requests r
    where r.id = ((storage.foldername(name))[1])::uuid
      and (r.requester_id = auth.uid()
           or has_role('agent', r.dept) or has_role('team_lead', r.dept)
           or has_role('dept_head', r.dept) or has_role('system_admin'))
  ));

drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and exists (
    select 1 from requests r
    where r.id = ((storage.foldername(name))[1])::uuid
      and (r.requester_id = auth.uid()
           or has_role('agent', r.dept) or has_role('team_lead', r.dept)
           or has_role('system_admin'))
  ));
