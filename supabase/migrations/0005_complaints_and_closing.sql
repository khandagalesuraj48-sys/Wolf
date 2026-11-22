-- FALCON · migration 0005 · complaints (photo, voice, severity, reply, decision, closing), the owner's follow-up list, the day's
-- closing (counts, attendance, the contractor's remarks, the lock) and corrections after the lock. Safe to run again.

do $$ begin create type public.complaint_category as enum ('quality', 'taste', 'quantity', 'temperature', 'cleanliness', 'water',
  'delay', 'missing', 'other');
exception when duplicate_object then null; end $$;
do $$ begin create type public.complaint_state as enum ('open', 'answered', 'person_confirmed', 'closed');
exception when duplicate_object then null; end $$;
do $$ begin create type public.day_state as enum ('open', 'submitted', 'locked');
exception when duplicate_object then null; end $$;

create table if not exists public.complaints (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  company_id     uuid not null references public.companies(id),
  site_id        uuid not null references public.sites(id),
  mess_id        uuid not null references public.messes(id),
  order_id       uuid references public.orders(id),
  raised_by      uuid not null references public.people(id),
  category       public.complaint_category not null,
  serious        boolean not null default false,
  people_count   integer not null default 1 check (people_count between 1 and 200),
  text           text check (length(text) <= 1000),
  heard_text     text check (length(heard_text) <= 2000),      -- the voice, written down
  voice_path     text,
  photo_paths    text[] not null default '{}' check (cardinality(photo_paths) <= 5),
  due_at         timestamptz not null,
  state          public.complaint_state not null default 'open',
  owner_reply    text,
  owner_action   text,
  replied_by     uuid references public.people(id),
  replied_at     timestamptz,
  found_true     boolean,
  penalty        numeric(10,2) check (penalty >= 0),
  decided_by     uuid references public.people(id),
  decided_at     timestamptz,
  close_note     text,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  check (coalesce(length(trim(text)), 0) > 0 or coalesce(length(trim(heard_text)), 0) > 0 or cardinality(photo_paths) > 0),
  check (state <> 'closed' or (decided_by is not null and found_true is not null))
);
create index if not exists complaints_mess_state on public.complaints (mess_id, state, due_at);

create table if not exists public.day_closings (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  site_id         uuid not null references public.sites(id),
  mess_id         uuid not null references public.messes(id),
  service_date    date not null,
  state           public.day_state not null default 'open',
  counts          jsonb,
  present_count   integer check (present_count >= 0),       -- from HR's attendance (or entered by the supervisor with the reason)
  present_source  text,
  owner_remarks   text check (length(owner_remarks) <= 1000),
  submitted_by    uuid references public.people(id),
  submitted_at    timestamptz,
  locked_by       uuid references public.people(id),
  locked_at       timestamptz,
  unique (mess_id, service_date),
  check (state <> 'locked' or (locked_by is not null and counts is not null))
);

-- A change to a locked day: asked by the supervisor with the reason, applied only when the Site Admin says yes.
create table if not exists public.day_corrections (
  id             uuid primary key default gen_random_uuid(),
  day_closing_id uuid not null references public.day_closings(id),
  order_line_id  uuid not null references public.order_lines(id),
  before         jsonb not null,
  after          jsonb not null,
  reason         text not null check (length(trim(reason)) between 3 and 500),
  asked_by       uuid not null references public.people(id),
  asked_at       timestamptz not null default now(),
  decided_by     uuid references public.people(id),
  decided_at     timestamptz,
  approved       boolean,
  check (decided_by is null or decided_by <> asked_by)
);

-- ── a locked day cannot change – except through an approved correction ───────────────────────────────────────────────────
create or replace function public.day_is_locked(p_mess uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.day_closings where mess_id = p_mess and service_date = p_date and state = 'locked')
$$;

create or replace function public.guard_locked_day() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m uuid; d date;
begin
  if tg_table_name = 'order_lines' then
    select o.mess_id, o.service_date into m, d from public.orders o where o.id = coalesce(new.order_id, old.order_id);
  else
    select o.mess_id, o.service_date into m, d from public.order_lines l join public.orders o on o.id = l.order_id
     where l.id = coalesce(new.order_line_id, old.order_line_id);
  end if;
  if public.day_is_locked(m, d) and coalesce(current_setting('falcon.correcting', true), '') <> 'on' then
    raise exception 'This day is closed and locked – ask a correction.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists order_lines_locked on public.order_lines;
create trigger order_lines_locked before insert or update or delete on public.order_lines for each row execute function public.guard_locked_day();
drop trigger if exists confirmations_locked on public.confirmations;
create trigger confirmations_locked before insert or update or delete on public.confirmations for each row execute function public.guard_locked_day();

-- ── complaints ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The answer time: the setting complaint.reply_minutes {"serious": …, "normal": …} of the day; until it is set, 60 and 360.
create or replace function public.reply_minutes(p_company uuid, p_serious boolean) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value ->> case when p_serious then 'serious' else 'normal' end)::integer from public.settings
                   where company_id = p_company and site_id is null and key = 'complaint.reply_minutes'
                     and public.local_today() >= valid_from and (valid_to is null or public.local_today() <= valid_to)),
                  case when p_serious then 60 else 360 end)
