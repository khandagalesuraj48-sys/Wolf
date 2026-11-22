-- TEST ONLY · migration 0001 – run by supabase/test/run.sh on a clean throwaway Postgres. Made-up test people only.
\set ON_ERROR_STOP on
begin;

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

insert into auth.users (id) select ('50000000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1, 7) n;
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

-- ── the rules hold, as each person ──
set local role authenticated;

select pg_temp.act('50000000-0000-0000-0000-000000000003');     -- a worker of S1
select pg_temp.ok((select count(*) from public.people) = 1, 'a worker sees only himself');
select pg_temp.ok((select count(*) from public.sites) = 2, 'a worker sees the sites of his own company only');
select pg_temp.ok((select count(*) from public.role_grants) = 0, 'a worker sees no one''s roles');
select pg_temp.ok((select count(*) from public.audit_log) = 0, 'a worker cannot read the audit log');
select pg_temp.ok(not public.has_role(array['site_admin']::public.app_role[]), 'a worker is no Site Admin');
do $$ begin
  insert into public.sites (company_id, code, name) values ('10000000-0000-0000-0000-000000000001', 'S3', 'Sneaky');
  raise exception 'FAILED: a worker made a site';
exception when insufficient_privilege then raise notice 'ok – a worker cannot make a site';
end $$;
do $$ begin
  update public.people set full_name = 'Changed' where id = '60000000-0000-0000-0000-000000000003';
  raise exception 'FAILED: a worker changed his own record directly';
exception when insufficient_privilege then raise notice 'ok – nobody changes a person directly (only through checked functions)';
end $$;

select pg_temp.act('50000000-0000-0000-0000-000000000002');     -- Site Admin of S1
select pg_temp.ok((select count(*) from public.people where home_site_id = '20000000-0000-0000-0000-000000000001') = 5, 'the Site Admin of S1 sees S1''s people');
select pg_temp.ok((select count(*) from public.people where home_site_id = '20000000-0000-0000-0000-000000000002') = 0, 'the Site Admin of S1 does not see S2''s people');
select pg_temp.ok(public.has_role(array['site_admin']::public.app_role[], '20000000-0000-0000-0000-000000000001'), 'Site Admin on S1');
select pg_temp.ok(not public.has_role(array['site_admin']::public.app_role[], '20000000-0000-0000-0000-000000000002'), 'not Site Admin on S2');
insert into public.sections (site_id, circle_id, code, name) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'A2', 'Section A2');
select pg_temp.ok(true, 'the Site Admin of S1 adds a section on S1');
do $$ begin
  insert into public.sections (site_id, circle_id, code, name) values ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'B9', 'Not his');
  raise exception 'FAILED: the Site Admin of S1 added a section on S2';
exception when insufficient_privilege then raise notice 'ok – not on another site';
end $$;

select pg_temp.act('50000000-0000-0000-0000-000000000001');     -- System Admin (every site)
select pg_temp.ok((select count(*) from public.people) = 7, 'the System Admin sees every person of his company');
select pg_temp.ok((select count(*) from public.sites) = 2, 'the System Admin sees no other company''s site');
select pg_temp.ok((select count(*) from public.audit_log) > 0, 'the System Admin reads the audit log');
insert into public.sites (company_id, code, name) values ('10000000-0000-0000-0000-000000000001', 'S3', 'Site Three');
select pg_temp.ok(true, 'the System Admin adds a site');
do $$ begin
  insert into public.sites (company_id, code, name) values ('10000000-0000-0000-0000-000000000002', 'X2', 'Other company');
  raise exception 'FAILED: a site added to another company';
exception when insufficient_privilege then raise notice 'ok – never into another company';
end $$;
do $$ begin
  delete from public.sites where code = 'S3';
  raise exception 'FAILED: a site was deleted';
exception when insufficient_privilege then raise notice 'ok – nothing is deleted through the API';
end $$;

