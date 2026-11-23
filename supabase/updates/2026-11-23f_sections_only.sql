-- FALCON · DATABASE UPDATE of 23-11-2026 (sixth) · only Sections: a section is a place with its area (metres); a van order finds its
-- section by the phone's location; an order from outside every section carries its location, and the kitchen and the driver get it
-- with the directions; the van's stops nearest first; no circle anywhere. It adds part 0017 (supabase/migrations/0017_sections_only.sql)
-- – nothing else is changed. Run ONCE in FALCON's Supabase (SQL Editor), BEFORE the web update of the same day is merged (the new pages
-- read the new columns). One transaction: all or nothing. Safe to run again; it deletes nothing (the circles of before stay in the
-- database, shown nowhere). It changes no row of before except the Km of the sections that have a place (worked out again from their
-- places, in the order of their codes).

begin;
set local client_min_messages = warning;

-- FALCON · migration 0017 · only Sections (his word of 23-11-2026: "ekach thew only section … Majiwada he section aahe, tya section
-- madhe jewde lok fetch krel system te tyat ale; circle chi garaj nahi watat; section che baheun koni kel asel tr – driver aso owner
-- aso je koni aso – te location, direction he sagle hot jail"; "OK he banaw").
--   * A SECTION is a place with its area: its point (lat, lng – as before) and its metres (radius_m – new). A circle is no longer
--     asked: sections.circle_id may be empty. The circles of before stay in the database as they are (nothing is deleted); no
--     screen shows them.
--   * A van order finds its section by itself: the phone's point → the section in use whose area holds it (the nearest, if two
--     do – public.section_at). A point inside no section is kept with that order only (orders.to_lat / to_lng) – the kitchen and
--     the driver get the place, its distance and Google's directions. Without the location the person still chooses the section.
--   * The van's stops: each section and each such point of its orders, the nearest to the mess first (batch_stops.order_id for a
--     point); the kitchen may change the order as before (set_route), the driver marks a point reached as a section (reach_stop).
--   * The Km: the sections that have a place, in the order of their codes (A1, A2 … A10 … B1 …) – the first Km 0, as before.
--   * kitchen_orders, driver_trip, my_van, start_places: the same, without the circle and with the point.
-- No row of before is changed except the Km of the sections (worked out again from their places, in the order of their codes).
-- Safe to run again.

-- ── the new columns ──────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.sections alter column circle_id drop not null;
alter table public.sections add column if not exists radius_m integer check (radius_m between 10 and 5000);

alter table public.orders add column if not exists to_lat numeric(9,6) check (to_lat between -90 and 90);
alter table public.orders add column if not exists to_lng numeric(9,6) check (to_lng between -180 and 180);
-- a van order goes to a section OR to a point (never both); every other order to neither
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.orders'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%to_section_id IS NOT NULL%' and pg_get_constraintdef(oid) not ilike '%to_lat%' loop
    execute format('alter table public.orders drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_delivery_place') then
    alter table public.orders add constraint orders_delivery_place check (case when kind = 'delivery'
      then (to_section_id is null) <> (to_lat is null) and (to_lat is null) = (to_lng is null)
      else to_section_id is null and to_lat is null and to_lng is null end);
  end if;
end $$;

