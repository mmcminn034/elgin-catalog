-- 001: collections + members/invites (shared editing), private locations for owners/editors,
--      public profiles, review requests, visibility, membership plans.
-- Run AFTER supabase/schema.sql. Idempotent: safe to run again.
begin;

-- ===== profiles: public profile + membership =====
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists is_public boolean not null default true;
alter table public.profiles add column if not exists membership text not null default 'free';
alter table public.profiles add column if not exists membership_expires timestamptz;
alter table public.profiles add column if not exists stripe_customer_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_membership_check') then
    alter table public.profiles add constraint profiles_membership_check check (membership in ('free','member'));
  end if;
end $$;
-- users may edit their own profile text, but NEVER their membership (only the webhook / service role can)
revoke update on public.profiles from authenticated;
grant update (display_name, bio, avatar_url, is_public) on public.profiles to authenticated;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (is_public or id = auth.uid());

create table if not exists public.plans (
  id text primary key, name text not null, price_cents int not null default 0, billing_interval text,
  finds_limit int, features jsonb not null default '{}'::jsonb
);
alter table public.plans enable row level security;
drop policy if exists "plans read" on public.plans;
create policy "plans read" on public.plans for select using (true);
grant select on public.plans to anon, authenticated;
insert into public.plans (id, name, price_cents, billing_interval, finds_limit, features) values
  ('free', 'Free', 0, null, 50, '{"ai_photo_analysis": false, "map": true, "labels": true, "sharing": true}'),
  ('member', 'Supporter membership', 1000, 'year', null, '{"ai_photo_analysis": true, "map": true, "labels": true, "sharing": true, "unlimited_finds": true}')
on conflict (id) do update set name = excluded.name, price_cents = excluded.price_cents, billing_interval = excluded.billing_interval, finds_limit = excluded.finds_limit, features = excluded.features;

-- only the service role (Stripe webhook Edge Function) may flip membership
create or replace function public.set_membership(p_user uuid, p_status text, p_expires timestamptz, p_customer text default null)
returns void language sql security definer set search_path = public as $$
  update public.profiles set membership = p_status, membership_expires = p_expires, stripe_customer_id = coalesce(p_customer, stripe_customer_id) where id = p_user;
