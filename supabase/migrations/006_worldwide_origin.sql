-- 006_worldwide_origin.sql: Stages 1-2 of the worldwide plan. ADDITIVE ONLY: new nullable columns, a backfill
-- for existing ELG rows, and a Discover view fallback that no longer assumes Texas. Nothing is dropped or renamed.
-- NOT YET APPLIED to the live project; run in the SQL editor only after Mark approves the preview.
-- Exact GPS stays only in public.find_locations (unchanged). Every new text column is coarse-checked like region.

-- 1. Collection home region (drives the "differs from home region" hint). Mark's collection keeps Bastrop/Elgin.
alter table public.collections add column if not exists home_region text;          -- region pack id, e.g. 'bastrop-tx'
update public.collections set home_region = 'bastrop-tx' where slug = 'rolling-oak' and home_region is null;

-- 2. Finds: coarse place fields + likely-origin suggestions.
alter table public.finds add column if not exists country text;                    -- ISO-3166 alpha-2, e.g. 'US'
alter table public.finds add column if not exists admin1 text;                     -- state / province, e.g. 'Texas'
alter table public.finds add column if not exists origin_guess jsonb;              -- [{region, setting, confidence, why, source}] (AI or rules)
alter table public.finds add column if not exists origin_confirmed text;           -- owner/reviewer-confirmed origin, coarse only

alter table public.finds drop constraint if exists finds_country_code;
alter table public.finds add constraint finds_country_code check (country is null or country ~ '^[A-Z]{2}$');
alter table public.finds drop constraint if exists finds_admin1_coarse;
alter table public.finds add constraint finds_admin1_coarse check (admin1 is null or (admin1 !~ '[0-9]' and length(admin1) <= 60));
alter table public.finds drop constraint if exists finds_origin_confirmed_coarse;
alter table public.finds add constraint finds_origin_confirmed_coarse check (origin_confirmed is null or (origin_confirmed !~ '[0-9]+\.[0-9]{2,}' and origin_confirmed !~ '^\s*[0-9]+\s+\w' and length(origin_confirmed) <= 80));
-- origin_guess must never carry coordinates: reject lat/lon-like keys and long decimals anywhere in the JSON text.
alter table public.finds drop constraint if exists finds_origin_guess_coarse;
alter table public.finds add constraint finds_origin_guess_coarse check (origin_guess is null or (origin_guess::text !~* '"(lat|lon|lng|latitude|longitude|coords?)"' and origin_guess::text !~ '[0-9]+\.[0-9]{3,}'));

-- 3. Backfill existing finds (no existing value is overwritten).
update public.finds set country = 'US' where country is null and catalog_id like 'ELG-%';
update public.finds set admin1 = 'Texas' where admin1 is null and catalog_id like 'ELG-%'
  and (provenance_answer = 'local' or (provenance_answer is null and coalesce(region, '') ilike '%Texas%'));
update public.finds set origin_confirmed = region where origin_confirmed is null and provenance_answer = 'local' and region is not null;
-- Collection pieces (e.g. ELG-017 Nevada, ELG-026 Idaho) keep their own provenance; admin1 = last part of region when it names a state.
update public.finds set admin1 = trim(split_part(split_part(region, ' (', 1), ',', array_length(string_to_array(split_part(region, ' (', 1), ','), 1)))
  where admin1 is null and provenance_answer = 'collection' and region is not null;

-- 4. Verified library gets the same coarse place fields (used by Stage 4 retrieval).
alter table public.verified_examples add column if not exists country text;
alter table public.verified_examples add column if not exists admin1 text;

-- 5. Discover view: stop defaulting to 'Texas'. Same columns, same order (create or replace is allowed); only the fallback changes.
create or replace view public.discover_finds with (security_barrier = true) as
  select f.catalog_id, f.category, f.object_type, f.material, f.era, coalesce(f.region, f.admin1, f.country, 'Unknown') as region,
         f.suggestion_1, f.suggestion_2, f.suggestion_3, f.confidence, f.status, f.key_features,
         f.length_mm, f.length_source, f.width_mm, f.width_source, f.thickness_mm, f.thickness_source, f.weight_g, f.weight_source,
         f.created_at, f.updated_at, c.slug as collection_slug,
         (select coalesce(p.thumb_path, p.repo_path) from public.photos p where p.catalog_id = f.catalog_id and p.is_public order by p.sort limit 1) as thumb_repo,
         (select p.storage_path from public.photos p where p.catalog_id = f.catalog_id and p.is_public order by p.sort limit 1) as thumb_storage,
         exists (select 1 from public.verified_examples v where v.catalog_id = f.catalog_id and v.is_public) as verified
  from public.finds f left join public.collections c on c.id = f.collection_id
  where f.visibility = 'public' and (f.collection_id is null or c.visibility = 'public');
revoke all on public.discover_finds from public;
grant select on public.discover_finds to anon, authenticated;
