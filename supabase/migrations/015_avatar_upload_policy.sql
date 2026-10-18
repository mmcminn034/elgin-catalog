-- 015: the public bucket only accepts each user's own avatar (find photos go to find-photos-private since 014).
-- Rollback: 015_avatar_upload_policy_down.sql
begin;
drop policy if exists "find-photos avatar insert" on storage.objects;
create policy "find-photos avatar insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'find-photos' and name = auth.uid()::text || '/avatar.jpg');
drop policy if exists "find-photos owner update" on storage.objects;
create policy "find-photos owner update" on storage.objects for update to authenticated
  using (bucket_id = 'find-photos' and name = auth.uid()::text || '/avatar.jpg');
commit;
-- (applied separately) public URLs of a public bucket don't need a SELECT policy; dropping it stops anyone listing object names.
begin;
drop policy if exists "find-photos public read" on storage.objects;
commit;
-- Creating a catalog from the app (insert ... returning) failed: the read policy's collection_role() can't see the row being inserted.
begin;
drop policy if exists "collections read" on public.collections;
create policy "collections read" on public.collections for select using (is_public or owner = auth.uid() or collection_role(id) is not null);
commit;
-- replacing an avatar (upsert) needs to see your own existing object; nobody can list anyone else's
begin;
drop policy if exists "find-photos own avatar read" on storage.objects;
create policy "find-photos own avatar read" on storage.objects for select to authenticated
  using (bucket_id = 'find-photos' and name = auth.uid()::text || '/avatar.jpg');
commit;
