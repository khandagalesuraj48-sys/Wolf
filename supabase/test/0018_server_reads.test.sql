-- TEST ONLY · migration 0018 – the server role may READ the five tables of the Mess card, and only read them; made-up data only.
\set ON_ERROR_STOP on
begin;
\ir fixture.sql
select pg_temp.ok(bool_and(has_table_privilege('service_role', 'public.' || t, 'SELECT')), 'the server reads the company, the site, the messes, the meal times and the menus')
  from unnest(array['companies', 'sites', 'messes', 'meal_windows', 'menus']) t;
select pg_temp.ok(not bool_or(has_table_privilege('service_role', 'public.' || t, 'INSERT') or has_table_privilege('service_role', 'public.' || t, 'UPDATE')
  or has_table_privilege('service_role', 'public.' || t, 'DELETE')), 'and writes none of them directly')
  from unnest(array['companies', 'sites', 'messes', 'meal_windows', 'menus']) t;
select pg_temp.ok(not has_table_privilege('service_role', 'public.people', 'SELECT'), 'a table it was not given (people) stays closed to it, as in his project');
-- the card's reads, as the server role
set local role service_role;
select pg_temp.ok((select count(*) from public.companies where code = 'TST') = 1, 'the server finds the company by its code');
select pg_temp.ok((select count(*) from public.sites where code = 'S1' and company_id = '10000000-0000-0000-0000-000000000001') = 1, 'and its site');
select count(*) from public.messes; select count(*) from public.meal_windows; select count(*) from public.menus;
reset role;
rollback;
