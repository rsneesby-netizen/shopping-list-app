-- Optional per-line "I paid $X for Y (unit)" to improve cost estimates without changing list quantity semantics.

alter table public.list_items
  add column if not exists price_calibration jsonb null;

comment on column public.list_items.price_calibration is
  'Optional {v:1,paidAud,packQty,unit} — paid amount for packQty in same unit as the line; used to derive unit price × list quantity.';
