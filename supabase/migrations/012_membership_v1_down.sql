-- Down for 012 (preview). Restores the 008/011 shapes. Data in the new tables is dropped.
begin;
drop trigger if exists finds_zz_public_id on public.finds; drop trigger if exists collections_zz_public_id on public.collections;
drop trigger if exists finds_zy_private_gate on public.finds; drop trigger if exists answers_mark on public.expert_answers;
drop function if exists public.ask_expert(text, text, jsonb); drop function if exists public.mark_question_answered();
drop table if exists public.expert_answers, public.expert_questions, public.expert_invites, public.experts, public.products, public.ai_usage, public.membership_notices, public.plan_grants, public.public_ids cascade;
drop function if exists public.admin_decide_expert(uuid, text, text); drop function if exists public.is_expert(uuid);
drop function if exists public.ai_quota_take(); drop function if exists public.apply_membership_lapses(); drop function if exists public.enforce_private_gate(); drop function if exists public.private_count(uuid);
drop function if exists public.public_find(text); drop function if exists public.public_id_for(text); drop function if exists public.sync_public_id(); drop function if exists public.gen_uf_id();
drop function if exists public.admin_find_user(text); drop function if exists public.admin_grant_plan(uuid, text, timestamptz, text);
drop view if exists public.discover_finds;
create view public.discover_finds with (security_barrier = true) as
select f.catalog_id, f.category, f.object_type, f.material, f.era, coalesce(f.region, f.admin1, f.country, 'Unknown') as region,
       f.suggestion_1, f.suggestion_2, f.suggestion_3, f.confidence, f.status, f.key_features,
       f.length_mm, f.length_source, f.width_mm, f.width_source, f.thickness_mm, f.thickness_source, f.weight_g, f.weight_source,
       f.created_at, f.updated_at, c.slug as collection_slug,
       (select coalesce(p.thumb_path, p.repo_path) from public.photos p where p.catalog_id = f.catalog_id and p.is_public order by p.sort limit 1) as thumb_repo,
       (select p.storage_path from public.photos p where p.catalog_id = f.catalog_id and p.is_public order by p.sort limit 1) as thumb_storage,
       exists (select 1 from public.verified_examples v where v.catalog_id = f.catalog_id and v.is_public) as verified
from public.finds f left join public.collections c on c.id = f.collection_id
where f.visibility = 'public' and ((f.collection_id is null or c.visibility = 'public') or (f.show_on_discover and f.is_public));
grant select on public.discover_finds to anon, authenticated;
drop policy if exists "finds read" on public.finds;
create policy "finds read" on public.finds for select using (
  (visibility = 'public' and public.collection_is_public(collection_id)) or owner = auth.uid()
  or (visibility <> 'private' and public.collection_role(collection_id) is not null) or public.collection_role(collection_id) = 'owner');
create or replace function public.can_view_find(fid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from finds f where f.catalog_id = fid and (
    (f.visibility = 'public' and public.collection_is_public(f.collection_id))
    or f.owner = auth.uid()
    or (f.visibility <> 'private' and public.collection_role(f.collection_id) is not null)
    or public.collection_role(f.collection_id) = 'owner'));
$$;
alter table public.finds drop column if exists public_id, drop column if exists title, drop column if exists keep_private;
alter table public.collections drop column if exists public_id, drop column if exists sort;
alter table public.profiles drop constraint if exists profiles_membership_check;
update public.profiles set membership = 'member' where membership in ('annual','lifetime');
alter table public.profiles add constraint profiles_membership_check check (membership in ('free','member'));
alter table public.profiles drop column if exists is_admin, drop column if exists lapse_notice_at;
drop function if exists public.is_member(uuid); drop function if exists public.plan_of(uuid); drop function if exists public.is_admin(uuid);
create or replace function public.set_membership(p_user uuid, p_status text, p_expires timestamptz, p_customer text default null)
returns void language sql security definer set search_path = public as $$
  update public.profiles set membership = p_status, membership_expires = p_expires, stripe_customer_id = coalesce(p_customer, stripe_customer_id) where id = p_user; $$;
delete from public.plans where id in ('annual','lifetime');
insert into public.plans (id, name, price_cents, billing_interval, finds_limit, features) values
  ('member', 'Supporter membership', 1000, 'year', null, '{"ai_photo_analysis": true, "map": true, "labels": true, "sharing": true, "unlimited_finds": true}') on conflict (id) do nothing;
alter table public.plans drop column if exists active, drop column if exists sort, drop column if exists stripe_price_id, drop column if exists private_limit, drop column if exists description;
drop function if exists public.cfg_int(text, int); drop table if exists public.app_config;
commit;
