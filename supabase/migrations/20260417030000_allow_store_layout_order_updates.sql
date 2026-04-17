-- Allow signed-in users to update per-store aisle ordering rows.
-- Without this, upserting store_preset_categories fails with RLS 42501.

drop policy if exists store_preset_categories_write on public.store_preset_categories;
create policy store_preset_categories_write on public.store_preset_categories
  for all to authenticated
  using (true)
  with check (true);
