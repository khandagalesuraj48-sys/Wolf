-- TEST ONLY · migration 0015 – opened from HR with HR's pass. Made-up data only.
\set ON_ERROR_STOP on
begin;

\ir fixture.sql

create temporary table t (k text primary key, v jsonb);
grant all on t to authenticated, service_role;

-- only FALCON's server reaches these two
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000003');
do $$ begin
  perform public.server_hr_pass_account('TST', 'TST0101', '+919800000101');
  raise exception 'FAILED: a signed-in person asked who a pass is for';
exception when insufficient_privilege then raise notice 'ok – a person''s app cannot ask who a pass is for';
end $$;
do $$ begin
  perform public.server_hr_pass_person('TST', '50000000-0000-0000-0000-000000000003', 'TST0101', 'X', '+919800000101', 'S1', null);
  raise exception 'FAILED: a signed-in person made himself from a pass';
exception when insufficient_privilege then raise notice 'ok – a person''s app cannot make a person from a pass';
end $$;
reset role;

-- ── a new employee (not in FALCON, no account): nobody, no account → the server makes the account, then the person ──
insert into t select 'a1', public.server_hr_pass_account('TST', 'tst0101', '+919800000101');
select pg_temp.ok((select v ->> 'person' is null and v ->> 'auth_user' is null from t where k = 'a1'), 'a new employee: no person, no account yet');
insert into auth.users (id, phone, email) values ('50000000-0000-0000-0000-000000000101', '919800000101', 'hr-a@falcon.invalid');
insert into t select 'p1', public.server_hr_pass_person('TST', '50000000-0000-0000-0000-000000000101', ' tst0101 ', 'Made Up One', '+919800000101', 's1', 'Site Engineer');
select pg_temp.ok((select v ->> 'how' = 'made' and v ->> 'state' = 'linked' from t where k = 'p1'), 'made as HR says, ready at once (linked)');
select pg_temp.ok((select rcl_id = 'TST0101' and full_name = 'Made Up One' and mobile = '+919800000101' and home_site_id = '20000000-0000-0000-0000-000000000001'
  and work_role = 'Site Engineer' and kind = 'employee' from public.people where auth_user_id = '50000000-0000-0000-0000-000000000101'),
  '… his code, name, mobile, site and designation from HR');
select pg_temp.ok((select count(*) = 1 from public.audit_log where action = 'opened_from_hr' and after ->> 'how' = 'made'), '… and it is in the audit log');

-- the next time: the same person, the same account
insert into t select 'a2', public.server_hr_pass_account('TST', 'TST0101', '+919800000101');
select pg_temp.ok((select v ->> 'auth_user' = '50000000-0000-0000-0000-000000000101' and v ->> 'email' = 'hr-a@falcon.invalid' from t where k = 'a2'), 'the next time: his own account');
insert into t select 'p2', public.server_hr_pass_person('TST', '50000000-0000-0000-0000-000000000101', 'TST0101', 'Made Up One', '+919800000101', 'S1', null);
select pg_temp.ok((select v ->> 'how' = 'known' and v ->> 'person' = (select v ->> 'person' from t where k = 'p1') from t where k = 'p2'), '… the same person – never a second one');

-- ── an employee who took a WhatsApp code once (an account with his mobile, no person): that account is used ──
insert into auth.users (id, phone) values ('50000000-0000-0000-0000-000000000102', '919800000102');
insert into t select 'a3', public.server_hr_pass_account('TST', 'TST0102', '+919800000102');
select pg_temp.ok((select v ->> 'auth_user' = '50000000-0000-0000-0000-000000000102' and v ->> 'email' is null from t where k = 'a3'), 'his WhatsApp account is found by the mobile');

-- ── a person the office made (no account) is joined, not made again ──
insert into public.people (id, company_id, kind, full_name, mobile, state, home_site_id)
values ('60000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000001', 'employee', 'Office Made', '+919800000103', 'pending_verification', null);
insert into auth.users (id, phone) values ('50000000-0000-0000-0000-000000000103', '919800000103');
insert into t select 'p3', public.server_hr_pass_person('TST', '50000000-0000-0000-0000-000000000103', 'TST0103', 'Office Made', '+919800000103', 'S2', null);
select pg_temp.ok((select v ->> 'how' = 'joined' and v ->> 'person' = '60000000-0000-0000-0000-000000000103' from t where k = 'p3'), 'a person made by the office is joined by his mobile');
select pg_temp.ok((select auth_user_id = '50000000-0000-0000-0000-000000000103' and rcl_id = 'TST0103' and state = 'linked' and home_site_id = '20000000-0000-0000-0000-000000000002'
  from public.people where id = '60000000-0000-0000-0000-000000000103'), '… his account, code and site set; he is in');

-- ── what is refused ──
do $$ begin
  perform public.server_hr_pass_person('TST', '50000000-0000-0000-0000-000000000101', 'TST0103', 'X', '+919800000103', 'S1', null);
  raise exception 'FAILED: a second account was joined to one person';
exception when insufficient_privilege then raise notice 'ok – a person joined to another account is refused';
end $$;
update public.people set state = 'suspended', state_reason = 'Test stop' where id = '60000000-0000-0000-0000-000000000103';
do $$ begin
  perform public.server_hr_pass_account('TST', 'TST0103', '+919800000103');
  raise exception 'FAILED: a stopped person got in';
exception when insufficient_privilege then raise notice 'ok – a person stopped in FALCON stays stopped';
end $$;
do $$ begin
  perform public.server_hr_pass_person('TST', '50000000-0000-0000-0000-000000000101', 'TST0104', 'X', '+91123', 'S1', null);
  raise exception 'FAILED: a wrong mobile was taken';
exception when invalid_parameter_value then raise notice 'ok – a pass without a right mobile is refused';
end $$;
do $$ begin
  perform public.server_hr_pass_person('TST', '50000000-0000-0000-0000-000000000101', 'bad code!', 'X', '+919800000101', 'S1', null);
  raise exception 'FAILED: a wrong code was taken';
exception when invalid_parameter_value then raise notice 'ok – a pass without a right employee code is refused';
end $$;
-- a guest with that mobile is not turned into an employee by a pass
insert into public.people (id, company_id, kind, full_name, mobile, state)
values ('60000000-0000-0000-0000-000000000105', '10000000-0000-0000-0000-000000000001', 'guest', 'A Guest', '+919800000105', 'verified');
insert into auth.users (id, phone) values ('50000000-0000-0000-0000-000000000105', '919800000105');
do $$ begin
  perform public.server_hr_pass_person('TST', '50000000-0000-0000-0000-000000000105', 'TST0105', 'X', '+919800000105', 'S1', null);
  raise exception 'FAILED: a guest became an employee';
exception when invalid_parameter_value then raise notice 'ok – a guest''s mobile is left for the Site Admin to join';
end $$;
-- another company's code
do $$ begin
  perform public.server_hr_pass_account('NOPE', 'TST0101', '+919800000101');
  raise exception 'FAILED: an unknown company';
exception when invalid_parameter_value then raise notice 'ok – an unknown company is refused';
end $$;

rollback;
