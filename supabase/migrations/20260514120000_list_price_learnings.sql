-- Per-list, per-fingerprint, per-store learned unit prices from user calibrations (EMA over time).

create table public.list_price_learnings (
  list_id uuid not null references public.lists (id) on delete cascade,
  fingerprint text not null,
  store_preset_id uuid not null references public.store_presets (id) on delete restrict,
  unit text not null,
  ema_unit_price_aud numeric not null check (ema_unit_price_aud > 0),
  sample_count int not null default 1 check (sample_count >= 1),
  min_unit_price_aud numeric not null check (min_unit_price_aud > 0),
  max_unit_price_aud numeric not null check (max_unit_price_aud > 0),
  last_obs_unit_price_aud numeric not null check (last_obs_unit_price_aud > 0),
  updated_at timestamptz not null default now(),
  primary key (list_id, fingerprint, store_preset_id, unit)
);

create index list_price_learnings_list_store_idx on public.list_price_learnings (list_id, store_preset_id);

alter table public.list_price_learnings enable row level security;

create policy list_price_learnings_all on public.list_price_learnings
  for all to authenticated using (public.user_has_list_access(list_id))
  with check (public.user_has_list_access(list_id));

alter publication supabase_realtime add table public.list_price_learnings;

