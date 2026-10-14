-- 003_learning_visibility.sql: feedback loop, verified references, accuracy stats, 3-level visibility, fuzzed public region.
-- Idempotent. Run after schema.sql, 001 and 002. Existing 14 finds and columns are kept; this only adds.

-- ===== 1. Visibility: private (owner + collection owner) | editors (collection members) | public =====
alter table public.finds add column if not exists visibility text;
alter table public.finds add column if not exists region text;            -- public, county-level only, e.g. 'Bastrop County, Texas'
update public.finds set visibility = case when is_public then 'public' else 'editors' end where visibility is null;
alter table public.finds alter column visibility set default 'public';
alter table public.finds alter column visibility set not null;
alter table public.finds drop constraint if exists finds_visibility_chk;
alter table public.finds add constraint finds_visibility_chk check (visibility in ('private','editors','public'));
-- region must never carry coordinates or a street address (no decimals with 3+ places, no house numbers)
alter table public.finds drop constraint if exists finds_region_coarse;
alter table public.finds add constraint finds_region_coarse check (region is null or (region !~ '[0-9]+\.[0-9]{2,}' and region !~ '^\s*[0-9]+\s+\w' and length(region) <= 80));
update public.finds set region = 'Bastrop County, Texas' where region is null and catalog_id like 'ELG-%';

alter table public.collections add column if not exists visibility text;
update public.collections set visibility = case when is_public then 'public' else 'members' end where visibility is null;
alter table public.collections alter column visibility set default 'public';
alter table public.collections drop constraint if exists collections_visibility_chk;
alter table public.collections add constraint collections_visibility_chk check (visibility in ('private','members','public'));

-- keep legacy is_public in sync with visibility (either column may be written by older/newer clients)
create or replace function public.sync_visibility() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.visibility is not distinct from old.visibility and new.is_public is distinct from old.is_public then
    new.visibility := case when new.is_public then 'public' when tg_table_name = 'collections' then 'members' else 'editors' end;
  end if;
  new.visibility := coalesce(new.visibility, case when new.is_public is false then (case when tg_table_name = 'collections' then 'members' else 'editors' end) else 'public' end);
  new.is_public := new.visibility = 'public';
  return new;
end $$;
drop trigger if exists finds_sync_visibility on public.finds;
create trigger finds_sync_visibility before insert or update on public.finds for each row execute function public.sync_visibility();
drop trigger if exists collections_sync_visibility on public.collections;
create trigger collections_sync_visibility before insert or update on public.collections for each row execute function public.sync_visibility();

-- read rules: public -> anyone (if collection public); editors -> any collection member; private -> find owner + collection owner
create or replace function public.can_view_find(fid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from finds f where f.catalog_id = fid and (
    (f.visibility = 'public' and public.collection_is_public(f.collection_id))
    or f.owner = auth.uid()
    or (f.visibility <> 'private' and public.collection_role(f.collection_id) is not null)
    or public.collection_role(f.collection_id) = 'owner'));
$$;
drop policy if exists "finds read" on public.finds;
create policy "finds read" on public.finds for select using (
  (visibility = 'public' and public.collection_is_public(collection_id)) or owner = auth.uid()
  or (visibility <> 'private' and public.collection_role(collection_id) is not null) or public.collection_role(collection_id) = 'owner');
-- photos/corrections policies from 001 already call can_view_find / can_edit_find, so they inherit the new rules.
-- find_locations is untouched: owner + collection editors only, never anon (exact GPS never leaves that table).

-- ===== 2. Feedback on identifications =====
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  catalog_id text not null references public.finds(catalog_id) on delete cascade,
  photo_index int,
  candidate_type text not null,                         -- the suggested type the verdict is about
  verdict text not null check (verdict in ('match','close','wrong')),
  correction text check (length(correction) <= 2000),
  better_type text check (length(better_type) <= 200), -- reference KB type name or free text
  source text not null default 'engine' check (source in ('engine','ai','owner')),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists feedback_catalog_idx on public.feedback(catalog_id);
create index if not exists feedback_type_idx on public.feedback(lower(candidate_type));
alter table public.feedback enable row level security;
drop policy if exists "feedback insert" on public.feedback;
create policy "feedback insert" on public.feedback for insert to authenticated with check (user_id = auth.uid() and public.can_view_find(catalog_id));
drop policy if exists "feedback read" on public.feedback;
create policy "feedback read" on public.feedback for select to authenticated using (user_id = auth.uid() or public.can_edit_find(catalog_id));
drop policy if exists "feedback delete own" on public.feedback;
create policy "feedback delete own" on public.feedback for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.feedback to authenticated;

-- aggregate agreement per type (no user ids or notes exposed); readable by everyone for the About panel
create or replace function public.type_accuracy() returns table (candidate_type text, matches bigint, close bigint, wrong bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select min(candidate_type), count(*) filter (where verdict = 'match'), count(*) filter (where verdict = 'close'), count(*) filter (where verdict = 'wrong'), count(*)
  from feedback group by lower(candidate_type) order by count(*) desc;
$$;
grant execute on function public.type_accuracy() to anon, authenticated;

-- ===== 3. Verified references (extend verified_examples) =====
alter table public.verified_examples add column if not exists region text;
alter table public.verified_examples add column if not exists era text;
alter table public.verified_examples add column if not exists notes text;
alter table public.verified_examples add column if not exists photo_ids text[] not null default '{}';
alter table public.verified_examples add column if not exists verified_by uuid references auth.users(id) on delete set null;
alter table public.verified_examples add column if not exists verified_at timestamptz default now();
alter table public.verified_examples drop constraint if exists verified_region_coarse;
alter table public.verified_examples add constraint verified_region_coarse check (region is null or (region !~ '[0-9]+\.[0-9]{2,}' and region !~ '^\s*[0-9]+\s+\w' and length(region) <= 80));
-- collection owners/editors (not only the row owner) may promote / edit / remove references for finds they can edit
drop policy if exists "verified editors write" on public.verified_examples;
create policy "verified editors write" on public.verified_examples for all to authenticated using (public.can_edit_find(catalog_id)) with check (public.can_edit_find(catalog_id));
drop policy if exists "verified read" on public.verified_examples;
create policy "verified read" on public.verified_examples for select using (is_public or public.can_edit_find(catalog_id));
