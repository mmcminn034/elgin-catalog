-- 011: fossil and rocks & minerals reference layers in public.reference_types. WRITTEN ONLY, NOT APPLIED.
-- Additive: new nullable columns; existing artifact rows are untouched. Rows come from data/reference/public-fossils.json and
-- public-minerals.json via tools/reference/gen_seed_sql.py -> supabase/seed/011_reference_fossil_mineral_seed.sql (run after this file).
-- Access: owner-only read (same rule as 010); the service role bypasses RLS; no write policy (service role writes).
alter table public.reference_types add column if not exists rules boolean not null default false;   -- curated group entry used by the rules engine
alter table public.reference_types add column if not exists group_id text;                          -- PBDB genus -> curated group id
alter table public.reference_types add column if not exists fossil_kind text check (fossil_kind is null or fossil_kind in ('body','plant','trace','pseudo'));
alter table public.reference_types add column if not exists age_ma numeric[];                       -- [oldest, youngest] million years
alter table public.reference_types add column if not exists formations text[] not null default '{}';
alter table public.reference_types add column if not exists lookalikes text[] not null default '{}';
alter table public.reference_types add column if not exists localities text[] not null default '{}';
alter table public.reference_types add column if not exists taxonomy jsonb;                         -- {phylum, class, order, family}
alter table public.reference_types add column if not exists properties jsonb;                       -- {hardness, luster, streak, system, colors, formula}
alter table public.reference_types add column if not exists diagnostic text;                        -- our own summary, cited in sources
create index if not exists reference_types_category_idx on public.reference_types (category);
create index if not exists reference_types_group_idx on public.reference_types (group_id);
alter table public.reference_types enable row level security;
drop policy if exists "reference read" on public.reference_types;
drop policy if exists "reference owner read" on public.reference_types;
create policy "reference owner read" on public.reference_types for select
  using (exists (select 1 from public.collections c where c.slug = 'rolling-oak' and c.owner = auth.uid()));
-- Down: alter table public.reference_types drop column rules, drop column group_id, drop column fossil_kind, drop column age_ma, drop column formations,
--       drop column lookalikes, drop column localities, drop column taxonomy, drop column properties, drop column diagnostic;
--       delete from public.reference_types where category in ('fossil','rock');
