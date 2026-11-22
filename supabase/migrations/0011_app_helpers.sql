-- FALCON · migration 0011 · what the screens ask for that no table rule can give safely: the person's own "what I got", his
-- van's driver while it is on the way, a group requester's team, a host's guest pass, the hosts a guest may choose, the month's
-- own counts. Each answer is only for the one who may have it. Safe to run again.

-- e12 · "What did you get?" – the person says what he received (only ever less than handed over), and how it came. A line
-- delivered with his code keeps its kind (OTP); a line without a confirmation gets his own ("in the app").
create or replace function public.report_received(p_line uuid, p_qty integer, p_food text default null, p_box text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.order_lines; o public.orders; c public.confirmations; note_ text;
begin
  select * into l from public.order_lines where id = p_line for update;
  if not found or l.person_id <> public.me() then raise exception 'Only the person it was for says what he got.' using errcode = '42501'; end if;
  if l.state not in ('served', 'delivered', 'short') then raise exception 'It is not delivered yet.' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 0 or p_qty > coalesce(l.delivered_qty, l.qty) then raise exception 'The number cannot be more than was handed over.' using errcode = '22023'; end if;
  select * into o from public.orders where id = l.order_id;
  note_ := nullif(concat_ws(' · ', 'food ' || nullif(p_food, ''), 'box ' || nullif(p_box, '')), '');
  select * into c from public.confirmations where order_line_id = l.id for update;
  if found then
    update public.confirmations set qty_received = least(coalesce(qty_received, p_qty), p_qty), note = coalesce(note_, note) where id = c.id;
  else
    insert into public.confirmations (order_line_id, kind, by_person, qty_received, note) values (l.id, 'beneficiary_app', public.me(), p_qty, note_);
  end if;
  if p_qty < coalesce(l.delivered_qty, l.qty) then
    update public.order_lines set state = 'short', short_qty = coalesce(l.delivered_qty, l.qty) - p_qty where id = l.id;
    perform public.notify_roles(o.site_id, array['mess_owner']::public.app_role[], 'short_given',
      o.code || ': ' || (coalesce(l.delivered_qty, l.qty) - p_qty) || ' short', null, '/owner/follow-up', o.mess_id);
  end if;
end $$;

-- e09 · e10 · his van: the driver, the vehicle, the stops – only to the people of an order in it, only while it is on the way.
create or replace function public.my_van(p_order uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('batch', x.id, 'code', x.code, 'state', x.state, 'dispatched_at', x.dispatched_at,
    'driver', d.full_name, 'driver_mobile', case when x.state = 'on_the_way' then d.mobile end,
    'vehicle', v.reg_no, 'vehicle_kind', v.kind,
    'stops', (select jsonb_agg(jsonb_build_object('seq', t.seq, 'section', s.code, 'km', s.km, 'place', s.place, 'eta', t.eta,
                                                  'reached_at', t.reached_at, 'mine', s.id = o.to_section_id) order by t.seq)
              from public.batch_stops t join public.sections s on s.id = t.section_id where t.batch_id = x.id),
    'last', (select jsonb_build_object('at', p.at, 'lat', p.lat, 'lng', p.lng) from public.track_points p where p.batch_id = x.id and x.state = 'on_the_way' order by p.at desc limit 1))
  from public.orders o join public.batch_orders bo on bo.order_id = o.id and bo.removed_at is null
       join public.batches x on x.id = bo.batch_id
       left join public.people d on d.id = x.driver_id left join public.vehicles v on v.id = x.vehicle_id
  where o.id = p_order and (o.requested_by = public.me() or exists (select 1 from public.order_lines l where l.order_id = o.id and l.person_id = public.me()))
$$;

-- e16 · a group requester's team: the checked employees of a section, and whether each already has that meal.
create or replace function public.team_for_group(p_section uuid, p_date date, p_meal public.meal)
returns table (person_id uuid, full_name text, work_role text, state public.person_state, has_meal boolean, existing_order text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.people where id = public.me() and may_group and kind = 'employee') then
    raise exception 'Asking for others needs the Site Admin''s permission.' using errcode = '42501';
  end if;
  return query
  select p.id, p.full_name, p.work_role, p.state,
         exists (select 1 from public.order_lines l where l.person_id = p.id and l.service_date = p_date and l.meal = p_meal and l.is_meal and l.state <> 'cancelled'),
         (select o.code from public.order_lines l join public.orders o on o.id = l.order_id where l.person_id = p.id and l.service_date = p_date
            and l.meal = p_meal and l.is_meal and l.state <> 'cancelled' limit 1)
  from public.people p
  where p.home_section_id = p_section and p.company_id = public.my_company() and p.kind = 'employee'
    and p.state in ('verified', 'id_assigned', 'linked', 'temporary')
  order by p.full_name;
end $$;

-- g01 · the hosts a guest may name at a site: its office people (name and role only).
create or replace function public.visit_hosts(p_site uuid) returns table (person_id uuid, full_name text, role text)
language sql stable security definer set search_path = '' as $$
  select distinct on (p.id) p.id, p.full_name, initcap(replace(g.role::text, '_', ' '))
  from public.role_grants g join public.people p on p.id = g.person_id
  where public.in_my_company(p_site) and g.revoked_at is null and g.role in ('site_admin', 'management', 'mess_supervisor')
    and (g.site_id is null or g.site_id = p_site) and p.state not in ('rejected', 'suspended')
  order by p.id, g.role
$$;

-- e15 · a host brings a guest who has no app: the guest's mobile is checked by a code (the server sends and checks it); his one
-- profile is found or made; a visit with this host; the host orders for him – it needs no further OK (he is the host).
create table if not exists public.guest_pass_codes (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  host_auth  uuid not null,
  phone      text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash  text not null,
  tries      integer not null default 0,
  exp        timestamptz not null
);
alter table public.guest_pass_codes enable row level security;          -- no rule: only the server
revoke all on public.guest_pass_codes from anon, authenticated;

create or replace function public.server_guest_code(p_host_auth uuid, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t text := encode(extensions.gen_random_bytes(24), 'hex');
        c text := (select lpad((((get_byte(b, 0) << 16) | (get_byte(b, 1) << 8) | get_byte(b, 2)) % 1000000)::text, 6, '0') from (select extensions.gen_random_bytes(3) as b) r);
begin
  if not exists (select 1 from public.people where auth_user_id = p_host_auth and kind = 'employee' and state in ('verified', 'id_assigned', 'linked')) then
    raise exception 'Only a checked employee brings a guest.' using errcode = '42501';
  end if;
  delete from public.guest_pass_codes where exp < now();
  insert into public.guest_pass_codes (token_hash, host_auth, phone, code_hash, exp)
  values (encode(extensions.digest(t, 'sha256'), 'hex'), p_host_auth, p_phone, encode(extensions.digest(c || t, 'sha256'), 'hex'), now() + interval '10 minutes');
  return jsonb_build_object('token', t, 'code', c);       -- the code goes to WhatsApp from the server, never to the browser
end $$;

create or replace function public.server_guest_pass(p_host_auth uuid, p_token text, p_code text, p_name text, p_org text, p_designation text,
  p_purpose text, p_site uuid, p_section uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.guest_pass_codes; host public.people; p public.people; v uuid;
begin
  select * into g from public.guest_pass_codes where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and exp > now() for update;
  if not found or g.host_auth <> p_host_auth then raise exception 'This step has expired – send a new code.' using errcode = '22023'; end if;
  if g.tries >= 5 then raise exception 'Too many wrong codes – send a new code.' using errcode = '22023'; end if;
  if g.code_hash <> encode(extensions.digest(p_code || p_token, 'sha256'), 'hex') then
    update public.guest_pass_codes set tries = tries + 1 where token_hash = g.token_hash;
    return jsonb_build_object('ok', false, 'tries_left', 4 - g.tries);
  end if;
  delete from public.guest_pass_codes where token_hash = g.token_hash;
  select * into host from public.people where auth_user_id = p_host_auth;
  if not exists (select 1 from public.sites where id = p_site and company_id = host.company_id) then raise exception 'Choose the site.' using errcode = '22023'; end if;
  select * into p from public.people where company_id = host.company_id and mobile = g.phone;
  if found and p.kind <> 'guest' then raise exception 'This mobile belongs to a registered employee – he orders for himself.' using errcode = '22023'; end if;
  if not found then
    insert into public.people (company_id, kind, full_name, mobile, mobile_verified_at, state)
    values (host.company_id, 'guest', p_name, g.phone, now(), 'verified') returning * into p;
    insert into public.guest_profiles (person_id, organisation, designation) values (p.id, p_org, p_designation);
  elsif p.state in ('rejected', 'suspended') then raise exception 'This guest may not be served.' using errcode = '42501';
  end if;
  update public.guest_visits set ended_at = now() where person_id = p.id and ended_at is null;
  insert into public.guest_visits (person_id, site_id, section_id, purpose, host_id, host_role)
  values (p.id, p_site, p_section, p_purpose, host.id, host.work_role) returning id into v;
  return jsonb_build_object('ok', true, 'guest', p.id, 'visit', v, 'name', p.full_name);
end $$;

-- The host orders for his guest (a visit he hosts): the guest's own line, the host's OK given.
create or replace function public.order_for_guest(p_visit uuid, p_mess uuid, p_date date, p_meal public.meal, p_kind public.order_kind,
  p_section uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.guest_visits; m public.messes; s public.sites; w public.meal_windows; it uuid; o public.orders; dl timestamp;
begin
  select * into v from public.guest_visits where id = p_visit and ended_at is null and host_id = public.me();
  if not found then raise exception 'Only the guest''s host orders for him.' using errcode = '42501'; end if;
  select * into m from public.messes where id = p_mess and site_id = v.site_id and active;
  if not found then raise exception 'Choose a mess of the guest''s site.' using errcode = '22023'; end if;
  select * into w from public.meal_windows where mess_id = p_mess and meal = p_meal and p_date >= valid_from and (valid_to is null or p_date <= valid_to);
  if not found then raise exception 'This mess does not serve this meal on that day.' using errcode = '22023'; end if;
  dl := p_date + (case when p_kind = 'meal' then w.serve_to else w.order_by end);
  if p_date < public.local_today() or public.local_now() > dl then raise exception 'Too late for this meal.' using errcode = '22023'; end if;
  if exists (select 1 from public.order_lines where person_id = v.person_id and service_date = p_date and meal = p_meal and is_meal and state <> 'cancelled') then
    raise exception 'Your guest has this meal already.' using errcode = '22023';
  end if;
  select id into it from public.items where company_id = m.company_id and kind = 'meal' and meal = p_meal and active limit 1;
  select * into s from public.sites where id = m.site_id;
  insert into public.orders (code, company_id, site_id, mess_id, kind, meal, service_date, requested_by, guest_visit_id, host_state, host_by, to_section_id, note)
  values (public.next_code('order:' || s.id, 'MS-' || s.code || '-'), m.company_id, m.site_id, m.id, p_kind, p_meal, p_date, public.me(), v.id,
          'approved', public.me(), case when p_kind = 'delivery' then coalesce(p_section, v.section_id) end, p_note)
  returning * into o;
  insert into public.order_lines (order_id, person_id, item_id, is_meal, service_date, meal, qty) values (o.id, v.person_id, it, true, p_date, p_meal, 1);
  if p_kind in ('parcel', 'delivery') then
    insert into public.delivery_codes (order_id, person_id, code)
    values (o.id, v.person_id, (select lpad((((get_byte(b, 0) << 16) | (get_byte(b, 1) << 8) | get_byte(b, 2)) % 10000)::text, 4, '0') from (select extensions.gen_random_bytes(3) as b) r));
  end if;
  return jsonb_build_object('order_id', o.id, 'code', o.code);
end $$;

-- The host sees his guest's code (the guest has no app).
create or replace function public.guest_code_for_host(p_order uuid) returns text
language sql stable security definer set search_path = '' as $$
  select c.code from public.delivery_codes c join public.orders o on o.id = c.order_id join public.guest_visits v on v.id = o.guest_visit_id
  where c.order_id = p_order and v.host_id = public.me()
$$;

-- Main · "38 meals and 9 parcels this month" – his own.
create or replace function public.my_month() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'meals', count(*) filter (where l.is_meal and l.state in ('served', 'delivered', 'short')),
    'parcels', count(*) filter (where l.is_meal and o.kind in ('parcel', 'delivery') and l.state in ('delivered', 'short')))
  from public.order_lines l join public.orders o on o.id = l.order_id
  where l.person_id = public.me() and l.service_date >= date_trunc('month', public.local_today())::date
$$;

revoke all on function public.report_received(uuid, integer, text, text), public.my_van(uuid), public.team_for_group(uuid, date, public.meal),
  public.visit_hosts(uuid), public.server_guest_code(uuid, text), public.server_guest_pass(uuid, text, text, text, text, text, text, uuid, uuid),
  public.order_for_guest(uuid, uuid, date, public.meal, public.order_kind, uuid, text), public.guest_code_for_host(uuid), public.my_month()
  from public, anon, authenticated;
grant execute on function public.report_received(uuid, integer, text, text), public.my_van(uuid), public.team_for_group(uuid, date, public.meal),
  public.visit_hosts(uuid), public.order_for_guest(uuid, uuid, date, public.meal, public.order_kind, uuid, text), public.guest_code_for_host(uuid),
  public.my_month() to authenticated;
grant execute on function public.server_guest_code(uuid, text), public.server_guest_pass(uuid, text, text, text, text, text, text, uuid, uuid) to service_role;

-- ── the kitchen's screens (o01–o16) ──────────────────────────────────────────────────────────────────────────────────────
-- Every order of a mess for a day, with its people, lines and confirmations – one call for the kitchen's lists.
create or replace function public.kitchen_orders(p_mess uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'code', o.code, 'kind', o.kind, 'meal', o.meal, 'state', o.state, 'host_state', o.host_state, 'created_at', o.created_at,
    'accepted_at', o.accepted_at, 'change_until', o.change_until, 'ready_at', o.ready_at, 'is_group', o.is_group, 'guest', o.guest_visit_id is not null,
    'note', o.note, 'requester', r.full_name, 'requester_role', r.work_role,
    'section', case when s.id is null then null else jsonb_build_object('id', s.id, 'code', s.code, 'km', s.km, 'place', s.place, 'circle', c.code) end,
    'batch', (select x.code from public.batch_orders bo join public.batches x on x.id = bo.batch_id where bo.order_id = o.id and bo.removed_at is null limit 1),
    'lines', (select jsonb_agg(jsonb_build_object('id', l.id, 'person', p.full_name, 'person_id', p.id, 'role', p.work_role, 'item', i.name, 'code', i.code,
                'is_meal', l.is_meal, 'qty', l.qty, 'state', l.state, 'delivered_qty', l.delivered_qty, 'short_qty', l.short_qty,
                'confirmed', (select k.kind from public.confirmations k where k.order_line_id = l.id)) order by l.is_meal desc, p.full_name)
              from public.order_lines l join public.people p on p.id = l.person_id join public.items i on i.id = l.item_id where l.order_id = o.id)
  ) order by c.code nulls last, s.km nulls last, o.created_at), '[]')
  from public.orders o join public.people r on r.id = o.requested_by
       left join public.sections s on s.id = o.to_section_id left join public.circles c on c.id = s.circle_id
  where o.mess_id = p_mess and o.service_date = p_date and o.host_state in ('not_needed', 'approved')
    and public.works_at_mess(p_mess, array['mess_owner', 'mess_operator']::public.app_role[])
$$;

-- o02 · an extra item needs the mess's OK: no → that line is taken out (the meal stays).
create or replace function public.kitchen_extra(p_line uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.order_lines;
begin
  select * into l from public.order_lines where id = p_line for update;
  if not found or l.is_meal or not public.is_kitchen_of_order(l.order_id) then raise exception 'Only this mess''s kitchen decides an extra.' using errcode = '42501'; end if;
  if not p_ok then update public.order_lines set state = 'cancelled' where id = l.id and state = 'open'; end if;
  perform public.audit_write(case when p_ok then 'extra_ok' else 'extra_no' end, 'order_lines', l.id::text, null, null, null, 'owner app', null);
end $$;

-- o16 · the follow-up calls: every call is kept; "got all / got less" confirm it as the owner's phone follow-up (never as an OTP);
-- "did not get" fails the line; "no answer" only keeps the call.
create table if not exists public.followup_calls (
  id            uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references public.order_lines(id),
  outcome       text not null check (outcome in ('got_all', 'got_less', 'did_not_get', 'no_answer', 'reminder')),
  qty           integer check (qty >= 0),
  note          text check (length(note) <= 300),
  by_person     uuid not null references public.people(id),
  at            timestamptz not null default now()
);
alter table public.followup_calls enable row level security;
drop policy if exists followup_calls_read on public.followup_calls;
create policy followup_calls_read on public.followup_calls for select to authenticated using (exists (select 1 from public.order_lines l where l.id = order_line_id));
revoke all on public.followup_calls from anon, authenticated;
grant select on public.followup_calls to authenticated;

create or replace function public.follow_up(p_line uuid, p_outcome text, p_qty integer default null, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.order_lines; o public.orders;
begin
  select * into l from public.order_lines where id = p_line for update;
  select * into o from public.orders where id = l.order_id;
  if not found or not public.works_at_mess(o.mess_id) then raise exception 'Only this mess''s owner follows up.' using errcode = '42501'; end if;
  insert into public.followup_calls (order_line_id, outcome, qty, note, by_person) values (l.id, p_outcome, p_qty, p_note, public.me());
  if p_outcome in ('got_all', 'got_less') then
    perform public.write_confirmation(l.id, 'owner_phone', case when p_outcome = 'got_less' then p_qty end,
      coalesce(nullif(trim(p_note), ''), case when p_outcome = 'got_all' then 'Got all (phone)' else 'Got less (phone)' end));
  elsif p_outcome = 'did_not_get' then
    update public.order_lines set state = 'failed', failed_reason = 'Did not get it (owner''s call)' || coalesce(' – ' || p_note, '') where id = l.id;
    perform public.finish_order_if_done(l.order_id);
  elsif p_outcome = 'reminder' then
    perform public.notify(l.person_id, 'confirm_reminder', o.code || ': please confirm what you got', null, '/app/orders/' || o.id);
  end if;
end $$;

-- o07 · the drivers of a site the kitchen may choose, with what each is doing today.
create or replace function public.site_drivers(p_mess uuid) returns table (person_id uuid, full_name text, busy text)
language sql stable security definer set search_path = '' as $$
  select distinct on (p.id) p.id, p.full_name,
    (select string_agg(x.code || ' · ' || x.state::text, ', ') from public.batches x where x.driver_id = p.id and x.service_date = public.local_today() and x.state in ('assigned', 'accepted', 'loaded', 'on_the_way'))
  from public.messes m join public.role_grants g on g.role = 'driver' and g.revoked_at is null and (g.site_id is null or g.site_id = m.site_id)
       join public.people p on p.id = g.person_id
  where m.id = p_mess and public.works_at_mess(p_mess, array['mess_owner', 'mess_operator']::public.app_role[])
    and public.local_today() >= g.valid_from and (g.valid_to is null or public.local_today() <= g.valid_to) and p.state not in ('rejected', 'suspended')
  order by p.id
$$;

revoke all on function public.kitchen_orders(uuid, date), public.kitchen_extra(uuid, boolean), public.follow_up(uuid, text, integer, text),
  public.site_drivers(uuid) from public, anon;
grant execute on function public.kitchen_orders(uuid, date), public.kitchen_extra(uuid, boolean), public.follow_up(uuid, text, integer, text),
  public.site_drivers(uuid) to authenticated;

-- A batch's driver (name and mobile) for whoever may see the batch: the kitchen, the site's office.
create or replace function public.batch_driver(p_batch uuid) returns table (person_id uuid, full_name text, mobile text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.mobile from public.batches x join public.people p on p.id = x.driver_id
  where x.id = p_batch and public.can_see_batch(x.id)
$$;
revoke all on function public.batch_driver(uuid) from public, anon;
grant execute on function public.batch_driver(uuid) to authenticated;

-- ── the driver's screens (d01–d11): his trip – stops, people, what each box holds (no prices) ─────────────────────────────
create or replace function public.driver_trip(p_batch uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'code', x.code, 'state', x.state, 'meal', x.meal, 'service_date', x.service_date, 'planned_km', x.planned_km,
    'planned_minutes', x.planned_minutes, 'dispatched_at', x.dispatched_at, 'completed_at', x.completed_at, 'vehicle_check', x.vehicle_check,
    'mess', m.name, 'vehicle', jsonb_build_object('reg_no', v.reg_no, 'kind', v.kind, 'capacity', v.capacity),
    'stops', (select jsonb_agg(jsonb_build_object('seq', t.seq, 'section_id', s.id, 'section', s.code, 'km', s.km, 'place', s.place, 'lat', s.lat, 'lng', s.lng,
                'eta', t.eta, 'reached_at', t.reached_at,
                'people', (select jsonb_agg(jsonb_build_object('person_id', p.id, 'name', p.full_name, 'role', p.work_role, 'order_id', o.id, 'code', o.code,
                              'lines', (select jsonb_agg(jsonb_build_object('item', i.name, 'qty', l2.qty, 'state', l2.state, 'is_meal', l2.is_meal, 'failed_reason', l2.failed_reason,
                                                                            'delivered_qty', l2.delivered_qty) order by l2.is_meal desc)
                                        from public.order_lines l2 join public.items i on i.id = l2.item_id where l2.order_id = o.id and l2.person_id = p.id and l2.state <> 'cancelled'),
                              'confirmed', (select k.kind from public.order_lines l3 join public.confirmations k on k.order_line_id = l3.id where l3.order_id = o.id and l3.person_id = p.id and l3.is_meal limit 1))
                            order by p.full_name)
                          from public.batch_orders bo join public.orders o on o.id = bo.order_id
                          join (select distinct order_id, person_id from public.order_lines where state <> 'cancelled') lp on lp.order_id = o.id
                          join public.people p on p.id = lp.person_id
                          where bo.batch_id = x.id and bo.removed_at is null and o.to_section_id = s.id)) order by t.seq)
              from public.batch_stops t join public.sections s on s.id = t.section_id where t.batch_id = x.id))
  from public.batches x join public.messes m on m.id = x.mess_id left join public.vehicles v on v.id = x.vehicle_id
  where x.id = p_batch and public.can_see_batch(x.id)
$$;
revoke all on function public.driver_trip(uuid) from public, anon;
grant execute on function public.driver_trip(uuid) to authenticated;

-- ── the office's web (w01, w07, w12): counts by site and day – only for sites where he has an office role ─────────────────
create or replace function public.office_stats(p_from date, p_to date)
returns table (site_id uuid, mess_id uuid, service_date date, breakfast integer, lunch integer, snacks integer, dinner integer, meals integer,
               guests integer, parcels integer, not_confirmed integer, failed integer, cancelled integer, short integer)
language sql stable security definer set search_path = '' as $$
  select o.site_id, o.mess_id, l.service_date,
    count(*) filter (where l.is_meal and l.meal = 'breakfast' and l.state in ('served', 'delivered', 'short'))::integer,
    count(*) filter (where l.is_meal and l.meal = 'lunch' and l.state in ('served', 'delivered', 'short'))::integer,
    count(*) filter (where l.is_meal and l.meal = 'snacks' and l.state in ('served', 'delivered', 'short'))::integer,
    count(*) filter (where l.is_meal and l.meal = 'dinner' and l.state in ('served', 'delivered', 'short'))::integer,
    count(*) filter (where l.is_meal and l.state in ('served', 'delivered', 'short'))::integer,
    count(*) filter (where l.is_meal and o.guest_visit_id is not null and l.state in ('served', 'delivered', 'short'))::integer,
    count(*) filter (where l.is_meal and o.kind in ('parcel', 'delivery') and l.state in ('delivered', 'short'))::integer,
    count(*) filter (where l.state in ('served', 'delivered', 'short') and not exists (select 1 from public.confirmations c where c.order_line_id = l.id))::integer,
    count(*) filter (where l.state = 'failed')::integer,
    count(*) filter (where l.is_meal and l.state = 'cancelled')::integer,
    coalesce(sum(l.short_qty) filter (where l.state = 'short'), 0)::integer
  from public.order_lines l join public.orders o on o.id = l.order_id
  where l.service_date between p_from and p_to and o.company_id = public.my_company()
    and public.has_role(array['site_admin', 'mess_supervisor', 'accounts', 'management', 'system_admin']::public.app_role[], o.site_id)
  group by o.site_id, o.mess_id, l.service_date
$$;

-- On-time deliveries (a stop reached by its ETA + the late minutes) and ratings – for the dashboard and the scorecard.
create or replace function public.office_delivery(p_from date, p_to date)
returns table (mess_id uuid, stops integer, on_time integer, batches integer, late_batches integer)
language sql stable security definer set search_path = '' as $$
  select x.mess_id, count(t.*)::integer,
    count(*) filter (where t.reached_at is not null and (t.eta is null or t.reached_at <= t.eta + make_interval(mins => public.setting_int(x.company_id, 'delivery.late_minutes', x.service_date, 30))))::integer,
    count(distinct x.id)::integer,
    count(distinct x.id) filter (where t.reached_at > t.eta + make_interval(mins => public.setting_int(x.company_id, 'delivery.late_minutes', x.service_date, 30)))::integer
  from public.batches x join public.batch_stops t on t.batch_id = x.id
  where x.service_date between p_from and p_to and x.company_id = public.my_company() and x.state = 'completed'
    and public.has_role(array['site_admin', 'mess_supervisor', 'accounts', 'management', 'system_admin']::public.app_role[], x.site_id)
  group by x.mess_id
$$;

create or replace function public.office_ratings(p_from date, p_to date)
returns table (mess_id uuid, reviews integer, overall numeric, taste numeric, quantity numeric, hot numeric, delivery numeric)
language sql stable security definer set search_path = '' as $$
  select o.mess_id, count(*)::integer, round(avg(r.overall), 1), round(avg(r.taste), 1), round(avg(r.quantity), 1), round(avg(r.hot), 1), round(avg(r.delivery), 1)
  from public.reviews r join public.orders o on o.id = r.order_id
  where o.service_date between p_from and p_to and o.company_id = public.my_company()
    and public.has_role(array['site_admin', 'mess_supervisor', 'accounts', 'management', 'system_admin']::public.app_role[], o.site_id)
  group by o.mess_id
$$;

revoke all on function public.office_stats(date, date), public.office_delivery(date, date), public.office_ratings(date, date) from public, anon;
grant execute on function public.office_stats(date, date), public.office_delivery(date, date), public.office_ratings(date, date) to authenticated;
