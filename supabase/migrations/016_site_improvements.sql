-- 016 (2026-10-18): exact locations owner-only, admin account can't be deleted by accident, account deletion support.
-- Rollback: 016_site_improvements_down.sql
begin;
-- 1) Exact find locations: owner of the find ONLY (no catalog editors, never public). The finds table holds no coordinates.
drop policy if exists "find_locations editors" on public.find_locations;
drop policy if exists "find_locations owner only" on public.find_locations;
create policy "find_locations owner only" on public.find_locations for all to authenticated
  using (owner = auth.uid() and public.is_find_owner(catalog_id))
  with check (owner = auth.uid() and public.is_find_owner(catalog_id));
revoke all on public.find_locations from anon;

-- 2) Guard: the owner/admin account (app_config.owner_user_id) can't be deleted, from the app, the API or the dashboard.
--    To really delete it, drop this trigger first (deliberate, two-step).
create or replace function public.protect_owner_account() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.id::text = (select value #>> '{}' from app_config where key = 'owner_user_id') then
    raise exception 'The site owner account is protected and cannot be deleted (drop trigger protect_owner_account first).';
  end if;
  return old;
end $$;
revoke all on function public.protect_owner_account() from public, anon, authenticated;
drop trigger if exists protect_owner_account on auth.users;
create trigger protect_owner_account before delete on auth.users for each row execute function public.protect_owner_account();

-- 3) Account deletion log (no personal data: just when, and how much was removed) for support questions.
create table if not exists public.account_deletions (id bigserial primary key, deleted_at timestamptz not null default now(), finds int, photos int, catalogs int);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from anon, authenticated;
commit;
-- 4) Deleting an account removes that user's catalogs and finds (photos, locations, comments… cascade from finds).
--    Previously they were orphaned (owner set to null). The owner account is protected by the trigger above.
begin;
alter table public.finds drop constraint finds_owner_fkey, add constraint finds_owner_fkey foreign key (owner) references auth.users(id) on delete cascade;
alter table public.collections drop constraint collections_owner_fkey, add constraint collections_owner_fkey foreign key (owner) references auth.users(id) on delete cascade;
alter table public.photos drop constraint photos_owner_fkey, add constraint photos_owner_fkey foreign key (owner) references auth.users(id) on delete cascade;
commit;
