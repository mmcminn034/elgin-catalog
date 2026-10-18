-- 014: access & privacy hardening (2026-10-18 audit)
--  * public = visible to everyone: Discover/public photos follow the UF public id (any public find, any user),
--    except legacy 'members' catalogs (Rolling Oak) where a find still needs the Discover opt-in until Mark confirms.
--  * verified_examples writes only by the find's owner/editors; plan lookups not callable by clients.
--  * default 'My Collection' for every account; private photo bucket with per-find RLS.
-- Rollback: 014_access_privacy_down.sql
begin;

-- ===== public visibility follows the UF public id =====
create or replace function public.find_on_discover(fid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from finds f where f.catalog_id = fid and f.visibility = 'public' and f.public_id is not null) $$;

create or replace function public.can_view_find(fid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from finds f where f.catalog_id = fid and (
    (f.visibility = 'public' and f.public_id is not null)
    or (f.visibility = 'public' and public.collection_is_public(f.collection_id))
    or f.owner = auth.uid()
    or (f.visibility <> 'private' and public.collection_role(f.collection_id) is not null)
    or public.collection_role(f.collection_id) = 'owner')) $$;

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
  WHERE f.visibility = 'public' AND f.public_id IS NOT NULL;
grant select on public.discover_finds to anon, authenticated;

-- ===== verified examples: only the find's owner/editors may add or change them =====
drop policy if exists "verified_examples insert own" on public.verified_examples;
drop policy if exists "verified_examples update own" on public.verified_examples;

-- ===== plan lookups for arbitrary users are internal only =====
revoke execute on function public.plan_of(uuid) from public, anon, authenticated;
revoke execute on function public.is_member(uuid) from public, anon, authenticated;

-- ===== default catalog for every account =====
create or replace function public.create_default_catalog(u uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select id into cid from collections where owner = u order by created_at limit 1;
  if cid is not null then return cid; end if;
  insert into collections (slug, name, owner, visibility, is_public)
  values ('my-collection-' || substr(replace(u::text, '-', ''), 1, 8) || '-' || substr(md5(random()::text), 1, 4), 'My Collection', u, 'private', false)
  returning id into cid;
  return cid;
end $$;
revoke all on function public.create_default_catalog(uuid) from public, anon, authenticated;
create or replace function public.ensure_default_catalog() returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  return public.create_default_catalog(auth.uid());
end $$;
revoke all on function public.ensure_default_catalog() from public, anon;
grant execute on function public.ensure_default_catalog() to authenticated;
create or replace function public.profiles_default_catalog() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.create_default_catalog(new.id); return new; end $$;
drop trigger if exists profiles_zz_default_catalog on public.profiles;
create trigger profiles_zz_default_catalog after insert on public.profiles for each row execute function public.profiles_default_catalog();
select public.create_default_catalog(p.id) from public.profiles p where not exists (select 1 from public.collections c where c.owner = p.id);

-- ===== private photo bucket: readable only when the find is visible to the caller =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('find-photos-private', 'find-photos-private', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;
drop policy if exists "private photos read" on storage.objects;
drop policy if exists "private photos insert" on storage.objects;
drop policy if exists "private photos update" on storage.objects;
drop policy if exists "private photos delete" on storage.objects;
create policy "private photos read" on storage.objects for select
  using (bucket_id = 'find-photos-private' and public.can_view_find((storage.foldername(name))[2]));
create policy "private photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'find-photos-private' and (storage.foldername(name))[1] = auth.uid()::text and public.can_edit_find((storage.foldername(name))[2]));
create policy "private photos update" on storage.objects for update to authenticated
  using (bucket_id = 'find-photos-private' and public.can_edit_find((storage.foldername(name))[2]));
create policy "private photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'find-photos-private' and public.can_edit_find((storage.foldername(name))[2]));
-- the old public bucket stops accepting new uploads (existing public URLs keep working until migrated)
drop policy if exists "find-photos owner insert" on storage.objects;

commit;
