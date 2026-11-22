-- FALCON · seed · the first company and what a mess sells. Run ONCE, AFTER FALCON_MASTER.sql, in the Supabase SQL Editor.
-- Safe to run again: nothing that is already there is changed (on conflict do nothing). No person, no rate, no tax rule, no
-- site and no money is put in here – the System Admin enters sites, circles and sections from the web (Sites and sections),
-- Accounts enters the work order, the rates and the GST / TDS rules (each with its date and the CA's check).

begin;

-- The company. Its code is the one in Vercel (VITE_FALCON_COMPANY_CODE / FALCON_COMPANY_CODE).
insert into public.companies (code, name) values ('RCL', 'Rachana Construction Limited')
on conflict (code) do nothing;

-- What a mess sells – the lines of a bill (as on the approved billing board). A meal's code is its meal; "guest_meal" and
-- "parcel_packing" are needed by the bill. Other extras are added by the System Admin from the web (Settings).
insert into public.items (company_id, code, name, kind, meal, unit)
select c.id, v.code, v.name, v.kind::public.item_kind, v.meal::public.meal, v.unit
from public.companies c
cross join (values
  ('breakfast',      'Breakfast',      'meal',    'breakfast', 'plate'),
  ('lunch',          'Lunch',          'meal',    'lunch',     'plate'),
  ('snacks',         'Snacks',         'meal',    'snacks',    'plate'),
  ('dinner',         'Dinner',         'meal',    'dinner',    'plate'),
  ('guest_meal',     'Guest meal',     'service', null,        'plate'),
  ('parcel_packing', 'Parcel packing', 'service', null,        'parcel'),
  ('water_1l',       'Water 1 L',      'extra',   null,        'bottle')
) as v (code, name, kind, meal, unit)
where c.code = 'RCL'
on conflict (company_id, code) do nothing;

commit;

-- What is there now (read only):
select c.code as company, i.code as item, i.name, i.kind, i.meal, i.unit
from public.items i join public.companies c on c.id = i.company_id where c.code = 'RCL' order by i.kind, i.code;
