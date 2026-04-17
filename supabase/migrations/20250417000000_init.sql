-- Grocery list app: schema, RLS, realtime, seeds

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  updated_at timestamptz not null default now()
);

create table public.store_presets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null
);

create table public.store_preset_categories (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references public.store_presets (id) on delete cascade,
  category_key text not null,
  sort_index int not null,
  unique (preset_id, category_key),
  unique (preset_id, sort_index)
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Shopping list',
  store_preset_id uuid references public.store_presets (id),
  category_order_override jsonb,
  created_at timestamptz not null default now()
);

create table public.list_members (
  list_id uuid not null references public.lists (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  primary key (list_id, user_id)
);

create table public.list_invites (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes (18), 'hex'),
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  text text not null,
  quantity numeric not null default 1 check (quantity > 0),
  unit text not null default 'each',
  checked boolean not null default false,
  position text not null,
  category_key text,
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index list_items_list_position on public.list_items (list_id, position);
create index list_items_list_checked on public.list_items (list_id, checked);

create table public.list_item_events (
  id bigserial primary key,
  list_id uuid not null references public.lists (id) on delete cascade,
  item_id uuid references public.list_items (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  fingerprint text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index list_item_events_list_created on public.list_item_events (list_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger list_items_updated_at
before update on public.list_items
for each row execute function public.set_updated_at();

create or replace function public.handle_new_list()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.list_members (list_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger lists_after_insert_member
after insert on public.lists
for each row execute function public.handle_new_list();

create or replace function public.prevent_list_owner_change()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id cannot change';
  end if;
  return new;
end;
$$;

create trigger lists_owner_immutable
before update on public.lists
for each row execute function public.prevent_list_owner_change();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger grocery_on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPC: accept invite
-- ---------------------------------------------------------------------------

create or replace function public.accept_list_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.list_invites%rowtype;
begin
  select * into inv
  from public.list_invites
  where token = invite_token
    and (expires_at is null or expires_at > now());

  if not found then
    raise exception 'invalid_or_expired_invite';
  end if;

  insert into public.list_members (list_id, user_id, role)
  values (inv.list_id, auth.uid(), inv.role)
  on conflict (list_id, user_id) do update set role = excluded.role;

  return inv.list_id;
end;
$$;

grant execute on function public.accept_list_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.store_presets enable row level security;
alter table public.store_preset_categories enable row level security;
alter table public.lists enable row level security;
alter table public.list_members enable row level security;
alter table public.list_invites enable row level security;
alter table public.list_items enable row level security;
alter table public.list_item_events enable row level security;

create or replace function public.user_has_list_access(target_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.list_members m
    where m.list_id = target_list_id
      and m.user_id = auth.uid()
  );
$$;

-- Profiles
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- Store presets (read for any signed-in user)
create policy store_presets_read on public.store_presets
  for select to authenticated using (true);

create policy store_preset_categories_read on public.store_preset_categories
  for select to authenticated using (true);

create policy store_preset_categories_write on public.store_preset_categories
  for all to authenticated using (true) with check (true);

-- Lists
create policy lists_select_member on public.lists
  for select to authenticated using (public.user_has_list_access(id));

create policy lists_insert_owner on public.lists
  for insert to authenticated with check (owner_id = auth.uid());

create policy lists_update_member on public.lists
  for update to authenticated using (public.user_has_list_access(id))
  with check (public.user_has_list_access(id));

create policy lists_delete_owner on public.lists
  for delete to authenticated using (owner_id = auth.uid());

-- Members
create policy list_members_select on public.list_members
  for select to authenticated using (public.user_has_list_access(list_id));

create policy list_members_insert_owner on public.list_members
  for insert to authenticated with check (
    exists (
      select 1 from public.lists l
      where l.id = list_members.list_id and l.owner_id = auth.uid()
    )
  );

create policy list_members_delete_owner on public.list_members
  for delete to authenticated using (
    exists (
      select 1 from public.lists l
      where l.id = list_members.list_id and l.owner_id = auth.uid()
    )
  );

-- Invites
create policy list_invites_select on public.list_invites
  for select to authenticated using (public.user_has_list_access(list_id));

create policy list_invites_insert on public.list_invites
  for insert to authenticated with check (public.user_has_list_access(list_id));

-- Items
create policy list_items_all on public.list_items
  for all to authenticated using (public.user_has_list_access(list_id))
  with check (public.user_has_list_access(list_id));

-- Events
create policy list_item_events_select on public.list_item_events
  for select to authenticated using (public.user_has_list_access(list_id));

create policy list_item_events_insert on public.list_item_events
  for insert to authenticated with check (public.user_has_list_access(list_id));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.list_items;
alter publication supabase_realtime add table public.lists;
alter publication supabase_realtime add table public.list_item_events;

-- ---------------------------------------------------------------------------
-- Seed store presets (typical AU walk order — illustrative)
-- ---------------------------------------------------------------------------

insert into public.store_presets (slug, name) values
  ('woolworths', 'Woolworths (typical)'),
  ('coles', 'Coles (typical)');

with w as (
  select id from public.store_presets where slug = 'woolworths'
), keys as (
  select * from (values
    ('fruit_veg', 0),
    ('bakery', 1),
    ('deli', 2),
    ('meat_poultry', 3),
    ('seafood', 4),
    ('dairy', 5),
    ('frozen', 6),
    ('pantry', 7),
    ('drinks', 8),
    ('snacks', 9),
    ('household', 10),
    ('health_beauty', 11),
    ('baby', 12),
    ('pet', 13),
    ('miscellaneous', 14)
  ) as t(category_key, sort_index)
)
insert into public.store_preset_categories (preset_id, category_key, sort_index)
select w.id, keys.category_key, keys.sort_index from w cross join keys;

with c as (
  select id from public.store_presets where slug = 'coles'
), keys as (
  select * from (values
    ('fruit_veg', 0),
    ('bakery', 1),
    ('deli', 2),
    ('seafood', 3),
    ('meat_poultry', 4),
    ('dairy', 5),
    ('frozen', 6),
    ('pantry', 7),
    ('drinks', 8),
    ('snacks', 9),
    ('household', 10),
    ('health_beauty', 11),
    ('baby', 12),
    ('pet', 13),
    ('miscellaneous', 14)
  ) as t(category_key, sort_index)
)
insert into public.store_preset_categories (preset_id, category_key, sort_index)
select c.id, keys.category_key, keys.sort_index from c cross join keys;
