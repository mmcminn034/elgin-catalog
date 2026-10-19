begin;
delete from public.products where category = 'kits' and coming_soon;
alter table public.products drop column if exists coming_soon, drop column if exists category;
drop table if exists public.pay_dig_sites;
commit;
