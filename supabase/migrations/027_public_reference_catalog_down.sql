-- Rollback for 027: removes only what 027 added. Rows created by the public catalog loader carry data->>'pc' = '1' and are deleted;
-- pre-existing rows (the 344 from 019/025) are kept and only lose the two new columns.
begin;
drop policy if exists "reference_media public catalog read" on public.reference_media;
delete from public.reference_media where data ->> 'pc' = '1';
drop index if exists public.reference_media_public;
alter table public.reference_media drop column if exists catalog;
alter table public.reference_media drop column if exists public_catalog;
commit;
