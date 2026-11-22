-- TEST ONLY · migrations 0003–0009 – one meal's whole life: asking (no second meal), a group, a guest and his host, the kitchen,
-- a batch, the driver and the person's code, the owner's phone follow-up, a complaint, the day's lock and a correction, the
-- month's bill and its invoice check, the approvals, the payment; registration; notifications. Made-up data only.
\set ON_ERROR_STOP on
begin;
\ir fixture.sql

-- more of the made-up world: a driver, a supervisor, management; the mess's lunch window; the things sold and their rates
insert into auth.users (id, phone) values ('50000000-0000-0000-0000-000000000011', null), ('50000000-0000-0000-0000-000000000012', null),
  ('50000000-0000-0000-0000-000000000013', null), ('50000000-0000-0000-0000-000000000020', '910000000020');
insert into public.people (id, company_id, kind, auth_user_id, full_name, mobile, mobile_verified_at, state, home_site_id) values
  ('60000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'employee', '50000000-0000-0000-0000-000000000011', 'Test Driver', '+910000000011', now(), 'verified', '20000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'employee', '50000000-0000-0000-0000-000000000012', 'Test Supervisor', '+910000000012', now(), 'verified', '20000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'employee', '50000000-0000-0000-0000-000000000013', 'Test Management', '+910000000013', now(), 'verified', '20000000-0000-0000-0000-000000000001');
insert into public.role_grants (person_id, company_id, site_id, role) values
  ('60000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'driver'),
  ('60000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'mess_supervisor'),
  ('60000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', null, 'management');
update public.people set may_group = true where id = '60000000-0000-0000-0000-000000000003';
insert into public.meal_windows (mess_id, meal, serve_from, serve_to, order_by, change_minutes, valid_from)
  values ('80000000-0000-0000-0000-000000000001', 'lunch', '12:00', '23:59', '23:58', 2, '2026-01-01');
insert into public.items (id, company_id, code, name, kind, meal) values
  ('90000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'guest_meal', 'Guest meal', 'service', null),
  ('90000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'parcel_packing', 'Parcel packing', 'service', null);
insert into public.rates (work_order_id, item_id, rate, valid_from, state, decided_by, decided_at) values
  ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 20, '2026-04-01', 'approved', '60000000-0000-0000-0000-000000000009', now()),
  ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 150, '2026-04-01', 'approved', '60000000-0000-0000-0000-000000000009', now()),
  ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004', 10, '2026-04-01', 'approved', '60000000-0000-0000-0000-000000000009', now());
insert into public.vehicles (id, company_id, site_id, reg_no, kind, capacity) values
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'MH 00 TT 0001', 'Van', 40);
insert into public.penalty_rules (work_order_id, code, what, amount, per, valid_from)
  values ('a0000000-0000-0000-0000-000000000001', 'late_van', 'Van more than 30 min late', 200, 'batch', '2026-04-01');

create temporary table t (k text primary key, v text);
grant all on t to authenticated, service_role;
set local role authenticated;

-- ── asking ──
select pg_temp.act('50000000-0000-0000-0000-000000000003');
insert into t select 'o1', (public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'delivery',
  '[{"item":"lunch"},{"item":"water_1l","qty":2}]', '40000000-0000-0000-0000-000000000001') ->> 'order_id');
select pg_temp.ok((select code from public.orders where id = (select v::uuid from t where k = 'o1')) ~ '^MS-S1-[0-9]{4}$', 'an order gets its code');
select pg_temp.ok((select count(*) from public.delivery_codes) = 1, 'the person gets his own delivery code');
select pg_temp.ok((public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'meal', '[{"item":"lunch"}]') ->> 'order_id') is null,
  'a second lunch for the same day is not made');
select pg_temp.ok(jsonb_array_length(public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'meal', '[{"item":"lunch"}]') -> 'existing') = 1,
  'his existing order is shown instead');
insert into t select 'g1', (public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'delivery',
  '[{"item":"lunch"},{"person":"60000000-0000-0000-0000-000000000001","item":"lunch"}]', '40000000-0000-0000-0000-000000000001') ->> 'order_id');
select pg_temp.ok((select count(*) from public.order_lines where order_id = (select v::uuid from t where k = 'g1')) = 1 and
  (select is_group from public.orders where id = (select v::uuid from t where k = 'g1')), 'a group: only the person without a lunch gets a line');
do $$ begin
  perform public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() - 1, 'lunch', 'meal', '[{"item":"lunch"}]');
  raise exception 'FAILED: a past day was asked';
