-- Ensure list owner is derived from JWT user in DB.
-- This avoids client-side owner_id mismatches causing RLS insert failures.

alter table public.lists
  alter column owner_id set default auth.uid();

drop policy if exists lists_insert_owner on public.lists;
create policy lists_insert_owner on public.lists
  for insert to authenticated
  with check (owner_id = auth.uid());
