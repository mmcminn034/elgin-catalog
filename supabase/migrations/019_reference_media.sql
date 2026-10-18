-- 019 (2026-10-18): small freely licensed reference sample (Wikimedia Commons images + PBDB taxon records).
-- Same owner-only library rule as reference_types: only the owner reads the table directly. Signed-in users get
-- matching thumbnails + credits only through similar_reference_media() (used by the AI suggestion view).
-- Rows: tools/reference/import_media.py -> data/reference/reference-media.json -> tools/reference/load_media_sql.py. Rollback: 019_reference_media_down.sql
begin;
create table if not exists public.reference_media (
  id text primary key, source text not null, kind text not null check (kind in ('artifact','fossil','mineral')),
  title text not null, keywords text[] not null default '{}', category text,
  thumb_url text, image_url text, source_url text not null,
  license text not null, license_url text, attribution text not null, data jsonb, imported_at timestamptz not null default now());
alter table public.reference_media enable row level security;
drop policy if exists "reference_media owner read" on public.reference_media;
create policy "reference_media owner read" on public.reference_media for select using (exists (select 1 from collections c where c.slug = 'rolling-oak' and c.owner = auth.uid()));
revoke insert, update, delete on public.reference_media from anon, authenticated;
create index if not exists reference_media_kw on public.reference_media using gin (keywords);
create or replace function public.similar_reference_media(p_names text[], p_kind text default null, p_limit int default 6)
returns table (id text, source text, kind text, title text, thumb_url text, source_url text, license text, license_url text, attribution text, matched text)
language sql stable security definer set search_path = public as $$
  select m.id, m.source, m.kind, m.title, m.thumb_url, m.source_url, m.license, m.license_url, m.attribution, k
  from reference_media m cross join lateral (
    select kw as k, min(array_position(p_names, n)) as rank from unnest(m.keywords) kw, unnest(p_names) n
    where length(kw) > 2 and lower(n) ~ ('\m' || regexp_replace(lower(kw), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M') group by kw order by rank, length(kw) desc limit 1) hit
  where auth.uid() is not null and m.thumb_url is not null and (p_kind is null or m.kind = p_kind)
  order by hit.rank, (hit.k in ('point','arrowhead','arrow point','dart point','projectile point','flake','core')), length(hit.k) desc, m.id limit least(greatest(coalesce(p_limit, 6), 1), 12) $$;
revoke all on function public.similar_reference_media(text[], text, int) from public, anon;
grant execute on function public.similar_reference_media(text[], text, int) to authenticated;
commit;
