-- Robust list creation path that avoids client-side RLS insert edge cases.
-- This function runs as definer and always uses auth.uid() as owner.

create or replace function public.create_list(
  list_title text default 'Shopping list',
  preset_id uuid default null
)
returns public.lists
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.lists;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.lists (owner_id, title, store_preset_id)
  values (auth.uid(), coalesce(nullif(trim(list_title), ''), 'Shopping list'), preset_id)
  returning * into created;

  return created;
end;
$$;

grant execute on function public.create_list(text, uuid) to authenticated;