exception when invalid_parameter_value then raise notice 'ok – a past day cannot be asked';
end $$;
select pg_temp.act('50000000-0000-0000-0000-000000000004');
do $$ begin
  perform public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'meal',
    '[{"person":"60000000-0000-0000-0000-000000000003","item":"lunch"}]');
  raise exception 'FAILED: a group request without permission';
exception when insufficient_privilege then raise notice 'ok – asking for others needs the Site Admin''s permission';
end $$;
select pg_temp.ok((select count(*) from public.orders) = 0, 'another employee sees none of these orders');

-- ── a guest and his host ──
select pg_temp.act('50000000-0000-0000-0000-000000000006');
insert into t select 'v1', public.start_visit('20000000-0000-0000-0000-000000000001', 'Test visit', null, '60000000-0000-0000-0000-000000000001', 'Host');
insert into t select 'q1', (public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch', 'meal',
  '[{"item":"lunch"}]', null, null, (select v::uuid from t where k = 'v1')) ->> 'order_id');
select pg_temp.act('50000000-0000-0000-0000-000000000008');
select pg_temp.ok((select count(*) from public.orders where id = (select v::uuid from t where k = 'q1')) = 0, 'the kitchen does not see a guest''s order before the host''s OK');
select pg_temp.act('50000000-0000-0000-0000-000000000001');
select public.host_decide((select v::uuid from t where k = 'q1'), true);
select pg_temp.act('50000000-0000-0000-0000-000000000008');
select pg_temp.ok((select count(*) from public.orders where id = (select v::uuid from t where k = 'q1')) = 1, 'after the host''s OK the kitchen sees it');

-- ── the kitchen ──
select public.kitchen_decide(id, true) from public.orders where state = 'requested';
select public.kitchen_step(id, 'ready') from public.orders where state = 'accepted';
select pg_temp.ok((select count(*) from public.orders where state = 'ready') = 3, 'the kitchen accepts and makes the orders ready');
select pg_temp.ok((select count(*) from public.people_of_order((select v::uuid from t where k = 'g1'))) = 1, 'the kitchen sees the names of an order''s people');
insert into t select 'b1', public.make_batch('80000000-0000-0000-0000-000000000001', public.local_today() + 1, 'lunch',
  array[(select v::uuid from t where k = 'o1'), (select v::uuid from t where k = 'g1')]);
select public.assign_batch((select v::uuid from t where k = 'b1'), '60000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000001');
do $$ begin
  perform public.dispatch_batch((select v::uuid from t where k = 'b1'));
  raise exception 'FAILED: dispatched before the driver said yes';
exception when invalid_parameter_value then raise notice 'ok – no dispatch before the driver accepts';
end $$;

-- ── the driver ──
select pg_temp.act('50000000-0000-0000-0000-000000000011');
select pg_temp.ok((select count(*) from public.batches) = 1 and (select count(*) from public.orders) = 2, 'the driver sees only his batch and its orders');
select pg_temp.ok((select count(*) from public.notifications where kind = 'batch_assigned') = 1, 'the driver is told of the new batch');
select pg_temp.ok((select count(*) from public.delivery_codes) = 0, 'the driver never sees a person''s code');
select public.driver_answer((select v::uuid from t where k = 'b1'), true);
select public.vehicle_ready((select v::uuid from t where k = 'b1'), '{"hot_box": true}');
select pg_temp.act('50000000-0000-0000-0000-000000000008');
select public.dispatch_batch((select v::uuid from t where k = 'b1'));
select pg_temp.act('50000000-0000-0000-0000-000000000011');
select public.van_position((select v::uuid from t where k = 'b1'), 18.5, 73.8);
select pg_temp.act('50000000-0000-0000-0000-000000000003');
select pg_temp.ok((select count(*) from public.track_points) = 1, 'the person sees the van while it is on the way');
insert into t select 'code', code from public.delivery_codes where order_id = (select v::uuid from t where k = 'o1');
select pg_temp.act('50000000-0000-0000-0000-000000000004');
select pg_temp.ok((select count(*) from public.track_points) = 0, 'somebody else does not');
select pg_temp.act('50000000-0000-0000-0000-000000000011');
select pg_temp.ok((public.deliver_with_code((select v::uuid from t where k = 'b1'), (select v::uuid from t where k = 'o1'), '60000000-0000-0000-0000-000000000003',
    case when (select v from t where k = 'code') = '0000' then '1111' else '0000' end) ->> 'tries_left') = '4', 'a wrong code is refused and its try is counted');
