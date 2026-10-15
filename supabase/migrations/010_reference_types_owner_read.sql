-- 010: reference_types readable only by the collection owner (admin). The service role bypasses RLS.
-- Scoring is unaffected: the client scorer and analyze-find (which falls back when 0 rows come back) use the static
-- data/reference/public-types.json, which carries the same published summaries.
-- Revert: drop policy "reference owner read"; create policy "reference read" on public.reference_types for select using (true);
drop policy if exists "reference read" on public.reference_types;
drop policy if exists "reference owner read" on public.reference_types;
create policy "reference owner read" on public.reference_types for select
  using (exists (select 1 from public.collections c where c.slug = 'rolling-oak' and c.owner = auth.uid()));
