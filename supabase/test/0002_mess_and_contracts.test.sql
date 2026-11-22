-- TEST ONLY · migration 0002 – contractors, work orders, rates, tax rules, menus. Made-up data only.
\set ON_ERROR_STOP on
begin;
\ir fixture.sql
set local role authenticated;

-- an employee: no contractor's money or papers
select pg_temp.act('50000000-0000-0000-0000-000000000003');
select pg_temp.ok((select count(*) from public.contractors) + (select count(*) from public.contractor_bank) + (select count(*) from public.contractor_documents) = 0, 'an employee sees no contractor, bank or paper');
select pg_temp.ok((select count(*) from public.work_orders) + (select count(*) from public.rates) + (select count(*) from public.tax_rules) = 0, 'an employee sees no work order, rate or tax rule');
select pg_temp.ok((select count(*) from public.messes) = 2, 'an employee sees the messes of his company');

-- a guest: the same
select pg_temp.act('50000000-0000-0000-0000-000000000006');
select pg_temp.ok((select count(*) from public.rates) + (select count(*) from public.contractors) = 0, 'a guest sees no rate and no contractor');

-- the mess owner of Mess One
select pg_temp.act('50000000-0000-0000-0000-000000000008');
select pg_temp.ok((select count(*) from public.contractors) = 1, 'a mess owner sees only his own contractor');
select pg_temp.ok((select count(*) from public.contractor_bank) = 1, 'a mess owner sees only his own bank details');
select pg_temp.ok((select count(*) from public.work_orders) = 1 and (select count(*) from public.rates) = 1, 'a mess owner sees only his own work order and its rates');
insert into public.rates (work_order_id, item_id, rate, valid_from, asked_by)
  values ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 100, '2027-01-01', '60000000-0000-0000-0000-000000000008');
select pg_temp.ok(true, 'a mess owner asks a new rate from a date (waiting)');
do $$ begin
  insert into public.rates (work_order_id, item_id, rate, valid_from, asked_by)
    values ('a0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 200, '2027-01-01', '60000000-0000-0000-0000-000000000008');
  raise exception 'FAILED: a rate asked on another mess''s work order';
exception when insufficient_privilege then raise notice 'ok – not on another mess''s work order';
end $$;
do $$ begin
  insert into public.rates (work_order_id, item_id, rate, valid_from, asked_by, state, decided_by, decided_at)
    values ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 25, '2026-04-01', '60000000-0000-0000-0000-000000000008', 'approved', '60000000-0000-0000-0000-000000000008', now());
  raise exception 'FAILED: a mess owner approved a rate';
exception when insufficient_privilege or check_violation then raise notice 'ok – a mess owner cannot approve a rate';
end $$;
do $$ begin
  perform public.decide_rate((select id from public.rates where rate = 100), true);
  raise exception 'FAILED: a mess owner decided a rate';
exception when insufficient_privilege then raise notice 'ok – a mess owner cannot decide a rate';
end $$;
do $$ begin
  update public.rates set rate = 1 where rate = 100;
  raise exception 'FAILED: a rate was changed directly';
exception when insufficient_privilege then raise notice 'ok – a rate is never changed directly';
end $$;
insert into public.menus (mess_id, service_date, meal, dishes, published_by)
  values ('80000000-0000-0000-0000-000000000001', '2026-11-23', 'lunch', array['Dal', 'Rice'], '60000000-0000-0000-0000-000000000008');
select pg_temp.ok(true, 'a mess owner publishes his own mess''s menu');
do $$ begin
  insert into public.menus (mess_id, service_date, meal, dishes, published_by)
    values ('80000000-0000-0000-0000-000000000002', '2026-11-23', 'lunch', array['Dal'], '60000000-0000-0000-0000-000000000008');
  raise exception 'FAILED: a menu for another mess';
exception when insufficient_privilege then raise notice 'ok – not another mess''s menu';
end $$;
do $$ begin
  insert into public.tax_rules (company_id, tax, applies_to, rate, valid_from, set_by)
    values ('10000000-0000-0000-0000-000000000001', 'gst', 'mess_services', 5, '2026-04-01', '60000000-0000-0000-0000-000000000008');
  raise exception 'FAILED: a mess owner set a tax rule';
