-- FALCON · migration 0003 · requests and orders: meals at the mess, parcels and deliveries; group requests (one line a person,
-- never a second meal); guests' visits and their host's OK; the owner's accept / refuse; the kitchen; the five kinds of
-- confirmation kept apart; the person's delivery code; optional reviews. Safe to run again.

do $$ begin create type public.order_kind as enum ('meal', 'parcel', 'delivery');
exception when duplicate_object then null; end $$;
do $$ begin create type public.order_state as enum ('requested', 'accepted', 'refused', 'preparing', 'ready', 'dispatched',
  'delivered', 'cancelled', 'failed');
exception when duplicate_object then null; end $$;
do $$ begin create type public.line_state as enum ('open', 'served', 'delivered', 'short', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin create type public.confirm_kind as enum ('beneficiary_otp', 'beneficiary_app', 'group_requester', 'owner_phone', 'supervisor');
exception when duplicate_object then null; end $$;
do $$ begin create type public.host_state as enum ('not_needed', 'waiting', 'approved', 'refused');
exception when duplicate_object then null; end $$;

-- A person may ask meals for others (a group request) only when the Site Admin allowed it.
alter table public.people add column if not exists may_group boolean not null default false;

-- Running numbers for the codes people read (MS-VTR-0147, G-0034, B-03 …).
create table if not exists public.code_counters (scope text primary key, next_no bigint not null);
create or replace function public.next_code(p_scope text, p_prefix text, p_width integer default 4) returns text
language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  insert into public.code_counters as c (scope, next_no) values (p_scope, 2)
  on conflict (scope) do update set next_no = c.next_no + 1
  returning c.next_no - 1 into n;
  return p_prefix || lpad(n::text, p_width, '0');
end $$;

-- ── guests' visits ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- One guest profile for ever (0001); each visit is its own record, with its host – whose OK a guest's order waits for.
create table if not exists public.guest_visits (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people(id),
  site_id     uuid not null references public.sites(id),
  section_id  uuid,
  purpose     text not null check (length(trim(purpose)) between 2 and 200),
  host_id     uuid references public.people(id),
  host_role   text check (length(host_role) <= 80),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  foreign key (section_id, site_id) references public.sections(id, site_id),
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists guest_visits_one_open on public.guest_visits (person_id) where ended_at is null;

-- ── orders and their lines ───────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  company_id     uuid not null references public.companies(id),
  site_id        uuid not null references public.sites(id),
  mess_id        uuid not null references public.messes(id),
  kind           public.order_kind not null,
  meal           public.meal not null,
  service_date   date not null,
  requested_by   uuid not null references public.people(id),
  is_group       boolean not null default false,
  guest_visit_id uuid references public.guest_visits(id),
  host_state     public.host_state not null default 'not_needed',
  host_by        uuid references public.people(id),
  to_section_id  uuid references public.sections(id),
  note           text check (length(note) <= 300),
  state          public.order_state not null default 'requested',
  refused_reason text,
  accepted_by    uuid references public.people(id),
  accepted_at    timestamptz,
  change_until   timestamptz,                      -- after this the requester can no longer change or cancel
  ready_at       timestamptz,
  created_at     timestamptz not null default now(),
  check ((kind = 'delivery') = (to_section_id is not null)),
  check (guest_visit_id is not null or host_state = 'not_needed'),
  check (state <> 'refused' or length(trim(coalesce(refused_reason, ''))) > 0)
);
create index if not exists orders_mess_day on public.orders (mess_id, service_date, meal);
create index if not exists orders_requested_by on public.orders (requested_by, service_date desc);

create table if not exists public.order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id),
  person_id     uuid not null references public.people(id),      -- who eats it (the requester himself, or one of his group)
  item_id       uuid not null references public.items(id),
  is_meal       boolean not null,                                 -- the main meal (one a person a meal a day) or an extra
  service_date  date not null,
  meal          public.meal not null,
  qty           integer not null check (qty between 1 and 50),
  state         public.line_state not null default 'open',
  delivered_qty integer check (delivered_qty between 0 and 50),
  short_qty     integer check (short_qty between 0 and 50),
  failed_reason text,
  check (not is_meal or qty = 1),
  check (state <> 'failed' or length(trim(coalesce(failed_reason, ''))) > 0)
);
-- THE rule against a second meal: one main meal a person a meal a day, whoever asked it.
create unique index if not exists order_lines_one_meal on public.order_lines (person_id, service_date, meal)
  where is_meal and state <> 'cancelled';
