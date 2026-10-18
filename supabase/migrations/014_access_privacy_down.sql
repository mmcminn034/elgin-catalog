-- Rollback for 014 (restores the 013 state). Objects already copied to find-photos-private are left in place.
begin;
create policy "find-photos owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'find-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "private photos read" on storage.objects;
drop policy if exists "private photos insert" on storage.objects;
drop policy if exists "private photos update" on storage.objects;
drop policy if exists "private photos delete" on storage.objects;
drop trigger if exists profiles_zz_default_catalog on public.profiles;
drop function if exists public.profiles_default_catalog();
drop function if exists public.ensure_default_catalog();
drop function if exists public.create_default_catalog(uuid);  -- default catalogs that were created stay
grant execute on function public.plan_of(uuid) to anon, authenticated;
grant execute on function public.is_member(uuid) to anon, authenticated;
create policy "verified_examples insert own" on public.verified_examples for insert to authenticated with check (owner = auth.uid());
create policy "verified_examples update own" on public.verified_examples for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create or replace view public.discover_finds with (security_barrier = true) as
 SELECT f.catalog_id, f.category, f.object_type, f.material, f.era,
    COALESCE(f.region, f.admin1, f.country, 'Unknown'::text) AS region,
    f.suggestion_1, f.suggestion_2, f.suggestion_3, f.confidence, f.status, f.key_features,
    f.length_mm, f.length_source, f.width_mm, f.width_source, f.thickness_mm, f.thickness_source, f.weight_g, f.weight_source,
    f.created_at, f.updated_at, c.slug AS collection_slug,
    ( SELECT COALESCE(p.thumb_path, p.repo_path) FROM photos p WHERE p.catalog_id = f.catalog_id AND p.is_public ORDER BY p.sort LIMIT 1) AS thumb_repo,
    ( SELECT p.storage_path FROM photos p WHERE p.catalog_id = f.catalog_id AND p.is_public ORDER BY p.sort LIMIT 1) AS thumb_storage,
    (EXISTS ( SELECT 1 FROM verified_examples v WHERE v.catalog_id = f.catalog_id AND v.is_public)) AS verified,
    f.public_id, COALESCE(f.title, f.object_type) AS title
   FROM finds f LEFT JOIN collections c ON c.id = f.collection_id
  WHERE f.visibility = 'public' AND (f.collection_id IS NULL OR c.visibility = 'public' OR f.show_on_discover AND f.is_public);
create or replace function public.can_view_find(fid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from finds f where f.catalog_id = fid and (
    (f.visibility = 'public' and public.collection_is_public(f.collection_id))
    or f.owner = auth.uid()
    or (f.visibility <> 'private' and public.collection_role(f.collection_id) is not null)
    or public.collection_role(f.collection_id) = 'owner')) $$;
create or replace function public.find_on_discover(fid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from finds f where f.catalog_id = fid and f.show_on_discover and f.is_public and f.visibility = 'public') $$;
commit;