select public.deliver_with_code((select v::uuid from t where k = 'b1'), (select v::uuid from t where k = 'o1'), '60000000-0000-0000-0000-000000000003', (select v from t where k = 'code'));
select pg_temp.ok((select count(*) from public.confirmations where kind = 'beneficiary_otp') = 2, 'the right code delivers and confirms his lunch and water');
select public.deliver_without_code((select v::uuid from t where k = 'b1'), (select v::uuid from t where k = 'g1'), '60000000-0000-0000-0000-000000000001', 'given to his colleague');
select public.complete_batch((select v::uuid from t where k = 'b1'));
select pg_temp.ok((select state from public.batches) = 'completed', 'the driver closes the trip');
do $$ begin
  perform public.van_position((select v::uuid from t where k = 'b1'), 18.5, 73.8);
  raise exception 'FAILED: the place kept after the trip';
exception when insufficient_privilege then raise notice 'ok – the van''s place is not kept after the delivery';
end $$;

-- ── the owner: the counter, the follow-up ──
select pg_temp.act('50000000-0000-0000-0000-000000000008');
select public.serve_line(id) from public.order_lines where order_id = (select v::uuid from t where k = 'q1');
select pg_temp.ok((select count(*) from public.followups('80000000-0000-0000-0000-000000000001', public.local_today(), public.local_today() + 1)) = 2,
  'the follow-up list shows what is delivered and not confirmed');
select public.confirm_by_phone((select order_line_id from public.followups('80000000-0000-0000-0000-000000000001', public.local_today(), public.local_today() + 1)
                                where person_id = '60000000-0000-0000-0000-000000000001'), 'He said he got it');
select pg_temp.act('50000000-0000-0000-0000-000000000006');
select public.confirm_received(id, 1) from public.order_lines where order_id = (select v::uuid from t where k = 'q1');
reset role;
select pg_temp.ok((select string_agg(kind::text, ',' order by kind::text) from public.confirmations) = 'beneficiary_app,beneficiary_otp,beneficiary_otp,owner_phone',
  'each confirmation keeps its own kind – a phone follow-up is never an OTP');
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000008');
do $$ begin
  perform public.confirm_by_phone((select id from public.order_lines where person_id = '60000000-0000-0000-0000-000000000003' and is_meal), 'again');
  raise exception 'FAILED: confirmed twice';
exception when invalid_parameter_value then raise notice 'ok – a line is confirmed once';
end $$;

-- ── a complaint ──
select pg_temp.act('50000000-0000-0000-0000-000000000003');
insert into t select 'c1', (public.raise_complaint('80000000-0000-0000-0000-000000000001', 'cleanliness', 'Stone in the dal', null, '{}', null,
  (select v::uuid from t where k = 'o1'), 2) ->> 'id');
