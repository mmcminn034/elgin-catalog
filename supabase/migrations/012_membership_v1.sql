-- 012: Membership v1 (Free / Annual $29.99 / Lifetime $59.99), private-item gate, AI daily safety cap, public UF ids,
--      named catalogs + custom find names, merch, experts. WRITTEN FOR PREVIEW ONLY: NOT APPLIED TO PRODUCTION.
-- Down: 012_membership_v1_down.sql. Idempotent where practical. Exact locations stay in find_locations (owner/editors only).
begin;

-- ===================== 0. Config (all limits configurable, no deploy needed) =====================
create table if not exists public.app_config (key text primary key, value jsonb not null, note text);
alter table public.app_config enable row level security;
drop policy if exists "config read" on public.app_config;
create policy "config read" on public.app_config for select using (true);           -- limits are not secret; no write policy => service role / admin RPC only
revoke all on public.app_config from anon, authenticated; grant select on public.app_config to anon, authenticated;
insert into public.app_config (key, value, note) values
  ('free_private_limit', '5', 'Free accounts: number of private items'),
  ('ai_daily_cap', '50', 'Per-account AI identifications per day (safety cap, all plans; not marketed as a limit)'),
  ('lapse_grace_days', '7', 'Days after an Annual plan lapses before extra private items become public'),
  ('free_expert_questions_month', '3', 'Free accounts: Ask an Expert questions per calendar month'),
  ('owner_user_id', '"a4779d71-ff10-4c11-864d-c79f83214b00"', 'Site owner: always Lifetime + admin')
on conflict (key) do nothing;
create or replace function public.cfg_int(k text, dflt int) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from app_config where key = k), dflt) $$;

-- ===================== 1. Plans + membership =====================
alter table public.plans add column if not exists active boolean not null default true;
alter table public.plans add column if not exists sort int not null default 0;
alter table public.plans add column if not exists stripe_price_id text;          -- filled when Stripe is connected
alter table public.plans add column if not exists private_limit int;             -- null = unlimited
alter table public.plans add column if not exists description text;
delete from public.plans where id = 'member';                                    -- old ~$10 Supporter plan retired (no monthly plan)
insert into public.plans (id, name, price_cents, billing_interval, finds_limit, private_limit, features, active, sort, description) values
  ('free', 'Free', 0, null, null, 5, '{"ai_identification": true, "private_items": 5, "public_toggle": false, "expert_questions_month": 3}', true, 0, 'Catalog and identify with AI. Your first 5 items can be private.'),
  ('annual', 'Annual', 2999, 'year', null, null, '{"ai_identification": true, "private_items": "unlimited", "public_toggle": true, "expert_questions": "unlimited", "expert_priority": true}', true, 1, 'Unlimited private items and the private/public toggle while active.'),
  ('lifetime', 'Lifetime', 5999, 'once', null, null, '{"ai_identification": true, "private_items": "unlimited", "public_toggle": true, "expert_questions": "unlimited", "expert_priority": true, "future_member_features": true}', true, 2, 'Everything in Annual, permanently, plus future member features at no extra cost.')
on conflict (id) do update set name = excluded.name, price_cents = excluded.price_cents, billing_interval = excluded.billing_interval, finds_limit = excluded.finds_limit,
  private_limit = excluded.private_limit, features = excluded.features, active = excluded.active, sort = excluded.sort, description = excluded.description;

