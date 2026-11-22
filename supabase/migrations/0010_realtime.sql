-- FALCON · migration 0010 · live screens: Supabase Realtime sends a change of these tables to whoever may read the row (its RLS
-- rule decides) – the order's status, the van on the map, a new request, a complaint, a notification. Safe to run again.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication here – live updates are skipped (screens still load on open).';
    return;
  end if;
  foreach t in array array['orders', 'order_lines', 'batches', 'batch_stops', 'track_points', 'complaints', 'notifications', 'day_closings',
                           'monthly_bills', 'registrations'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
