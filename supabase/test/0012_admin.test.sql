-- TEST ONLY · migration 0012 – run by supabase/test/run.sh on a clean throwaway Postgres. Made-up test people only.
\set ON_ERROR_STOP on
begin;

\ir fixture.sql

set local role authenticated;

select pg_temp.act('50000000-0000-0000-0000-000000000002');     -- Site Admin of S1
do $$ begin
  perform public.set_setting('delivery.late_minutes', '45', public.local_today(), null);
  raise exception 'FAILED: a Site Admin changed a setting';
exception when insufficient_privilege then raise notice 'ok – only the System Admin changes a setting';
end $$;

select pg_temp.act('50000000-0000-0000-0000-000000000001');     -- System Admin
select public.set_setting('delivery.late_minutes', '45', public.local_today(), 'first value');
select pg_temp.ok(public.setting_int('10000000-0000-0000-0000-000000000001', 'delivery.late_minutes', public.local_today(), 30) = 45,
  'the new value counts from its day');
do $$ begin
  perform public.set_setting('delivery.late_minutes', '50', public.local_today() - 1, null);
  raise exception 'FAILED: a setting was changed backwards';
exception when invalid_parameter_value then raise notice 'ok – a day already counted is not changed';
end $$;
do $$ begin
  perform public.set_setting('delivery.late_minutes', '50', public.local_today(), null);
  raise exception 'FAILED: two values from the same day';
exception when invalid_parameter_value then raise notice 'ok – a new value starts after the one in force';
end $$;
select public.set_setting('delivery.late_minutes', '60', public.local_today() + 10, null);
select pg_temp.ok(public.setting_int('10000000-0000-0000-0000-000000000001', 'delivery.late_minutes', public.local_today() + 9, 30) = 45
  and public.setting_int('10000000-0000-0000-0000-000000000001', 'delivery.late_minutes', public.local_today() + 10, 30) = 60,
  'the old value ends the day before the new one – both kept');
select pg_temp.ok((select count(*) from public.settings where key = 'delivery.late_minutes') = 2, 'the old value stays in the record');
do $$ begin
  perform public.set_setting('Bad Key!', '1', public.local_today() + 20, null);
  raise exception 'FAILED: a bad setting name was taken';
exception when invalid_parameter_value then raise notice 'ok – a setting has a proper name';
end $$;

-- the complaint answer time is one setting with two values (serious, other)
select public.set_setting('complaint.reply_minutes', '{"serious": 45, "normal": 240}', public.local_today(), null);
select pg_temp.ok(public.reply_minutes('10000000-0000-0000-0000-000000000001', true) = 45
  and public.reply_minutes('10000000-0000-0000-0000-000000000001', false) = 240, 'the complaint answer times count from their day');

rollback;
