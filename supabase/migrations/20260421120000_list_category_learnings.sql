-- Remember manual category choices per list + item fingerprint (normalized text),
-- so future adds of the same item default to that aisle category.

create table public.list_category_learnings (
  list_id uuid not null references public.lists (id) on delete cascade,
  fingerprint text not null,
  category_key text not null,
  updated_at timestamptz not null default now(),
  primary key (list_id, fingerprint)
);

create index list_category_learnings_list_idx on public.list_category_learnings (list_id);

alter table public.list_category_learnings enable row level security;

create policy list_category_learnings_all on public.list_category_learnings
  for all to authenticated using (public.user_has_list_access(list_id))
  with check (public.user_has_list_access(list_id));
