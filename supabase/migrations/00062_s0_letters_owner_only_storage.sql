-- 00062 — S0 security hardening (3/4): raw letter scans become owner-only.
--
-- Watermarking has moved server-side (letter-rendition edge function): every
-- non-owner view is a per-viewer stamped PDF rendition produced with the
-- service role after a can_access_letter() check. The raw object therefore
-- no longer needs to be readable by shared viewers or department staff — and
-- a signed URL lifted from the browser's network tab no longer yields a
-- clean copy of a restricted or confidential letter.
--
-- Insert stays open to everyone with letter access (attaching scans),
-- delete stays owner-only (unchanged from 00039).

drop policy if exists letters_files_read on storage.objects;
create policy letters_files_read on storage.objects for select to authenticated
  using (bucket_id = 'letters' and exists (
    select 1 from letters t
    where t.id = ((storage.foldername(name))[1])::uuid
      and t.owner_id = auth.uid()
  ));
