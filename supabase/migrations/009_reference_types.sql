-- 009: public reference layer (published typology summaries). WRITTEN ONLY, NOT APPLIED.
-- Additive: one new table, read-only to everyone, writable only by the service role (seed / maintenance).
-- No find data, no locations, no photos. Rows come from data/reference/public-types.json via
-- tools/reference/gen_seed_sql.py -> supabase/seed/009_reference_types_seed.sql (run after this file).
create table if not exists public.reference_types (
  id text primary key,                       -- e.g. ppn-nolan, pidba-clovis, wd-Q123, world-solutrean
  name text not null,
  aliases text[] not null default '{}',
  typology_system text not null,             -- 'North American projectile point', 'Upper Paleolithic industry', ...
  category text not null default 'artifact' check (category in ('artifact','fossil','rock')),
  period text, dates text,
  continent text, country text[] not null default '{}', admin1 text[] not null default '{}', region_notes text,
  length_mm int[], width_mm int[], thickness_mm int[],   -- [min, max]
  pidba jsonb,                               -- PIDBA measured summary {length_mm, width_mm, thickness_mm, measured_n}
  traits text[] not null default '{}',       -- keyword tags from a fixed vocabulary (not copied text)
  similar_types text[] not null default '{}',
  validity text,
  texas boolean not null default false, home_priority int not null default 3,
  sources jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) > 0),  -- [{name,url,retrieved,license}]
  updated_at timestamptz not null default now(),
  constraint reference_types_len_chk check (length_mm is null or array_length(length_mm, 1) = 2)
);
create index if not exists reference_types_name_idx on public.reference_types (lower(name));
create index if not exists reference_types_admin1_idx on public.reference_types using gin (admin1);
create index if not exists reference_types_traits_idx on public.reference_types using gin (traits);
alter table public.reference_types enable row level security;
drop policy if exists "reference read" on public.reference_types;
create policy "reference read" on public.reference_types for select using (true);   -- published reference data; no write policy => only service role writes
grant select on public.reference_types to anon, authenticated;
