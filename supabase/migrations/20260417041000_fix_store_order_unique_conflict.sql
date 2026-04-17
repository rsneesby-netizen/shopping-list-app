-- Fix duplicate sort_index collisions when reordering store preset categories.
-- Strategy:
-- 1) Shift current rows for this preset to a temporary high range.
-- 2) Upsert desired category rows with final contiguous sort_index values.
-- 3) Remove any categories no longer present in ordered_categories.

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

  delete from public.store_preset_categories
  where preset_id = target_preset_id
    and not (category_key = any (ordered_categories));
end;
$$;
