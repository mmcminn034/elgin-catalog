-- 005: (a) stop measurement-source / heat / visibility check failures from client values like '' or 'Photo estimate'
--      (normalized by a trigger, so nothing is rejected and no data is dropped);
--      (b) optional provenance / acquisition columns for pieces that are not local field finds.
-- Additive and idempotent: safe to run more than once.
begin;

create or replace function public.normalize_find_enums() returns trigger language plpgsql as $$
declare c text; v text;
begin
  foreach c in array array['length_source','width_source','thickness_source','weight_source'] loop
    execute format('select ($1).%I::text', c) into v using new;
    v := lower(btrim(coalesce(v, '')));
    v := case
      when v = '' or v in ('unknown','none','source…','source...') then null
      when v like 'measur%' or v in ('caliper','scale') then 'measured'
      when v like '%photo%' then 'photo_estimate'
      when v like 'estimat%' or v like 'approx%' or v in ('rough','guess') then 'estimate'
      else null end;
    new := jsonb_populate_record(new, jsonb_build_object(c, v));
  end loop;
  if new.heat_treatment is not null then
    v := lower(btrim(new.heat_treatment));
    new.heat_treatment := case when v = '' then null when v in ('none','possible','likely','unknown') then v
      when v like 'no%' then 'none' when v like 'likel%' or v = 'yes' then 'likely' when v like 'possib%' or v = 'maybe' then 'possible' else 'unknown' end;
  end if;
  if new.visibility is not null then
    v := lower(btrim(new.visibility));
    new.visibility := case when v in ('private','editors','public') then v else null end;  -- null -> sync_visibility() fills it from is_public
  end if;
  return new;
end $$;

-- Runs before finds_sync_visibility (triggers fire in name order: "finds_normalize..." < "finds_sync...").
drop trigger if exists finds_normalize_enums on public.finds;
create trigger finds_normalize_enums before insert or update on public.finds for each row execute function public.normalize_find_enums();

-- Clean any existing rows (no data dropped beyond invalid enum strings, which become null).
update public.finds set length_source = length_source where true;

-- Provenance (optional; public pages show state level only)
alter table public.finds add column if not exists provenance text;
alter table public.finds add column if not exists acquisition text;
alter table public.finds add column if not exists provenance_answer text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'finds_provenance_answer_chk') then
    alter table public.finds add constraint finds_provenance_answer_chk check (provenance_answer is null or provenance_answer in ('local','collection','unsure'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'finds_provenance_coarse') then
    alter table public.finds add constraint finds_provenance_coarse check (provenance is null or (provenance !~ '[0-9]+\.[0-9]{2,}' and provenance !~ '^\s*[0-9]+\s+\w' and length(provenance) <= 120));
  end if;
end $$;

commit;
