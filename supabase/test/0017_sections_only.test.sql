-- TEST ONLY · migration 0017 – only Sections: a section is a place with its area; a van order finds its section by the phone's
-- point; a point inside no section goes with the order (the kitchen and the driver get where); the van's stops near → far.
-- Made-up data only.
\set ON_ERROR_STOP on
begin;

\ir fixture.sql

create temporary table t (k text primary key, v text);
grant all on t to authenticated, service_role;

-- the made-up world: the mess at a point; lunch; a driver and his van; Section A1 with an area; Majiwada – a section with no circle
update public.messes set lat = 19.000000, lng = 73.000000, radius_m = 100 where id = '80000000-0000-0000-0000-000000000001';
insert into public.meal_windows (mess_id, meal, serve_from, serve_to, order_by, change_minutes, valid_from)
  values ('80000000-0000-0000-0000-000000000001', 'lunch', '12:00', '23:59', '23:58', 0, '2026-01-01');
insert into auth.users (id) values ('50000000-0000-0000-0000-000000000011');
insert into public.people (id, company_id, kind, auth_user_id, full_name, mobile, mobile_verified_at, state, home_site_id) values
  ('60000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'employee', '50000000-0000-0000-0000-000000000011', 'Test Driver', '+910000000011', now(), 'verified', '20000000-0000-0000-0000-000000000001');
insert into public.role_grants (person_id, company_id, site_id, role) values
  ('60000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'driver');
insert into public.vehicles (id, company_id, site_id, reg_no, kind, capacity) values
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'MH 00 TT 0001', 'Van', 40);
update public.sections set lat = 19.010000, lng = 73.000000, radius_m = 700 where id = '40000000-0000-0000-0000-000000000001';
insert into public.sections (id, site_id, code, name, place, lat, lng, radius_m) values
  ('40000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000001', 'MJW', 'Majiwada', 'Majiwada junction', 19.020000, 73.000000, 500);
insert into public.sections (id, site_id, code, name, lat, lng) values
  ('40000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000001', 'NOAREA', 'No area yet', 19.050000, 73.000000);

select pg_temp.ok((select circle_id is null from public.sections where code = 'MJW'), 'a section is made without a circle');
select pg_temp.ok((select count(*) from public.circles) = 2, 'the circles of before stay as they are');

-- ── the Km: in the order of the codes, no circle ──
select pg_temp.ok((select km = 0 from public.sections where code = 'A1' and site_id = '20000000-0000-0000-0000-000000000001'), 'A1 (the first code) is Km 0');
select pg_temp.ok((select km between 1.10 and 1.12 from public.sections where code = 'MJW'), 'Majiwada comes after A1 by its code – about 1.1 km');

-- ── the section of a point ──
select pg_temp.ok(public.section_at('20000000-0000-0000-0000-000000000001', 19.021, 73.000) = '40000000-0000-0000-0000-000000000020', 'a point inside Majiwada''s 500 m is Majiwada');
select pg_temp.ok(public.section_at('20000000-0000-0000-0000-000000000001', 19.0105, 73.000) = '40000000-0000-0000-0000-000000000001', 'a point near A1 is A1');
select pg_temp.ok(public.section_at('20000000-0000-0000-0000-000000000001', 19.016, 73.000) = '40000000-0000-0000-0000-000000000020',
  'inside two areas (A1 667 m of its 700, Majiwada 445 m of its 500): the nearest – Majiwada');
select pg_temp.ok(public.section_at('20000000-0000-0000-0000-000000000001', 19.050, 73.000) is null, 'a section without its metres is never found by a point');
select pg_temp.ok(public.section_at('20000000-0000-0000-0000-000000000001', 19.100, 73.000) is null, 'a point far from every section: none');
select pg_temp.ok(public.section_at('20000000-0000-0000-0000-000000000002', 19.021, 73.000) is null, 'another site''s sections are not looked at');

-- ── asking: by the point ──
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000003');            -- inside Majiwada
insert into t select 'in', public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'delivery',
  '[{"item":"lunch"}]', null, null, null, 19.0205, 73.0001)::text;
select pg_temp.ok((select (v::jsonb ->> 'section') = 'MJW' and (v::jsonb ->> 'point') = 'false' from t where k = 'in'), 'inside Majiwada: the answer says Majiwada');
select pg_temp.ok((select to_section_id = '40000000-0000-0000-0000-000000000020' and to_lat is null and to_lng is null from public.orders
  where id = (select (v::jsonb ->> 'order_id')::uuid from t where k = 'in')), '… the order goes to Majiwada and his point is not kept');
select pg_temp.act('50000000-0000-0000-0000-000000000001');            -- outside every section
insert into t select 'out', public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'delivery',
  '[{"item":"lunch"}]', null, null, null, 19.0400004, 73.0000004)::text;
select pg_temp.ok((select v::jsonb ->> 'section' is null and (v::jsonb ->> 'point') = 'true' from t where k = 'out'), 'outside every section: the answer says "a point"');
select pg_temp.ok((select to_section_id is null and to_lat = 19.040000 and to_lng = 73.000000 from public.orders
  where id = (select (v::jsonb ->> 'order_id')::uuid from t where k = 'out')), '… the order keeps the point (6 places) for the van');
