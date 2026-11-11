-- Rollback for 027: the page goes back to owner-only reads (the Reference Catalog then shows its error state to visitors).
-- Data is NOT deleted here. To also remove the importer's rows, run separately (after a backup):
--   delete from public.reference_media where data ->> 'pc' = '1';
--   update public.reference_media set data = data - 'public' - 'catalog' where data ? 'public';
-- and empty the Storage bucket 'reference-media'.
begin;
drop policy if exists "reference_media public catalog read" on public.reference_media;
drop index if exists public.reference_media_pc_source_catno;
drop index if exists public.reference_media_public_idx;
commit;
