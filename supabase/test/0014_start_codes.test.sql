-- TEST ONLY · migration 0014 – the company code first, a contractor's code, the limits, the BOQ. Made-up data only.
\set ON_ERROR_STOP on
begin;

\ir fixture.sql

create temporary table t (k text primary key, v text);
grant all on t to authenticated, service_role;

-- ── a contractor's sign-in code: only the System Admin, one code in all of FALCON ──
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000009');     -- Accounts: may change a contractor, not its code
do $$ begin
  perform public.office_contractor_code('70000000-0000-0000-0000-000000000001', 'TCAT');
  raise exception 'FAILED: Accounts set the code';
exception when insufficient_privilege then raise notice 'ok – only the System Admin sets a contractor''s sign-in code';
end $$;
do $$ begin
  update public.contractors set login_code = 'TCAT' where id = '70000000-0000-0000-0000-000000000001';
  raise exception 'FAILED: the code was set by a plain change';
exception when insufficient_privilege then raise notice 'ok – the code is never set by a plain change of the row';
end $$;
select pg_temp.act('50000000-0000-0000-0000-000000000001');     -- the System Admin
insert into t select 'c1', public.office_contractor_code('70000000-0000-0000-0000-000000000001', ' tcat ');
select pg_temp.ok((select v = 'TCAT' from t where k = 'c1'), 'the System Admin sets the code (capitals, no spaces)');
do $$ begin
  perform public.office_contractor_code('70000000-0000-0000-0000-000000000002', 'TCAT');
  raise exception 'FAILED: a second contractor took the same code';
exception when unique_violation then raise notice 'ok – one code is one contractor';
end $$;
do $$ begin
  perform public.office_contractor_code('70000000-0000-0000-0000-000000000002', 'OTH');
  raise exception 'FAILED: a company''s code was taken';
exception when unique_violation then raise notice 'ok – a contractor never takes a company''s code';
end $$;
do $$ begin
  perform public.office_contractor_code('70000000-0000-0000-0000-000000000002', 'A B');
  raise exception 'FAILED: a code with a space';
exception when invalid_parameter_value then raise notice 'ok – letters and numbers only';
end $$;
reset role;
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'contractor_code' and after ->> 'login_code' = 'TCAT'), 'the code is in the audit log');
do $$ begin
  insert into public.companies (code, name) values ('TCAT', 'Clash Company');
  raise exception 'FAILED: a company took a contractor''s code';
exception when unique_violation then raise notice 'ok – a company never takes a contractor''s code';
end $$;

-- ── the first screen ──
set local role authenticated;
select pg_temp.act(null);
do $$ begin
  perform public.server_door('TST');
  raise exception 'FAILED: the door was asked from the browser';
exception when insufficient_privilege then raise notice 'ok – only FALCON''s server answers what a code is';
end $$;
reset role;
set local role service_role;
select pg_temp.ok(public.server_door(' tst ') @> '{"kind":"company","code":"TST","name":"Test Company"}', 'a company''s code: the company');
select pg_temp.ok(public.server_door('TCAT') @> '{"kind":"contractor","name":"Test Caterers","company":"TST","company_name":"Test Company"}', 'a contractor''s code: the contractor and its company');
select pg_temp.ok(public.server_door('NOPE') is null, 'an unknown code: nothing');
-- the contractor's mobiles: a live Mess owner / operator at one of its messes
select pg_temp.ok(public.server_contractor_mobile('TCAT', '+910000000008') @> '{"name":"Test Owner","role":"mess_owner"}', 'the owner the Admin gave signs in with the contractor''s code');
select pg_temp.ok(public.server_contractor_mobile('TCAT', '+910000000010') is null, 'another contractor''s owner does not');
select pg_temp.ok(public.server_contractor_mobile('TCAT', '+910000000003') is null, 'a mobile not given for the contractor does not');
reset role;
update public.role_grants set revoked_at = now(), revoked_by = '60000000-0000-0000-0000-000000000001', reason = 'test'
 where person_id = '60000000-0000-0000-0000-000000000008' and role = 'mess_owner';
set local role service_role;
select pg_temp.ok(public.server_contractor_mobile('TCAT', '+910000000008') is null, 'his role taken away: no longer');
reset role;

