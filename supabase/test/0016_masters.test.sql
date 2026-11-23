-- TEST ONLY · migration 0016 – the masters: Edit, Remove and From date; the Km by itself. Made-up data only.
\set ON_ERROR_STOP on
begin;

\ir fixture.sql

create temporary table t (k text primary key, v jsonb);
grant all on t to authenticated, service_role;

-- ── in use: between its From and its Till ──
select pg_temp.ok(public.in_use(null, null) and public.in_use(public.local_today(), public.local_today())
  and not public.in_use(public.local_today() + 1, null) and not public.in_use(null, public.local_today() - 1), 'in use between From and Till (today when no day is given)');

-- ── the Km by itself: places only, in the order of circle and code; the first Km 0 ──
insert into public.sections (id, site_id, circle_id, code, name, lat, lng) values
  ('40000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'A2', 'Section A2', 19.009000, 73.000000),
  ('40000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'A10', 'Section A10', 19.018000, 73.000000);
update public.sections set lat = 19.000000, lng = 73.000000 where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.ok((select km = 0 from public.sections where code = 'A1' and site_id = '20000000-0000-0000-0000-000000000001'), 'A1 (the first) is Km 0 – the Km typed before is replaced by the place');
select pg_temp.ok((select km between 0.99 and 1.01 from public.sections where code = 'A2' and site_id = '20000000-0000-0000-0000-000000000001'), 'A2 is about 1 km on');
select pg_temp.ok((select km between 1.99 and 2.01 from public.sections where code = 'A10' and site_id = '20000000-0000-0000-0000-000000000001'), 'A10 comes after A2 (A2 < A10), about 2 km');
select pg_temp.ok((select km_from = 0 and km_to between 1.99 and 2.01 from public.circles where id = '30000000-0000-0000-0000-000000000001'), 'the circle''s Km from–to from its sections');

-- ── who may remove, and how ──
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000003');            -- a worker
do $$ begin
  perform public.office_remove('mess', '80000000-0000-0000-0000-000000000001', public.local_today(), 'not mine');
  raise exception 'FAILED: a worker removed a mess';
exception when insufficient_privilege then raise notice 'ok – a worker cannot remove a mess';
end $$;
select pg_temp.act('50000000-0000-0000-0000-000000000002');            -- Site Admin of S1
do $$ begin
  perform public.office_remove('mess', '80000000-0000-0000-0000-000000000002', public.local_today(), 'not my site');
  raise exception 'FAILED: a Site Admin removed another site''s mess';
exception when insufficient_privilege then raise notice 'ok – a Site Admin cannot remove another site''s mess';
end $$;
do $$ begin
  perform public.office_remove('mess', '80000000-0000-0000-0000-000000000001', public.local_today(), '  ');
  raise exception 'FAILED: removed without a reason';
exception when invalid_parameter_value then raise notice 'ok – no removal without the reason';
end $$;
do $$ begin
  perform public.office_remove('mess', '80000000-0000-0000-0000-000000000001', public.local_today() - 1, 'yesterday');
  raise exception 'FAILED: removed from a day that has passed';
exception when invalid_parameter_value then raise notice 'ok – a removal starts today or later (the days before stay)';
end $$;
-- a circle with sections in use stays
select pg_temp.act('50000000-0000-0000-0000-000000000001');            -- the System Admin
do $$ begin
  perform public.office_remove('circle', '30000000-0000-0000-0000-000000000001', public.local_today(), 'not used');
  raise exception 'FAILED: a circle with sections in use was removed';
exception when invalid_parameter_value then raise notice 'ok – a circle with sections in use stays (its sections first)';
end $$;
-- a contractor of a mess in use stays
select pg_temp.act('50000000-0000-0000-0000-000000000009');            -- Accounts
do $$ begin
  perform public.office_remove('contractor', '70000000-0000-0000-0000-000000000001', public.local_today(), 'left');
  raise exception 'FAILED: the contractor of a mess in use was removed';
exception when invalid_parameter_value then raise notice 'ok – the contractor of a mess in use stays (the mess first)';
end $$;

-- the Site Admin removes Mess One from tomorrow: in use today, not tomorrow; who, when, why kept; asked again → refused
select pg_temp.act('50000000-0000-0000-0000-000000000002');
insert into t select 'rm1', public.office_remove('mess', '80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'Mess closed – made by mistake');
reset role;
select pg_temp.ok((select valid_to = public.local_today() and removed_reason = 'Mess closed – made by mistake' and removed_by = '60000000-0000-0000-0000-000000000002'
  and removed_at is not null and active from public.messes where id = '80000000-0000-0000-0000-000000000001'), 'removed from tomorrow: in use till today, with who and why; the row stays');
select pg_temp.ok((select public.in_use(valid_from, valid_to) and not public.in_use(valid_from, valid_to, public.local_today() + 1)
  from public.messes where id = '80000000-0000-0000-0000-000000000001'), '… in use today, not tomorrow');
select pg_temp.ok((select count(*) >= 1 from public.audit_log where entity = 'messes' and entity_id = '80000000-0000-0000-0000-000000000001'
  and after ->> 'removed_reason' = 'Mess closed – made by mistake'), '… and the change is in the audit log');
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000002');
do $$ begin
  perform public.office_remove('mess', '80000000-0000-0000-0000-000000000001', public.local_today() + 2, 'again');
  raise exception 'FAILED: removed twice';
exception when invalid_parameter_value then raise notice 'ok – a removed one is not removed again';
end $$;
-- nobody asks a meal at it for tomorrow
insert into public.meal_windows (mess_id, meal, serve_from, serve_to, order_by, valid_from) values
  ('80000000-0000-0000-0000-000000000001', 'dinner', '23:00', '23:59', '22:00', public.local_today() - 30);
select pg_temp.act('50000000-0000-0000-0000-000000000003');
do $$ begin
  perform public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'dinner', 'meal',
    '[{"item": "lunch", "qty": 1}]'::jsonb);
  raise exception 'FAILED: a meal asked at a mess on a day it is not in use';
exception when insufficient_privilege then raise notice 'ok – a mess not in use that day takes no order';
end $$;

-- ── meal times: new from a date, edit from a date, correct, remove ──
select pg_temp.act('50000000-0000-0000-0000-000000000002');
insert into t select 'w1', to_jsonb(public.office_meal_times('80000000-0000-0000-0000-000000000001', 'lunch', null, public.local_today(), '12:30', '14:30', '00:00', 2, null));
insert into t select 'w2', to_jsonb(public.office_meal_times('80000000-0000-0000-0000-000000000001', 'lunch', (select (v #>> '{}')::uuid from t where k = 'w1'),
  public.local_today() + 1, '12:30', '14:30', '11:30', 2, 'order time typed wrong'));
reset role;
select pg_temp.ok((select valid_to = public.local_today() and order_by = '00:00' from public.meal_windows where id = (select (v #>> '{}')::uuid from t where k = 'w1')),
  'Edit from tomorrow: today keeps the old times');
select pg_temp.ok((select valid_from = public.local_today() + 1 and valid_to is null and order_by = '11:30' from public.meal_windows where id = (select (v #>> '{}')::uuid from t where k = 'w2')),
  '… the new times from tomorrow');
select pg_temp.ok((select count(*) = 1 from public.audit_log where action = 'reason' and entity = 'meal_windows' and reason = 'order time typed wrong'), '… the why is in the History');
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000002');
select public.office_meal_times('80000000-0000-0000-0000-000000000001', 'lunch', (select (v #>> '{}')::uuid from t where k = 'w2'), null, '12:45', '14:30', '11:30', 2, null);
reset role;
select pg_temp.ok((select serve_from = '12:45' and valid_from = public.local_today() + 1 from public.meal_windows where id = (select (v #>> '{}')::uuid from t where k = 'w2')),
  'a correction keeps its days (no new version)');
-- the coming version removed: out of every rule; the days can be given again
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000002');
insert into t select 'rmw', public.office_remove('meal_time', (select (v #>> '{}')::uuid from t where k = 'w2'), public.local_today() + 1, 'not needed');
select public.office_meal_times('80000000-0000-0000-0000-000000000001', 'lunch', null, public.local_today() + 1, '13:00', '15:00', '12:00', 0, null);
reset role;
select pg_temp.ok((select v ->> 'how' = 'removed' from t where k = 'rmw'), 'a version not started yet is removed (kept, out of the rules)');
select pg_temp.ok((select count(*) = 1 from public.meal_windows where mess_id = '80000000-0000-0000-0000-000000000001' and meal = 'lunch' and removed_at is null
  and valid_from = public.local_today() + 1), '… and new times for those days can be given');
-- the version in use ends from a day (never wiped out)
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000002');
insert into t select 'endw', public.office_remove('meal_time', (select id from public.meal_windows where mess_id = '80000000-0000-0000-0000-000000000001' and meal = 'dinner'),
  public.local_today() + 1, 'dinner stops');
reset role;
select pg_temp.ok((select v ->> 'how' = 'ended' from t where k = 'endw') and
  (select valid_to = public.local_today() and removed_at is null from public.meal_windows where mess_id = '80000000-0000-0000-0000-000000000001' and meal = 'dinner'),
  'the version in use ends (its Till), it is not removed');

-- ── rates ──
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000001');            -- the System Admin asks a new rate
insert into public.rates (work_order_id, item_id, rate, valid_from, state, asked_by)
values ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 20, public.local_today() + 5, 'waiting', '60000000-0000-0000-0000-000000000001');
select public.office_rate_edit((select id from public.rates where item_id = '90000000-0000-0000-0000-000000000002' and work_order_id = 'a0000000-0000-0000-0000-000000000001'), 22, null, null);
reset role;
select pg_temp.ok((select rate = 22 and state = 'waiting' from public.rates where item_id = '90000000-0000-0000-0000-000000000002' and work_order_id = 'a0000000-0000-0000-0000-000000000001'),
  'a waiting rate is corrected');
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000001');
insert into t select 'wd', public.office_remove('rate', (select id from public.rates where item_id = '90000000-0000-0000-0000-000000000002' and work_order_id = 'a0000000-0000-0000-0000-000000000001'),
  public.local_today(), 'asked by mistake');
select pg_temp.act('50000000-0000-0000-0000-000000000009');
do $$ begin
  perform public.decide_rate((select id from public.rates where item_id = '90000000-0000-0000-0000-000000000002' and work_order_id = 'a0000000-0000-0000-0000-000000000001'), true, null);
  raise exception 'FAILED: a withdrawn rate was approved';
exception when raise_exception then raise notice 'ok – a withdrawn rate is not decided';
end $$;
reset role;
select pg_temp.ok((select v ->> 'how' = 'withdrawn' from t where k = 'wd'), 'a waiting rate is withdrawn');
-- an approved rate in a bill: only a new rate after the bill's month
insert into public.monthly_bills (code, company_id, site_id, mess_id, work_order_id, month)
values ('B-T-1', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001', '2026-10-01');
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000009');
do $$ begin
  perform public.office_rate_edit((select id from public.rates where work_order_id = 'a0000000-0000-0000-0000-000000000001' and rate = 95), 99, null, null);
  raise exception 'FAILED: a rate in a bill was corrected';
exception when invalid_parameter_value then raise notice 'ok – a rate in a bill is never corrected: a new rate from a later date';
end $$;
insert into t select 'nr', public.office_rate_edit((select id from public.rates where work_order_id = 'a0000000-0000-0000-0000-000000000001' and rate = 95), 99, '2026-11-01', 'new year rate');
reset role;
select pg_temp.ok((select v ->> 'how' like 'new from a date%' from t where k = 'nr')
  and (select rate = 99 and state = 'waiting' and valid_from = '2026-11-01' from public.rates where id = (select (v ->> 'id')::uuid from t where k = 'nr'))
  and (select state = 'approved' and valid_to is null from public.rates where work_order_id = 'a0000000-0000-0000-0000-000000000001' and rate = 95),
  '… the new rate waits for Accounts; the old one stays as it is until approved');

-- ── penalties and work orders ──
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000009');
insert into t select 'p1', to_jsonb(public.office_penalty('a0000000-0000-0000-0000-000000000001', null, public.local_today(), 'late_van', 'Van late', 200, 'batch', null));
insert into t select 'p2', to_jsonb(public.office_penalty('a0000000-0000-0000-0000-000000000001', (select (v #>> '{}')::uuid from t where k = 'p1'), public.local_today() + 3,
  'late_van', 'Van late', 300, 'batch', 'raised'));
insert into t select 'rmp', public.office_remove('penalty', (select (v #>> '{}')::uuid from t where k = 'p2'), public.local_today(), 'not agreed');
reset role;
select pg_temp.ok((select amount = 200 and valid_to = public.local_today() + 2 from public.penalty_rules where id = (select (v #>> '{}')::uuid from t where k = 'p1'))
  and (select v ->> 'how' = 'removed' from t where k = 'rmp'), 'a penalty changes from a date; the coming one is removed');
insert into public.work_orders (id, company_id, site_id, mess_id, contractor_id, number, valid_from, valid_to, payment_days, state) values
  ('a0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000001', 'WO-T-9', '2027-04-01', '2028-03-31', 30, 'draft');
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000009');
insert into t select 'wo9', public.office_remove('work_order', 'a0000000-0000-0000-0000-000000000009', public.local_today(), 'made twice');
insert into t select 'wo1', public.office_remove('work_order', 'a0000000-0000-0000-0000-000000000001', public.local_today() + 10, 'ends early');
reset role;
select pg_temp.ok((select v ->> 'how' = 'removed' from t where k = 'wo9') and (select removed_at is not null and state = 'draft' from public.work_orders where id = 'a0000000-0000-0000-0000-000000000009'),
  'a draft work order is removed');
select pg_temp.ok((select valid_to = public.local_today() + 9 and state = 'active' and removed_at is null from public.work_orders where id = 'a0000000-0000-0000-0000-000000000001'),
  'a live work order ends from a date (never wiped out)');

-- ── sections, contractors' codes, History ──
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000002');
select public.office_remove('section', '40000000-0000-0000-0000-000000000012', public.local_today(), 'no such place');
reset role;
select pg_temp.ok((select not (public.start_places('TST') -> 'sites' -> 0 -> 'sections')::text like '%"A2"%'), 'a removed section is not offered at registration');
select pg_temp.ok((select km between 1.99 and 2.01 from public.sections where code = 'A10' and site_id = '20000000-0000-0000-0000-000000000001'),
  'the Km of the others are worked out again (A10 from A1: about 2 km)');
select set_config('falcon.contractor_code', 'on', true);
update public.contractors set login_code = 'TSTCAT', valid_to = public.local_today() - 1 where id = '70000000-0000-0000-0000-000000000002';
select pg_temp.ok(public.server_door('TSTCAT') is null, 'a contractor not in use: his code opens nothing');
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) >= 2 from public.office_history('messes', '80000000-0000-0000-0000-000000000001')), 'the History of a mess: its changes');
select pg_temp.ok((select count(*) >= 1 from public.office_history('meal_windows', (select (v #>> '{}')::uuid from t where k = 'w1')) where reason is null), '… of a meal-time version too');
select pg_temp.act('50000000-0000-0000-0000-000000000003');
do $$ begin
  perform * from public.office_history('messes', '80000000-0000-0000-0000-000000000001');
  raise exception 'FAILED: a worker read the History';
exception when insufficient_privilege then raise notice 'ok – only the office sees the History';
end $$;
select pg_temp.act('50000000-0000-0000-0000-000000000002');
select public.office_note('messes', '80000000-0000-0000-0000-000000000001', 'place set at the gate');
reset role;
select pg_temp.ok((select count(*) = 1 from public.audit_log where action = 'reason' and entity = 'messes' and reason = 'place set at the gate'), 'the why of a plain edit is kept');

rollback;
