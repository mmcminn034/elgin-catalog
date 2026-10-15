-- 008: status progression, per-find Discover, measurement photo refs.  WRITTEN ONLY, NOT APPLIED (needs Mark's approval).
-- Additive and idempotent. No data is deleted; existing Draft/Reviewed values stay valid; exact locations are untouched
-- (find_locations is not referenced). After applying, set ROLLING_OAK_CLOUD.schema008 = true in assets/js/config.js.

-- 1. Status: allow the progression Draft -> Needs review -> Reviewed -> Verified (there was no status check before).
alter table public.finds drop constraint if exists finds_status_chk;
alter table public.finds add constraint finds_status_chk
  check (status is null or status in ('Draft', 'Needs review', 'Reviewed', 'Verified')) not valid;
alter table public.finds validate constraint finds_status_chk;   -- live rows today are only Draft / Reviewed
create index if not exists finds_status_idx on public.finds (status);

-- 2. Per-find Discover opt-in. A find shows on Discover when the owner opts it in, even if the collection is members-only.
--    Opt-in is a separate flag so the 14 finds that are already visibility='public' inside the members-only collection
--    do NOT suddenly appear on Discover when this migration runs.
alter table public.finds add column if not exists show_on_discover boolean not null default false;
alter table public.finds add column if not exists vis_before_discover text;
alter table public.finds drop constraint if exists finds_discover_public_chk;
alter table public.finds add constraint finds_discover_public_chk
  check (not show_on_discover or (visibility = 'public' and is_public));

-- Same columns and order as before (coarse region only, no coordinates); only the WHERE clause widens.
create or replace view public.discover_finds with (security_barrier = true) as
select f.catalog_id, f.category, f.object_type, f.material, f.era,
       coalesce(f.region, f.admin1, f.country, 'Unknown') as region,
       f.suggestion_1, f.suggestion_2, f.suggestion_3, f.confidence, f.status, f.key_features,
       f.length_mm, f.length_source, f.width_mm, f.width_source, f.thickness_mm, f.thickness_source, f.weight_g, f.weight_source,
       f.created_at, f.updated_at, c.slug as collection_slug,
       (select coalesce(p.thumb_path, p.repo_path) from public.photos p where p.catalog_id = f.catalog_id and p.is_public order by p.sort limit 1) as thumb_repo,
       (select p.storage_path from public.photos p where p.catalog_id = f.catalog_id and p.is_public order by p.sort limit 1) as thumb_storage,
       exists (select 1 from public.verified_examples v where v.catalog_id = f.catalog_id and v.is_public) as verified
from public.finds f left join public.collections c on c.id = f.collection_id
where f.visibility = 'public'
  and ((f.collection_id is null or c.visibility = 'public')                 -- unchanged: public collection
       or (f.show_on_discover and f.is_public));                            -- new: individually opted-in find
grant select on public.discover_finds to anon, authenticated;

-- Photos: an opted-in find's PUBLIC photos are readable (only that find's is_public photos; private photos stay private).
drop policy if exists "photos discover read" on public.photos;
create policy "photos discover read" on public.photos for select using (
  is_public and exists (select 1 from public.finds f where f.catalog_id = photos.catalog_id
                        and f.show_on_discover and f.is_public and f.visibility = 'public'));

-- 3. Measurements: which photo a "From ruler in photo #N" value came from, e.g. {"length": 3, "width": 3}.
--    The *_source columns keep their existing values (measured / photo_estimate / estimate).
alter table public.finds add column if not exists measure_refs jsonb;
alter table public.finds drop constraint if exists finds_measure_refs_chk;
alter table public.finds add constraint finds_measure_refs_chk
  check (measure_refs is null or jsonb_typeof(measure_refs) = 'object');

-- 4. SEED (run only when Mark approves which finds go public). ELG-001 plus three others; their photos marked public.
--    Region shown stays coarse (e.g. 'Bastrop County, Texas'); exact location remains in owner-only find_locations.
-- update public.finds set vis_before_discover = visibility, visibility = 'public', is_public = true, show_on_discover = true
--   where catalog_id in ('ELG-001', 'ELG-002', 'ELG-003', 'ELG-005');
-- update public.photos set is_public = true where catalog_id in ('ELG-001', 'ELG-002', 'ELG-003', 'ELG-005');

-- Verify:
--   select catalog_id, region from public.discover_finds order by 1;           -- as anon: only opted-in finds, coarse region
--   select count(*) from public.finds where status not in ('Draft','Needs review','Reviewed','Verified');  -- 0
