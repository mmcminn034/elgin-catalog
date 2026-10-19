-- 023 (2026-10-18): collaborators (catalog editors) can edit find details but only the owner changes visibility,
-- Discover listing, location-sharing, owner or catalog. Delete was already owner-only (policy "finds delete"); exact locations already owner-only (find_locations).
-- Rollback: 023_editor_guard_down.sql
begin;
create or replace function public.finds_editor_guard() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  if auth.role() = 'service_role' or auth.uid() is null or auth.uid() = old.owner then return new; end if;
  if new.visibility is distinct from old.visibility or new.is_public is distinct from old.is_public or new.show_on_discover is distinct from old.show_on_discover
     or new.location_sharing is distinct from old.location_sharing or new.owner is distinct from old.owner or new.collection_id is distinct from old.collection_id or new.keep_private is distinct from old.keep_private then
    raise exception 'owner_only: only the find''s owner can change its visibility, sharing or catalog' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.finds_editor_guard() from public, anon, authenticated;
drop trigger if exists finds_ab_editor_guard on public.finds;
create trigger finds_ab_editor_guard before update on public.finds for each row execute function public.finds_editor_guard();
commit;
