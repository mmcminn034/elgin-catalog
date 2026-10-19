begin;
drop trigger if exists finds_ab_editor_guard on public.finds;
drop function if exists public.finds_editor_guard();
commit;
