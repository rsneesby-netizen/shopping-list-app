-- Save store layout category order through a security-definer RPC.
-- This avoids client-side upsert failures under RLS.

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

  i := 0;
  foreach cat in array ordered_categories loop
    insert into public.store_preset_categories (preset_id, category_key, sort_index)
    values (target_preset_id, cat, i)
    on conflict (preset_id, category_key)
    do update set sort_index = excluded.sort_index;
    i := i + 1;
  end loop;
end;
$$;

grant execute on function public.save_store_preset_order(uuid, text[]) to authenticated;