alter table public.batch_stops alter column section_id drop not null;
alter table public.batch_stops add column if not exists order_id uuid references public.orders(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.batch_stops'::regclass and conname = 'batch_stops_section_or_point') then
    alter table public.batch_stops add constraint batch_stops_section_or_point check ((section_id is null) <> (order_id is null));
  end if;
end $$;
create unique index if not exists batch_stops_one_point on public.batch_stops (batch_id, order_id) where order_id is not null;

-- ── the section of a point ───────────────────────────────────────────────────────────────────────────────────────────────
-- The section in use (on that day) whose area holds the point – the nearest one when two do; null: inside no section.
-- A section without its place or its metres is never found by a point (it is still chosen by hand).
create or replace function public.section_at(p_site uuid, p_lat numeric, p_lng numeric, p_day date default null) returns uuid
language sql stable security definer set search_path = '' as $$
  select x.id from public.sections x
  where x.site_id = p_site and x.active and public.in_use(x.valid_from, x.valid_to, p_day)
    and x.lat is not null and x.lng is not null and x.radius_m is not null
    and public.metres_between(x.lat, x.lng, p_lat, p_lng) <= x.radius_m
  order by public.metres_between(x.lat, x.lng, p_lat, p_lng), x.code
  limit 1
$$;

-- ── the Km by itself: the sections in the order of their codes (no circle) ───────────────────────────────────────────────
create or replace function public.site_km(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; plat numeric; plng numeric; acc numeric := 0; first boolean := true; k numeric;
begin
  for r in select x.id, x.lat, x.lng from public.sections x
           where x.site_id = p_site and x.active and public.in_use(x.valid_from, x.valid_to) and x.lat is not null and x.lng is not null
           order by regexp_replace(x.code, '[0-9]+', '', 'g'), coalesce(substring(x.code from '[0-9]+')::numeric, 0), x.code loop
    if not first then acc := acc + public.metres_between(plat, plng, r.lat, r.lng); end if;
    k := round(acc / 1000.0, 3);
    update public.sections set km = k where id = r.id and km is distinct from k;
    plat := r.lat; plng := r.lng; first := false;
  end loop;
  -- the circles of before (shown nowhere) keep their Km from–to from their sections
  update public.circles ci set km_from = q.lo, km_to = case when q.hi > q.lo then q.hi end
  from (select circle_id, min(km) lo, max(km) hi from public.sections
        where site_id = p_site and circle_id is not null and active and public.in_use(valid_from, valid_to) and lat is not null and lng is not null and km is not null
        group by circle_id) q
  where ci.id = q.circle_id and (ci.km_from is distinct from q.lo or ci.km_to is distinct from (case when q.hi > q.lo then q.hi end));
end $$;
do $$ declare s uuid; begin for s in select id from public.sites loop perform public.site_km(s); end loop; end $$;

-- ── asking: request_order (as in 0016) – a van order with the phone's point instead of a section ──────────────────────────
drop function if exists public.request_order(uuid, date, public.meal, public.order_kind, jsonb, uuid, text, uuid);
create or replace function public.request_order(p_mess uuid, p_date date, p_meal public.meal, p_kind public.order_kind,
  p_lines jsonb, p_section uuid default null, p_note text default null, p_visit uuid default null,
  p_lat numeric default null, p_lng numeric default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me(); who public.people; m public.messes; w public.meal_windows; s public.sites;
  ln jsonb; pid uuid; it public.items; qty integer; existing jsonb := '[]'::jsonb; made integer := 0;
  o public.orders; v public.guest_visits; group_ boolean := false; dl timestamp;
  sec uuid; plat numeric; plng numeric;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into who from public.people where id = me;
  select * into m from public.messes where id = p_mess and active and public.in_use(valid_from, valid_to, p_date);
  if not found or m.company_id <> who.company_id then raise exception 'This mess is not open to you.' using errcode = '42501'; end if;
  select * into s from public.sites where id = m.site_id;
  if p_date < public.local_today() then raise exception 'A day that has passed cannot be asked.' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Nothing was asked.' using errcode = '22023'; end if;
  select * into w from public.meal_windows where mess_id = p_mess and meal = p_meal and removed_at is null
    and p_date >= valid_from and (valid_to is null or p_date <= valid_to);
  if not found then raise exception 'This mess does not serve this meal on that day.' using errcode = '22023'; end if;
  dl := p_date + (case when p_kind = 'meal' then w.serve_to else w.order_by end);
  if public.local_now() > dl then
    raise exception 'Too late for this meal – asking closed at %.', to_char(dl, 'HH24:MI') using errcode = '22023';
  end if;
  -- (0017) where the van goes: the section chosen by hand; else the section whose area holds the phone's point; else the point
  if p_kind = 'delivery' then
    if p_section is not null then
      if not exists (select 1 from public.sections where id = p_section and site_id = m.site_id and active and public.in_use(valid_from, valid_to, p_date)) then
        raise exception 'Choose the section to deliver to.' using errcode = '22023';
      end if;
      sec := p_section;
    elsif p_lat is not null and p_lng is not null then
      if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'The location is not right.' using errcode = '22023'; end if;
      sec := public.section_at(m.site_id, p_lat, p_lng, p_date);
      if sec is null then plat := round(p_lat, 6); plng := round(p_lng, 6); end if;
    else
      raise exception 'Turn on the location, or choose the section to deliver to.' using errcode = '22023';
    end if;
  end if;
  -- a temporary user: meals at the mess for himself only, at his own site (docs/PERMISSIONS.md)
  if who.state = 'temporary' and (p_kind <> 'meal' or m.site_id is distinct from who.home_site_id) then
    raise exception 'Your temporary access is for meals at your own site''s mess only.' using errcode = '42501';
  end if;
  if who.state not in ('verified', 'id_assigned', 'linked', 'temporary') then
    raise exception 'Your registration is not checked yet.' using errcode = '42501';
  end if;
  -- a guest: only during his open visit at this site, and his host says yes first
  if who.kind = 'guest' then
    select * into v from public.guest_visits where id = p_visit and person_id = me and ended_at is null and site_id = m.site_id;
    if not found then raise exception 'Start today''s visit first.' using errcode = '42501'; end if;
  elsif p_visit is not null then
    raise exception 'Only a guest orders on a visit.' using errcode = '22023';
  end if;

  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := coalesce(nullif(ln ->> 'person', '')::uuid, me);
    if pid <> me then group_ := true; end if;
  end loop;
  if group_ and (not who.may_group or who.kind <> 'employee') then
    raise exception 'Asking for others needs the Site Admin''s permission.' using errcode = '42501';
  end if;

  o := null;
  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := coalesce(nullif(ln ->> 'person', '')::uuid, me);
    qty := coalesce((ln ->> 'qty')::integer, 1);
    select * into it from public.items where company_id = who.company_id and code = ln ->> 'item' and active;
    if not found then raise exception 'Unknown item: %', ln ->> 'item' using errcode = '22023'; end if;
    if it.kind = 'meal' and it.meal <> p_meal then raise exception '% is not %.', it.name, p_meal using errcode = '22023'; end if;
    if who.state = 'temporary' and it.kind <> 'meal' then
      raise exception 'Your temporary access is for meals only.' using errcode = '42501';
    end if;
    if pid <> me and not exists (select 1 from public.people where id = pid and company_id = who.company_id and kind = 'employee'
                                 and state in ('verified', 'id_assigned', 'linked')) then
      raise exception 'One of the people is not a checked employee.' using errcode = '22023';
    end if;
    if it.kind = 'meal' and exists (select 1 from public.order_lines l where l.person_id = pid and l.service_date = p_date
                                   and l.meal = p_meal and l.is_meal and l.state <> 'cancelled') then
      existing := existing || (select jsonb_build_object('person', pid, 'order', x.code, 'order_id', x.id)
                               from public.order_lines l join public.orders x on x.id = l.order_id
                               where l.person_id = pid and l.service_date = p_date and l.meal = p_meal and l.is_meal and l.state <> 'cancelled'
                               limit 1);
      continue;
    end if;
    if o.id is null then
      insert into public.orders (code, company_id, site_id, mess_id, kind, meal, service_date, requested_by, is_group,
                                 guest_visit_id, host_state, to_section_id, to_lat, to_lng, note)
      values (public.next_code('order:' || s.id, 'MS-' || s.code || '-'), who.company_id, m.site_id, m.id, p_kind, p_meal, p_date, me,
              group_, v.id, case when v.id is null or v.host_id is null then 'not_needed' else 'waiting' end::public.host_state, sec, plat, plng, p_note)
      returning * into o;
    end if;
    insert into public.order_lines (order_id, person_id, item_id, is_meal, service_date, meal, qty)
    values (o.id, pid, it.id, it.kind = 'meal', p_date, p_meal, case when it.kind = 'meal' then 1 else qty end);
    made := made + 1;
    if p_kind in ('parcel', 'delivery') then
      insert into public.delivery_codes (order_id, person_id, code)
      values (o.id, pid, (select lpad((((get_byte(b, 0) << 16) | (get_byte(b, 1) << 8) | get_byte(b, 2)) % 10000)::text, 4, '0')
                         from (select extensions.gen_random_bytes(3) as b) r))
      on conflict do nothing;
    end if;
  end loop;

  if o.id is not null then
    perform public.audit_write('request', 'orders', o.id::text, null, to_jsonb(o), o.site_id, 'app', null);
  end if;
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'lines', made, 'existing', existing,
    'section', (select code from public.sections where id = sec), 'point', plat is not null);
end $$;


-- ── the van: its stops – sections and points, the nearest to the mess first ─────────────────────────────────────────────
-- make_batch (as in 0004) – a point of an order is a stop of its own
create or replace function public.make_batch(p_mess uuid, p_date date, p_meal public.meal, p_orders uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.messes; b uuid; n integer; code text; i integer := 0; r record;
begin
  select * into m from public.messes where id = p_mess;
  if not found or not public.works_at_mess(p_mess, array['mess_owner', 'mess_operator']::public.app_role[]) then
    raise exception 'Only this mess''s kitchen makes its batches.' using errcode = '42501';
  end if;
  select count(*) into n from public.orders o where o.id = any (p_orders) and o.mess_id = p_mess and o.kind = 'delivery'
    and o.service_date = p_date and o.meal = p_meal and o.state in ('accepted', 'preparing', 'ready')
    and not exists (select 1 from public.batch_orders bo where bo.order_id = o.id and bo.removed_at is null);
  if n = 0 or n <> cardinality(p_orders) then
    raise exception 'Every order of a batch must be an accepted delivery of this meal, not in another batch.' using errcode = '22023';
  end if;
  code := public.next_code('batch:' || p_mess || ':' || p_date, 'B-', 2);
  insert into public.batches (code, company_id, site_id, mess_id, service_date, meal, created_by)
  values (code, m.company_id, m.site_id, m.id, p_date, p_meal, public.me()) returning id into b;
  insert into public.batch_orders (batch_id, order_id) select b, unnest(p_orders);
  for r in select q.sid, q.oid from (
             select distinct s.id sid, case when s.id is null then o.id end oid, s.km,
                    public.metres_between(m.lat, m.lng, coalesce(s.lat, o.to_lat), coalesce(s.lng, o.to_lng)) far
             from public.orders o left join public.sections s on s.id = o.to_section_id
             where o.id = any (p_orders)) q
           order by q.far nulls last, q.km nulls last loop
    i := i + 1;
    insert into public.batch_stops (batch_id, seq, section_id, order_id) values (b, i, r.sid, r.oid);
  end loop;
  perform public.audit_write('make', 'batches', b::text, null, jsonb_build_object('orders', p_orders), m.site_id, 'owner app', null);
  return b;
end $$;

-- set_route (as in 0004) – a stop is {section, eta} or {order, eta} (a point)
create or replace function public.set_route(p_batch uuid, p_stops jsonb, p_km numeric, p_minutes integer) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.batches; s jsonb; i integer := 0;
begin
  select * into x from public.batches where id = p_batch for update;
  if not found or not public.works_at_mess(x.mess_id, array['mess_owner', 'mess_operator']::public.app_role[]) then
    raise exception 'Only this mess''s kitchen sets the route.' using errcode = '42501';
  end if;
  if x.state in ('on_the_way', 'completed', 'cancelled') then raise exception 'The batch has gone already.' using errcode = '22023'; end if;
  update public.batch_stops set seq = seq + 50 where batch_id = x.id;                         -- free the numbers, then renumber
  for s in select * from jsonb_array_elements(p_stops) loop
    i := i + 1;
    update public.batch_stops set seq = i, eta = nullif(s ->> 'eta', '')::timestamptz
     where batch_id = x.id and (section_id = nullif(s ->> 'section', '')::uuid or order_id = nullif(s ->> 'order', '')::uuid);
    if not found then raise exception 'A stop is not a section of this batch.' using errcode = '22023'; end if;
  end loop;
  if exists (select 1 from public.batch_stops where batch_id = x.id and seq > 50) then
    raise exception 'Every section of the batch must be in the route.' using errcode = '22023';
  end if;
  update public.batches set planned_km = p_km, planned_minutes = p_minutes where id = x.id;
end $$;

-- reach_stop (as in 0004) – a section, or a point (its order)
drop function if exists public.reach_stop(uuid, uuid);
create or replace function public.reach_stop(p_batch uuid, p_section uuid default null, p_order uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_driver_of(p_batch) then raise exception 'This batch is not given to you.' using errcode = '42501'; end if;
  update public.batch_stops set reached_at = coalesce(reached_at, now())
   where batch_id = p_batch and (section_id = p_section or order_id = p_order);
  if not found then raise exception 'This is not a stop of your batch.' using errcode = '22023'; end if;
end $$;

-- ── what the screens read ────────────────────────────────────────────────────────────────────────────────────────────────
-- kitchen_orders (as in 0011) – no circle; a point: where, for the kitchen's directions
create or replace function public.kitchen_orders(p_mess uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'code', o.code, 'kind', o.kind, 'meal', o.meal, 'state', o.state, 'host_state', o.host_state, 'created_at', o.created_at,
    'accepted_at', o.accepted_at, 'change_until', o.change_until, 'ready_at', o.ready_at, 'is_group', o.is_group, 'guest', o.guest_visit_id is not null,
    'note', o.note, 'requester', r.full_name, 'requester_role', r.work_role,
    'section', case when s.id is null then null else jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'km', s.km, 'place', s.place, 'lat', s.lat, 'lng', s.lng) end,
    'point', case when o.to_lat is null then null else jsonb_build_object('lat', o.to_lat, 'lng', o.to_lng) end,
    'batch', (select x.code from public.batch_orders bo join public.batches x on x.id = bo.batch_id where bo.order_id = o.id and bo.removed_at is null limit 1),
    'lines', (select jsonb_agg(jsonb_build_object('id', l.id, 'person', p.full_name, 'person_id', p.id, 'role', p.work_role, 'item', i.name, 'code', i.code,
                'is_meal', l.is_meal, 'qty', l.qty, 'state', l.state, 'delivered_qty', l.delivered_qty, 'short_qty', l.short_qty,
                'confirmed', (select k.kind from public.confirmations k where k.order_line_id = l.id)) order by l.is_meal desc, p.full_name)
              from public.order_lines l join public.people p on p.id = l.person_id join public.items i on i.id = l.item_id where l.order_id = o.id)
  ) order by s.km nulls last, s.code, o.created_at), '[]')
  from public.orders o join public.people r on r.id = o.requested_by
       left join public.sections s on s.id = o.to_section_id
  where o.mess_id = p_mess and o.service_date = p_date and o.host_state in ('not_needed', 'approved')
    and public.works_at_mess(p_mess, array['mess_owner', 'mess_operator']::public.app_role[])
$$;

-- driver_trip (as in 0011) – a stop is a section or a point; the point's place for his directions
create or replace function public.driver_trip(p_batch uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'code', x.code, 'state', x.state, 'meal', x.meal, 'service_date', x.service_date, 'planned_km', x.planned_km,
    'planned_minutes', x.planned_minutes, 'dispatched_at', x.dispatched_at, 'completed_at', x.completed_at, 'vehicle_check', x.vehicle_check,
    'mess', m.name, 'mess_lat', m.lat, 'mess_lng', m.lng, 'vehicle', jsonb_build_object('reg_no', v.reg_no, 'kind', v.kind, 'capacity', v.capacity),
    'stops', (select jsonb_agg(jsonb_build_object('seq', t.seq, 'section_id', s.id, 'order_id', t.order_id, 'point', t.order_id is not null,
                'section', coalesce(s.code, po.code), 'km', s.km, 'place', case when s.id is null then 'Location – outside the sections' else s.place end,
                'lat', coalesce(s.lat, po.to_lat), 'lng', coalesce(s.lng, po.to_lng), 'eta', t.eta, 'reached_at', t.reached_at,
                'people', (select jsonb_agg(jsonb_build_object('person_id', p.id, 'name', p.full_name, 'role', p.work_role, 'order_id', o.id, 'code', o.code,
                              'lines', (select jsonb_agg(jsonb_build_object('item', i.name, 'qty', l2.qty, 'state', l2.state, 'is_meal', l2.is_meal, 'failed_reason', l2.failed_reason,
                                                                            'delivered_qty', l2.delivered_qty) order by l2.is_meal desc)
                                        from public.order_lines l2 join public.items i on i.id = l2.item_id where l2.order_id = o.id and l2.person_id = p.id and l2.state <> 'cancelled'),
                              'confirmed', (select k.kind from public.order_lines l3 join public.confirmations k on k.order_line_id = l3.id where l3.order_id = o.id and l3.person_id = p.id and l3.is_meal limit 1))
                            order by p.full_name)
                          from public.batch_orders bo join public.orders o on o.id = bo.order_id
                          join (select distinct order_id, person_id from public.order_lines where state <> 'cancelled') lp on lp.order_id = o.id
                          join public.people p on p.id = lp.person_id
                          where bo.batch_id = x.id and bo.removed_at is null and (o.to_section_id = t.section_id or o.id = t.order_id))) order by t.seq)
              from public.batch_stops t left join public.sections s on s.id = t.section_id left join public.orders po on po.id = t.order_id
              where t.batch_id = x.id))
  from public.batches x join public.messes m on m.id = x.mess_id left join public.vehicles v on v.id = x.vehicle_id
  where x.id = p_batch and public.can_see_batch(x.id)
$$;

-- my_van (as in 0011) – a point of somebody else is only "a location" (never where); his own is "mine"
create or replace function public.my_van(p_order uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('batch', x.id, 'code', x.code, 'state', x.state, 'dispatched_at', x.dispatched_at,
    'driver', d.full_name, 'driver_mobile', case when x.state = 'on_the_way' then d.mobile end,
    'vehicle', v.reg_no, 'vehicle_kind', v.kind,
    'stops', (select jsonb_agg(jsonb_build_object('seq', t.seq, 'section', coalesce(s.code, 'Location'), 'km', s.km, 'place', s.place, 'eta', t.eta,
                                                  'reached_at', t.reached_at, 'point', t.order_id is not null,
                                                  'mine', coalesce(t.section_id = o.to_section_id, false) or coalesce(t.order_id = o.id, false)) order by t.seq)
              from public.batch_stops t left join public.sections s on s.id = t.section_id where t.batch_id = x.id),
    'last', (select jsonb_build_object('at', p.at, 'lat', p.lat, 'lng', p.lng) from public.track_points p where p.batch_id = x.id and x.state = 'on_the_way' order by p.at desc limit 1))
  from public.orders o join public.batch_orders bo on bo.order_id = o.id and bo.removed_at is null
       join public.batches x on x.id = bo.batch_id
       left join public.people d on d.id = x.driver_id left join public.vehicles v on v.id = x.vehicle_id
  where o.id = p_order and (o.requested_by = public.me() or exists (select 1 from public.order_lines l where l.order_id = o.id and l.person_id = public.me()))
$$;

-- start_places (as in 0016) – the sections of a site, no circle
create or replace function public.start_places(p_company text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('company', c.id, 'name', c.name, 'sites', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name)
                       order by regexp_replace(x.code, '[0-9]+', '', 'g'), coalesce(substring(x.code from '[0-9]+')::numeric, 0), x.code)
      from public.sections x where x.site_id = s.id and x.active and public.in_use(x.valid_from, x.valid_to)), '[]')) order by s.code)
    from public.sites s where s.company_id = c.id and s.active and public.in_use(s.valid_from, s.valid_to)), '[]'))
  from public.companies c where c.code = upper(p_company) and c.active
$$;

-- ── who may call what ────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.section_at(uuid, numeric, numeric, date) from public, anon, authenticated;
revoke all on function public.request_order(uuid, date, public.meal, public.order_kind, jsonb, uuid, text, uuid, numeric, numeric),
  public.reach_stop(uuid, uuid, uuid) from public, anon;
grant execute on function public.request_order(uuid, date, public.meal, public.order_kind, jsonb, uuid, text, uuid, numeric, numeric),
  public.reach_stop(uuid, uuid, uuid) to authenticated;

commit;
