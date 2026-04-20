-- Optional display name per category per store layout (falls back to taxonomy label when null).
alter table public.store_preset_categories
  add column if not exists label_override text;