select pg_temp.act('50000000-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) from public.notifications where kind = 'complaint_serious') = 1, 'a serious complaint reaches the Site Admin at once');
select pg_temp.act('50000000-0000-0000-0000-000000000008');
select public.reply_complaint((select v::uuid from t where k = 'c1'), 'Sorry – replaced', 'Dal changed');
select pg_temp.act('50000000-0000-0000-0000-000000000003');
select public.complaint_solved((select v::uuid from t where k = 'c1'), true);
select pg_temp.act('50000000-0000-0000-0000-000000000012');
select public.decide_complaint((select v::uuid from t where k = 'c1'), true, 50);
select pg_temp.ok((select state from public.complaints) = 'closed', 'the supervisor decides and closes it');
reset role;

-- ── time passes: the day goes back into last month ──
insert into t values ('day', (date_trunc('month', public.local_today()) - interval '1 month' + interval '4 days')::date::text);
update public.orders set service_date = (select v::date from t where k = 'day');
update public.order_lines set service_date = (select v::date from t where k = 'day');
update public.batches set service_date = (select v::date from t where k = 'day');
update public.complaints set decided_at = (select v::date from t where k = 'day') + interval '15 hours';
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000008');
select public.submit_day('80000000-0000-0000-0000-000000000001', (select v::date from t where k = 'day'), 'All fine');
select pg_temp.act('50000000-0000-0000-0000-000000000012');
select public.lock_day('80000000-0000-0000-0000-000000000001', (select v::date from t where k = 'day'));
select pg_temp.ok((select (counts ->> 'delivered')::int from public.day_closings) = 3, 'the locked day counts 3 meals delivered');
insert into t select 'corr', public.ask_correction((select id from public.order_lines where item_id = '90000000-0000-0000-0000-000000000002'), 'delivered', 1, 'One bottle was broken');
do $$ begin
  perform public.decide_correction((select v::uuid from t where k = 'corr'), true);
  raise exception 'FAILED: own correction approved';
exception when insufficient_privilege then raise notice 'ok – nobody decides his own correction';
end $$;
select pg_temp.act('50000000-0000-0000-0000-000000000002');
select public.decide_correction((select v::uuid from t where k = 'corr'), true);
reset role;
do $$ begin
  update public.order_lines set qty = 1 where item_id = '90000000-0000-0000-0000-000000000002';
  raise exception 'FAILED: a locked day changed';
exception when raise_exception then raise notice 'ok – a locked day changes only through an approved correction';
end $$;
select pg_temp.ok((select delivered_qty from public.order_lines where item_id = '90000000-0000-0000-0000-000000000002') = 1, 'the approved correction is applied');
set local role authenticated;

-- ── the month's bill ──
select pg_temp.act('50000000-0000-0000-0000-000000000009');
do $$ begin
  perform public.build_bill('a0000000-0000-0000-0000-000000000001', (select v::date from t where k = 'day'));
  raise exception 'FAILED: a bill without the GST rule';
exception when invalid_parameter_value then raise notice 'ok – no bill until Accounts sets the GST and TDS rules (tax is never assumed)';
end $$;
insert into public.tax_rules (company_id, tax, applies_to, rate, valid_from, set_by, checked_by_ca) values
  ('10000000-0000-0000-0000-000000000001', 'gst', 'mess_services', 5, '2026-01-01', '60000000-0000-0000-0000-000000000009', true),
  ('10000000-0000-0000-0000-000000000001', 'tds', 'proprietor', 1, '2026-01-01', '60000000-0000-0000-0000-000000000009', true);
insert into t select 'bill', public.build_bill('a0000000-0000-0000-0000-000000000001', (select v::date from t where k = 'day'));
select pg_temp.ok((select taxable from public.monthly_bills) = 380, 'taxable: 2 lunches × 95 + a guest meal 150 + 2 packings × 10 + 1 water × 20 = 380');
select pg_temp.ok((select gst_amount = 19 and tds_amount = 4 and retention = 19 and penalties = 50 from public.monthly_bills), 'GST 5%, TDS 1% (to the rupee), retention 5%, the penalty');
select pg_temp.ok((select net_payable from public.monthly_bills) = 326, 'net payable 380 + 19 − 4 − 19 − 50 = 326');
select pg_temp.act('50000000-0000-0000-0000-000000000008');
select public.upload_invoice((select v::uuid from t where k = 'bill'), 'INV-T-1', null, 400,
  '[{"item":"lunch","qty":3,"rate":95},{"item":"guest_meal","qty":1,"rate":150},{"item":"parcel_packing","qty":2,"rate":10},{"item":"water_1l","qty":1,"rate":22}]');
select pg_temp.act('50000000-0000-0000-0000-000000000009');
select public.check_invoice((select v::uuid from t where k = 'bill'));
select pg_temp.ok((select x ->> 'why' from public.monthly_bills, jsonb_array_elements(recon -> 'lines') x where x ->> 'item' = 'lunch') = 'more than served, delivered and confirmed', 'the check finds a lunch billed that was not confirmed');
select pg_temp.ok((select x ->> 'why' from public.monthly_bills, jsonb_array_elements(recon -> 'lines') x where x ->> 'item' = 'water_1l') = 'rate not as the contract', 'the check finds the water''s rate above the contract');

-- ── approvals: Site Admin → Accounts → Management → posting → payment ──
do $$ begin
  perform public.bill_step((select v::uuid from t where k = 'bill'), 'approve');
  raise exception 'FAILED: Accounts approved the Site Admin''s step';
exception when insufficient_privilege then raise notice 'ok – each step only by its own role';
end $$;
select pg_temp.act('50000000-0000-0000-0000-000000000002');
select public.bill_step((select v::uuid from t where k = 'bill'), 'approve');
select pg_temp.act('50000000-0000-0000-0000-000000000009');
select public.bill_step((select v::uuid from t where k = 'bill'), 'approve');
do $$ begin
  perform public.bill_step((select v::uuid from t where k = 'bill'), 'hold');
  raise exception 'FAILED: hold without the reason';
exception when insufficient_privilege or check_violation then raise notice 'ok – hold / send back need the reason and the right step';
end $$;
select pg_temp.act('50000000-0000-0000-0000-000000000013');
select public.bill_step((select v::uuid from t where k = 'bill'), 'approve');
select pg_temp.act('50000000-0000-0000-0000-000000000009');
select public.bill_step((select v::uuid from t where k = 'bill'), 'approve', null, 'ERP-TEST-1');
select public.record_payment((select v::uuid from t where k = 'bill'), 326, 'UTRTEST0001', public.local_today());
select pg_temp.ok((select state from public.monthly_bills) = 'paid', 'posted and paid with its UTR');
select pg_temp.act('50000000-0000-0000-0000-000000000003');
select pg_temp.ok((select count(*) from public.monthly_bills) + (select count(*) from public.payments) = 0, 'an employee never sees a bill or a payment');
reset role;

-- ── registration: HR record not found ──
set local role service_role;
insert into t select 'reg', public.server_register('50000000-0000-0000-0000-000000000020', 'TST', 'employee', 'New Person',
  '20000000-0000-0000-0000-000000000001', null, 'TST-0457', '{"result":"not_found"}') ->> 'person';
reset role;
select pg_temp.ok((select state from public.people where id = (select v::uuid from t where k = 'reg')) = 'pending_verification', 'not found in HR: he waits – no RCL ID is made up');
select pg_temp.ok((select rcl_id from public.people where id = (select v::uuid from t where k = 'reg')) is null, 'his typed ID is kept only on the registration');
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) from public.notifications where title = 'New Site User Registered — HR Employee Record Not Found') = 1, 'the Site Admin gets the alert in his words');
do $$ begin
  perform public.decide_registration((select id from public.registrations), 'reject');
  raise exception 'FAILED: rejected without a reason';
