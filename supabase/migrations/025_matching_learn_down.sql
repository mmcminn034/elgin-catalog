-- Rollback for 025_matching_learn.sql (restores ai_quota_take and similar_reference_media to their 013/019 definitions; keeps no new data)
begin;
drop function if exists public.admin_ai_labeled_data(int);
create or replace function public.ai_quota_take() returns jsonb language plpgsql security definer set search_path = public as $$
declare cap int := public.cfg_int('ai_daily_cap', 50); c int; mem boolean;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  mem := public.is_member(auth.uid());
  insert into ai_usage (user_id, day, count) values (auth.uid(), current_date, 0) on conflict do nothing;
  if mem then
    update ai_usage set count = count + 1 where user_id = auth.uid() and day = current_date returning count into c;
    return jsonb_build_object('allowed', true, 'used', c, 'cap', null, 'member', true);
  end if;
  update ai_usage set count = count + 1 where user_id = auth.uid() and day = current_date and count < cap returning count into c;
  return jsonb_build_object('allowed', c is not null, 'used', coalesce(c, cap), 'cap', cap, 'member', false);
end $$;
delete from public.app_config where key = 'ai_global_daily_cap';
drop function if exists public.ai_cache_purge();
drop table if exists public.ai_cache;
alter table public.feedback drop constraint if exists feedback_meta_size;
alter table public.feedback drop column if exists meta;
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
drop index if exists public.reference_media_topics;
alter table public.reference_media drop column if exists topics;
commit;