create index if not exists order_lines_order on public.order_lines (order_id);

-- The person's own code for a parcel or a delivery – he tells it to the driver. Only he reads it.
create table if not exists public.delivery_codes (
  order_id  uuid not null references public.orders(id),
  person_id uuid not null references public.people(id),
  code      text not null check (code ~ '^[0-9]{4}$'),
  tries     integer not null default 0,
  used_at   timestamptz,
  primary key (order_id, person_id)
);

-- How a line was confirmed – five kinds, kept apart for ever: a phone follow-up is never written as an OTP.
create table if not exists public.confirmations (
  id            uuid primary key default gen_random_uuid(),
  order_line_id uuid not null unique references public.order_lines(id),
  kind          public.confirm_kind not null,
  by_person     uuid not null references public.people(id),
  at            timestamptz not null default now(),
  qty_received  integer check (qty_received between 0 and 50),
  note          text check (length(note) <= 300),
  check (kind not in ('owner_phone', 'supervisor') or length(trim(coalesce(note, ''))) > 0)
);

-- Optional: never stops a delivery, the day's closing or a bill.
create table if not exists public.reviews (
  id        uuid primary key default gen_random_uuid(),
  order_id  uuid not null references public.orders(id),
  person_id uuid not null references public.people(id),
  taste     smallint check (taste between 1 and 5),
  quantity  smallint check (quantity between 1 and 5),
  hygiene   smallint check (hygiene between 1 and 5),
  overall   smallint check (overall between 1 and 5),
  hot       smallint check (hot between 1 and 5),
  delivery  smallint check (delivery between 1 and 5),
  liked     text[] not null default '{}' check (cardinality(liked) <= 10),
  comment   text check (length(comment) <= 500),
  at        timestamptz not null default now(),
  unique (order_id, person_id)
);

-- ── who may see an order ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.can_see_order(o uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orders x
    where x.id = o and x.company_id = public.my_company() and (
      x.requested_by = public.me()
      or exists (select 1 from public.order_lines l where l.order_id = x.id and l.person_id = public.me())
      or (x.host_state in ('not_needed', 'approved') and public.works_at_mess(x.mess_id, array['mess_owner', 'mess_operator']::public.app_role[]))
      or exists (select 1 from public.guest_visits v where v.id = x.guest_visit_id and v.host_id = public.me())
      or public.has_role(array['site_admin', 'mess_supervisor']::public.app_role[], x.site_id)
      or public.has_role(array['accounts', 'management', 'system_admin']::public.app_role[])))
$$;

-- Who sees every line of an order (not only his own): the requester, the host, the kitchen, the office (and the driver, 0004).
create or replace function public.sees_all_lines(o uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orders x
    where x.id = o and x.company_id = public.my_company() and (
      x.requested_by = public.me()
      or (x.host_state in ('not_needed', 'approved') and public.works_at_mess(x.mess_id, array['mess_owner', 'mess_operator']::public.app_role[]))
      or exists (select 1 from public.guest_visits v where v.id = x.guest_visit_id and v.host_id = public.me())
      or public.has_role(array['site_admin', 'mess_supervisor']::public.app_role[], x.site_id)
      or public.has_role(array['accounts', 'management', 'system_admin']::public.app_role[])))
$$;

