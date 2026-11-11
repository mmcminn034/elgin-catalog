-- 027 (2026-11-11, revised before first apply): free public Reference Catalog, read straight from reference_media.
-- Public-catalog rows are ordinary reference_media rows whose data->>'public' = '1' (display fields in data->'catalog').
-- They are written by tools/reference/import_public_catalog.py with the service key (REST + Storage), so no schema
-- columns are added. Rows from the catalog importer carry data->>'pc' = '1'; pre-existing rows from 019/025 only gain
-- data.public/data.catalog. Their keywords feed similar_reference_media() (AI look-alike matching), as Mark asked.
-- This migration adds:
--   1. anon + authenticated SELECT on public-catalog rows only, so signed-out visitors can read them. All other rows keep the 019 owner-only rule.
--   2. a unique index on (source, catalog number) for importer rows: the database enforces the weekly dedupe.
--   3. a partial index for the page query.
-- Rollback: 027_public_reference_catalog_down.sql
begin;
drop policy if exists "reference_media public catalog read" on public.reference_media;
create policy "reference_media public catalog read" on public.reference_media for select to anon, authenticated
  using ((data ->> 'public') = '1');
create unique index if not exists reference_media_pc_source_catno on public.reference_media (source, upper(data -> 'catalog' ->> 'catalog_number'))
  where (data ->> 'pc') = '1' and coalesce(data -> 'catalog' ->> 'catalog_number', '') <> '';
create index if not exists reference_media_public_idx on public.reference_media (kind, id) where (data ->> 'public') = '1';
commit;