exception when insufficient_privilege then raise notice 'ok – only Accounts sets a tax rule';
end $$;

-- the Site Admin of S1
select pg_temp.act('50000000-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) from public.work_orders) = 1, 'the Site Admin sees only his site''s work order');
select pg_temp.ok((select count(*) from public.contractor_bank) = 0, 'the Site Admin does not see bank details');

-- Accounts
select pg_temp.act('50000000-0000-0000-0000-000000000009');
select pg_temp.ok((select count(*) from public.work_orders) = 2 and (select count(*) from public.contractor_bank) = 2, 'Accounts sees every work order and the bank details');
select public.decide_rate((select id from public.rates where rate = 100), true);
select pg_temp.ok((select state from public.rates where rate = 100) = 'approved', 'Accounts approves the asked rate');
select pg_temp.ok((select valid_to from public.rates where rate = 95) = '2026-12-31', 'the rate before it ends the day before');
select pg_temp.ok((select count(*) from public.rates where item_id = '90000000-0000-0000-0000-000000000001' and work_order_id = 'a0000000-0000-0000-0000-000000000001') = 2, 'the old rate is kept beside the new one');
do $$ begin
  insert into public.rates (work_order_id, item_id, rate, valid_from, asked_by) values ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 20, '2026-04-01', '60000000-0000-0000-0000-000000000009');
  perform public.decide_rate((select id from public.rates where rate = 20), true);
  raise exception 'FAILED: Accounts approved his own rate';
exception when insufficient_privilege then raise notice 'ok – nobody approves the rate he asked';
end $$;
insert into public.tax_rules (company_id, tax, applies_to, section, rate, valid_from, set_by, checked_by_ca)
  values ('10000000-0000-0000-0000-000000000001', 'tds', 'proprietor', '194C', 1, '2026-04-01', '60000000-0000-0000-0000-000000000009', true);
select pg_temp.ok(true, 'Accounts sets a TDS rule with its section and date');
do $$ begin
  insert into public.tax_rules (company_id, tax, applies_to, section, rate, valid_from, set_by)
    values ('10000000-0000-0000-0000-000000000001', 'tds', 'proprietor', '194C', 2, '2026-10-01', '60000000-0000-0000-0000-000000000009');
  raise exception 'FAILED: two TDS rules on one day';
exception when exclusion_violation then raise notice 'ok – one tax rule a day';
end $$;
reset role;

-- the data rules
do $$ begin
  insert into public.rates (work_order_id, item_id, rate, valid_from, valid_to, state, decided_by, decided_at)
    values ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 99, '2027-02-01', '2027-02-28', 'approved', '60000000-0000-0000-0000-000000000009', now());
  raise exception 'FAILED: two approved rates on one day';
exception when exclusion_violation then raise notice 'ok – one approved rate an item on any day';
end $$;
do $$ begin
  insert into public.work_orders (company_id, site_id, mess_id, contractor_id, number, valid_from, valid_to, payment_days, state)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'WO-T-9', '2026-10-01', '2027-09-30', 30, 'active');
  raise exception 'FAILED: two live work orders for one mess';
exception when exclusion_violation then raise notice 'ok – one live work order a mess';
end $$;
do $$ begin
  insert into public.work_orders (company_id, site_id, mess_id, contractor_id, number, valid_from, valid_to, payment_days)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'WO-T-8', '2026-10-01', '2027-09-30', 30);
  raise exception 'FAILED: a work order on a site its mess is not on';
exception when foreign_key_violation then raise notice 'ok – a work order''s mess is on its own site';
end $$;
do $$ begin
  insert into public.role_grants (person_id, company_id, site_id, role) values ('60000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'mess_operator');
  raise exception 'FAILED: an operator without his mess';
exception when check_violation then raise notice 'ok – a mess owner / operator always names his mess';
end $$;
do $$ begin
  insert into public.contractor_bank (contractor_id, bank_name, ifsc, account_no) values ('70000000-0000-0000-0000-000000000001', 'X', 'BAD', '1');
  raise exception 'FAILED: a wrong IFSC';
exception when check_violation or unique_violation then raise notice 'ok – bank details are checked';
end $$;
select pg_temp.ok((select count(*) from public.audit_log where entity = 'rates') >= 3, 'every rate change is in the audit log');

rollback;