-- The kitchen's people of an order's mess.
create or replace function public.is_kitchen_of_order(o uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders x where x.id = o
                 and public.works_at_mess(x.mess_id, array['mess_owner', 'mess_operator']::public.app_role[]))
$$;

-- ── asking ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- One call asks an order: p_lines = [{"person": uuid (empty = me), "item": "lunch", "qty": 1}, …]. A person who already has
-- that meal is NOT given a second one: his existing order is returned instead (and nothing is made when nobody is new).
create or replace function public.request_order(p_mess uuid, p_date date, p_meal public.meal, p_kind public.order_kind,
  p_lines jsonb, p_section uuid default null, p_note text default null, p_visit uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me(); who public.people; m public.messes; w public.meal_windows; s public.sites;
  ln jsonb; pid uuid; it public.items; qty integer; existing jsonb := '[]'::jsonb; made integer := 0;
  o public.orders; v public.guest_visits; group_ boolean := false; dl timestamp;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into who from public.people where id = me;
  select * into m from public.messes where id = p_mess and active;
  if not found or m.company_id <> who.company_id then raise exception 'This mess is not open to you.' using errcode = '42501'; end if;
  select * into s from public.sites where id = m.site_id;
  if p_date < public.local_today() then raise exception 'A day that has passed cannot be asked.' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Nothing was asked.' using errcode = '22023'; end if;
  select * into w from public.meal_windows where mess_id = p_mess and meal = p_meal
    and p_date >= valid_from and (valid_to is null or p_date <= valid_to);
  if not found then raise exception 'This mess does not serve this meal on that day.' using errcode = '22023'; end if;
  dl := p_date + (case when p_kind = 'meal' then w.serve_to else w.order_by end);
  if public.local_now() > dl then
    raise exception 'Too late for this meal – asking closed at %.', to_char(dl, 'HH24:MI') using errcode = '22023';
  end if;
  if p_kind = 'delivery' and (p_section is null or not exists (select 1 from public.sections where id = p_section and site_id = m.site_id and active)) then
    raise exception 'Choose the section to deliver to.' using errcode = '22023';
  end if;
  -- a temporary user: meals at the mess for himself only, at his own site (docs/PERMISSIONS.md)
  if who.state = 'temporary' and (p_kind <> 'meal' or m.site_id is distinct from who.home_site_id) then
    raise exception 'Your temporary access is for meals at your own site''s mess only.' using errcode = '42501';
  end if;
  if who.state not in ('verified', 'id_assigned', 'linked', 'temporary') then
    raise exception 'Your registration is not checked yet.' using errcode = '42501';
  end if;
  -- a guest: only during his open visit at this site, and his host says yes first
  if who.kind = 'guest' then
    select * into v from public.guest_visits where id = p_visit and person_id = me and ended_at is null and site_id = m.site_id;
    if not found then raise exception 'Start today''s visit first.' using errcode = '42501'; end if;
  elsif p_visit is not null then
    raise exception 'Only a guest orders on a visit.' using errcode = '22023';
  end if;

  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := coalesce(nullif(ln ->> 'person', '')::uuid, me);
    if pid <> me then group_ := true; end if;
  end loop;
  if group_ and (not who.may_group or who.kind <> 'employee') then
    raise exception 'Asking for others needs the Site Admin''s permission.' using errcode = '42501';
  end if;

  o := null;
  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := coalesce(nullif(ln ->> 'person', '')::uuid, me);
    qty := coalesce((ln ->> 'qty')::integer, 1);
    select * into it from public.items where company_id = who.company_id and code = ln ->> 'item' and active;
    if not found then raise exception 'Unknown item: %', ln ->> 'item' using errcode = '22023'; end if;
    if it.kind = 'meal' and it.meal <> p_meal then raise exception '% is not %.', it.name, p_meal using errcode = '22023'; end if;
    if who.state = 'temporary' and it.kind <> 'meal' then
      raise exception 'Your temporary access is for meals only.' using errcode = '42501';
    end if;
    if pid <> me and not exists (select 1 from public.people where id = pid and company_id = who.company_id and kind = 'employee'
                                 and state in ('verified', 'id_assigned', 'linked')) then
      raise exception 'One of the people is not a checked employee.' using errcode = '22023';
    end if;
    if it.kind = 'meal' and exists (select 1 from public.order_lines l where l.person_id = pid and l.service_date = p_date
                                   and l.meal = p_meal and l.is_meal and l.state <> 'cancelled') then
      existing := existing || (select jsonb_build_object('person', pid, 'order', x.code, 'order_id', x.id)
                               from public.order_lines l join public.orders x on x.id = l.order_id
                               where l.person_id = pid and l.service_date = p_date and l.meal = p_meal and l.is_meal and l.state <> 'cancelled'
                               limit 1);
      continue;
    end if;
    if o.id is null then
      insert into public.orders (code, company_id, site_id, mess_id, kind, meal, service_date, requested_by, is_group,
                                 guest_visit_id, host_state, to_section_id, note)
      values (public.next_code('order:' || s.id, 'MS-' || s.code || '-'), who.company_id, m.site_id, m.id, p_kind, p_meal, p_date, me,
              group_, v.id, case when v.id is null or v.host_id is null then 'not_needed' else 'waiting' end::public.host_state, p_section, p_note)
      returning * into o;
    end if;
    insert into public.order_lines (order_id, person_id, item_id, is_meal, service_date, meal, qty)
    values (o.id, pid, it.id, it.kind = 'meal', p_date, p_meal, case when it.kind = 'meal' then 1 else qty end);
    made := made + 1;
    if p_kind in ('parcel', 'delivery') then
      insert into public.delivery_codes (order_id, person_id, code)
      values (o.id, pid, (select lpad((((get_byte(b, 0) << 16) | (get_byte(b, 1) << 8) | get_byte(b, 2)) % 10000)::text, 4, '0')
                         from (select extensions.gen_random_bytes(3) as b) r))
      on conflict do nothing;
    end if;
  end loop;

  if o.id is not null then
    perform public.audit_write('request', 'orders', o.id::text, null, to_jsonb(o), o.site_id, 'app', null);
  end if;
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'lines', made, 'existing', existing);
end $$;

