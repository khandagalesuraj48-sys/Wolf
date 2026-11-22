-- TEST ONLY · the made-up company, sites and people every test file starts from (inside its own transaction).
-- A test helper: act as a signed-in user (as PostgREST does) or as nobody.
create or replace function pg_temp.act(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u, 'role', 'authenticated')::text end, true);
end $$;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok – %', what;
end $$;

-- made-up company, two sites, people
insert into public.companies (id, code, name) values ('10000000-0000-0000-0000-000000000001', 'TST', 'Test Company');
insert into public.companies (id, code, name) values ('10000000-0000-0000-0000-000000000002', 'OTH', 'Other Company');
insert into public.sites (id, company_id, code, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'S1', 'Site One'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'S2', 'Site Two'),
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'X1', 'Other Site');
insert into public.circles (id, site_id, code, name, km_from, km_to) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'A', 'Circle A', 0, 12),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'B', 'Circle B', 12, 24);
insert into public.sections (id, site_id, circle_id, code, name, km) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'A1', 'Section A1', 2.4);

insert into auth.users (id) select ('50000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 10) n;
insert into public.people (id, company_id, kind, auth_user_id, full_name, mobile, mobile_verified_at, state, home_site_id, state_reason, temporary_until) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'employee', '50000000-0000-0000-0000-000000000001', 'Test Admin',   '+910000000001', now(), 'verified', '20000000-0000-0000-0000-000000000001', null, null),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'employee', '50000000-0000-0000-0000-000000000002', 'Test SiteOne', '+910000000002', now(), 'verified', '20000000-0000-0000-0000-000000000001', null, null),
  ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'employee', '50000000-0000-0000-0000-000000000003', 'Test Worker',  '+910000000003', now(), 'verified', '20000000-0000-0000-0000-000000000001', null, null),
  ('60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'employee', '50000000-0000-0000-0000-000000000004', 'Test Far',     '+910000000004', now(), 'verified', '20000000-0000-0000-0000-000000000002', null, null),
  ('60000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'employee', '50000000-0000-0000-0000-000000000005', 'Test Stopped', '+910000000005', now(), 'suspended', '20000000-0000-0000-0000-000000000001', 'test', null),
  ('60000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'guest',    '50000000-0000-0000-0000-000000000006', 'Test Guest',   '+910000000006', now(), 'verified', null, null, null),
  ('60000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'employee', '50000000-0000-0000-0000-000000000007', 'Test Lapsed',  '+910000000007', now(), 'temporary', '20000000-0000-0000-0000-000000000001', null, current_date - 1);
insert into public.guest_profiles (person_id, organisation) values ('60000000-0000-0000-0000-000000000006', 'Test Org');
insert into public.role_grants (person_id, company_id, site_id, role) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, 'system_admin'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'site_admin'),
  ('60000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', null, 'system_admin');


-- (0002) contractor staff, Accounts, two contractors, two messes
insert into public.people (id, company_id, kind, auth_user_id, full_name, mobile, mobile_verified_at, state, home_site_id) values
  ('60000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'contractor_staff', '50000000-0000-0000-0000-000000000008', 'Test Owner',    '+910000000008', now(), 'verified', '20000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'employee',         '50000000-0000-0000-0000-000000000009', 'Test Accounts', '+910000000009', now(), 'verified', '20000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'contractor_staff', '50000000-0000-0000-0000-000000000010', 'Test Owner Two','+910000000010', now(), 'verified', '20000000-0000-0000-0000-000000000002');
insert into public.contractors (id, company_id, name, kind) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Test Caterers', 'proprietor'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Other Caterers', 'company');
insert into public.contractor_bank (contractor_id, bank_name, ifsc, account_no) values
  ('70000000-0000-0000-0000-000000000001', 'Test Bank', 'TEST0000001', '000000000001'),
  ('70000000-0000-0000-0000-000000000002', 'Test Bank', 'TEST0000001', '000000000002');
insert into public.messes (id, company_id, site_id, name, contractor_id) values
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Mess One', '70000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Mess Two', '70000000-0000-0000-0000-000000000002');
insert into public.role_grants (person_id, company_id, site_id, role, mess_id) values
  ('60000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'mess_owner', '80000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'mess_owner', '80000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', null, 'accounts', null);
insert into public.items (id, company_id, code, name, kind, meal) values
  ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'lunch', 'Lunch', 'meal', 'lunch'),
  ('90000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'water_1l', 'Water 1 L', 'extra', null);
insert into public.work_orders (id, company_id, site_id, mess_id, contractor_id, number, valid_from, valid_to, payment_days, retention_pct, state) values
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'WO-T-1', '2026-04-01', '2027-03-31', 30, 5, 'active'),
  ('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'WO-T-2', '2026-04-01', '2027-03-31', 30, 5, 'active');
insert into public.rates (work_order_id, item_id, rate, valid_from, state, decided_by, decided_at) values
  ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 95, '2026-04-01', 'approved', '60000000-0000-0000-0000-000000000009', now()),
  ('a0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 90, '2026-04-01', 'approved', '60000000-0000-0000-0000-000000000009', now());