$$;
revoke execute on function public.set_membership(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.set_membership(uuid, text, timestamptz, text) to service_role;

-- ===== collections + members + invites =====
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name text not null, description text,
  owner uuid references auth.users(id) on delete set null default auth.uid(),
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.collection_members (
  collection_id uuid not null references public.collections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  added_at timestamptz not null default now(),
  primary key (collection_id, user_id)
);
create table if not exists public.collection_invites (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'editor' check (role in ('editor','viewer')),
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  unique (collection_id, email)
);
alter table public.finds add column if not exists collection_id uuid references public.collections(id) on delete set null;
create index if not exists finds_collection_idx on public.finds(collection_id);

-- helper functions (security definer avoids RLS recursion)
create or replace function public.collection_role(cid uuid) returns text language sql stable security definer set search_path = public as $$
  select case when cid is null or auth.uid() is null then null
    when exists (select 1 from collections c where c.id = cid and c.owner = auth.uid()) then 'owner'
    else (select m.role from collection_members m where m.collection_id = cid and m.user_id = auth.uid()) end;
$$;
create or replace function public.can_edit_collection(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.collection_role(cid) in ('owner','editor'), false);
$$;
create or replace function public.collection_is_public(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select cid is null or coalesce((select is_public from collections where id = cid), false);
$$;
create or replace function public.can_edit_find(fid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from finds f where f.catalog_id = fid and (f.owner = auth.uid() or public.can_edit_collection(f.collection_id)));
$$;
create or replace function public.can_view_find(fid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from finds f where f.catalog_id = fid and ((f.is_public and public.collection_is_public(f.collection_id)) or f.owner = auth.uid() or public.collection_role(f.collection_id) is not null));
$$;
grant execute on function public.collection_role(uuid), public.can_edit_collection(uuid), public.collection_is_public(uuid), public.can_edit_find(text), public.can_view_find(text) to anon, authenticated;

-- owner automatically becomes a member
create or replace function public.add_owner_member() returns trigger language plpgsql security definer set search_path = public as $$
begin if new.owner is not null then insert into collection_members (collection_id, user_id, role) values (new.id, new.owner, 'owner') on conflict (collection_id, user_id) do update set role = 'owner'; end if; return new; end $$;
drop trigger if exists collections_owner_member on public.collections;
create trigger collections_owner_member after insert or update of owner on public.collections for each row execute function public.add_owner_member();

-- accept pending invites for the signed-in user's email (client calls rpc('accept_invites') after sign-in)
create or replace function public.accept_invites() returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; em text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or em = '' then return 0; end if;
  insert into collection_members (collection_id, user_id, role)
    select collection_id, auth.uid(), role from collection_invites where email = em and status = 'pending'
    on conflict (collection_id, user_id) do nothing;
  get diagnostics n = row_count;
  update collection_invites set status = 'accepted' where email = em and status = 'pending';
  return n;
end $$;
grant execute on function public.accept_invites() to authenticated;

alter table public.collections enable row level security;
alter table public.collection_members enable row level security;
alter table public.collection_invites enable row level security;
drop policy if exists "collections read" on public.collections;
create policy "collections read" on public.collections for select using (is_public or public.collection_role(id) is not null);
drop policy if exists "collections insert" on public.collections;
create policy "collections insert" on public.collections for insert to authenticated with check (owner = auth.uid());
drop policy if exists "collections update" on public.collections;
create policy "collections update" on public.collections for update to authenticated using (public.collection_role(id) = 'owner') with check (public.collection_role(id) = 'owner');
drop policy if exists "collections delete" on public.collections;
create policy "collections delete" on public.collections for delete to authenticated using (owner = auth.uid());
drop policy if exists "members read" on public.collection_members;
create policy "members read" on public.collection_members for select using (public.collection_role(collection_id) is not null);
drop policy if exists "members manage" on public.collection_members;
create policy "members manage" on public.collection_members for all to authenticated using (public.collection_role(collection_id) = 'owner') with check (public.collection_role(collection_id) = 'owner');
drop policy if exists "members leave" on public.collection_members;
create policy "members leave" on public.collection_members for delete to authenticated using (user_id = auth.uid() and role <> 'owner');
drop policy if exists "invites owner" on public.collection_invites;
create policy "invites owner" on public.collection_invites for all to authenticated using (public.collection_role(collection_id) = 'owner') with check (public.collection_role(collection_id) = 'owner');
drop policy if exists "invites invitee" on public.collection_invites;
create policy "invites invitee" on public.collection_invites for select to authenticated using (email = lower(coalesce(auth.jwt() ->> 'email', '')));
grant select on public.collections to anon, authenticated;
grant insert, update, delete on public.collections to authenticated;
grant select, insert, update, delete on public.collection_members, public.collection_invites to authenticated;

-- ===== replace find/photo/location/correction policies with collection-aware ones =====
do $$ declare t text; begin
  foreach t in array array['finds','photos','corrections'] loop
    execute format('drop policy if exists "%1$s read public or own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s insert own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s update own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s delete own" on public.%1$I', t);
  end loop;
end $$;
drop policy if exists "finds read" on public.finds;
create policy "finds read" on public.finds for select using ((is_public and public.collection_is_public(collection_id)) or owner = auth.uid() or public.collection_role(collection_id) is not null);
drop policy if exists "finds insert" on public.finds;
create policy "finds insert" on public.finds for insert to authenticated with check (owner = auth.uid() and (collection_id is null or public.can_edit_collection(collection_id)));
drop policy if exists "finds update" on public.finds;
create policy "finds update" on public.finds for update to authenticated using (owner = auth.uid() or public.can_edit_collection(collection_id)) with check (owner = auth.uid() or public.can_edit_collection(collection_id));
drop policy if exists "finds delete" on public.finds;
create policy "finds delete" on public.finds for delete to authenticated using (owner = auth.uid() or public.collection_role(collection_id) = 'owner');

drop policy if exists "photos read" on public.photos;
create policy "photos read" on public.photos for select using ((is_public and public.can_view_find(catalog_id)) or public.can_edit_find(catalog_id));
drop policy if exists "photos write" on public.photos;
create policy "photos write" on public.photos for all to authenticated using (public.can_edit_find(catalog_id)) with check (public.can_edit_find(catalog_id));

drop policy if exists "corrections read" on public.corrections;
create policy "corrections read" on public.corrections for select using ((is_public and public.can_view_find(catalog_id)) or public.can_edit_find(catalog_id));
drop policy if exists "corrections insert" on public.corrections;
create policy "corrections insert" on public.corrections for insert to authenticated with check (owner = auth.uid() and public.can_edit_find(catalog_id));

-- private locations: collection owner + editors (and the row owner) only. Never viewers, never public.
drop policy if exists "find_locations owner only" on public.find_locations;
drop policy if exists "find_locations editors" on public.find_locations;
create policy "find_locations editors" on public.find_locations for all to authenticated using (owner = auth.uid() or public.can_edit_find(catalog_id)) with check (public.can_edit_find(catalog_id));
revoke all on public.find_locations from anon;

-- storage: collection editors may also write photos under the collection owner's folder is NOT needed; each uploader writes in <own uid>/...

-- ===== review requests =====
create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),
  catalog_id text not null references public.finds(catalog_id) on delete cascade,
  requester uuid not null references auth.users(id) on delete cascade default auth.uid(),
  note text, status text not null default 'open' check (status in ('open','in_review','answered','closed')),
  response text, created_at timestamptz not null default now()
);
alter table public.review_requests enable row level security;
drop policy if exists "reviews insert" on public.review_requests;
create policy "reviews insert" on public.review_requests for insert to authenticated with check (requester = auth.uid() and public.can_view_find(catalog_id));
drop policy if exists "reviews read" on public.review_requests;
create policy "reviews read" on public.review_requests for select to authenticated using (requester = auth.uid() or public.can_edit_find(catalog_id));
drop policy if exists "reviews update" on public.review_requests;
create policy "reviews update" on public.review_requests for update to authenticated using (public.can_edit_find(catalog_id)) with check (public.can_edit_find(catalog_id));
grant select, insert, update on public.review_requests to authenticated;

-- ===== seed: Rolling Oak collection holding ELG-001..014 =====
insert into public.collections (slug, name, description, owner, is_public)
values ('rolling-oak', 'Rolling Oak', 'Surface finds from private land near Elgin, Texas.', null, true)
on conflict (slug) do nothing;
update public.finds set collection_id = (select id from public.collections where slug = 'rolling-oak')
where collection_id is null and catalog_id between 'ELG-001' and 'ELG-014';

commit;

-- ===== CLAIM (run once after signing in; replace the email) =====
--   update public.collections set owner = (select id from auth.users where email = 'YOUR-EMAIL@gmail.com') where slug = 'rolling-oak' and owner is null;
-- Then invite your wife from the site (Collection → Members → Invite). She signs in with that email and is added automatically.
