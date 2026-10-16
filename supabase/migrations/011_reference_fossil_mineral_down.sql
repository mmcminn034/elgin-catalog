-- Down for 011: remove the fossil and rocks & minerals reference rows and the added columns. The artifact rows and the
-- owner-only read policy from 010 stay in place. Full pre-011 data backup: /workspace/backups/pre-fm-2026-10-16/ (tag backup/pre-fossil-mineral-2026-10-16).
begin;
delete from public.reference_types where category in ('fossil','rock');
drop index if exists public.reference_types_group_idx;
drop index if exists public.reference_types_category_idx;
alter table public.reference_types
  drop column if exists rules, drop column if exists group_id, drop column if exists fossil_kind, drop column if exists age_ma,
  drop column if exists formations, drop column if exists lookalikes, drop column if exists localities, drop column if exists taxonomy,
  drop column if exists properties, drop column if exists diagnostic;
-- 010's policy is the same rule as 011's; restate it so the down leaves the 010 state.
drop policy if exists "reference owner read" on public.reference_types;
create policy "reference owner read" on public.reference_types for select
  using (exists (select 1 from public.collections c where c.slug = 'rolling-oak' and c.owner = auth.uid()));
commit;