$$;

create or replace function public.raise_complaint(p_mess uuid, p_category public.complaint_category, p_text text default null,
  p_heard text default null, p_photos text[] default '{}', p_voice text default null, p_order uuid default null,
  p_people integer default 1, p_serious boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.me(); m public.messes; s public.sites; c public.complaints; ser boolean;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into m from public.messes where id = p_mess and company_id = public.my_company();
  if not found then raise exception 'This mess is not open to you.' using errcode = '42501'; end if;
  if p_order is not null and not exists (select 1 from public.order_lines where order_id = p_order and person_id = me)
     and not exists (select 1 from public.orders where id = p_order and requested_by = me) then
    raise exception 'You can complain only about your own order.' using errcode = '42501';
  end if;
  select * into s from public.sites where id = m.site_id;
  ser := coalesce(p_serious, false) or p_category = 'cleanliness';
  insert into public.complaints (code, company_id, site_id, mess_id, order_id, raised_by, category, serious, people_count, text,
                                 heard_text, voice_path, photo_paths, due_at)
  values (public.next_code('complaint:' || s.id, 'CP-' || s.code || '-'), m.company_id, m.site_id, m.id, p_order, me, p_category, ser,
          greatest(coalesce(p_people, 1), 1), p_text, p_heard, p_voice, coalesce(p_photos, '{}'),
          now() + make_interval(mins => public.reply_minutes(m.company_id, ser)))
  returning * into c;
  return jsonb_build_object('id', c.id, 'code', c.code, 'due_at', c.due_at, 'serious', c.serious);
end $$;

create or replace function public.reply_complaint(p_id uuid, p_reply text, p_action text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.complaints;
begin
  select * into c from public.complaints where id = p_id for update;
  if not found or not public.works_at_mess(c.mess_id) then raise exception 'Only this mess''s owner replies.' using errcode = '42501'; end if;
  if c.state = 'closed' then raise exception 'This complaint is closed.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reply, ''))) = 0 then raise exception 'Write the reply.' using errcode = '22023'; end if;
  update public.complaints set owner_reply = p_reply, owner_action = p_action, replied_by = public.me(), replied_at = now(),
    state = 'answered' where id = c.id;
end $$;

-- The person who complained: solved, or not yet (it opens again).
create or replace function public.complaint_solved(p_id uuid, p_solved boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.complaints;
begin
  select * into c from public.complaints where id = p_id for update;
  if not found or c.raised_by <> public.me() then raise exception 'Only the one who complained says it is solved.' using errcode = '42501'; end if;
  if c.state <> 'answered' then raise exception 'Wait for the mess''s reply.' using errcode = '22023'; end if;
  update public.complaints set state = case when p_solved then 'person_confirmed' else 'open' end::public.complaint_state,
    close_note = coalesce(p_note, close_note) where id = c.id;
end $$;

-- The supervisor (or the Site Admin) decides: found true or not, the penalty of the work order – and closes it. Closed only after
-- the person said it is solved; otherwise only with the note why (e.g. he did not answer).
create or replace function public.decide_complaint(p_id uuid, p_found_true boolean, p_penalty numeric default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.complaints;
begin
  select * into c from public.complaints where id = p_id for update;
  if not found or not public.has_role(array['mess_supervisor', 'site_admin']::public.app_role[], c.site_id) then
    raise exception 'Only the site''s supervisor or Site Admin decides.' using errcode = '42501';
  end if;
  if c.state = 'closed' then raise exception 'This complaint is closed.' using errcode = '22023'; end if;
  if c.state = 'open' then raise exception 'Wait for the mess''s reply.' using errcode = '22023'; end if;
  if c.state <> 'person_confirmed' and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'The person has not said it is solved – write why it is closed.' using errcode = '22023';
  end if;
  if not p_found_true and coalesce(p_penalty, 0) > 0 then raise exception 'No penalty when it was not true.' using errcode = '22023'; end if;
  update public.complaints set found_true = p_found_true, penalty = case when p_found_true then p_penalty end, decided_by = public.me(),
    decided_at = now(), close_note = coalesce(p_note, close_note), state = 'closed', closed_at = now() where id = c.id;
end $$;

-- ── the owner's follow-up: delivered or served, not confirmed ────────────────────────────────────────────────────────────
create or replace function public.followups(p_mess uuid, p_from date default null, p_to date default null)
returns table (order_line_id uuid, order_id uuid, order_code text, service_date date, meal public.meal, person_id uuid, full_name text,
               mobile text, state public.line_state, delivered_qty integer)
language sql stable security definer set search_path = '' as $$
  select l.id, o.id, o.code, l.service_date, l.meal, p.id, p.full_name, p.mobile, l.state, l.delivered_qty
  from public.order_lines l join public.orders o on o.id = l.order_id join public.people p on p.id = l.person_id
  where o.mess_id = p_mess and l.state in ('served', 'delivered', 'short')
    and not exists (select 1 from public.confirmations c where c.order_line_id = l.id)
    and l.service_date between coalesce(p_from, public.local_today() - 7) and coalesce(p_to, public.local_today())
    and (public.works_at_mess(p_mess) or public.has_role(array['mess_supervisor', 'site_admin']::public.app_role[], o.site_id))
  order by l.service_date, o.code
$$;

-- ── the day ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.day_counts(p_mess uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with l as (select l.*, o.kind, o.state as ostate, o.guest_visit_id, o.accepted_at
             from public.order_lines l join public.orders o on o.id = l.order_id
             where o.mess_id = p_mess and l.service_date = p_date),
       c as (select c.kind, l.meal from public.confirmations c join l on l.id = c.order_line_id)
  select jsonb_build_object(
    'requested',  (select count(*) from l where is_meal),
    'accepted',   (select count(*) from l where is_meal and accepted_at is not null and ostate not in ('refused')),
    'prepared',   (select count(*) from l where is_meal and ostate in ('ready', 'dispatched', 'delivered')),
    'delivered',  (select count(*) from l where is_meal and state in ('served', 'delivered', 'short')),
    'confirmed',  (select count(*) from c),
    'by_kind',    (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from c group by kind) k),
    'by_meal',    (select coalesce(jsonb_object_agg(meal, n), '{}') from (select meal, count(*) n from l where is_meal and state in ('served', 'delivered', 'short') group by meal) k),
    'guests',     (select count(*) from l where is_meal and guest_visit_id is not null and state in ('served', 'delivered', 'short')),
    'parcels',    (select count(*) from l where is_meal and kind in ('parcel', 'delivery') and state in ('delivered', 'short')),
    'cancelled',  (select count(*) from l where is_meal and state = 'cancelled'),
    'failed',     (select count(*) from l where state = 'failed'),
    'short',      (select coalesce(sum(short_qty), 0) from l where state = 'short'),
    'not_confirmed', (select count(*) from l where state in ('served', 'delivered', 'short') and not exists (select 1 from public.confirmations x where x.order_line_id = l.id)),
    'complaints', (select count(*) from public.complaints k where k.mess_id = p_mess and k.created_at::date = p_date))
  where public.works_at_mess(p_mess, array['mess_owner', 'mess_operator']::public.app_role[])
     or exists (select 1 from public.messes m where m.id = p_mess and public.has_role(array['mess_supervisor', 'site_admin', 'accounts', 'management', 'system_admin']::public.app_role[], m.site_id))
$$;

create or replace function public.open_day(p_mess uuid, p_date date) returns public.day_closings
language plpgsql security definer set search_path = '' as $$
declare d public.day_closings; m public.messes;
begin
  select * into d from public.day_closings where mess_id = p_mess and service_date = p_date for update;
  if found then return d; end if;
  select * into m from public.messes where id = p_mess;
  insert into public.day_closings (company_id, site_id, mess_id, service_date) values (m.company_id, m.site_id, m.id, p_date)
  on conflict (mess_id, service_date) do nothing;
  select * into d from public.day_closings where mess_id = p_mess and service_date = p_date for update;
  return d;
end $$;

-- The mess owner sends the day with his remarks.
create or replace function public.submit_day(p_mess uuid, p_date date, p_remarks text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.day_closings;
begin
  if not public.works_at_mess(p_mess) then raise exception 'Only this mess''s owner sends its day.' using errcode = '42501'; end if;
  d := public.open_day(p_mess, p_date);
  if d.state = 'locked' then raise exception 'This day is locked already.' using errcode = '22023'; end if;
  update public.day_closings set state = 'submitted', owner_remarks = p_remarks, submitted_by = public.me(), submitted_at = now(),
    counts = public.day_counts(p_mess, p_date) where id = d.id;
end $$;

-- The number present that day (from HR's attendance by the server, or by the supervisor with the reason).
create or replace function public.set_present(p_mess uuid, p_date date, p_count integer, p_source text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.day_closings; m public.messes;
begin
  select * into m from public.messes where id = p_mess;
  if not public.has_role(array['mess_supervisor', 'site_admin']::public.app_role[], m.site_id) then
    raise exception 'Only the site''s supervisor enters it.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_source, ''))) = 0 then raise exception 'Say where the number comes from.' using errcode = '22023'; end if;
  d := public.open_day(p_mess, p_date);
  if d.state = 'locked' then raise exception 'This day is locked already.' using errcode = '22023'; end if;
  update public.day_closings set present_count = p_count, present_source = p_source where id = d.id;
end $$;

-- The supervisor checks and locks the day: what is locked is what is billed.
create or replace function public.lock_day(p_mess uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.day_closings; m public.messes;
begin
  select * into m from public.messes where id = p_mess;
  if not public.has_role(array['mess_supervisor']::public.app_role[], m.site_id) then
    raise exception 'Only the site''s supervisor locks a day.' using errcode = '42501';
  end if;
  if p_date >= public.local_today() then raise exception 'A day is locked after it is over.' using errcode = '22023'; end if;
  d := public.open_day(p_mess, p_date);
  if d.state = 'locked' then raise exception 'This day is locked already.' using errcode = '22023'; end if;
  if exists (select 1 from public.order_lines l join public.orders o on o.id = l.order_id
             where o.mess_id = p_mess and l.service_date = p_date and l.state = 'open' and o.state not in ('cancelled', 'refused')) then
    raise exception 'Some orders of this day are still open – deliver, fail or cancel them first.' using errcode = '22023';
  end if;
  update public.day_closings set state = 'locked', locked_by = public.me(), locked_at = now(), counts = public.day_counts(p_mess, p_date)
  where id = d.id;
end $$;

create or replace function public.ask_correction(p_line uuid, p_state public.line_state, p_qty integer, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.order_lines; o public.orders; d public.day_closings; id_ uuid;
begin
  select * into l from public.order_lines where id = p_line;
  select * into o from public.orders where id = l.order_id;
  if not public.has_role(array['mess_supervisor']::public.app_role[], o.site_id) then
    raise exception 'Only the site''s supervisor asks a correction.' using errcode = '42501';
  end if;
  select * into d from public.day_closings where mess_id = o.mess_id and service_date = l.service_date and state = 'locked';
  if not found then raise exception 'The day is not locked – change it in the day itself.' using errcode = '22023'; end if;
  insert into public.day_corrections (day_closing_id, order_line_id, before, after, reason, asked_by)
  values (d.id, l.id, jsonb_build_object('state', l.state, 'delivered_qty', l.delivered_qty),
          jsonb_build_object('state', p_state, 'delivered_qty', p_qty), p_reason, public.me())
  returning id into id_;
  return id_;
end $$;

create or replace function public.decide_correction(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.day_corrections; d public.day_closings;
begin
  select * into k from public.day_corrections where id = p_id for update;
  select * into d from public.day_closings where id = k.day_closing_id;
  if not found or not public.has_role(array['site_admin']::public.app_role[], d.site_id) then
    raise exception 'Only the Site Admin decides a correction.' using errcode = '42501';
  end if;
  if k.decided_at is not null then raise exception 'It was decided already.' using errcode = '22023'; end if;
  if k.asked_by = public.me() then raise exception 'Nobody decides his own correction.' using errcode = '42501'; end if;
  update public.day_corrections set decided_by = public.me(), decided_at = now(), approved = p_ok where id = k.id;
  if p_ok then
    perform set_config('falcon.correcting', 'on', true);
    update public.order_lines set state = (k.after ->> 'state')::public.line_state, delivered_qty = (k.after ->> 'delivered_qty')::integer
    where id = k.order_line_id;
    update public.day_closings set counts = public.day_counts(d.mess_id, d.service_date) where id = d.id;
    perform set_config('falcon.correcting', 'off', true);
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['complaints', 'day_closings', 'day_corrections'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

-- ── Row Level Security ───────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.complaints      enable row level security;
alter table public.day_closings    enable row level security;
alter table public.day_corrections enable row level security;

drop policy if exists complaints_read on public.complaints;
create policy complaints_read on public.complaints for select to authenticated using (
  raised_by = public.me()
  or (company_id = public.my_company() and (
        public.works_at_mess(mess_id)
        or public.has_role(array['site_admin', 'mess_supervisor']::public.app_role[], site_id)
        or public.has_role(array['management', 'system_admin']::public.app_role[]))));

drop policy if exists day_closings_read on public.day_closings;
create policy day_closings_read on public.day_closings for select to authenticated using (
  company_id = public.my_company() and (
    public.works_at_mess(mess_id, array['mess_owner', 'mess_operator']::public.app_role[])
    or public.has_role(array['site_admin', 'mess_supervisor']::public.app_role[], site_id)
    or public.has_role(array['accounts', 'management', 'system_admin']::public.app_role[])));

drop policy if exists day_corrections_read on public.day_corrections;
create policy day_corrections_read on public.day_corrections for select to authenticated using (
  exists (select 1 from public.day_closings d where d.id = day_closing_id));

revoke all on public.complaints, public.day_closings, public.day_corrections from anon, authenticated;
grant select on public.complaints, public.day_closings, public.day_corrections to authenticated;

revoke all on function public.day_is_locked(uuid, date), public.guard_locked_day(), public.reply_minutes(uuid, boolean),
  public.raise_complaint(uuid, public.complaint_category, text, text, text[], text, uuid, integer, boolean),
  public.reply_complaint(uuid, text, text), public.complaint_solved(uuid, boolean, text), public.decide_complaint(uuid, boolean, numeric, text),
  public.followups(uuid, date, date), public.day_counts(uuid, date), public.open_day(uuid, date), public.submit_day(uuid, date, text),
  public.set_present(uuid, date, integer, text), public.lock_day(uuid, date), public.ask_correction(uuid, public.line_state, integer, text),
  public.decide_correction(uuid, boolean) from public, anon;
grant execute on function public.day_is_locked(uuid, date),
  public.raise_complaint(uuid, public.complaint_category, text, text, text[], text, uuid, integer, boolean),
  public.reply_complaint(uuid, text, text), public.complaint_solved(uuid, boolean, text), public.decide_complaint(uuid, boolean, numeric, text),
  public.followups(uuid, date, date), public.day_counts(uuid, date), public.submit_day(uuid, date, text),
  public.set_present(uuid, date, integer, text), public.lock_day(uuid, date), public.ask_correction(uuid, public.line_state, integer, text),
  public.decide_correction(uuid, boolean) to authenticated;