select pg_temp.act('50000000-0000-0000-0000-000000000002');
do $$ begin
  perform public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'delivery', '[{"item":"lunch"}]');
  raise exception 'FAILED: a van order with no section and no point';
exception when invalid_parameter_value then raise notice 'ok – no van order without the location or a section';
end $$;
do $$ begin
  perform public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'delivery', '[{"item":"lunch"}]', null, null, null, 95, 73);
  raise exception 'FAILED: a point that is no point';
exception when invalid_parameter_value then raise notice 'ok – a location that is not right is refused';
end $$;
-- chosen by hand (no location – an app of before): as before, and the point is not looked at
insert into t select 'hand', public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'delivery',
  '[{"item":"lunch"}]', '40000000-0000-0000-0000-000000000001', null, null, 19.0205, 73.0001) ->> 'order_id';
select pg_temp.ok((select to_section_id = '40000000-0000-0000-0000-000000000001' and to_lat is null from public.orders where id = (select v::uuid from t where k = 'hand')),
  'a section chosen by hand goes first (the point is not kept)');
reset role;
do $$ begin
  insert into public.orders (code, company_id, site_id, mess_id, kind, meal, service_date, requested_by, to_lat, to_lng)
  values ('MS-T-X1', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001',
          'meal', 'lunch', public.local_today() + 1, '60000000-0000-0000-0000-000000000003', 19, 73);
  raise exception 'FAILED: a meal at the mess with a point';
