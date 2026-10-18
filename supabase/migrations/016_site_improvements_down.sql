begin;
drop trigger if exists protect_owner_account on auth.users;
drop function if exists public.protect_owner_account();
drop policy if exists "find_locations owner only" on public.find_locations;
create policy "find_locations editors" on public.find_locations for all to authenticated
  using ((owner = auth.uid()) OR can_edit_find(catalog_id)) with check (can_edit_find(catalog_id));
drop table if exists public.account_deletions;
alter table public.finds drop constraint finds_owner_fkey, add constraint finds_owner_fkey foreign key (owner) references auth.users(id) on delete set null;
alter table public.collections drop constraint collections_owner_fkey, add constraint collections_owner_fkey foreign key (owner) references auth.users(id) on delete set null;
alter table public.photos drop constraint photos_owner_fkey, add constraint photos_owner_fkey foreign key (owner) references auth.users(id) on delete set null;
commit;