select pg_temp.act('50000000-0000-0000-0000-000000000005');     -- suspended, though he holds a System Admin grant
select pg_temp.ok(public.me() is null, 'a suspended person is nobody');
select pg_temp.ok((select count(*) from public.people) + (select count(*) from public.sites) = 0, 'a suspended person sees nothing');

select pg_temp.act('50000000-0000-0000-0000-000000000007');     -- temporary access ended yesterday
select pg_temp.ok(public.me() is null and (select count(*) from public.sites) = 0, 'temporary access ends on its date');

select pg_temp.act('50000000-0000-0000-0000-000000000006');     -- a guest
select pg_temp.ok((select count(*) from public.people) = 1 and (select count(*) from public.guest_profiles) = 1, 'a guest sees only his own profile');
select pg_temp.ok((select guest_code from public.guest_profiles) ~ '^GST-[0-9]{4}$', 'a guest gets a guest code');

select pg_temp.act(null);                                         -- signed out
select pg_temp.ok((select count(*) from public.sites) + (select count(*) from public.people) = 0, 'nobody signed in sees nothing');
reset role;

-- anon has no right at all
set local role anon;
do $$ begin
  perform 1 from public.people limit 1;
  raise exception 'FAILED: anon read people';
exception when insufficient_privilege then raise notice 'ok – anon reads nothing';
end $$;
reset role;

-- ── the data rules hold ──
do $$ begin
  insert into public.people (company_id, kind, full_name, mobile) values ('10000000-0000-0000-0000-000000000001', 'guest', 'Second Profile', '+910000000006');
  raise exception 'FAILED: a second profile with the same mobile';
exception when unique_violation then raise notice 'ok – one mobile, one profile';
end $$;
update public.people set rcl_id = 'TST-0001' where id = '60000000-0000-0000-0000-000000000003';
do $$ begin
  update public.people set rcl_id = 'TST-0001' where id = '60000000-0000-0000-0000-000000000004';
  raise exception 'FAILED: one RCL ID on two people';
exception when unique_violation then raise notice 'ok – an RCL ID links to one person only';
end $$;
do $$ begin
  update public.people set rcl_id = 'TST-0009' where id = '60000000-0000-0000-0000-000000000006';
  raise exception 'FAILED: a guest got an RCL ID';
exception when check_violation then raise notice 'ok – a guest has no RCL ID';
end $$;
do $$ begin
  update public.people set state = 'rejected' where id = '60000000-0000-0000-0000-000000000004';
  raise exception 'FAILED: rejected without a reason';
exception when check_violation then raise notice 'ok – rejected / suspended need the reason';
end $$;
do $$ begin
  insert into public.sections (site_id, circle_id, code, name) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'ZZ', 'Wrong circle');
  raise exception 'FAILED: a section on a circle of another site';
exception when foreign_key_violation then raise notice 'ok – a section belongs to a circle of its own site';
end $$;
insert into public.settings (company_id, key, value, valid_from, valid_to) values ('10000000-0000-0000-0000-000000000001', 'tax.gst_rate', '5', '2026-04-01', '2027-03-31');
do $$ begin
  insert into public.settings (company_id, key, value, valid_from) values ('10000000-0000-0000-0000-000000000001', 'tax.gst_rate', '12', '2026-10-01');
  raise exception 'FAILED: two values of one setting on one day';
exception when exclusion_violation then raise notice 'ok – a setting has one value a day';
end $$;
do $$ begin
  update public.audit_log set action = 'x' where id = (select min(id) from public.audit_log);
  raise exception 'FAILED: the audit log was changed';
exception when raise_exception then raise notice 'ok – the audit log cannot be changed';
end $$;
do $$ begin
  delete from public.audit_log;
  raise exception 'FAILED: the audit log was emptied';
exception when raise_exception then raise notice 'ok – the audit log cannot be deleted';
end $$;
select pg_temp.ok((select count(*) from public.audit_log where entity = 'people' and action = 'update') >= 1, 'a change to a person is in the audit log');

rollback;
