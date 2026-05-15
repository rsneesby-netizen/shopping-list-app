-- Per-store-scope line calibrations so "your price" at Aldi does not apply when viewing Woolworths.

alter table public.list_items
  add column if not exists price_calibration_by_scope jsonb not null default '{}'::jsonb;

comment on column public.list_items.price_calibration_by_scope is
  'Per retail scope user price hints. Keys: aldi, coles, woolworths, iga, preset:<uuid>, or _ when list has no store. Values: {v:1,paidAud,packQty,unit}.';

-- Move legacy single-column calibration to the scope implied by each list's current store preset.
update public.list_items li
set price_calibration_by_scope = jsonb_build_object(
  coalesce(
    case
      when l.store_preset_id is null then '_'
      when lower(coalesce(sp.slug, '')) like '%aldi%' then 'aldi'
      when lower(coalesce(sp.slug, '')) like '%woolworths%' or lower(coalesce(sp.slug, '')) like '%woolies%' then 'woolworths'
      when lower(coalesce(sp.slug, '')) like '%coles%' then 'coles'
      when lower(coalesce(sp.slug, '')) like '%iga%' then 'iga'
      else 'preset:' || l.store_preset_id::text
    end,
    '_'
  ),
  li.price_calibration
)
from public.lists l
left join public.store_presets sp on sp.id = l.store_preset_id
where li.list_id = l.id
  and li.price_calibration is not null;

alter table public.list_items drop column if exists price_calibration;
