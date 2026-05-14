-- Allow authenticated users to manage store presets from the app.
-- When a preset is deleted, lists that used it keep working with store_preset_id cleared.

alter table public.lists
  drop constraint if exists lists_store_preset_id_fkey;

alter table public.lists
  add constraint lists_store_preset_id_fkey
  foreign key (store_preset_id)
  references public.store_presets (id)
  on delete set null;

create policy store_presets_insert on public.store_presets
  for insert to authenticated with check (true);

create policy store_presets_update on public.store_presets
  for update to authenticated using (true) with check (true);

create policy store_presets_delete on public.store_presets
  for delete to authenticated using (true);
