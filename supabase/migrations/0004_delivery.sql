-- FALCON · migration 0004 · delivery: vans, batches by section, the driver and the vehicle, the route and its ETAs, dispatch,
-- the van's place (only while it is on the way), handing over with the person's code, short given, failed with the reason.
-- Safe to run again.

do $$ begin create type public.batch_state as enum ('draft', 'assigned', 'accepted', 'loaded', 'on_the_way', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.vehicles (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  site_id    uuid references public.sites(id),
  reg_no     text not null check (reg_no ~ '^[A-Z0-9 -]{4,16}$'),
  kind       text not null check (length(trim(kind)) between 2 and 40),
  capacity   integer check (capacity between 1 and 500),            -- parcels / hot boxes
  ext_ref    text,                                                   -- the same vehicle in the ERP (Mechanical), when linked
  active     boolean not null default true,
  unique (company_id, reg_no)
);

create table if not exists public.batches (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  company_id      uuid not null references public.companies(id),
  site_id         uuid not null references public.sites(id),
  mess_id         uuid not null references public.messes(id),
  service_date    date not null,
  meal            public.meal not null,
  driver_id       uuid references public.people(id),
  vehicle_id      uuid references public.vehicles(id),
  state           public.batch_state not null default 'draft',
  refused_reason  text,
  planned_km      numeric(7,2) check (planned_km >= 0),
  planned_minutes integer check (planned_minutes >= 0),
  vehicle_check   jsonb,
  dispatched_at   timestamptz,
  completed_at    timestamptz,
  created_by      uuid references public.people(id),
  created_at      timestamptz not null default now(),
  unique (mess_id, service_date, code),
  check (state in ('draft', 'cancelled') or driver_id is not null),
  check (state not in ('on_the_way', 'completed') or vehicle_id is not null)
);

create table if not exists public.batch_stops (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.batches(id),
  seq        integer not null check (seq between 1 and 99),
  section_id uuid not null references public.sections(id),
  eta        timestamptz,
  reached_at timestamptz,
  unique (batch_id, seq),
  unique (batch_id, section_id)
);

create table if not exists public.batch_orders (
  batch_id   uuid not null references public.batches(id),
  order_id   uuid not null references public.orders(id),
  removed_at timestamptz,
  primary key (batch_id, order_id)
);
create unique index if not exists batch_orders_one_batch on public.batch_orders (order_id) where removed_at is null;

-- The van's place: written by its driver only while it is on the way, and kept a short time (see clean_track_points).
create table if not exists public.track_points (
  id       bigint generated always as identity primary key,
  batch_id uuid not null references public.batches(id),
  at       timestamptz not null default now(),
  lat      numeric(9,6) not null check (lat between -90 and 90),
  lng      numeric(9,6) not null check (lng between -180 and 180),
  speed    numeric(6,2)
);
create index if not exists track_points_batch_at on public.track_points (batch_id, at desc);

-- ── who sees a batch ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.is_driver_of(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.batches x where x.id = b and x.driver_id = public.me() and x.state <> 'cancelled'
                 and public.has_role(array['driver']::public.app_role[], x.site_id))
$$;

create or replace function public.can_see_batch(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.batches x where x.id = b and x.company_id = public.my_company() and (
    public.is_driver_of(x.id)
    or public.works_at_mess(x.mess_id, array['mess_owner', 'mess_operator']::public.app_role[])
    or public.has_role(array['site_admin', 'mess_supervisor']::public.app_role[], x.site_id)
    or public.has_role(array['management', 'system_admin']::public.app_role[])))
$$;

-- The person whose order is in the van sees it move – only while it is on the way.
create or replace function public.can_track(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_see_batch(b) or exists (
    select 1 from public.batches x join public.batch_orders bo on bo.batch_id = x.id and bo.removed_at is null
      join public.order_lines l on l.order_id = bo.order_id
    where x.id = b and x.state = 'on_the_way' and (l.person_id = public.me()
          or exists (select 1 from public.orders o where o.id = bo.order_id and o.requested_by = public.me())))
$$;

-- The driver of an order's live batch sees that order and its lines (now that batches exist, the two rules of 0003 grow).
create or replace function public.drives_order(o uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.batch_orders bo where bo.order_id = o and bo.removed_at is null and public.is_driver_of(bo.batch_id))
$$;

create or replace function public.can_see_order(o uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.drives_order(o) or exists (
    select 1 from public.orders x
    where x.id = o and x.company_id = public.my_company() and (
      x.requested_by = public.me()
      or exists (select 1 from public.order_lines l where l.order_id = x.id and l.person_id = public.me())
      or (x.host_state in ('not_needed', 'approved') and public.works_at_mess(x.mess_id, array['mess_owner', 'mess_operator']::public.app_role[]))
      or exists (select 1 from public.guest_visits v where v.id = x.guest_visit_id and v.host_id = public.me())
      or public.has_role(array['site_admin', 'mess_supervisor']::public.app_role[], x.site_id)
      or public.has_role(array['accounts', 'management', 'system_admin']::public.app_role[])))
$$;

create or replace function public.sees_all_lines(o uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.drives_order(o) or exists (
    select 1 from public.orders x
    where x.id = o and x.company_id = public.my_company() and (
      x.requested_by = public.me()
      or (x.host_state in ('not_needed', 'approved') and public.works_at_mess(x.mess_id, array['mess_owner', 'mess_operator']::public.app_role[]))
      or exists (select 1 from public.guest_visits v where v.id = x.guest_visit_id and v.host_id = public.me())
      or public.has_role(array['site_admin', 'mess_supervisor']::public.app_role[], x.site_id)
      or public.has_role(array['accounts', 'management', 'system_admin']::public.app_role[])))
$$;

-- The names (and a masked mobile) of the people of an order – for whoever sees its lines: the kitchen, the driver, the office.
create or replace function public.people_of_order(o uuid)
returns table (person_id uuid, full_name text, mobile_masked text, section text, rcl_id text)
language sql stable security definer set search_path = '' as $$
  select distinct p.id, p.full_name,
         case when p.mobile is null then null else left(p.mobile, 3) || repeat('X', greatest(length(p.mobile) - 6, 0)) || right(p.mobile, 3) end,
         s.code, p.rcl_id
  from public.order_lines l join public.people p on p.id = l.person_id
       left join public.sections s on s.id = p.home_section_id
  where l.order_id = o and public.sees_all_lines(o)
$$;

-- ── the kitchen makes a batch, gives it a driver and a vehicle, sets the route, dispatches it ────────────────────────────
create or replace function public.make_batch(p_mess uuid, p_date date, p_meal public.meal, p_orders uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.messes; b uuid; n integer; code text; i integer := 0; r record;
begin
  select * into m from public.messes where id = p_mess;
  if not found or not public.works_at_mess(p_mess, array['mess_owner', 'mess_operator']::public.app_role[]) then
    raise exception 'Only this mess''s kitchen makes its batches.' using errcode = '42501';
  end if;
  select count(*) into n from public.orders o where o.id = any (p_orders) and o.mess_id = p_mess and o.kind = 'delivery'
    and o.service_date = p_date and o.meal = p_meal and o.state in ('accepted', 'preparing', 'ready')
    and not exists (select 1 from public.batch_orders bo where bo.order_id = o.id and bo.removed_at is null);
  if n = 0 or n <> cardinality(p_orders) then
    raise exception 'Every order of a batch must be an accepted delivery of this meal, not in another batch.' using errcode = '22023';
  end if;
  code := public.next_code('batch:' || p_mess || ':' || p_date, 'B-', 2);
  insert into public.batches (code, company_id, site_id, mess_id, service_date, meal, created_by)
  values (code, m.company_id, m.site_id, m.id, p_date, p_meal, public.me()) returning id into b;
  insert into public.batch_orders (batch_id, order_id) select b, unnest(p_orders);
  for r in select distinct s.id, s.km from public.orders o join public.sections s on s.id = o.to_section_id
           where o.id = any (p_orders) order by s.km nulls last loop
    i := i + 1;
    insert into public.batch_stops (batch_id, seq, section_id) values (b, i, r.id);
  end loop;
  perform public.audit_write('make', 'batches', b::text, null, jsonb_build_object('orders', p_orders), m.site_id, 'owner app', null);
  return b;
end $$;

create or replace function public.assign_batch(p_batch uuid, p_driver uuid, p_vehicle uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.batches;
begin
  select * into x from public.batches where id = p_batch for update;
  if not found or not public.works_at_mess(x.mess_id, array['mess_owner', 'mess_operator']::public.app_role[]) then
    raise exception 'Only this mess''s kitchen gives a batch its driver.' using errcode = '42501';
  end if;
  if x.state not in ('draft', 'assigned') then raise exception 'This batch has gone already.' using errcode = '22023'; end if;
  if not exists (select 1 from public.role_grants g where g.person_id = p_driver and g.role = 'driver' and g.revoked_at is null
                 and (g.site_id is null or g.site_id = x.site_id) and public.local_today() >= g.valid_from
                 and (g.valid_to is null or public.local_today() <= g.valid_to)) then
    raise exception 'This person is not a driver of this site.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.vehicles v where v.id = p_vehicle and v.company_id = x.company_id and v.active) then
    raise exception 'This vehicle is not available.' using errcode = '22023';
  end if;
  update public.batches set driver_id = p_driver, vehicle_id = p_vehicle, state = 'assigned', refused_reason = null where id = x.id;
  perform public.audit_write('assign', 'batches', x.id::text, null, jsonb_build_object('driver', p_driver, 'vehicle', p_vehicle), x.site_id, 'owner app', null);
end $$;

-- The route as the map gave it: the stops in order with their ETAs, the km and minutes.
create or replace function public.set_route(p_batch uuid, p_stops jsonb, p_km numeric, p_minutes integer) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.batches; s jsonb; i integer := 0;
begin
  select * into x from public.batches where id = p_batch for update;
  if not found or not public.works_at_mess(x.mess_id, array['mess_owner', 'mess_operator']::public.app_role[]) then
    raise exception 'Only this mess''s kitchen sets the route.' using errcode = '42501';
  end if;
  if x.state in ('on_the_way', 'completed', 'cancelled') then raise exception 'The batch has gone already.' using errcode = '22023'; end if;
  update public.batch_stops set seq = seq + 50 where batch_id = x.id;                         -- free the numbers, then renumber
  for s in select * from jsonb_array_elements(p_stops) loop
    i := i + 1;
    update public.batch_stops set seq = i, eta = nullif(s ->> 'eta', '')::timestamptz
     where batch_id = x.id and section_id = (s ->> 'section')::uuid;
    if not found then raise exception 'A stop is not a section of this batch.' using errcode = '22023'; end if;
  end loop;
  if exists (select 1 from public.batch_stops where batch_id = x.id and seq > 50) then
    raise exception 'Every section of the batch must be in the route.' using errcode = '22023';
  end if;
  update public.batches set planned_km = p_km, planned_minutes = p_minutes where id = x.id;
end $$;

create or replace function public.driver_answer(p_batch uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.batches;
begin
  select * into x from public.batches where id = p_batch for update;
  if not found or not public.is_driver_of(x.id) then raise exception 'This batch is not given to you.' using errcode = '42501'; end if;
  if x.state <> 'assigned' then raise exception 'This batch is not waiting for your answer.' using errcode = '22023'; end if;
  if p_accept then
    update public.batches set state = 'accepted' where id = x.id;
  else
    if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Saying no needs the reason.' using errcode = '22023'; end if;
    update public.batches set state = 'draft', driver_id = null, refused_reason = p_reason where id = x.id;
  end if;
  perform public.audit_write(case when p_accept then 'driver_accept' else 'driver_refuse' end, 'batches', x.id::text, null, null, x.site_id, 'driver app', p_reason);
end $$;

create or replace function public.vehicle_ready(p_batch uuid, p_check jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.batches;
begin
  select * into x from public.batches where id = p_batch for update;
  if not found or not public.is_driver_of(x.id) then raise exception 'This batch is not given to you.' using errcode = '42501'; end if;
  if x.state not in ('accepted', 'loaded') then raise exception 'Accept the batch first.' using errcode = '22023'; end if;
  update public.batches set vehicle_check = p_check, state = 'loaded' where id = x.id;
end $$;

create or replace function public.dispatch_batch(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.batches;
begin
  select * into x from public.batches where id = p_batch for update;
  if not found or not public.works_at_mess(x.mess_id, array['mess_owner', 'mess_operator']::public.app_role[]) then
    raise exception 'Only this mess''s kitchen dispatches.' using errcode = '42501';
  end if;
  if x.state not in ('accepted', 'loaded') then raise exception 'The driver has not accepted this batch yet.' using errcode = '22023'; end if;
  if exists (select 1 from public.batch_orders bo join public.orders o on o.id = bo.order_id
             where bo.batch_id = x.id and bo.removed_at is null and o.state not in ('accepted', 'preparing', 'ready')) then
    raise exception 'An order of this batch is not ready.' using errcode = '22023';
  end if;
  update public.batches set state = 'on_the_way', dispatched_at = now() where id = x.id;
  update public.orders set state = 'dispatched' where id in (select order_id from public.batch_orders where batch_id = x.id and removed_at is null);
  perform public.audit_write('dispatch', 'batches', x.id::text, null, null, x.site_id, 'owner app', null);
end $$;

create or replace function public.van_position(p_batch uuid, p_lat numeric, p_lng numeric, p_speed numeric default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.batches where id = p_batch and state = 'on_the_way') or not public.is_driver_of(p_batch) then
    raise exception 'The place is kept only while your batch is on the way.' using errcode = '42501';
  end if;
  insert into public.track_points (batch_id, lat, lng, speed) values (p_batch, p_lat, p_lng, p_speed);
end $$;

create or replace function public.reach_stop(p_batch uuid, p_section uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_driver_of(p_batch) then raise exception 'This batch is not given to you.' using errcode = '42501'; end if;
  update public.batch_stops set reached_at = coalesce(reached_at, now()) where batch_id = p_batch and section_id = p_section;
  if not found then raise exception 'This is not a stop of your batch.' using errcode = '22023'; end if;
end $$;

-- Handing over. With the person's code: delivered and confirmed by his code (5 wrong tries lock it – then the owner follows up).
-- Without it: delivered, not confirmed – it goes to the owner's follow-up. Failed: with the reason.
create or replace function public.driver_line(p_batch uuid, p_order uuid, p_person uuid) returns public.order_lines
language plpgsql security definer set search_path = '' as $$
declare l public.order_lines;
begin
  if not public.is_driver_of(p_batch) or not exists (select 1 from public.batches where id = p_batch and state = 'on_the_way')
     or not exists (select 1 from public.batch_orders where batch_id = p_batch and order_id = p_order and removed_at is null) then
    raise exception 'This order is not in your batch on the way.' using errcode = '42501';
  end if;
  select * into l from public.order_lines where order_id = p_order and person_id = p_person and is_meal and state = 'open' for update;
  if not found then
    select * into l from public.order_lines where order_id = p_order and person_id = p_person and state = 'open' order by is_meal desc limit 1 for update;
  end if;
  if not found then raise exception 'Nothing is waiting for this person in this order.' using errcode = '22023'; end if;
  return l;
end $$;

create or replace function public.finish_order_if_done(p_order uuid) returns void
language sql security definer set search_path = '' as $$
  update public.orders set state = case when exists (select 1 from public.order_lines where order_id = p_order and state in ('delivered', 'short', 'served'))
                                        then 'delivered' else 'failed' end::public.order_state
  where id = p_order and not exists (select 1 from public.order_lines where order_id = p_order and state = 'open')
$$;

-- A wrong code is answered (not raised), so its try is counted: {"ok": false, "tries_left": n}.
drop function if exists public.deliver_with_code(uuid, uuid, uuid, text, integer);
create or replace function public.deliver_with_code(p_batch uuid, p_order uuid, p_person uuid, p_code text, p_given integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.delivery_codes; ln record; s uuid;
begin
  perform public.driver_line(p_batch, p_order, p_person);
  select * into c from public.delivery_codes where order_id = p_order and person_id = p_person for update;
  if not found or c.used_at is not null then raise exception 'This code was used already.' using errcode = '22023'; end if;
  if c.tries >= 5 then raise exception 'Too many wrong codes – hand it over without the code; the owner will follow up.' using errcode = '22023'; end if;
  if c.code <> p_code then
    update public.delivery_codes set tries = tries + 1 where order_id = p_order and person_id = p_person;
    return jsonb_build_object('ok', false, 'tries_left', 4 - c.tries);
  end if;
  update public.delivery_codes set used_at = now() where order_id = p_order and person_id = p_person;
  select site_id into s from public.orders where id = p_order;
  for ln in select * from public.order_lines where order_id = p_order and person_id = p_person and state = 'open' for update loop
    update public.order_lines set state = (case when ln.is_meal and p_given is not null and p_given < ln.qty then 'short' else 'delivered' end)::public.line_state,
      delivered_qty = case when ln.is_meal and p_given is not null then least(p_given, ln.qty) else ln.qty end,
      short_qty = case when ln.is_meal and p_given is not null and p_given < ln.qty then ln.qty - p_given else null end
    where id = ln.id;
    insert into public.confirmations (order_line_id, kind, by_person, qty_received)
    values (ln.id, 'beneficiary_otp', public.me(), case when ln.is_meal and p_given is not null then least(p_given, ln.qty) else ln.qty end);
  end loop;
  perform public.finish_order_if_done(p_order);
  perform public.audit_write('deliver_code', 'orders', p_order::text, null, jsonb_build_object('person', p_person), s, 'beneficiary_otp', null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.deliver_without_code(p_batch uuid, p_order uuid, p_person uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  perform public.driver_line(p_batch, p_order, p_person);
  if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Say to whom it was given.' using errcode = '22023'; end if;
  update public.order_lines set state = 'delivered', delivered_qty = qty where order_id = p_order and person_id = p_person and state = 'open';
  perform public.finish_order_if_done(p_order);
  select site_id into s from public.orders where id = p_order;
  perform public.audit_write('deliver_no_code', 'orders', p_order::text, null, jsonb_build_object('person', p_person), s, 'driver app', p_note);
end $$;

create or replace function public.fail_delivery(p_batch uuid, p_order uuid, p_person uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  perform public.driver_line(p_batch, p_order, p_person);
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A failed delivery needs the reason.' using errcode = '22023'; end if;
  update public.order_lines set state = 'failed', failed_reason = p_reason where order_id = p_order and person_id = p_person and state = 'open';
  perform public.finish_order_if_done(p_order);
  select site_id into s from public.orders where id = p_order;
  perform public.audit_write('fail', 'orders', p_order::text, null, jsonb_build_object('person', p_person), s, 'driver app', p_reason);
end $$;

-- The driver closes the trip when nothing is left open.
create or replace function public.complete_batch(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.batches;
begin
  select * into x from public.batches where id = p_batch for update;
  if not found or not public.is_driver_of(x.id) then raise exception 'This batch is not given to you.' using errcode = '42501'; end if;
  if x.state <> 'on_the_way' then raise exception 'This batch is not on the way.' using errcode = '22023'; end if;
  if exists (select 1 from public.batch_orders bo join public.order_lines l on l.order_id = bo.order_id
             where bo.batch_id = x.id and bo.removed_at is null and l.state = 'open') then
    raise exception 'Some people are still waiting – deliver or mark them failed first.' using errcode = '22023';
  end if;
  update public.batches set state = 'completed', completed_at = now() where id = x.id;
  perform public.audit_write('complete', 'batches', x.id::text, null, null, x.site_id, 'driver app', null);
end $$;

-- Places older than 7 days are not kept (run daily by the scheduler, or by hand).
create or replace function public.clean_track_points() returns integer
language sql security definer set search_path = '' as $$
  with d as (delete from public.track_points where at < now() - interval '7 days' returning 1) select count(*)::integer from d
$$;

do $$ declare t text; begin
  foreach t in array array['vehicles', 'batches', 'batch_stops', 'batch_orders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

-- ── Row Level Security ───────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.vehicles     enable row level security;
alter table public.batches      enable row level security;
alter table public.batch_stops  enable row level security;
alter table public.batch_orders enable row level security;
alter table public.track_points enable row level security;

drop policy if exists vehicles_read on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated using (company_id = public.my_company());
drop policy if exists vehicles_write on public.vehicles;
create policy vehicles_write on public.vehicles for all to authenticated
  using (company_id = public.my_company() and public.has_role(array['system_admin', 'site_admin']::public.app_role[], site_id))
  with check (company_id = public.my_company() and public.has_role(array['system_admin', 'site_admin']::public.app_role[], site_id));

drop policy if exists batches_read on public.batches;
create policy batches_read on public.batches for select to authenticated using (public.can_track(id));
drop policy if exists batch_stops_read on public.batch_stops;
create policy batch_stops_read on public.batch_stops for select to authenticated using (public.can_track(batch_id));
drop policy if exists batch_orders_read on public.batch_orders;
create policy batch_orders_read on public.batch_orders for select to authenticated using (public.can_see_batch(batch_id) or public.can_see_order(order_id));
drop policy if exists track_points_read on public.track_points;
create policy track_points_read on public.track_points for select to authenticated using (public.can_track(batch_id));

revoke all on public.vehicles, public.batches, public.batch_stops, public.batch_orders, public.track_points from anon, authenticated;
grant select on public.batches, public.batch_stops, public.batch_orders, public.track_points to authenticated;
grant select, insert, update on public.vehicles to authenticated;

revoke all on function public.is_driver_of(uuid), public.can_see_batch(uuid), public.can_track(uuid), public.drives_order(uuid),
  public.people_of_order(uuid), public.make_batch(uuid, date, public.meal, uuid[]), public.assign_batch(uuid, uuid, uuid),
  public.set_route(uuid, jsonb, numeric, integer), public.driver_answer(uuid, boolean, text), public.vehicle_ready(uuid, jsonb),
  public.dispatch_batch(uuid), public.van_position(uuid, numeric, numeric, numeric), public.reach_stop(uuid, uuid),
  public.driver_line(uuid, uuid, uuid), public.finish_order_if_done(uuid), public.deliver_with_code(uuid, uuid, uuid, text, integer),
  public.deliver_without_code(uuid, uuid, uuid, text), public.fail_delivery(uuid, uuid, uuid, text), public.complete_batch(uuid),
  public.clean_track_points() from public, anon;
grant execute on function public.is_driver_of(uuid), public.can_see_batch(uuid), public.can_track(uuid), public.drives_order(uuid),
  public.people_of_order(uuid), public.make_batch(uuid, date, public.meal, uuid[]), public.assign_batch(uuid, uuid, uuid),
  public.set_route(uuid, jsonb, numeric, integer), public.driver_answer(uuid, boolean, text), public.vehicle_ready(uuid, jsonb),
  public.dispatch_batch(uuid), public.van_position(uuid, numeric, numeric, numeric), public.reach_stop(uuid, uuid),
  public.deliver_with_code(uuid, uuid, uuid, text, integer), public.deliver_without_code(uuid, uuid, uuid, text),
  public.fail_delivery(uuid, uuid, uuid, text), public.complete_batch(uuid) to authenticated;
