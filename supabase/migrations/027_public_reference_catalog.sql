-- 027 (2026-11-11): free public Reference Catalog, stored in the existing reference_media table (extended, not duplicated).
-- * public_catalog = true marks institution-held records with open images (CC0 / PD / CC BY / CC BY-SA) that anyone may read,
--   including signed-out visitors. All other reference_media rows keep the owner-only rule from 019 (unchanged).
-- * catalog jsonb holds the display fields: name, type, material, period, age, formation, culture, region (county/state at most),
--   institution, catalog_number, creator, thumb (repo path) and search text. No coordinates or localities are ever stored.
-- * New rows are inserted with keywords = '{}' so similar_reference_media() (AI look-alike matching) behaves exactly as before.
-- Rows: tools/reference/import_public_catalog.py -> data/reference/public-catalog.json -> tools/reference/load_public_catalog_sql.py
-- Rollback: 027_public_reference_catalog_down.sql
begin;
alter table public.reference_media add column if not exists public_catalog boolean not null default false;
alter table public.reference_media add column if not exists catalog jsonb;
create index if not exists reference_media_public on public.reference_media (kind) where public_catalog;
drop policy if exists "reference_media public catalog read" on public.reference_media;
create policy "reference_media public catalog read" on public.reference_media for select to anon, authenticated using (public_catalog);
grant select on public.reference_media to anon, authenticated;
revoke insert, update, delete on public.reference_media from anon, authenticated;
commit;