exception when check_violation then raise notice 'ok – only a van order has a point';
end $$;
do $$ begin
  insert into public.orders (code, company_id, site_id, mess_id, kind, meal, service_date, requested_by, to_section_id, to_lat, to_lng)
  values ('MS-T-X2', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001',
          'delivery', 'lunch', public.local_today() + 1, '60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 19, 73);
  raise exception 'FAILED: a van order to a section and a point';
exception when check_violation then raise notice 'ok – a van order goes to a section OR a point, never both';
end $$;

-- ── the kitchen: where; the van's stops near → far ──
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000008');
select public.kitchen_decide(id, true) from public.orders where state = 'requested';
select public.kitchen_step(id, 'ready') from public.orders where state = 'accepted';
insert into t select 'k', public.kitchen_orders('80000000-0000-0000-0000-000000000001', public.local_today() + 1)::text;
select pg_temp.ok((select bool_and(not (x ? 'circle') and not ((x -> 'section') ? 'circle')) from t, jsonb_array_elements(t.v::jsonb) x where t.k = 'k'), 'the kitchen''s list has no circle');
select pg_temp.ok((select (x -> 'point' ->> 'lat')::numeric = 19.04 and x -> 'section' = 'null'::jsonb from t, jsonb_array_elements(t.v::jsonb) x
  where t.k = 'k' and x ->> 'id' = (select v::jsonb ->> 'order_id' from t where k = 'out')), 'the kitchen sees the point of the order outside the sections');
select pg_temp.ok((select x -> 'point' = 'null'::jsonb and x -> 'section' ->> 'code' = 'MJW' from t, jsonb_array_elements(t.v::jsonb) x
  where t.k = 'k' and x ->> 'id' = (select v::jsonb ->> 'order_id' from t where k = 'in')), '… and Majiwada for the one inside (no point)');
insert into t select 'b', public.make_batch('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch',
  array[(select (v::jsonb ->> 'order_id')::uuid from t where k = 'out'), (select (v::jsonb ->> 'order_id')::uuid from t where k = 'in'), (select v::uuid from t where k = 'hand')]);
select pg_temp.ok((select string_agg(coalesce(s.code, 'point'), ',' order by t2.seq) from public.batch_stops t2 left join public.sections s on s.id = t2.section_id
  where t2.batch_id = (select v::uuid from t where k = 'b')) = 'A1,MJW,point', 'the stops: A1 (1.1 km), Majiwada (2.2 km), the point (4.4 km) – nearest first');
select pg_temp.ok((select order_id = (select (v::jsonb ->> 'order_id')::uuid from t where k = 'out') from public.batch_stops
  where batch_id = (select v::uuid from t where k = 'b') and section_id is null), 'the point is a stop of its own, with its order');
select public.set_route((select v::uuid from t where k = 'b'), jsonb_build_array(
  jsonb_build_object('order', (select v::jsonb ->> 'order_id' from t where k = 'out')), jsonb_build_object('section', '40000000-0000-0000-0000-000000000020'),
  jsonb_build_object('section', '40000000-0000-0000-0000-000000000001')), 9, 30);
select pg_temp.ok((select seq = 1 from public.batch_stops where batch_id = (select v::uuid from t where k = 'b') and section_id is null), 'the kitchen may put the point first');
do $$ begin
  perform public.set_route((select v::uuid from t where k = 'b'), jsonb_build_array(jsonb_build_object('section', '40000000-0000-0000-0000-000000000020')), 9, 30);
  raise exception 'FAILED: a route without every stop';
exception when invalid_parameter_value then raise notice 'ok – every stop must be in the route';
end $$;
select public.assign_batch((select v::uuid from t where k = 'b'), '60000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000001');

-- ── the driver: where to go; he reaches the point ──
select pg_temp.act('50000000-0000-0000-0000-000000000011');
select public.driver_answer((select v::uuid from t where k = 'b'), true);
insert into t select 'trip', public.driver_trip((select v::uuid from t where k = 'b'))::text;
select pg_temp.ok((select (x ->> 'point')::boolean and (x ->> 'lat')::numeric = 19.04 and (x ->> 'lng')::numeric = 73 and x ->> 'section_id' is null
  and jsonb_array_length(x -> 'people') = 1 and x -> 'people' -> 0 ->> 'name' = 'Test Admin'
  from t, jsonb_array_elements(t.v::jsonb -> 'stops') x where t.k = 'trip' and (x ->> 'seq')::int = 1), 'the driver gets the point''s place and its person');
select pg_temp.ok((select x ->> 'section' = 'MJW' and (x ->> 'lat')::numeric = 19.02 and jsonb_array_length(x -> 'people') = 1
  from t, jsonb_array_elements(t.v::jsonb -> 'stops') x where t.k = 'trip' and (x ->> 'seq')::int = 2), '… and Majiwada''s place and its person');
select pg_temp.ok((select (v::jsonb ->> 'mess_lat')::numeric = 19 from t where k = 'trip'), '… and the mess''s place (where the trip starts)');
select public.vehicle_ready((select v::uuid from t where k = 'b'), '{"hot_box": true}');
select pg_temp.act('50000000-0000-0000-0000-000000000008');
select public.dispatch_batch((select v::uuid from t where k = 'b'));
select pg_temp.act('50000000-0000-0000-0000-000000000011');
select public.reach_stop((select v::uuid from t where k = 'b'), null, (select (v::jsonb ->> 'order_id')::uuid from t where k = 'out'));
select public.reach_stop((select v::uuid from t where k = 'b'), '40000000-0000-0000-0000-000000000020');
select pg_temp.ok((select count(*) = 2 from public.batch_stops where batch_id = (select v::uuid from t where k = 'b') and reached_at is not null), 'the driver marks the point and a section reached');
do $$ begin
  perform public.reach_stop((select v::uuid from t where k = 'b'), null, (select v::uuid from t where k = 'hand'));
  raise exception 'FAILED: reached an order that is no stop';
exception when invalid_parameter_value then raise notice 'ok – an order that is no point is not a stop';
end $$;

-- ── the people: their van ──
select pg_temp.act('50000000-0000-0000-0000-000000000003');            -- Majiwada
insert into t select 'van3', public.my_van((select (v::jsonb ->> 'order_id')::uuid from t where k = 'in'))::text;
select pg_temp.ok((select (x ->> 'mine')::boolean from t, jsonb_array_elements(t.v::jsonb -> 'stops') x where t.k = 'van3' and x ->> 'section' = 'MJW'), 'his stop is Majiwada');
select pg_temp.ok((select x ->> 'section' = 'Location' and not (x ? 'lat') and not (x ->> 'mine')::boolean
  from t, jsonb_array_elements(t.v::jsonb -> 'stops') x where t.k = 'van3' and (x ->> 'point')::boolean), 'somebody else''s point is only "Location" – never where');
select pg_temp.act('50000000-0000-0000-0000-000000000001');            -- the point
insert into t select 'van1', public.my_van((select (v::jsonb ->> 'order_id')::uuid from t where k = 'out'))::text;
select pg_temp.ok((select count(*) = 1 from t, jsonb_array_elements(t.v::jsonb -> 'stops') x where t.k = 'van1' and (x ->> 'mine')::boolean and (x ->> 'point')::boolean), 'his stop is his point');
reset role;

-- ── registration: the sections of a site, no circle ──
insert into t select 'start', public.start_places('TST')::text;
select pg_temp.ok((select bool_and(not (y ? 'circle')) and count(*) = 3 from t, jsonb_array_elements(t.v::jsonb -> 'sites') x, jsonb_array_elements(x -> 'sections') y
  where t.k = 'start' and x ->> 'code' = 'S1'), 'registration offers the sections – no circle');

-- ── who may call ──
select pg_temp.ok(not has_function_privilege('authenticated', 'public.section_at(uuid, numeric, numeric, date)', 'execute'), 'nobody calls section_at directly');
select pg_temp.ok(has_function_privilege('authenticated', 'public.request_order(uuid, date, public.meal, public.order_kind, jsonb, uuid, text, uuid, numeric, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.request_order(uuid, date, public.meal, public.order_kind, jsonb, uuid, text, uuid, numeric, numeric)', 'execute'), 'request_order: a signed-in person only');
select pg_temp.ok((select count(*) = 1 from pg_proc where proname = 'request_order' and pronamespace = 'public'::regnamespace), 'one request_order only (no second of before)');

rollback;
