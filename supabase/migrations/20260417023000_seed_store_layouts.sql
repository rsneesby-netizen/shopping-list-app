-- Add explicit store layouts requested by product requirements and
-- ensure each has its own aisle-order rows.

insert into public.store_presets (slug, name)
values
  ('woolworths-kotara', 'Woolworths Kotara'),
  ('coles-kotara', 'Coles Kotara'),
  ('coles-waratah', 'Coles Waratah'),
  ('aldi-kotara', 'Aldi Kotara'),
  ('aldi-newcastle-west', 'Aldi Newcastle West')
on conflict (slug) do update set name = excluded.name;

with categories as (
  select * from (values
    ('fruit_veg', 0),
    ('bakery', 1),
    ('deli', 2),
    ('meat_poultry', 3),
    ('seafood', 4),
    ('dairy', 5),
    ('frozen', 6),
    ('pantry', 7),
    ('drinks', 8),
    ('snacks', 9),
    ('household', 10),
    ('health_beauty', 11),
    ('baby', 12),
    ('pet', 13),
    ('miscellaneous', 14)
  ) as t(category_key, sort_index)
),
target_presets as (
  select id
  from public.store_presets
  where slug in (
    'woolworths-kotara',
    'coles-kotara',
    'coles-waratah',
    'aldi-kotara',
    'aldi-newcastle-west'
  )
)
insert into public.store_preset_categories (preset_id, category_key, sort_index)
select p.id, c.category_key, c.sort_index
from target_presets p
cross join categories c
on conflict (preset_id, category_key)
do update set sort_index = excluded.sort_index;
