begin;
drop policy if exists "find-photos avatar insert" on storage.objects;
drop policy if exists "find-photos owner update" on storage.objects;
create policy "find-photos owner update" on storage.objects for update to authenticated
  using ((bucket_id = 'find-photos') and ((storage.foldername(name))[1] = (auth.uid())::text));
create policy "find-photos public read" on storage.objects for select using (bucket_id = 'find-photos');
drop policy if exists "collections read" on public.collections;
create policy "collections read" on public.collections for select using (is_public OR (collection_role(id) IS NOT NULL));
commit;
