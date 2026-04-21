-- When a store layout category is removed, move affected list items to miscellaneous.
-- This keeps grouped views stable and prevents "lost" categories on existing items.

create or replace function public.save_store_preset_order(
  target_preset_id uuid,
  ordered_categories text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
  cat text;
  removed_categories text[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if target_preset_id is null then
    raise exception 'target_preset_id_required';
  end if;

  if ordered_categories is null or array_length(ordered_categories, 1) is null then
    raise exception 'ordered_categories_required';
  end if;

  select coalesce(array_agg(c.category_key), '{}'::text[])
  into removed_categories
  from public.store_preset_categories c
  where c.preset_id = target_preset_id
    and not (c.category_key = any (ordered_categories));

  -- Move existing sort indexes out of the way to avoid unique collisions.
  update public.store_preset_categories
  set sort_index = sort_index + 1000
  where preset_id = target_preset_id;

  i := 0;
  foreach cat in array ordered_categories loop
    insert into public.store_preset_categories (preset_id, category_key, sort_index)
    values (target_preset_id, cat, i)
    on conflict (preset_id, category_key)
    do update set sort_index = excluded.sort_index;
    i := i + 1;
  end loop;

  if array_length(removed_categories, 1) is not null then
    update public.list_items li
    set category_key = 'miscellaneous'
    from public.lists l
    where li.list_id = l.id
      and l.store_preset_id = target_preset_id
      and li.category_key = any (removed_categories);
  end if;

  delete from public.store_preset_categories
  where preset_id = target_preset_id
    and not (category_key = any (ordered_categories));
end;
$$;

