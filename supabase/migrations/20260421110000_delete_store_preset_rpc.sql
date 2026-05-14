-- Reliable store deletion: clear list references then remove preset + categories.
-- Runs as security definer so it works even if client RLS on store_presets is missing,
-- and avoids FK issues when lists.store_preset_id still uses ON DELETE NO ACTION.

create or replace function public.delete_store_preset(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  preset_count int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if target_id is null then
    raise exception 'No store was specified.';
  end if;

  select count(*)::int into preset_count from public.store_presets;
  if preset_count <= 1 then
    raise exception 'Add another store before deleting the last one.';
  end if;

  if not exists (select 1 from public.store_presets where id = target_id) then
    raise exception 'That store no longer exists.';
  end if;

  update public.lists
  set store_preset_id = null
  where store_preset_id = target_id;

  delete from public.store_preset_categories
  where preset_id = target_id;

  delete from public.store_presets
  where id = target_id;
end;
$$;

grant execute on function public.delete_store_preset(uuid) to authenticated;