alter table public.profiles drop constraint if exists profiles_membership_check;
update public.profiles set membership = 'annual' where membership = 'member';    -- legacy supporters keep their paid status as Annual
alter table public.profiles add constraint profiles_membership_check check (membership in ('free','annual','lifetime'));
alter table public.profiles add column if not exists is_admin boolean not null default false;   -- never user-writable (column grants from 001)
alter table public.profiles add column if not exists lapse_notice_at timestamptz;              -- when the lapse banner/email was first issued
update public.profiles set membership = 'lifetime', membership_expires = null, is_admin = true
  where id = (select (value #>> '{}')::uuid from public.app_config where key = 'owner_user_id');

create or replace function public.is_admin(u uuid default auth.uid()) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = u), false)
      or u = (select (value #>> '{}')::uuid from app_config where key = 'owner_user_id') $$;
create or replace function public.plan_of(u uuid default auth.uid()) returns text language sql stable security definer set search_path = public as $$
  select case when u = (select (value #>> '{}')::uuid from app_config where key = 'owner_user_id') then 'lifetime'
              when p.membership = 'lifetime' then 'lifetime'
              when p.membership = 'annual' and (p.membership_expires is null or p.membership_expires > now()) then 'annual'
              else 'free' end
  from profiles p where p.id = u $$;
create or replace function public.is_member(u uuid default auth.uid()) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.plan_of(u), 'free') in ('annual','lifetime') $$;

-- webhook/service-role setter accepts the new plan names (old 'member' maps to 'annual')
create or replace function public.set_membership(p_user uuid, p_status text, p_expires timestamptz, p_customer text default null)
returns void language sql security definer set search_path = public as $$
  update public.profiles set membership = case when p_status = 'member' then 'annual' else p_status end,
    membership_expires = case when p_status = 'lifetime' then null else p_expires end,
    stripe_customer_id = coalesce(p_customer, stripe_customer_id), lapse_notice_at = null where id = p_user;
$$;
revoke execute on function public.set_membership(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.set_membership(uuid, text, timestamptz, text) to service_role;

-- admin: grant a plan manually (logged)
create table if not exists public.plan_grants (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('free','annual','lifetime')), expires timestamptz, granted_by uuid, note text, created_at timestamptz not null default now());
alter table public.plan_grants enable row level security;
drop policy if exists "grants admin read" on public.plan_grants;
create policy "grants admin read" on public.plan_grants for select to authenticated using (public.is_admin() or user_id = auth.uid());
revoke all on public.plan_grants from anon, authenticated; grant select on public.plan_grants to authenticated;
create or replace function public.admin_grant_plan(p_user uuid, p_plan text, p_expires timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_plan not in ('free','annual','lifetime') then raise exception 'unknown plan %', p_plan; end if;
  update profiles set membership = p_plan, membership_expires = case when p_plan = 'annual' then coalesce(p_expires, now() + interval '1 year') else null end, lapse_notice_at = null where id = p_user;
  insert into plan_grants (user_id, plan, expires, granted_by, note) values (p_user, p_plan, p_expires, auth.uid(), p_note);
end $$;
revoke all on function public.admin_grant_plan(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_grant_plan(uuid, text, timestamptz, text) to authenticated;
create or replace function public.admin_find_user(p_email text) returns table (id uuid, email text, membership text, membership_expires timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text, p.membership, p.membership_expires from auth.users u join profiles p on p.id = u.id
  where public.is_admin() and lower(u.email) = lower(trim(p_email)) $$;
revoke all on function public.admin_find_user(text) from public, anon;
grant execute on function public.admin_find_user(text) to authenticated;

-- ===================== 2. Named catalogs + custom find names =====================
alter table public.finds add column if not exists title text check (title is null or length(title) <= 120);   -- display title; catalog_id unchanged
alter table public.collections add column if not exists sort int not null default 0;
-- Mark's existing collection keeps its name ('Rolling Oak'); nothing to migrate.

-- ===================== 3. Public UF ids (only while public) =====================
create table if not exists public.public_ids (
  public_id text primary key check (public_id ~ '^UF-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4,8}$'),
  kind text not null check (kind in ('find','catalog')), ref text not null, active boolean not null default true,
  created_at timestamptz not null default now(), unique (kind, ref));
alter table public.public_ids enable row level security;
drop policy if exists "public ids active read" on public.public_ids;
create policy "public ids active read" on public.public_ids for select using (active);   -- private items expose nothing
revoke all on public.public_ids from anon, authenticated; grant select on public.public_ids to anon, authenticated;
alter table public.finds add column if not exists public_id text unique;
alter table public.collections add column if not exists public_id text unique;

create or replace function public.gen_uf_id() returns text language plpgsql volatile set search_path = public as $$
declare a text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; n int := 4; s text; tries int := 0;
begin
  loop
    s := 'UF-'; for i in 1..n loop s := s || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    exit when not exists (select 1 from public_ids where public_id = s);
    tries := tries + 1; if tries % 20 = 0 and n < 8 then n := n + 1; end if;
  end loop; return s;
end $$;

-- assigns/reactivates a UF id when an item or catalog becomes public; hides it (null) when it goes private again.
-- The same UF id is reused if it is made public again, so old share links keep working.
create or replace function public.sync_public_id() returns trigger language plpgsql security definer set search_path = public as $$
declare k text := case when tg_table_name = 'finds' then 'find' else 'catalog' end; r text; pid text;
begin
  r := case when tg_table_name = 'finds' then to_jsonb(new) ->> 'catalog_id' else to_jsonb(new) ->> 'id' end;
  if new.visibility = 'public' then
    select public_id into pid from public_ids where kind = k and ref = r;
    if pid is null then pid := public.gen_uf_id(); insert into public_ids (public_id, kind, ref) values (pid, k, r);
    else update public_ids set active = true where public_id = pid; end if;
    new.public_id := pid;
  else
    update public_ids set active = false where kind = k and ref = r; new.public_id := null;
  end if;
  return new;
end $$;
-- triggers fire in name order: finds_normalize_enums -> finds_sync_visibility -> finds_zy_private_gate -> finds_zz_public_id
drop trigger if exists finds_zz_public_id on public.finds;
create trigger finds_zz_public_id before insert or update on public.finds for each row execute function public.sync_public_id();
drop trigger if exists collections_zz_public_id on public.collections;
create trigger collections_zz_public_id before insert or update on public.collections for each row execute function public.sync_public_id();
-- backfill: everything already public gets a UF id now (private items get none)
do $$ declare r record; pid text; begin
  for r in select catalog_id from public.finds where visibility = 'public' and public_id is null order by created_at loop
    pid := public.gen_uf_id(); insert into public.public_ids (public_id, kind, ref) values (pid, 'find', r.catalog_id);
    update public.finds set public_id = pid where catalog_id = r.catalog_id; end loop;
  for r in select id from public.collections where visibility = 'public' and public_id is null loop
    pid := public.gen_uf_id(); insert into public.public_ids (public_id, kind, ref) values (pid, 'catalog', r.id::text);
    update public.collections set public_id = pid where id = r.id; end loop;
end $$;
-- users cannot write public_id themselves: the trigger above runs on every insert/update and always recomputes it from the registry

-- A public item is readable even inside a private catalog (it has a UF id); private items and exact locations never are.
drop policy if exists "finds read" on public.finds;
create policy "finds read" on public.finds for select using (
  (visibility = 'public' and (public.collection_is_public(collection_id) or public_id is not null)) or owner = auth.uid()
  or (visibility <> 'private' and public.collection_role(collection_id) is not null) or public.collection_role(collection_id) = 'owner');

-- photos/corrections policies call can_view_find, so keep it identical to the finds read rule
create or replace function public.can_view_find(fid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from finds f where f.catalog_id = fid and (
    (f.visibility = 'public' and (public.collection_is_public(f.collection_id) or f.public_id is not null))
    or f.owner = auth.uid()
    or (f.visibility <> 'private' and public.collection_role(f.collection_id) is not null)
    or public.collection_role(f.collection_id) = 'owner'));
$$;

-- Public lookups by UF id (no catalog_id, no owner id, no location fields)
create or replace function public.public_find(p_uf text) returns table (public_id text, title text, category text, object_type text, material text, era text,
  region text, suggestion_1 text, confidence text, status text, key_features text, length_mm text, width_mm text, thickness_mm text, weight_g text, photos jsonb, catalog_public_id text, catalog_name text)
language sql stable security definer set search_path = public as $$
  select f.public_id, coalesce(f.title, f.object_type), f.category, f.object_type, f.material, f.era, coalesce(f.region, f.admin1, f.country), f.suggestion_1, f.confidence, f.status, f.key_features,
         f.length_mm, f.width_mm, f.thickness_mm, f.weight_g,
         coalesce((select jsonb_agg(jsonb_build_object('repo', coalesce(p.thumb_path, p.repo_path), 'full', p.repo_path, 'storage', p.storage_path, 'label', p.label) order by p.sort) from photos p where p.catalog_id = f.catalog_id and p.is_public), '[]'),
         c.public_id, case when c.public_id is not null then c.name end
  from finds f left join collections c on c.id = f.collection_id where f.public_id = p_uf and f.visibility = 'public' $$;
grant execute on function public.public_find(text) to anon, authenticated;
-- Legacy share/QR links (#/find/ELG-xxx, share/ELG-xxx.html): resolve to the UF id only when the find is public.
create or replace function public.public_id_for(p_catalog_id text) returns text language sql stable security definer set search_path = public as $$
  select public_id from finds where catalog_id = p_catalog_id and visibility = 'public' and public_id is not null $$;
grant execute on function public.public_id_for(text) to anon, authenticated;

-- discover_finds: same columns + public_id/title appended (catalog_id stays for owners' existing clients; anon UI shows UF/title)
create or replace view public.discover_finds with (security_barrier = true) as
select f.catalog_id, f.category, f.object_type, f.material, f.era,
       coalesce(f.region, f.admin1, f.country, 'Unknown') as region,
       f.suggestion_1, f.suggestion_2, f.suggestion_3, f.confidence, f.status, f.key_features,
       f.length_mm, f.length_source, f.width_mm, f.width_source, f.thickness_mm, f.thickness_source, f.weight_g, f.weight_source,
       f.created_at, f.updated_at, c.slug as collection_slug,
       (select coalesce(p.thumb_path, p.repo_path) from public.photos p where p.catalog_id = f.catalog_id and p.is_public order by p.sort limit 1) as thumb_repo,
       (select p.storage_path from public.photos p where p.catalog_id = f.catalog_id and p.is_public order by p.sort limit 1) as thumb_storage,
       exists (select 1 from public.verified_examples v where v.catalog_id = f.catalog_id and v.is_public) as verified,
       f.public_id, coalesce(f.title, f.object_type) as title
from public.finds f left join public.collections c on c.id = f.collection_id
where f.visibility = 'public'
  and ((f.collection_id is null or c.visibility = 'public') or (f.show_on_discover and f.is_public));
grant select on public.discover_finds to anon, authenticated;

-- ===================== 4. Private-item gate (server-side, cannot be bypassed by the client) =====================
create or replace function public.private_count(u uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from finds where owner = u and visibility <> 'public' $$;
create or replace function public.enforce_private_gate() returns trigger language plpgsql security definer set search_path = public as $$
declare lim int := public.cfg_int('free_private_limit', 5); u uuid := coalesce(new.owner, auth.uid());
begin
  if auth.role() = 'service_role' or u is null or public.is_member(u) then return new; end if;
  if tg_op = 'INSERT' and new.visibility <> 'public' and public.private_count(u) >= lim then
    raise exception 'free_private_limit: free accounts can keep % private items; this item must be public (upgrade for unlimited private items)', lim using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.visibility = 'public' and new.visibility <> 'public' then
    raise exception 'toggle_locked: free accounts cannot make public items private again' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists finds_zy_private_gate on public.finds;
create trigger finds_zy_private_gate before insert or update of visibility, is_public on public.finds for each row execute function public.enforce_private_gate();

-- Lapse handling (run daily by a scheduled job with the service role; no-op for members and Lifetime):
--   day 0 after expiry: lapse_notice_at is set (banner in the app + optional email);
--   after lapse_grace_days: private items beyond the 5 kept ones become public. Kept = finds.keep_private (user-chosen) first, then oldest.
alter table public.finds add column if not exists keep_private boolean not null default false;
create table if not exists public.membership_notices (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('lapse_warning','lapse_applied')), due_at timestamptz, email_sent_at timestamptz, details jsonb, created_at timestamptz not null default now());
alter table public.membership_notices enable row level security;
drop policy if exists "notices own" on public.membership_notices;
create policy "notices own" on public.membership_notices for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke all on public.membership_notices from anon, authenticated; grant select on public.membership_notices to authenticated;
create or replace function public.apply_membership_lapses() returns int language plpgsql security definer set search_path = public as $$
declare p record; lim int := public.cfg_int('free_private_limit', 5); g int := public.cfg_int('lapse_grace_days', 7); n int := 0; moved text[];
begin
  for p in select * from profiles where membership = 'annual' and membership_expires is not null and membership_expires <= now() loop
    if p.lapse_notice_at is null then
      update profiles set lapse_notice_at = now() where id = p.id;
      insert into membership_notices (user_id, kind, due_at, details) values (p.id, 'lapse_warning', now() + make_interval(days => g), jsonb_build_object('private_count', public.private_count(p.id), 'limit', lim));
    elsif p.lapse_notice_at + make_interval(days => g) <= now() then
      with ranked as (select catalog_id, row_number() over (order by keep_private desc, created_at asc, catalog_id) rn from finds where owner = p.id and visibility <> 'public')
      select array_agg(catalog_id) into moved from ranked where rn > lim;
      if moved is not null then
        perform set_config('request.jwt.claim.role', 'service_role', true);
        update finds set visibility = 'public', is_public = true where catalog_id = any(moved);
        update photos set is_public = true where catalog_id = any(moved);   -- exact locations are NOT touched (find_locations stays owner-only)
      end if;
      update profiles set membership = 'free', membership_expires = null, lapse_notice_at = null where id = p.id;
      insert into membership_notices (user_id, kind, details) values (p.id, 'lapse_applied', jsonb_build_object('made_public', coalesce(moved, '{}')));
      n := n + 1;
    end if;
  end loop; return n;
end $$;
revoke all on function public.apply_membership_lapses() from public, anon, authenticated;
grant execute on function public.apply_membership_lapses() to service_role;

-- ===================== 5. AI daily safety cap =====================
create table if not exists public.ai_usage (user_id uuid not null references auth.users(id) on delete cascade, day date not null default current_date, count int not null default 0, primary key (user_id, day));
alter table public.ai_usage enable row level security;
drop policy if exists "ai usage own" on public.ai_usage;
create policy "ai usage own" on public.ai_usage for select to authenticated using (user_id = auth.uid());
revoke all on public.ai_usage from anon, authenticated; grant select on public.ai_usage to authenticated;
create or replace function public.ai_quota_take() returns jsonb language plpgsql security definer set search_path = public as $$
declare cap int := public.cfg_int('ai_daily_cap', 50); c int;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  insert into ai_usage (user_id, day, count) values (auth.uid(), current_date, 0) on conflict do nothing;
  update ai_usage set count = count + 1 where user_id = auth.uid() and day = current_date and count < cap returning count into c;
  return jsonb_build_object('allowed', c is not null, 'used', coalesce(c, cap), 'cap', cap);
end $$;
revoke all on function public.ai_quota_take() from public, anon;
grant execute on function public.ai_quota_take() to authenticated;

-- ===================== 6. Merch =====================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 1 and 120), description text,
  price_cents int not null check (price_cents >= 0), currency text not null default 'usd', images jsonb not null default '[]'::jsonb,
  variants jsonb not null default '[]'::jsonb,   -- e.g. [{"size":"M","color":"Clay","sku":"TEE-M-CLAY","stock":null}]
  active boolean not null default false, sort int not null default 0, stripe_price_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (jsonb_typeof(images) = 'array' and jsonb_typeof(variants) = 'array'));
alter table public.products enable row level security;
drop policy if exists "products read active" on public.products;
create policy "products read active" on public.products for select using (active or public.is_admin());
drop policy if exists "products admin write" on public.products;
create policy "products admin write" on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.products from anon, authenticated; grant select on public.products to anon, authenticated; grant insert, update, delete on public.products to authenticated;
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();

revoke all on function public.gen_uf_id() from public, anon, authenticated;
revoke all on function public.private_count(uuid) from public, anon;

-- ===================== 7. Experts =====================
create table if not exists public.experts (
  user_id uuid primary key references auth.users(id) on delete cascade, name text not null, credentials text, specialties text[] not null default '{}',
  links text[] not null default '{}', status text not null default 'pending' check (status in ('pending','approved','rejected')),
  invited boolean not null default false, applied_at timestamptz not null default now(), decided_at timestamptz, decided_by uuid, note text);
alter table public.experts enable row level security;
drop policy if exists "experts read" on public.experts;
create policy "experts read" on public.experts for select using (status = 'approved' or user_id = auth.uid() or public.is_admin());
drop policy if exists "experts apply" on public.experts;
create policy "experts apply" on public.experts for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
drop policy if exists "experts edit own pending" on public.experts;
create policy "experts edit own pending" on public.experts for update to authenticated using (user_id = auth.uid() and status = 'pending') with check (user_id = auth.uid() and status = 'pending');
revoke all on public.experts from anon, authenticated; grant select on public.experts to anon, authenticated; grant insert, update (name, credentials, specialties, links) on public.experts to authenticated;
create table if not exists public.expert_invites (id uuid primary key default gen_random_uuid(), email text not null, invited_by uuid default auth.uid(),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')), created_at timestamptz not null default now());
alter table public.expert_invites enable row level security;
drop policy if exists "expert invites admin" on public.expert_invites;
create policy "expert invites admin" on public.expert_invites for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "expert invites invitee" on public.expert_invites;
create policy "expert invites invitee" on public.expert_invites for select to authenticated using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.expert_invites from anon, authenticated; grant select, insert, update, delete on public.expert_invites to authenticated;
create or replace function public.is_expert(u uuid default auth.uid()) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from experts where user_id = u and status = 'approved') $$;
create or replace function public.admin_decide_expert(p_user uuid, p_status text, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_status not in ('approved','rejected','pending') then raise exception 'bad status'; end if;
  update experts set status = p_status, decided_at = now(), decided_by = auth.uid(), note = p_note where user_id = p_user;
end $$;
revoke all on function public.admin_decide_expert(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_expert(uuid, text, text) to authenticated;

create table if not exists public.expert_questions (
  id uuid primary key default gen_random_uuid(), asker uuid not null references auth.users(id) on delete cascade default auth.uid(),
  catalog_id text references public.finds(catalog_id) on delete set null, question text not null check (length(question) between 5 and 4000),
  context jsonb not null default '{}'::jsonb,     -- snapshot the asker chose to share (title, type, material, measurements, photo URLs); never a location
  status text not null default 'open' check (status in ('open','answered','closed')), priority int not null default 0,
  created_at timestamptz not null default now());
alter table public.expert_questions enable row level security;
drop policy if exists "questions read" on public.expert_questions;
create policy "questions read" on public.expert_questions for select to authenticated using (asker = auth.uid() or public.is_expert() or public.is_admin());
drop policy if exists "questions close own" on public.expert_questions;
create policy "questions close own" on public.expert_questions for update to authenticated using (asker = auth.uid()) with check (asker = auth.uid());
revoke all on public.expert_questions from anon, authenticated; grant select, update on public.expert_questions to authenticated;   -- inserts go through ask_expert() so the monthly limit holds
create table if not exists public.expert_answers (id uuid primary key default gen_random_uuid(), question_id uuid not null references public.expert_questions(id) on delete cascade,
  expert_id uuid not null references auth.users(id) on delete cascade default auth.uid(), body text not null check (length(body) between 1 and 8000), created_at timestamptz not null default now());
alter table public.expert_answers enable row level security;
drop policy if exists "answers read" on public.expert_answers;
create policy "answers read" on public.expert_answers for select to authenticated using (expert_id = auth.uid() or public.is_admin()
  or exists (select 1 from expert_questions q where q.id = question_id and q.asker = auth.uid()) or public.is_expert());
drop policy if exists "answers write" on public.expert_answers;
create policy "answers write" on public.expert_answers for insert to authenticated with check (expert_id = auth.uid() and public.is_expert());
revoke all on public.expert_answers from anon, authenticated; grant select, insert on public.expert_answers to authenticated;
create or replace function public.mark_question_answered() returns trigger language plpgsql security definer set search_path = public as $$
begin update expert_questions set status = 'answered' where id = new.question_id and status = 'open'; return new; end $$;
drop trigger if exists answers_mark on public.expert_answers;
create trigger answers_mark after insert on public.expert_answers for each row execute function public.mark_question_answered();

create or replace function public.ask_expert(p_question text, p_catalog_id text default null, p_context jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare lim int := public.cfg_int('free_expert_questions_month', 3); used int; mem boolean := public.is_member(); qid uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_catalog_id is not null and not public.can_view_find(p_catalog_id) then raise exception 'not your find' using errcode = '42501'; end if;
  if not mem then
    select count(*) into used from expert_questions where asker = auth.uid() and created_at >= date_trunc('month', now());
    if used >= lim then raise exception 'expert_question_limit: free accounts can ask % questions per month', lim using errcode = 'P0001'; end if;
  end if;
  insert into expert_questions (asker, catalog_id, question, context, priority) values (auth.uid(), p_catalog_id, p_question, coalesce(p_context, '{}'::jsonb) - 'location' - 'lat' - 'lon' - 'find_location_private', case when mem then 10 else 0 end)
  returning id into qid; return qid;
end $$;
revoke all on function public.ask_expert(text, text, jsonb) from public, anon;
grant execute on function public.ask_expert(text, text, jsonb) to authenticated;

commit;
