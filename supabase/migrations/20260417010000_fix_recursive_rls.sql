-- Fix recursive RLS evaluation by routing membership checks through
-- a security-definer helper function.

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

drop policy if exists lists_select_member on public.lists;
create policy lists_select_member on public.lists
  for select to authenticated using (public.user_has_list_access(id));

drop policy if exists lists_update_member on public.lists;
create policy lists_update_member on public.lists
  for update to authenticated using (public.user_has_list_access(id))
  with check (public.user_has_list_access(id));

drop policy if exists list_members_select on public.list_members;
create policy list_members_select on public.list_members
  for select to authenticated using (public.user_has_list_access(list_id));

drop policy if exists list_invites_select on public.list_invites;
create policy list_invites_select on public.list_invites
  for select to authenticated using (public.user_has_list_access(list_id));

drop policy if exists list_invites_insert on public.list_invites;
create policy list_invites_insert on public.list_invites
  for insert to authenticated with check (public.user_has_list_access(list_id));

drop policy if exists list_items_all on public.list_items;
create policy list_items_all on public.list_items
  for all to authenticated using (public.user_has_list_access(list_id))
  with check (public.user_has_list_access(list_id));

drop policy if exists list_item_events_select on public.list_item_events;
create policy list_item_events_select on public.list_item_events
  for select to authenticated using (public.user_has_list_access(list_id));

drop policy if exists list_item_events_insert on public.list_item_events;
create policy list_item_events_insert on public.list_item_events
  for insert to authenticated with check (public.user_has_list_access(list_id));
