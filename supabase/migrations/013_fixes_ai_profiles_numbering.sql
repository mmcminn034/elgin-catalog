-- 013: AI quota (members unlimited, refunds), private profiles + public_profiles view, server-side find numbering.
-- Rollback: 013_fixes_ai_profiles_numbering_down.sql
begin;

-- ===== 1. AI quota: free accounts have a per-account daily safety cap (app_config.ai_daily_cap); members are unlimited =====
create or replace function public.ai_quota_take() returns jsonb
language plpgsql security definer set search_path = public as $$
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
-- give back one unit when the request never reached a usable AI answer (provider down, no credits)
create or replace function public.ai_quota_refund() returns void
language sql security definer set search_path = public as $$
  update ai_usage set count = greatest(count - 1, 0) where user_id = auth.uid() and day = current_date and auth.uid() is not null $$;
revoke all on function public.ai_quota_take() from public, anon;
revoke all on function public.ai_quota_refund() from public, anon;
grant execute on function public.ai_quota_take() to authenticated;
grant execute on function public.ai_quota_refund() to authenticated;

-- ===== 2. Profiles: only the owner (and the admin) read the full row; everyone else uses public_profiles =====
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read own or admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
revoke all on public.profiles from anon;
revoke insert, update, delete, truncate, references, trigger on public.profiles from authenticated;
grant select on public.profiles to authenticated;                                              -- rows limited by RLS above
grant insert (id, display_name, avatar_url, bio, is_public) on public.profiles to authenticated; -- never membership/is_admin/stripe ids
grant update (display_name, avatar_url, bio, is_public) on public.profiles to authenticated;

create or replace view public.public_profiles with (security_barrier = true) as
  select p.id, p.display_name, p.avatar_url, p.bio,
         (select count(*) from public.finds f where f.owner = p.id and f.public_id is not null)::int as public_finds,
         (select count(*) from public.collections c where c.owner = p.id and c.public_id is not null)::int as public_catalogs
  from public.profiles p
  where p.is_public or p.id = auth.uid();
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;
comment on view public.public_profiles is 'Safe public profile fields only (no membership, admin flag, Stripe ids or email). Owner-privileged view by design; profiles itself is owner/admin-only.';

-- ===== 3. Server-side find numbering: each account has its own prefix + sequence =====
create table if not exists public.catalog_id_prefixes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prefix  text not null unique check (prefix ~ '^[A-Z]{2,5}$' and prefix <> 'TMP' and prefix !~ '^UF'),
  next_n  int  not null default 1 check (next_n >= 1),
  created_at timestamptz not null default now());
alter table public.catalog_id_prefixes enable row level security;
revoke all on public.catalog_id_prefixes from anon, authenticated;
grant select on public.catalog_id_prefixes to authenticated;
drop policy if exists "prefix own read" on public.catalog_id_prefixes;
create policy "prefix own read" on public.catalog_id_prefixes for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- the owner keeps the ELG series, continuing after the highest existing number
insert into public.catalog_id_prefixes (user_id, prefix, next_n)
select (value #>> '{}')::uuid, 'ELG', coalesce((select max(substring(catalog_id from '^ELG-(\d+)$')::int) from public.finds), 0) + 1
from public.app_config where key = 'owner_user_id'
on conflict (user_id) do update set prefix = 'ELG', next_n = greatest(public.catalog_id_prefixes.next_n, excluded.next_n);

create or replace function public.ensure_catalog_prefix(u uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p text; a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ'; len int := 3; tries int := 0;
begin
  select prefix into p from catalog_id_prefixes where user_id = u; if p is not null then return p; end if;
  loop
    p := ''; for i in 1..len loop p := p || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    if p not in ('ELG', 'TMP', 'NEW') and p !~ '^UF' and not exists (select 1 from catalog_id_prefixes where prefix = p)
       and not exists (select 1 from finds where catalog_id like p || '-%') then
      begin insert into catalog_id_prefixes (user_id, prefix, next_n) values (u, p, 1); return p;
      exception when unique_violation then select prefix into p from catalog_id_prefixes where user_id = u; if p is not null then return p; end if; end;
    end if;
    tries := tries + 1; if tries % 25 = 0 and len < 5 then len := len + 1; end if;
    if tries > 500 then raise exception 'could not allocate a catalog prefix'; end if;
  end loop;
end $$;

create or replace function public.allocate_catalog_id_for(u uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p text; n int; id text;
begin
  perform public.ensure_catalog_prefix(u);
  loop
    update catalog_id_prefixes set next_n = next_n + 1 where user_id = u returning prefix, next_n - 1 into p, n;
    id := p || '-' || lpad(n::text, 3, '0');
    exit when not exists (select 1 from finds where catalog_id = id);
  end loop;
  return id;
end $$;
revoke all on function public.ensure_catalog_prefix(uuid) from public, anon, authenticated;
revoke all on function public.allocate_catalog_id_for(uuid) from public, anon, authenticated;

create or replace function public.allocate_catalog_id() returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  return public.allocate_catalog_id_for(auth.uid());
end $$;
create or replace function public.my_catalog_prefix() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p text; n int;
begin
  if auth.uid() is null then return null; end if;
  perform public.ensure_catalog_prefix(auth.uid());
  select prefix, next_n into p, n from catalog_id_prefixes where user_id = auth.uid();
  return jsonb_build_object('prefix', p, 'next', n);
end $$;
revoke all on function public.allocate_catalog_id() from public, anon;
revoke all on function public.my_catalog_prefix() from public, anon;
grant execute on function public.allocate_catalog_id() to authenticated;
grant execute on function public.my_catalog_prefix() to authenticated;

-- every new row from an end user gets a number from their own series; TMP-/null ids (offline adds) are assigned here
create or replace function public.assign_catalog_id() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p text; n int;
begin
  if u is null or coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if new.catalog_id is not null and exists (select 1 from finds where catalog_id = new.catalog_id) then return new; end if; -- upsert of an existing row (RLS decides)
  p := public.ensure_catalog_prefix(u);
  if new.catalog_id is null or new.catalog_id ~ '^TMP-' then new.catalog_id := public.allocate_catalog_id_for(u); return new; end if;
  if split_part(new.catalog_id, '-', 1) <> p then
    raise exception 'catalog_id_prefix: new finds use your own number series (%-NNN)', p using errcode = '23514'; end if;
  n := substring(new.catalog_id from '-(\d+)$')::int;
  update catalog_id_prefixes set next_n = greatest(next_n, n + 1) where user_id = u;
  return new;
end $$;
drop trigger if exists finds_aa_catalog_id on public.finds;
create trigger finds_aa_catalog_id before insert on public.finds for each row execute function public.assign_catalog_id();

commit;
