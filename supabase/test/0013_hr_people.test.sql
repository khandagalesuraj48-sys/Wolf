-- TEST ONLY · migration 0013 – HR's employees in FALCON and the first System Admin. Made-up people only.
\set ON_ERROR_STOP on
begin;

\ir fixture.sql

create temporary table t (k text primary key, v text);
grant all on t to authenticated, service_role;

-- phones of sign-ins (made-up numbers)
insert into auth.users (id, phone) values
  ('51000000-0000-0000-0000-000000000001', '919800000044'),   -- an active HR employee of S1
  ('51000000-0000-0000-0000-000000000002', '919800000099'),   -- nobody known
  ('51000000-0000-0000-0000-000000000003', '919800000077'),   -- the first admin of OTH
  ('51000000-0000-0000-0000-000000000004', '919800000055'),   -- an HR employee who has LEFT
  ('51000000-0000-0000-0000-000000000005', '919800000088');   -- a second try at OTH's first admin

-- ── only FALCON's server may copy, find and welcome ──
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000001');     -- even the System Admin, from the app
do $$ begin
  perform public.server_hr_sync('TST', '[{"id":"h1"}]', 'office');
  raise exception 'FAILED: the copy was made from the app';
exception when insufficient_privilege then raise notice 'ok – only the server copies HR''s list';
end $$;
do $$ begin
  perform public.server_welcome('50000000-0000-0000-0000-000000000001', 'TST', '+919800000077');
  raise exception 'FAILED: welcome from the app';
exception when insufficient_privilege then raise notice 'ok – only the server says who a new sign-in is';
end $$;
do $$ begin
  perform count(*) from public.hr_people;
  raise exception 'FAILED: the list is read from the app';
exception when insufficient_privilege then raise notice 'ok – nobody reads HR''s list directly (mobiles stay on the server)';
end $$;
reset role;

-- ── the copy ──
set local role service_role;
select pg_temp.ok(public.server_hr_find('TST', 'RCL-0007') ->> 'result' = 'not_checked', 'nothing kept yet: "not checked"');
insert into t select 'sync1', public.server_hr_sync('TST', '[
  {"id":"h1","code":"rcl-0007","name":"Ganesh Shinde","designation":"Driver","category":"driver","site":"S1","mobile":"9800000044","status":"active","left":""},
  {"id":"h2","code":"RCL-0009","name":"Kiran Jadhav","designation":"Fitter","category":"staff","site":"B18","mobile":"9800000055","status":"active","left":""},
  {"id":"h3","code":"RCL-0010","name":"New Joiner","designation":"","category":"labour","site":"S2","mobile":"","status":"pending","left":""},
  {"id":"h4","code":"RCL-0011","name":"One Letter Site","category":"staff","site":"Z","mobile":"9800000066","status":"active"},
  {"id":"","code":"RCL-0099","name":"No id – left out"}
]', 'timer')::text;
reset role;
select pg_temp.ok((select (v::jsonb ->> 'total')::int = 5 and (v::jsonb ->> 'added')::int = 4 from t where k = 'sync1'), 'HR''s list is kept (a row without HR''s key is left out)');
select pg_temp.ok((select rcl_id = 'RCL-0007' and mobile = '+919800000044' and site_code = 'S1' from public.hr_people where hr_id = 'h1'), 'the RCL ID and the mobile in FALCON''s form');
select pg_temp.ok((select v::jsonb -> 'new_sites' = '["B18"]'::jsonb from t where k = 'sync1'), 'a new site of HR is made in FALCON by itself');
select pg_temp.ok(exists (select 1 from public.sites where company_id = '10000000-0000-0000-0000-000000000001' and code = 'B18'), 'B18 is a FALCON site now');
select pg_temp.ok(not exists (select 1 from public.sites where code = 'Z'), 'a site code FALCON cannot take is not made up');
select pg_temp.ok(exists (select 1 from public.notifications n join public.people p on p.id = n.person_id
  where n.kind = 'hr_new_site' and p.id = '60000000-0000-0000-0000-000000000001'), 'the System Admin is told of the new site');
select pg_temp.ok((select count(*) from public.hr_sync_runs where ok) = 1, 'the run is written');

-- ── the RCL ID look-up from the kept list ──
set local role service_role;
select pg_temp.ok(public.server_hr_find('TST', 'rcl-0007', '+919800000044') @> '{"result":"found","name":"Ganesh Shinde","mobile_matches":true}', 'found, with his own mobile');
select pg_temp.ok(public.server_hr_find('TST', 'RCL-0010') ->> 'result' = 'maybe', 'not active in HR yet: "maybe" – the Site Admin checks');
select pg_temp.ok(public.server_hr_find('TST', 'RCL-4040') ->> 'result' = 'not_found', 'an unknown RCL ID: not found');
select pg_temp.ok(public.server_hr_find('OTH', 'RCL-0007') ->> 'result' = 'not_checked', 'another company never sees this list');

-- ── after a WhatsApp code ──
insert into t select 'w1', public.server_welcome('51000000-0000-0000-0000-000000000001', 'TST', null)::text;
insert into t select 'w2', public.server_welcome('51000000-0000-0000-0000-000000000002', 'TST', null)::text;
insert into t select 'w3', public.server_welcome('50000000-0000-0000-0000-000000000003', 'TST', null)::text;
reset role;
select pg_temp.ok((select v::jsonb ->> 'how' = 'hr' from t where k = 'w1'), 'an active HR employee is known by his mobile at once');
select pg_temp.ok((select state = 'linked' and rcl_id = 'RCL-0007' and kind = 'employee' and full_name = 'Ganesh Shinde'
                          and home_site_id = '20000000-0000-0000-0000-000000000001' and work_role = 'Driver'
                   from public.people where auth_user_id = '51000000-0000-0000-0000-000000000001'), '… with his RCL ID, name, site and designation – no form, no check');
