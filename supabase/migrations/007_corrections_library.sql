-- 007_corrections_library.sql: Stage 4 (corrections -> verified library -> similar examples). ADDITIVE ONLY.
-- NOT APPLIED. Run only after Mark approves. The app works without it (source/kept ride in corrections.reason).

-- 1. Corrections: where the suggestion came from and whether the owner kept it.
alter table public.corrections add column if not exists source text;     -- 'ai' | 'rules' | 'owner'
alter table public.corrections add column if not exists kept boolean;    -- true = owner kept the suggestion; false = corrected
alter table public.corrections drop constraint if exists corrections_source_chk;
alter table public.corrections add constraint corrections_source_chk check (source is null or source in ('ai','rules','owner'));
-- Backfill from the reason prefix written by the Stage 4 client: "[kept:rules] ..." / "[corrected:AI] ..."
update public.corrections set kept = (reason like '[kept:%'), source = lower(substring(reason from '^\[(?:kept|corrected):([A-Za-z]+)\]'))
  where source is null and reason ~ '^\[(kept|corrected):(ai|AI|rules|owner)\]';
-- Origin corrections must stay coarse (same rule as finds.region).
alter table public.corrections drop constraint if exists corrections_origin_coarse;
alter table public.corrections add constraint corrections_origin_coarse check (field <> 'origin' or new_value is null or (new_value !~ '[0-9]+\.[0-9]{2,}' and new_value !~ '^\s*[0-9]+\s+\w' and length(new_value) <= 80));

-- 2. Verified library: geologic setting + era for worldwide retrieval (country/admin1 were added in 006).
alter table public.verified_examples add column if not exists origin_setting text;
alter table public.verified_examples add column if not exists era text;

-- 3. Field accuracy (aggregate only, no row data, no owner ids): kept vs corrected per field and source.
create or replace function public.field_accuracy() returns table (field text, source text, kept bigint, corrected bigint, total bigint)
  language sql stable security definer set search_path = public as $$
  select c.field, coalesce(c.source, 'unknown'), count(*) filter (where c.kept), count(*) filter (where c.kept is false), count(*)
  from public.corrections c where c.field in ('category','type','material','era','origin') group by 1, 2 $$;
revoke all on function public.field_accuracy() from public;
grant execute on function public.field_accuracy() to authenticated;