exception when invalid_parameter_value then raise notice 'ok – reject needs the reason';
end $$;
select public.decide_registration((select id from public.registrations), 'temporary', jsonb_build_object('until', public.local_today() + 7));
select pg_temp.act('50000000-0000-0000-0000-000000000020');
do $$ begin
  perform public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 2, 'lunch', 'delivery', '[{"item":"lunch"}]', '40000000-0000-0000-0000-000000000001');
  raise exception 'FAILED: a temporary user asked a delivery';
exception when insufficient_privilege then raise notice 'ok – a temporary user: meals at his mess only';
end $$;
select pg_temp.ok((public.request_order('80000000-0000-0000-0000-000000000001', public.local_today() + 2, 'lunch', 'meal', '[{"item":"lunch"}]') ->> 'code') is not null,
  'a temporary user gets his lunch at the mess');
select pg_temp.act('50000000-0000-0000-0000-000000000002');
select public.decide_registration((select id from public.registrations), 'link', '{"rcl_id":"TST-0457","new_in_hr":true}');
reset role;
select pg_temp.ok((select state = 'id_assigned' and rcl_id = 'TST-0457' from public.people where id = (select v::uuid from t where k = 'reg')), 'HR''s new ID linked – his meals stay his');

-- ── the Portal's one sign-in ──
insert into auth.users (id, email) values ('50000000-0000-0000-0000-000000000021', 'boss@test.invalid');
set local role service_role;
insert into t select 'boss', public.server_portal_person('TST', 'Boss@Test.invalid', 'Test Boss', '50000000-0000-0000-0000-000000000021', null, 'S1', true);
reset role;
select pg_temp.ok((select count(*) from public.role_grants where person_id = (select v::uuid from t where k = 'boss') and role = 'system_admin') = 1,
  'the Portal''s Super Admin is FALCON''s System Admin');
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000003');
do $$ begin
  perform public.server_register('50000000-0000-0000-0000-000000000003', 'TST', 'employee', 'x', null, null, 'TST-1', '{"result":"found","mobile_matches":true}');
  raise exception 'FAILED: the browser claimed "found in HR"';
exception when insufficient_privilege then raise notice 'ok – only the server can say "found in HR"';
end $$;
select pg_temp.ok((select count(*) from public.notifications where person_id <> public.me()) = 0, 'a person reads only his own notifications');
reset role;
set local role service_role;
select pg_temp.ok(public.daily_alerts() >= 0, 'the daily alerts run');
reset role;
select pg_temp.ok((select count(*) from public.audit_log where entity in ('orders', 'order_lines', 'batches', 'monthly_bills', 'registrations')) > 20, 'every step is in the audit log');

rollback;