-- ── the limits ──
set local role service_role;
insert into t select 'o1', public.server_hit('otp', '+919800000001', '[{"n":1,"secs":60},{"n":5,"secs":3600},{"n":10,"secs":86400}]')::text;
insert into t select 'o2', public.server_hit('otp', '+919800000001', '[{"n":1,"secs":60},{"n":5,"secs":3600},{"n":10,"secs":86400}]')::text;
insert into t select 'o3', public.server_hit('otp', '+919800000002', '[{"n":1,"secs":60},{"n":5,"secs":3600},{"n":10,"secs":86400}]')::text;
reset role;
select pg_temp.ok((select (v::jsonb ->> 'ok')::boolean from t where k = 'o1'), 'the first code goes');
select pg_temp.ok((select not (v::jsonb ->> 'ok')::boolean and (v::jsonb ->> 'wait')::int between 1 and 60 from t where k = 'o2'), 'a second code within the minute waits (with the seconds to wait)');
select pg_temp.ok((select (v::jsonb ->> 'ok')::boolean from t where k = 'o3'), 'another mobile is not held up');
-- five in the hour: the sixth waits even after the minute
update public.start_hits set at = at - interval '2 minutes';
insert into public.start_hits (what, key_hash, at)
select 'otp', encode(extensions.digest('+919800000001', 'sha256'), 'hex'), now() - make_interval(mins => 10 * g) from generate_series(1, 4) g;
set local role service_role;
insert into t select 'o4', public.server_hit('otp', '+919800000001', '[{"n":1,"secs":60},{"n":5,"secs":3600},{"n":10,"secs":86400}]')::text;
reset role;
select pg_temp.ok((select not (v::jsonb ->> 'ok')::boolean and (v::jsonb ->> 'wait')::int > 60 from t where k = 'o4'), 'the sixth code in an hour waits');
select pg_temp.ok(not exists (select 1 from public.start_hits where key_hash !~ '^[0-9a-f]{64}$'), 'only fingerprints are kept – never the mobile');
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000001');
do $$ begin
  perform count(*) from public.start_hits;
  raise exception 'FAILED: the limits were read from the app';
exception when insufficient_privilege then raise notice 'ok – nobody reads the limits from the app';
end $$;
reset role;

-- ── the BOQ ──
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000002');     -- Site Admin: sees, does not set
do $$ begin
  perform public.office_boq_set('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 1000);
  raise exception 'FAILED: the Site Admin set the BOQ';
exception when insufficient_privilege then raise notice 'ok – only Accounts or the System Admin set the BOQ';
end $$;
select pg_temp.act('50000000-0000-0000-0000-000000000009');     -- Accounts
select public.office_boq_set('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 30000, 'a year of lunches');
select public.office_boq_set('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 32000);
select public.office_boq_set('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 5000);
do $$ begin
  perform public.office_boq_set('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', -1);
  raise exception 'FAILED: a quantity below 0';
exception when invalid_parameter_value then raise notice 'ok – a quantity is 0 or more';
end $$;
do $$ begin
  insert into public.work_order_boq (work_order_id, item_id, qty) values ('a0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 1);
  raise exception 'FAILED: a BOQ line written directly';
exception when insufficient_privilege then raise notice 'ok – a BOQ line is set only through its step (with the audit line)';
end $$;
select pg_temp.ok((select qty = 32000 from public.work_order_boq where work_order_id = 'a0000000-0000-0000-0000-000000000001' and item_id = '90000000-0000-0000-0000-000000000001'), 'one line an item – the change replaces the quantity');
select pg_temp.act('50000000-0000-0000-0000-000000000002');     -- the Site Admin of S1
select pg_temp.ok((select count(*) from public.work_order_boq) = 2, 'the site''s Site Admin sees the BOQ of its work order');
select pg_temp.act('50000000-0000-0000-0000-000000000010');     -- the owner of Mess Two
select pg_temp.ok((select count(*) from public.work_order_boq) = 0, 'another mess''s owner does not see this BOQ');
select pg_temp.act('50000000-0000-0000-0000-000000000003');     -- a worker
select pg_temp.ok((select count(*) from public.work_order_boq) = 0, 'a worker sees no BOQ');
reset role;
select pg_temp.ok((select count(*) from public.audit_log where action = 'boq_set') = 3, 'every BOQ change is in the audit log');
select pg_temp.ok((select before ->> 'qty' = '30000.00' and after ->> 'qty' = '32000.00' from public.audit_log where action = 'boq_set' and before is not null), '… with the quantity before and after');

rollback;