select pg_temp.ok((select v::jsonb -> 'person' = 'null'::jsonb from t where k = 'w2'), 'a mobile nobody knows: he registers as before');
select pg_temp.ok((select v::jsonb ->> 'how' = 'known' from t where k = 'w3'), 'a person already in FALCON is simply known');
set local role service_role;
insert into t select 'w1b', public.server_welcome('51000000-0000-0000-0000-000000000001', 'TST', null)::text;
reset role;
select pg_temp.ok((select count(*) from public.people where rcl_id = 'RCL-0007') = 1, 'never a second person for him');

-- ── who left in HR is stopped; back to active is let in again; the name follows HR ──
set local role service_role;
insert into t select 'w4', public.server_welcome('51000000-0000-0000-0000-000000000004', 'TST', null)::text;   -- Kiran, active now
insert into t select 'sync2', public.server_hr_sync('TST', '[
  {"id":"h1","code":"RCL-0007","name":"Ganesh B. Shinde","designation":"Driver","category":"driver","site":"S1","mobile":"9800000044","status":"active"},
  {"id":"h2","code":"RCL-0009","name":"Kiran Jadhav","category":"staff","site":"B18","mobile":"9800000055","status":"left","left":"2026-11-20"},
  {"id":"h4","code":"RCL-0011","name":"One Letter Site","category":"staff","site":"Z","mobile":"9800000066","status":"active"}
]', 'office')::text;
reset role;
select pg_temp.ok((select state = 'suspended' and state_reason = 'Left the company in HR on 20 Nov 2026' from public.people where rcl_id = 'RCL-0009'), 'who LEFT in HR is stopped in FALCON, with the day');
select pg_temp.ok((select full_name = 'Ganesh B. Shinde' from public.people where rcl_id = 'RCL-0007'), 'the name follows HR');
select pg_temp.ok((select gone from public.hr_people where hr_id = 'h3'), 'no longer in HR''s list: marked gone, kept');
select pg_temp.ok((select (v::jsonb ->> 'stopped')::int = 1 and (v::jsonb ->> 'gone')::int = 1 from t where k = 'sync2'), 'the run counts it');
set local role service_role;
select public.server_hr_sync('TST', '[{"id":"h2","code":"RCL-0009","name":"Kiran Jadhav","site":"B18","mobile":"9800000055","status":"active"}]', 'timer');
reset role;
select pg_temp.ok((select state = 'linked' and state_reason is null from public.people where rcl_id = 'RCL-0009'), 'made active again in HR: let in again');
update public.people set state = 'suspended', state_reason = 'misbehaviour at the mess' where rcl_id = 'RCL-0007';
set local role service_role;
select public.server_hr_sync('TST', '[{"id":"h1","code":"RCL-0007","name":"Ganesh B. Shinde","site":"S1","mobile":"9800000044","status":"active"}]', 'timer');
reset role;
select pg_temp.ok((select state = 'suspended' from public.people where rcl_id = 'RCL-0007'), 'a Site Admin''s own suspension is never undone by HR');
set local role service_role;
do $$ begin
  perform public.server_hr_sync('TST', '[]', 'timer');
  raise exception 'FAILED: an empty list was taken';
exception when invalid_parameter_value then raise notice 'ok – an empty list from HR changes nothing (nobody is stopped by a fault)';
end $$;
reset role;

-- ── the first System Admin (FALCON_FIRST_ADMIN) ──
set local role service_role;
insert into t select 'a1', public.server_welcome('51000000-0000-0000-0000-000000000002', 'OTH', '+919800000077')::text;   -- not his mobile
insert into t select 'a2', public.server_welcome('51000000-0000-0000-0000-000000000003', 'OTH', '+919800000077')::text;
insert into t select 'a3', public.server_welcome('51000000-0000-0000-0000-000000000005', 'OTH', '+919800000088')::text;   -- one exists now
reset role;
select pg_temp.ok((select v::jsonb -> 'person' = 'null'::jsonb from t where k = 'a1'), 'another mobile is not made System Admin');
select pg_temp.ok((select (v::jsonb ->> 'first_admin')::boolean from t where k = 'a2'), 'the mobile set in Vercel becomes the first System Admin');
select pg_temp.ok(exists (select 1 from public.role_grants g join public.people p on p.id = g.person_id
  where p.auth_user_id = '51000000-0000-0000-0000-000000000003' and g.role = 'system_admin' and g.site_id is null and g.revoked_at is null), '… for every site of his company');
select pg_temp.ok((select v::jsonb -> 'person' = 'null'::jsonb from t where k = 'a3'), 'once there is a System Admin the setting does nothing');
select pg_temp.ok((select count(*) from public.role_grants where company_id = '10000000-0000-0000-0000-000000000002' and role = 'system_admin') = 1, 'exactly one');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'first_system_admin' and company_id = '10000000-0000-0000-0000-000000000002'), 'it is in the audit log');

-- ── the office sees the list with the mobile masked ──
set local role authenticated;
select pg_temp.act('50000000-0000-0000-0000-000000000002');     -- Site Admin of S1
select pg_temp.ok((select mobile from public.office_hr_people('S1', null) where rcl_id = 'RCL-0007') = '+91 98XXX XX044', 'the office sees the mobile masked');
select pg_temp.ok((public.office_hr_status() -> 'last' ->> 'ok')::boolean, 'the last copy and its state are shown');
select pg_temp.act('50000000-0000-0000-0000-000000000003');     -- a worker
select pg_temp.ok((select count(*) from public.office_hr_people(null, null)) = 0 and public.office_hr_status() is null, 'a worker sees nothing of HR''s list');
reset role;

rollback;
