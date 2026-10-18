-- Rolling Oak Catalog: Supabase schema, RLS, storage and seed.
-- Paste the whole file into Dashboard → SQL Editor → Run. It is idempotent (safe to run again).
-- Ownership: rows belong to auth.uid(). Seed rows start with owner = null (public, read-only)
-- until you run section 5 ("claim") once with your sign-in email.
begin;

-- ===== 1. TABLES =====
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.finds (
  catalog_id text primary key check (catalog_id ~ '^[A-Z]{2,5}-\d{3,}$'),
  owner uuid references auth.users(id) on delete set null default auth.uid(),
  is_public boolean not null default true,
  category text not null default 'artifact' check (category in ('artifact','fossil','rock')),
  object_type text, material text, color text,
  length_mm text, width_mm text, thickness_mm text, weight_g text, measure_method text,
  condition text, key_features text,
  suggestion_1 text, suggestion_2 text, suggestion_3 text, confidence text,
  owner_observations text, open_questions text, date_found text, context_notes text,
  location_sharing text default 'Private', status text default 'Draft',
  era text, geologic_period text, formation text, preservation text,
  hardness text, luster text, streak text, category_note text, category_kept text,
  analysis jsonb not null default '{}'::jsonb,          -- optional stored analysis notes
  annotations jsonb not null default '{}'::jsonb,       -- { "<photo index>": [ {type, coords, label, explanation, links_to} ] }
  category_history jsonb not null default '[]'::jsonb,  -- [ {from, to, date, reason} ]
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Exact find locations NEVER live in finds; owner-only table:
create table if not exists public.find_locations (
  catalog_id text primary key references public.finds(catalog_id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade default auth.uid(),
  location text, lat double precision, lon double precision,
  updated_at timestamptz not null default now()
);
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  catalog_id text not null references public.finds(catalog_id) on delete cascade,
  owner uuid references auth.users(id) on delete set null default auth.uid(),
  sort int not null default 0,
  repo_path text,       -- e.g. images/ELG-001/01.jpg (served by GitHub Pages)
  storage_path text,    -- e.g. <uid>/ELG-015/00.jpg in bucket find-photos (EXIF stripped client-side)
  thumb_path text, view text, label text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  unique (catalog_id, sort)
);
create table if not exists public.corrections (
  id uuid primary key default gen_random_uuid(),
  catalog_id text not null references public.finds(catalog_id) on delete cascade,
  owner uuid references auth.users(id) on delete set null default auth.uid(),
  field text not null, old_value text, new_value text, reason text,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.verified_examples (
  catalog_id text primary key,
  owner uuid references auth.users(id) on delete set null default auth.uid(),
  category text not null check (category in ('artifact','fossil','rock')),
  confirmed_type text not null, type_ids text[] not null default '{}',
  features text, length_mm text, material text, confirmed_on text, source text,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists photos_catalog_idx on public.photos(catalog_id, sort);
create index if not exists corrections_catalog_idx on public.corrections(catalog_id);

-- updated_at + new-user profile triggers
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists finds_touch on public.finds;
create trigger finds_touch before update on public.finds for each row execute function public.touch_updated_at();
drop trigger if exists find_locations_touch on public.find_locations;
create trigger find_locations_touch before update on public.find_locations for each row execute function public.touch_updated_at();
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, display_name) values (new.id, split_part(new.email, '@', 1)) on conflict (id) do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ===== 2. ROW LEVEL SECURITY =====
alter table public.profiles enable row level security;
alter table public.finds enable row level security;
alter table public.find_locations enable row level security;
alter table public.photos enable row level security;
alter table public.corrections enable row level security;
alter table public.verified_examples enable row level security;

do $$
declare t text;
begin
  -- public-read / owner-write tables
  foreach t in array array['finds','photos','corrections','verified_examples'] loop
    execute format('drop policy if exists "%1$s read public or own" on public.%1$I', t);
    execute format('create policy "%1$s read public or own" on public.%1$I for select using (is_public or owner = auth.uid())', t);
    execute format('drop policy if exists "%1$s insert own" on public.%1$I', t);
    execute format('create policy "%1$s insert own" on public.%1$I for insert to authenticated with check (owner = auth.uid())', t);
    execute format('drop policy if exists "%1$s update own" on public.%1$I', t);
    execute format('create policy "%1$s update own" on public.%1$I for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid())', t);
    execute format('drop policy if exists "%1$s delete own" on public.%1$I', t);
    execute format('create policy "%1$s delete own" on public.%1$I for delete to authenticated using (owner = auth.uid())', t);
  end loop;
end $$;

-- private locations: owner only, for every operation
drop policy if exists "find_locations owner only" on public.find_locations;
create policy "find_locations owner only" on public.find_locations for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
-- profiles: everyone may read display names; users edit their own
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (true);
drop policy if exists "profiles self" on public.profiles;
create policy "profiles self" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "profiles self insert" on public.profiles;
create policy "profiles self insert" on public.profiles for insert to authenticated with check (id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select on public.finds, public.photos, public.corrections, public.verified_examples, public.profiles to anon, authenticated;
grant insert, update, delete on public.finds, public.photos, public.corrections, public.verified_examples, public.find_locations, public.profiles to authenticated;
grant select on public.find_locations to authenticated;
revoke all on public.find_locations from anon;

-- ===== 3. STORAGE: bucket find-photos (public read, owner write into <uid>/... folder) =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('find-photos', 'find-photos', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true;
drop policy if exists "find-photos public read" on storage.objects;
create policy "find-photos public read" on storage.objects for select using (bucket_id = 'find-photos');
drop policy if exists "find-photos owner insert" on storage.objects;
create policy "find-photos owner insert" on storage.objects for insert to authenticated with check (bucket_id = 'find-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "find-photos owner update" on storage.objects;
create policy "find-photos owner update" on storage.objects for update to authenticated using (bucket_id = 'find-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "find-photos owner delete" on storage.objects;
create policy "find-photos owner delete" on storage.objects for delete to authenticated using (bucket_id = 'find-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== 5. CLAIM (run separately, ONCE, after you have signed in on the site at least once) =====
-- Replace the email, then run just these lines to become owner of the seeded finds:
--   update public.finds             set owner = (select id from auth.users where email = 'YOUR-EMAIL@gmail.com') where owner is null;
--   update public.photos            set owner = (select id from auth.users where email = 'YOUR-EMAIL@gmail.com') where owner is null;
--   update public.verified_examples set owner = (select id from auth.users where email = 'YOUR-EMAIL@gmail.com') where owner is null;

-- ===== 4. SEED (generated by supabase/gen_seed.py; safe to re-run: existing rows are left untouched) =====
insert into public.finds (catalog_id, category, object_type, material, color, length_mm, width_mm, thickness_mm, weight_g, measure_method, condition, key_features, suggestion_1, suggestion_2, suggestion_3, confidence, owner_observations, open_questions, date_found, context_notes, location_sharing, status, era, geologic_period, formation, preservation, hardness, luster, streak, category_note, annotations, category_history, is_public) values ('ELG-001', 'artifact', 'Stemmed dart point', 'Chert', 'Cream/white, tan-orange streaks, reddish tip', '80-85', '25-28', '7-8', null, 'Photo estimate', 'Complete', 'Long narrow blade, weak shoulders, short straight stem, thin lenticular section, fine edge retouch', 'Nolan/Travis (Middle Archaic, ~4000-2500 BC)', 'Bulverde', null, 'Moderate', 'Stem edges chipped and sharp, not ground (confirmed by owner)', 'Stem beveling? Possible heat treatment (red tip)', null, null, null, 'Reviewed', 'Middle Archaic', null, null, null, null, null, null, null, '{"0": [{"type": "box", "coords": [0.76, 0.26, 0.91, 0.64], "label": "Stem", "explanation": "Hafting element at the base: a short, roughly straight-sided stem. It is not clearly expanding in this view.", "links_to": {"kind": "feature", "ref": "Hafting element (stem or notches)"}}, {"type": "arrow", "coords": [0.95, 0.8, 0.87, 0.62], "label": "Stem edges chipped, not ground", "explanation": "Small flake removals run along the stem edges. Mark confirmed by touch that they are sharp, not smoothed by grinding. Ground stems point toward Paleoindian/Early Archaic types, so their absence fits Nolan/Travis better.", "links_to": {"kind": "feature", "ref": "Basal / stem grinding"}}, {"type": "circle", "coords": [0.73, 0.67, 0.035], "label": "Weak shoulder", "explanation": "The outline steps in only slightly where blade meets stem: a weak shoulder, a trait listed for Nolan and Travis.", "links_to": {"kind": "candidate", "ref": "travis"}}, {"type": "arrow", "coords": [0.3, 0.88, 0.33, 0.7], "label": "Long narrow blade, retouched edge", "explanation": "The blade is long relative to its width, with fine retouch along the edge. Long narrow blades are typical of Middle Archaic Nolan/Travis points.", "links_to": {"kind": "candidate", "ref": "nolan"}}, {"type": "circle", "coords": [0.05, 0.52, 0.035], "label": "Tip", "explanation": "Intact pointed tip at the distal end."}, {"type": "circle", "coords": [0.5, 0.44, 0.07], "label": "Flake scars", "explanation": "Broad, overlapping flake scars across the face show deliberate bifacial thinning.", "links_to": {"kind": "feature", "ref": "Bifacial flaking / flake scars"}}], "1": [{"type": "box", "coords": [0.0, 0.19, 1.0, 0.36], "label": "Ruler for scale", "explanation": "Two rulers in the frame. The upper one has centimetre numbers about 0.083 of the frame width apart."}, {"type": "measure", "coords": [0.1, 0.63, 0.83, 0.63], "label": "Length ≈ 85–90 mm (approx.)", "explanation": "Tip to base, about 0.73 of the frame width ÷ ~0.083 per cm ≈ 8.8 cm. Approximate: the piece is not in the same plane as the ruler. The record keeps 80–85 mm until a caliper reading is taken.", "links_to": {"kind": "date", "ref": "Typical Nolan/Travis length range (~45–110 mm) includes this size."}}, {"type": "box", "coords": [0.66, 0.44, 0.84, 0.59], "label": "Stem", "explanation": "A short stem with straight to slightly contracting sides; it does not expand.", "links_to": {"kind": "feature", "ref": "Hafting element (stem or notches)"}}, {"type": "circle", "coords": [0.71, 0.59, 0.03], "label": "Weak shoulder", "explanation": "Slight step where the blade meets the stem.", "links_to": {"kind": "candidate", "ref": "travis"}}]}'::jsonb, '[]'::jsonb, true) on conflict (catalog_id) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-001', 0, 'images/ELG-001/01.jpg', 'images/ELG-001/01_thumb.jpg', 'front', 'Front view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-001', 1, 'images/ELG-001/02.jpg', 'images/ELG-001/02_thumb.jpg', 'scale', 'Scale view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-001', 2, 'images/ELG-001/03.jpg', 'images/ELG-001/03_thumb.jpg', 'edge', 'Edge view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-001', 3, 'images/ELG-001/04.jpg', 'images/ELG-001/04_thumb.jpg', 'scale', 'Scale view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-001', 4, 'images/ELG-001/05.jpg', 'images/ELG-001/05_thumb.jpg', 'edge', 'Edge view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-001', 5, 'images/ELG-001/06.jpg', 'images/ELG-001/06_thumb.jpg', 'back', 'Back view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-001', 6, 'images/ELG-001/07.jpg', 'images/ELG-001/07_thumb.jpg', 'edge', 'Edge view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-001', 7, 'images/ELG-001/08.jpg', 'images/ELG-001/08_thumb.jpg', 'base', 'Base view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-001', 8, 'images/ELG-001/09.jpg', 'images/ELG-001/09_thumb.jpg', 'edge', 'Edge view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-001', 9, 'images/ELG-001/10.jpg', 'images/ELG-001/10_thumb.jpg', 'case', 'In display case', true) on conflict (catalog_id, sort) do nothing;
insert into public.finds (catalog_id, category, object_type, material, color, length_mm, width_mm, thickness_mm, weight_g, measure_method, condition, key_features, suggestion_1, suggestion_2, suggestion_3, confidence, owner_observations, open_questions, date_found, context_notes, location_sharing, status, era, geologic_period, formation, preservation, hardness, luster, streak, category_note, annotations, category_history, is_public) values ('ELG-002', 'artifact', 'Corner-notched dart point', 'Chert (likely Edwards)', 'Gray-lavender, mottled', '60-70', '35-40', '8-10', null, 'Photo estimate (two readings disagree)', 'Complete', 'Triangular blade, barbed shoulders, deep corner notches, expanding stem, fine serration one edge', 'Castroville (Late Archaic)', 'Marcos', 'Ensor', 'Moderate-low', null, 'Base edge shape (straight/convex/concave); exact length', null, null, null, 'Draft', 'Late Archaic', null, null, null, null, null, null, null, '{"0": [{"type": "circle", "coords": [0.41, 0.315, 0.03], "label": "Tip", "explanation": "Pointed distal tip."}, {"type": "circle", "coords": [0.285, 0.52, 0.035], "label": "Barb", "explanation": "The shoulder extends down and out into a barb. Barbed shoulders are typical of Castroville and Marcos.", "links_to": {"kind": "candidate", "ref": "castroville"}}, {"type": "circle", "coords": [0.545, 0.515, 0.035], "label": "Barb", "explanation": "Second barb on the opposite shoulder.", "links_to": {"kind": "candidate", "ref": "castroville"}}, {"type": "arrow", "coords": [0.18, 0.6, 0.315, 0.555], "label": "Corner notch", "explanation": "A notch cut in at the corner between barb and stem. Corner notching (rather than side or basal notching) favours Castroville and Marcos over Ensor.", "links_to": {"kind": "feature", "ref": "Notching (corner, side or basal)"}}, {"type": "arrow", "coords": [0.64, 0.6, 0.495, 0.56], "label": "Corner notch", "explanation": "Matching notch on the other corner.", "links_to": {"kind": "feature", "ref": "Notching (corner, side or basal)"}}, {"type": "box", "coords": [0.33, 0.555, 0.49, 0.625], "label": "Stem / base", "explanation": "Short stem below the notches that widens toward the base, with a roughly straight base edge.", "links_to": {"kind": "candidate", "ref": "marcos"}}, {"type": "measure", "coords": [0.24, 0.31, 0.24, 0.625], "label": "Length ≈ 53–55 mm (approx.)", "explanation": "The tip-to-base span is about 0.31 of the frame height. The right-hand scale''s numbers are about 0.06 of the height apart (the left scale''s are 2.54× wider, so the right one is centimetres), giving ≈ 5.3 cm. Earlier photo readings gave 60–70 mm, so a caliper check is needed.", "links_to": {"kind": "date", "ref": "Castroville points are typically larger (~50–110 mm); Marcos ~40–80 mm."}}, {"type": "box", "coords": [0.64, 0.02, 0.86, 0.98], "label": "Ruler for scale", "explanation": "Folding ruler with inch (left) and cm (right) scales."}], "3": [{"type": "circle", "coords": [0.845, 0.555, 0.035], "label": "Tip", "explanation": "Distal tip (piece rotated in this view)."}, {"type": "circle", "coords": [0.445, 0.42, 0.035], "label": "Barb", "explanation": "Barbed shoulder seen from the back.", "links_to": {"kind": "candidate", "ref": "castroville"}}, {"type": "circle", "coords": [0.255, 0.63, 0.035], "label": "Barb", "explanation": "The opposite barb.", "links_to": {"kind": "candidate", "ref": "castroville"}}]}'::jsonb, '[]'::jsonb, true) on conflict (catalog_id) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-002', 0, 'images/ELG-002/01.jpg', 'images/ELG-002/01_thumb.jpg', 'front', 'Front view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-002', 1, 'images/ELG-002/02.jpg', 'images/ELG-002/02_thumb.jpg', 'edge', 'Edge view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-002', 2, 'images/ELG-002/03.jpg', 'images/ELG-002/03_thumb.jpg', 'edge', 'Edge view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-002', 3, 'images/ELG-002/04.jpg', 'images/ELG-002/04_thumb.jpg', 'back', 'Back view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-002', 4, 'images/ELG-002/05.jpg', 'images/ELG-002/05_thumb.jpg', 'case', 'In display case', true) on conflict (catalog_id, sort) do nothing;
insert into public.finds (catalog_id, category, object_type, material, color, length_mm, width_mm, thickness_mm, weight_g, measure_method, condition, key_features, suggestion_1, suggestion_2, suggestion_3, confidence, owner_observations, open_questions, date_found, context_notes, location_sharing, status, era, geologic_period, formation, preservation, hardness, luster, streak, category_note, annotations, category_history, is_public) values ('ELG-003', 'artifact', 'Triangular biface', 'Chert', 'Pale cream-pink, tan mineral spots', null, null, null, null, 'Not measured', 'Complete', 'Triangular outline, sharp tip, thin flat profile, edge retouch, straight base', 'Triangular knife/biface', 'Tortugas/Matamoros', 'Late-stage preform', 'Low-moderate', null, 'Base close-up; size', null, null, null, 'Draft', 'Undetermined', null, null, null, null, null, null, null, '{}'::jsonb, '[]'::jsonb, true) on conflict (catalog_id) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-003', 0, 'images/ELG-003/01.jpg', 'images/ELG-003/01_thumb.jpg', 'front', 'Front view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-003', 1, 'images/ELG-003/02.jpg', 'images/ELG-003/02_thumb.jpg', 'back', 'Back view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-003', 2, 'images/ELG-003/03.jpg', 'images/ELG-003/03_thumb.jpg', 'edge', 'Edge view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-003', 3, 'images/ELG-003/04.jpg', 'images/ELG-003/04_thumb.jpg', 'edge', 'Edge view', true) on conflict (catalog_id, sort) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-003', 4, 'images/ELG-003/05.jpg', 'images/ELG-003/05_thumb.jpg', 'case', 'In display case', true) on conflict (catalog_id, sort) do nothing;
insert into public.finds (catalog_id, category, object_type, material, color, length_mm, width_mm, thickness_mm, weight_g, measure_method, condition, key_features, suggestion_1, suggestion_2, suggestion_3, confidence, owner_observations, open_questions, date_found, context_notes, location_sharing, status, era, geologic_period, formation, preservation, hardness, luster, streak, category_note, annotations, category_history, is_public) values ('ELG-005', 'artifact', 'Large biface', 'Chert', 'Cream-white', null, null, null, null, 'Not measured', 'Complete?', 'Broad asymmetric outline, some cortex', 'Knife', 'Scraper', 'Large preform', 'Low', null, 'Needs scaled multi-view photos; use-wear check', null, null, null, 'Draft', 'Undetermined', null, null, null, null, null, null, null, '{}'::jsonb, '[]'::jsonb, true) on conflict (catalog_id) do nothing;
insert into public.photos (catalog_id, sort, repo_path, thumb_path, view, label, is_public) values ('ELG-005', 0, 'images/ELG-005/01.jpg', 'images/ELG-005/01_thumb.jpg', 'case', 'In display case', true) on conflict (catalog_id, sort) do nothing;
insert into public.verified_examples (catalog_id, category, confirmed_type, type_ids, features, length_mm, material, confirmed_on, source, is_public) values ('ELG-001', 'artifact', 'Nolan/Travis', array['nolan', 'travis']::text[], 'Stemmed dart point Long narrow blade, weak shoulders, short straight stem, thin lenticular section, fine edge retouch Stem edges chipped and sharp, not ground (confirmed by owner) Chert', '80-85', 'Chert', '2026-10-12', 'Owner review: stem edges chipped and sharp, not ground', true) on conflict (catalog_id) do nothing;

commit;
