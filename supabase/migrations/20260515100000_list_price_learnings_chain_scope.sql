-- Share learned prices across all locations of the same chain (Aldi, Coles, Woolworths, IGA).
-- Other presets keep an isolated scope: preset:<uuid>

alter table public.list_price_learnings
  add column if not exists store_scope text;

update public.list_price_learnings l
set store_scope = case
  when exists (
    select 1 from public.store_presets p
    where p.id = l.store_preset_id and lower(p.slug) like '%aldi%'
  ) then 'aldi'
  when exists (
    select 1 from public.store_presets p
    where p.id = l.store_preset_id
      and (lower(p.slug) like '%woolworths%' or lower(p.slug) like '%woolies%')
  ) then 'woolworths'
  when exists (
    select 1 from public.store_presets p
    where p.id = l.store_preset_id and lower(p.slug) like '%coles%'
  ) then 'coles'
  when exists (
    select 1 from public.store_presets p
    where p.id = l.store_preset_id and lower(p.slug) like '%iga%'
  ) then 'iga'
  else 'preset:' || l.store_preset_id::text
end
where l.store_scope is null;

with ranked as (
  select
    ctid,
    row_number() over (
      partition by list_id, fingerprint, store_scope, unit
      order by sample_count desc, updated_at desc
    ) as rn
  from public.list_price_learnings
  where store_scope is not null
)
delete from public.list_price_learnings l
where l.ctid in (select ctid from ranked where rn > 1);

alter table public.list_price_learnings drop constraint if exists list_price_learnings_pkey;

alter table public.list_price_learnings drop constraint if exists list_price_learnings_store_preset_id_fkey;

alter table public.list_price_learnings drop column if exists store_preset_id;

alter table public.list_price_learnings alter column store_scope set not null;

alter table public.list_price_learnings
  add constraint list_price_learnings_pkey primary key (list_id, fingerprint, store_scope, unit);

drop index if exists list_price_learnings_list_store_idx;

create index if not exists list_price_learnings_list_scope_idx
  on public.list_price_learnings (list_id, store_scope);
