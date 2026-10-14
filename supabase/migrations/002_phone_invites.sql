-- 002_phone_invites.sql: invite collection members by phone number; profiles for users without email.
-- Idempotent: safe to run more than once. Run after schema.sql and 001.

-- 1. collection_invites: email becomes optional, phone (E.164, e.g. +15125550123) added; one of the two is required.
alter table public.collection_invites alter column email drop not null;
alter table public.collection_invites add column if not exists phone text;
alter table public.collection_invites drop constraint if exists collection_invites_phone_e164;
alter table public.collection_invites add constraint collection_invites_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');
alter table public.collection_invites drop constraint if exists collection_invites_contact;
alter table public.collection_invites add constraint collection_invites_contact check (email is not null or phone is not null);
create unique index if not exists collection_invites_phone_key on public.collection_invites (collection_id, phone);

-- 2. Digits-only helper: auth.users.phone is stored without "+", so compare digits on both sides.
create or replace function public.phone_digits(p text) returns text language sql immutable as $$ select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') $$;

-- 3. accept_invites(): matches the signed-in user's confirmed email OR confirmed phone (read from auth.users, not the client).
create or replace function public.accept_invites() returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; em text; ph text;
begin
  if auth.uid() is null then return 0; end if;
  select case when u.email_confirmed_at is not null then lower(u.email) end, case when u.phone_confirmed_at is not null then public.phone_digits(u.phone) end
    into em, ph from auth.users u where u.id = auth.uid();
  if em is null and ph is null then return 0; end if;
  insert into collection_members (collection_id, user_id, role)
    select distinct on (collection_id) collection_id, auth.uid(), role from collection_invites
    where status = 'pending' and ((em is not null and email = em) or (ph is not null and public.phone_digits(phone) = ph))
    order by collection_id, case role when 'editor' then 0 else 1 end
    on conflict (collection_id, user_id) do nothing;
  get diagnostics n = row_count;
  update collection_invites set status = 'accepted'
    where status = 'pending' and ((em is not null and email = em) or (ph is not null and public.phone_digits(phone) = ph));
  return n;
end $$;
revoke all on function public.accept_invites() from public, anon;
grant execute on function public.accept_invites() to authenticated;

-- 4. Invitees may see their own pending invites by email or phone.
drop policy if exists "invites invitee" on public.collection_invites;
create policy "invites invitee" on public.collection_invites for select to authenticated using (
  (email is not null and email = lower(coalesce(auth.jwt() ->> 'email', '')))
  or (phone is not null and public.phone_digits(phone) = public.phone_digits(auth.jwt() ->> 'phone')));

-- 5. Profiles for users with no email (phone or some OAuth accounts): default display name. Never derived from the phone number (profiles are publicly readable).
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Member'))
  on conflict (id) do nothing; return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
-- backfill: any existing profile with an empty name
update public.profiles p set display_name = coalesce(nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Member')
  from auth.users u where u.id = p.id and coalesce(p.display_name, '') = '';