-- The requester takes his order back while the change window is open (before the kitchen accepted, or within its minutes).
create or replace function public.cancel_order(p_order uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.requested_by is distinct from public.me() then raise exception 'Only the one who asked can take it back.' using errcode = '42501'; end if;
  if o.state not in ('requested', 'accepted') or (o.state = 'accepted' and now() > o.change_until) then
    raise exception 'The kitchen has started – it can no longer be taken back.' using errcode = '22023';
  end if;
  update public.order_lines set state = 'cancelled' where order_id = o.id;
  update public.orders set state = 'cancelled', note = coalesce(note || ' · ', '') || coalesce('Cancelled: ' || p_reason, 'Cancelled') where id = o.id;
  perform public.audit_write('cancel', 'orders', o.id::text, to_jsonb(o), null, o.site_id, 'app', p_reason);
end $$;

-- The guest's host says yes or no.
create or replace function public.host_decide(p_order uuid, p_ok boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.host_state <> 'waiting'
     or not exists (select 1 from public.guest_visits v where v.id = o.guest_visit_id and v.host_id = public.me()) then
    raise exception 'Only the host decides this guest''s order.' using errcode = '42501';
  end if;
  if not p_ok and length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Saying no needs the reason.' using errcode = '22023'; end if;
  update public.orders set host_state = case when p_ok then 'approved' else 'refused' end::public.host_state, host_by = public.me(),
    state = case when p_ok then state else 'refused' end, refused_reason = case when p_ok then refused_reason else p_reason end
  where id = o.id;
  if not p_ok then update public.order_lines set state = 'cancelled' where order_id = o.id; end if;
  perform public.audit_write(case when p_ok then 'host_ok' else 'host_no' end, 'orders', o.id::text, null, null, o.site_id, 'app', p_reason);
end $$;

-- ── the kitchen ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Accept (the change window of the mess's meal starts) or refuse with the reason.
create or replace function public.kitchen_decide(p_order uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; mins integer;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not public.is_kitchen_of_order(o.id) then raise exception 'Only this mess''s kitchen decides it.' using errcode = '42501'; end if;
  if o.state <> 'requested' or o.host_state not in ('not_needed', 'approved') then raise exception 'This request is not waiting.' using errcode = '22023'; end if;
  if p_accept then
    select coalesce(max(w.change_minutes), 0) into mins from public.meal_windows w where w.mess_id = o.mess_id and w.meal = o.meal
      and o.service_date >= w.valid_from and (w.valid_to is null or o.service_date <= w.valid_to);
    update public.orders set state = 'accepted', accepted_by = public.me(), accepted_at = now(),
      change_until = now() + make_interval(mins => mins) where id = o.id;
  else
    if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Refusing needs the reason.' using errcode = '22023'; end if;
    update public.orders set state = 'refused', refused_reason = p_reason, accepted_by = public.me(), accepted_at = now() where id = o.id;
    update public.order_lines set state = 'cancelled' where order_id = o.id;
  end if;
  perform public.audit_write(case when p_accept then 'accept' else 'refuse' end, 'orders', o.id::text, null, null, o.site_id, 'owner app', p_reason);
end $$;

-- Preparing → Ready (a parcel is packed); at the mess, a line is served at the counter.
create or replace function public.kitchen_step(p_order uuid, p_state public.order_state) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not public.is_kitchen_of_order(o.id) then raise exception 'Only this mess''s kitchen moves it.' using errcode = '42501'; end if;
  if not ((o.state = 'accepted' and p_state = 'preparing') or (o.state in ('accepted', 'preparing') and p_state = 'ready')) then
    raise exception 'It cannot go from % to %.', o.state, p_state using errcode = '22023';
  end if;
  update public.orders set state = p_state, ready_at = case when p_state = 'ready' then now() else ready_at end where id = o.id;
  perform public.audit_write(p_state::text, 'orders', o.id::text, null, null, o.site_id, 'owner app', null);
end $$;

create or replace function public.serve_line(p_line uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.order_lines; o public.orders;
begin
  select * into l from public.order_lines where id = p_line for update;
  select * into o from public.orders where id = l.order_id;
  if not found or not public.is_kitchen_of_order(o.id) then raise exception 'Only this mess''s counter serves it.' using errcode = '42501'; end if;
  if o.kind <> 'meal' or o.state not in ('accepted', 'preparing', 'ready') or l.state <> 'open' then
    raise exception 'This meal is not waiting at the counter.' using errcode = '22023';
  end if;
  update public.order_lines set state = 'served', delivered_qty = l.qty where id = l.id;
  if not exists (select 1 from public.order_lines where order_id = o.id and state = 'open') then
    update public.orders set state = 'delivered' where id = o.id;
  end if;
  perform public.audit_write('serve', 'order_lines', l.id::text, null, null, o.site_id, 'counter', null);
end $$;

-- ── confirming – each kind by its own function, so a kind can never be written by the wrong person ─────────────────────
create or replace function public.write_confirmation(p_line uuid, p_kind public.confirm_kind, p_qty integer, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.order_lines; o public.orders;
begin
  select * into l from public.order_lines where id = p_line for update;
  select * into o from public.orders where id = l.order_id;
  if l.state not in ('served', 'delivered', 'short') then raise exception 'It is not delivered yet.' using errcode = '22023'; end if;
  if exists (select 1 from public.confirmations where order_line_id = l.id) then raise exception 'It is confirmed already.' using errcode = '22023'; end if;
  if p_qty is not null and p_qty < coalesce(l.delivered_qty, l.qty) then
    update public.order_lines set state = 'short', short_qty = coalesce(l.delivered_qty, l.qty) - p_qty where id = l.id;
  end if;
  insert into public.confirmations (order_line_id, kind, by_person, qty_received, note) values (l.id, p_kind, public.me(), p_qty, p_note);
  perform public.audit_write('confirm', 'order_lines', l.id::text, null, jsonb_build_object('kind', p_kind, 'qty', p_qty), o.site_id, p_kind::text, p_note);
end $$;

-- The person himself, in his app (at the mess, or after the driver's code was taken): what he got.
create or replace function public.confirm_received(p_line uuid, p_qty integer default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.order_lines where id = p_line and person_id = public.me()) then
    raise exception 'Only the person it was for confirms it in his app.' using errcode = '42501';
  end if;
  perform public.write_confirmation(p_line, 'beneficiary_app', p_qty, null);
end $$;

-- The group requester, for one person of his own group.
create or replace function public.confirm_for_group(p_line uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.order_lines l join public.orders o on o.id = l.order_id
                 where l.id = p_line and o.is_group and o.requested_by = public.me()) then
    raise exception 'Only the one who asked for the group confirms for it.' using errcode = '42501';
  end if;
  perform public.write_confirmation(p_line, 'group_requester', null, p_note);
end $$;

-- The mess owner after calling the person – always with what was said.
create or replace function public.confirm_by_phone(p_line uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.order_lines l join public.orders o on o.id = l.order_id
                 where l.id = p_line and public.works_at_mess(o.mess_id)) then
    raise exception 'Only this mess''s owner records a phone follow-up.' using errcode = '42501';
  end if;
  perform public.write_confirmation(p_line, 'owner_phone', null, p_note);
end $$;

-- The site's supervisor – always with the reason.
create or replace function public.confirm_by_supervisor(p_line uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.order_lines l join public.orders o on o.id = l.order_id
                 where l.id = p_line and public.has_role(array['mess_supervisor']::public.app_role[], o.site_id)) then
    raise exception 'Only the site''s supervisor confirms here.' using errcode = '42501';
  end if;
  perform public.write_confirmation(p_line, 'supervisor', null, p_note);
end $$;

drop function if exists public.review_order(uuid, smallint, smallint, smallint, smallint, smallint, text[], text);
create or replace function public.review_order(p_order uuid, p_overall smallint, p_taste smallint default null, p_quantity smallint default null,
  p_hot smallint default null, p_delivery smallint default null, p_liked text[] default '{}', p_comment text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.order_lines where order_id = p_order and person_id = public.me()) then
    raise exception 'Only someone who ate it reviews it.' using errcode = '42501';
  end if;
  insert into public.reviews (order_id, person_id, overall, taste, quantity, hot, delivery, liked, comment)
  values (p_order, public.me(), p_overall, p_taste, p_quantity, p_hot, p_delivery, coalesce(p_liked, '{}'), p_comment)
  on conflict (order_id, person_id) do update set overall = excluded.overall, taste = excluded.taste, quantity = excluded.quantity,
    hot = excluded.hot, delivery = excluded.delivery, liked = excluded.liked, comment = excluded.comment, at = now();
end $$;

-- A guest opens today's visit (one open visit at a time) and closes it.
create or replace function public.start_visit(p_site uuid, p_purpose text, p_section uuid default null, p_host uuid default null,
  p_host_role text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.me(); v uuid;
begin
  if me is null or not exists (select 1 from public.people where id = me and kind = 'guest') then
    raise exception 'Only a guest starts a visit.' using errcode = '42501';
  end if;
  if not public.in_my_company(p_site) then raise exception 'This site is not open to you.' using errcode = '42501'; end if;
  update public.guest_visits set ended_at = now() where person_id = me and ended_at is null;
  insert into public.guest_visits (person_id, site_id, section_id, purpose, host_id, host_role)
  values (me, p_site, p_section, p_purpose, p_host, p_host_role) returning id into v;
  return v;
end $$;

do $$ declare t text; begin
  foreach t in array array['guest_visits', 'orders', 'order_lines', 'confirmations', 'reviews'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

-- ── Row Level Security (changes only through the functions above) ────────────────────────────────────────────────────────
alter table public.code_counters  enable row level security;
alter table public.guest_visits   enable row level security;
alter table public.orders         enable row level security;
alter table public.order_lines    enable row level security;
alter table public.delivery_codes enable row level security;
alter table public.confirmations  enable row level security;
alter table public.reviews        enable row level security;

drop policy if exists guest_visits_read on public.guest_visits;
create policy guest_visits_read on public.guest_visits for select to authenticated using (
  person_id = public.me() or host_id = public.me()
  or (public.in_my_company(site_id) and public.has_role(array['site_admin', 'mess_supervisor', 'accounts', 'management', 'system_admin']::public.app_role[], site_id)));

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using (public.can_see_order(id));

-- A line: the person it is for; and whoever sees the whole order except a fellow eater of a group (he sees only his own line).
drop policy if exists order_lines_read on public.order_lines;
create policy order_lines_read on public.order_lines for select to authenticated using (
  person_id = public.me() or public.sees_all_lines(order_id));

drop policy if exists delivery_codes_read on public.delivery_codes;
create policy delivery_codes_read on public.delivery_codes for select to authenticated using (person_id = public.me());

drop policy if exists confirmations_read on public.confirmations;
create policy confirmations_read on public.confirmations for select to authenticated using (
  exists (select 1 from public.order_lines l where l.id = order_line_id));

drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to authenticated using (person_id = public.me() or public.can_see_order(order_id));

revoke all on public.code_counters, public.guest_visits, public.orders, public.order_lines, public.delivery_codes,
  public.confirmations, public.reviews from anon, authenticated;
grant select on public.guest_visits, public.orders, public.order_lines, public.delivery_codes, public.confirmations, public.reviews
  to authenticated;

revoke all on function public.next_code(text, text, integer), public.can_see_order(uuid), public.sees_all_lines(uuid), public.is_kitchen_of_order(uuid),
  public.request_order(uuid, date, public.meal, public.order_kind, jsonb, uuid, text, uuid), public.cancel_order(uuid, text),
  public.host_decide(uuid, boolean, text), public.kitchen_decide(uuid, boolean, text), public.kitchen_step(uuid, public.order_state),
  public.serve_line(uuid), public.write_confirmation(uuid, public.confirm_kind, integer, text), public.confirm_received(uuid, integer),
  public.confirm_for_group(uuid, text), public.confirm_by_phone(uuid, text), public.confirm_by_supervisor(uuid, text),
  public.review_order(uuid, smallint, smallint, smallint, smallint, smallint, text[], text), public.start_visit(uuid, text, uuid, uuid, text) from public, anon;
grant execute on function public.can_see_order(uuid), public.sees_all_lines(uuid), public.is_kitchen_of_order(uuid),
  public.request_order(uuid, date, public.meal, public.order_kind, jsonb, uuid, text, uuid), public.cancel_order(uuid, text),
  public.host_decide(uuid, boolean, text), public.kitchen_decide(uuid, boolean, text), public.kitchen_step(uuid, public.order_state),
  public.serve_line(uuid), public.confirm_received(uuid, integer), public.confirm_for_group(uuid, text),
  public.confirm_by_phone(uuid, text), public.confirm_by_supervisor(uuid, text),
  public.review_order(uuid, smallint, smallint, smallint, smallint, smallint, text[], text), public.start_visit(uuid, text, uuid, uuid, text) to authenticated;
