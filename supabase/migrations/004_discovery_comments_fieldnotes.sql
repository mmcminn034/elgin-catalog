-- 004_discovery_comments_fieldnotes.sql: Discover view, comments/expert requests, per-dimension measurement sources, field notes.
-- Idempotent and additive only (no drops of data or columns). Run after 001-003.

-- ===== 1. Measurement sources + field notes on finds (existing values untouched) =====
alter table public.finds add column if not exists length_source text;
alter table public.finds add column if not exists width_source text;
alter table public.finds add column if not exists thickness_source text;
alter table public.finds add column if not exists weight_source text;
alter table public.finds add column if not exists condition_notes text;
alter table public.finds add column if not exists heat_treatment text;
alter table public.finds add column if not exists heat_notes text;
alter table public.finds add column if not exists use_wear text;
do $$ declare c text; begin
  foreach c in array array['length_source','width_source','thickness_source','weight_source'] loop
    execute format('alter table public.finds drop constraint if exists finds_%s_chk', c);
    execute format('alter table public.finds add constraint finds_%1$s_chk check (%1$s is null or %1$s in (''measured'',''photo_estimate'',''estimate''))', c);
  end loop; end $$;
alter table public.finds drop constraint if exists finds_heat_chk;
alter table public.finds add constraint finds_heat_chk check (heat_treatment is null or heat_treatment in ('none','possible','likely','unknown'));
-- non-destructive backfill: derive a source from the old single measure_method only where a value exists and no source is set
update public.finds set
  length_source    = coalesce(length_source,    case when length_mm    is not null and length_mm    <> '' then case when measure_method ilike 'measured%' then 'measured' when measure_method ilike '%photo%' then 'photo_estimate' else 'estimate' end end),
  width_source     = coalesce(width_source,     case when width_mm     is not null and width_mm     <> '' then case when measure_method ilike 'measured%' then 'measured' when measure_method ilike '%photo%' then 'photo_estimate' else 'estimate' end end),
  thickness_source = coalesce(thickness_source, case when thickness_mm is not null and thickness_mm <> '' then case when measure_method ilike 'measured%' then 'measured' when measure_method ilike '%photo%' then 'photo_estimate' else 'estimate' end end),
  weight_source    = coalesce(weight_source,    case when weight_g     is not null and weight_g::text <> '' then case when measure_method ilike 'measured%' then 'measured' else 'estimate' end end);

-- ===== 2. Discover: public, safe-columns-only view (never locations, owner ids or private notes) =====
create or replace view public.discover_finds with (security_barrier = true) as
  select f.catalog_id, f.category, f.object_type, f.material, f.era, coalesce(f.region, 'Texas') as region,
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

-- ===== 3. Comments, questions and expert requests =====
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  catalog_id text not null references public.finds(catalog_id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'comment' check (kind in ('comment','question','expert')),
  body text not null check (length(btrim(body)) between 1 and 4000),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_catalog_idx on public.comments(catalog_id, created_at);
alter table public.comments enable row level security;
create or replace function public.is_find_owner(fid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from finds f where f.catalog_id = fid and (f.owner = auth.uid() or public.collection_role(f.collection_id) = 'owner'));
$$;
grant execute on function public.is_find_owner(text) to anon, authenticated;
drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select using (public.can_view_find(catalog_id));       -- visibility follows the find
drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments for insert to authenticated with check (user_id = auth.uid() and resolved = false and public.can_view_find(catalog_id));
drop policy if exists "comments resolve" on public.comments;
create policy "comments resolve" on public.comments for update to authenticated using (public.can_edit_find(catalog_id)) with check (public.can_edit_find(catalog_id));
drop policy if exists "comments delete" on public.comments;
create policy "comments delete" on public.comments for delete to authenticated using (user_id = auth.uid() or public.is_find_owner(catalog_id));  -- own comment, or moderation by the find owner
grant select on public.comments to anon, authenticated;
grant insert (catalog_id, kind, body) on public.comments to authenticated;
grant update (resolved) on public.comments to authenticated;   -- only the resolved flag can change
grant delete on public.comments to authenticated;
