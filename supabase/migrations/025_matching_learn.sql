-- 025 (2026-10-27): matching + learning layer.
--  * reference_media.topics (e.g. natural, texas, cretaceous) + similar_reference_media() also returns 'natural' look-alike photos for any kind (so a natural-rock candidate gets natural-rock references).
--  * feedback.meta (jsonb): prompt version, model, candidate %, artifact-likelihood, photo count, owner attributes (never locations) = labeled data for future matching.
--  * ai_cache: per-user cache of AI results (7-day reuse; identical photos + attributes + prompt version cost nothing the second time).
--  * ai_quota_take(): adds a GLOBAL daily safety cap (app_config.ai_global_daily_cap, default 300 analyses/day across all accounts) on top of the per-account cap.
--  * admin_ai_labeled_data(): admin-only export of Keep/Correct/feedback labels with non-location find attributes (owner id hashed).
-- Rollback: 025_matching_learn_down.sql
begin;
alter table public.reference_media add column if not exists topics text[] not null default '{}';
update public.reference_media set topics = coalesce(array(select jsonb_array_elements_text(data -> 'topics')), '{}') where data ? 'topics' and topics = '{}';
create index if not exists reference_media_topics on public.reference_media using gin (topics);
create or replace function public.similar_reference_media(p_names text[], p_kind text default null, p_limit int default 6)
returns table (id text, source text, kind text, title text, thumb_url text, source_url text, license text, license_url text, attribution text, matched text)
language sql stable security definer set search_path = public as $$
  select m.id, m.source, m.kind, m.title, m.thumb_url, m.source_url, m.license, m.license_url, m.attribution, k
  from reference_media m cross join lateral (
    select kw as k, min(array_position(p_names, n)) as rank from unnest(m.keywords) kw, unnest(p_names) n
    where length(kw) > 2 and lower(n) ~ ('\m' || regexp_replace(lower(kw), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M') group by kw order by rank, length(kw) desc limit 1) hit
  where auth.uid() is not null and m.thumb_url is not null and (p_kind is null or m.kind = p_kind or 'natural' = any(m.topics))
  order by hit.rank, (hit.k in ('point','arrowhead','arrow point','dart point','projectile point','flake','core')), length(hit.k) desc, m.id limit least(greatest(coalesce(p_limit, 6), 1), 12) $$;
revoke all on function public.similar_reference_media(text[], text, int) from public, anon;
grant execute on function public.similar_reference_media(text[], text, int) to authenticated;

alter table public.feedback add column if not exists meta jsonb;

create table if not exists public.ai_cache (user_id uuid not null references auth.users(id) on delete cascade, cache_key text not null, result jsonb not null, model text, created_at timestamptz not null default now(), primary key (user_id, cache_key));
alter table public.ai_cache enable row level security;
drop policy if exists "ai_cache own" on public.ai_cache;
create policy "ai_cache own" on public.ai_cache for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function public.ai_cache_purge() returns void language sql security definer set search_path = public as $$ delete from ai_cache where user_id = auth.uid() and created_at < now() - interval '14 days' $$;
revoke all on function public.ai_cache_purge() from public, anon; grant execute on function public.ai_cache_purge() to authenticated;

insert into public.app_config (key, value, note) values ('ai_global_daily_cap', '300'::jsonb, 'Safety cap: total AI analyses per day across all accounts (protects the API budget)') on conflict (key) do nothing;
create or replace function public.ai_quota_take() returns jsonb language plpgsql security definer set search_path = public as $$
declare cap int := public.cfg_int('ai_daily_cap', 50); gcap int := public.cfg_int('ai_global_daily_cap', 300); c int; mem boolean; tot int;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  mem := public.is_member(auth.uid());
  select coalesce(sum(count), 0) into tot from ai_usage where day = current_date;
  if tot >= gcap then return jsonb_build_object('allowed', false, 'global', true, 'used', tot, 'cap', gcap, 'member', mem); end if;
  insert into ai_usage (user_id, day, count) values (auth.uid(), current_date, 0) on conflict do nothing;
  if mem then
    update ai_usage set count = count + 1 where user_id = auth.uid() and day = current_date returning count into c;
    return jsonb_build_object('allowed', true, 'used', c, 'cap', null, 'member', true);
  end if;
  update ai_usage set count = count + 1 where user_id = auth.uid() and day = current_date and count < cap returning count into c;
  return jsonb_build_object('allowed', c is not null, 'used', coalesce(c, cap), 'cap', cap, 'member', false);
end $$;

create or replace function public.admin_ai_labeled_data(p_limit int default 5000)
returns table (created_at timestamptz, source text, owner_hash text, catalog_id text, candidate text, verdict text, better_type text, note text, meta jsonb, category text, object_type text, material text, length_mm text, key_features text)
language sql stable security definer set search_path = public as $$
  select f.created_at, 'feedback', left(md5(coalesce(f.user_id::text, '')), 10), f.catalog_id, f.candidate_type, f.verdict, f.better_type, f.correction, f.meta, x.category, x.object_type, x.material, x.length_mm::text, x.key_features
  from feedback f left join finds x on x.catalog_id = f.catalog_id where public.is_admin()
  union all
  select c.created_at, 'correction', left(md5(coalesce(c.owner::text, '')), 10), c.catalog_id, c.old_value, case when c.kept then 'keep' else 'correct' end, c.new_value, c.reason, null::jsonb, x.category, x.object_type, x.material, x.length_mm::text, x.key_features
  from corrections c left join finds x on x.catalog_id = c.catalog_id where public.is_admin() and c.field = 'type'
  order by 1 desc limit least(greatest(coalesce(p_limit, 5000), 1), 20000) $$;
revoke all on function public.admin_ai_labeled_data(int) from public, anon; grant execute on function public.admin_ai_labeled_data(int) to authenticated;
alter table public.feedback drop constraint if exists feedback_meta_size; alter table public.feedback add constraint feedback_meta_size check (meta is null or length(meta::text) <= 4000);
commit;
