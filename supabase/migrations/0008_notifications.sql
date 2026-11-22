-- FALCON · migration 0008 · notifications: each person's own list in the app (WhatsApp / push are sent from it by the server
-- when they are switched on); the events that write them; the daily alerts. Safe to run again.

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  person_id  uuid not null references public.people(id),
  kind       text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  title      text not null check (length(title) between 1 and 160),
  body       text check (length(body) <= 600),
  link       text check (length(link) <= 200),
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  sent_at    timestamptz                                  -- sent outside the app (WhatsApp / push), by the server
);
create index if not exists notifications_person on public.notifications (person_id, created_at desc);
create index if not exists notifications_unsent on public.notifications (created_at) where sent_at is null;
-- the same daily alert is written once a day
create unique index if not exists notifications_once_a_day on public.notifications (person_id, kind, link, ((created_at at time zone 'Asia/Kolkata')::date))
  where kind like 'daily_%';

create or replace function public.notify(p_person uuid, p_kind text, p_title text, p_body text default null, p_link text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (company_id, person_id, kind, title, body, link)
  select p.company_id, p.id, p_kind, p_title, p_body, p_link from public.people p
  where p.id = p_person and p.state not in ('rejected', 'suspended')
  on conflict do nothing
$$;

-- Everybody who has one of these roles on this site today (a grant for every site counts) – optionally of one mess only.
create or replace function public.notify_roles(p_site uuid, p_roles public.app_role[], p_kind text, p_title text, p_body text default null,
  p_link text default null, p_mess uuid default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (company_id, person_id, kind, title, body, link)
  select distinct p.company_id, p.id, p_kind, p_title, p_body, p_link
  from public.role_grants g join public.people p on p.id = g.person_id
  join public.sites s on s.id = p_site and s.company_id = g.company_id
  where g.revoked_at is null and g.role = any (p_roles) and (g.site_id is null or g.site_id = p_site)
    and (p_mess is null or g.mess_id is null or g.mess_id = p_mess)
    and public.local_today() >= g.valid_from and (g.valid_to is null or public.local_today() <= g.valid_to)
    and p.state not in ('rejected', 'suspended')
  on conflict do nothing
$$;

-- ── the events ───────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.on_order_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare msg text; who uuid;
begin
  if tg_op = 'INSERT' then
    if new.host_state = 'waiting' then
      perform public.notify(v.host_id, 'guest_order', 'A guest''s order waits for your OK', new.code, '/app/orders/' || new.id)
      from public.guest_visits v where v.id = new.guest_visit_id and v.host_id is not null;
    else
      perform public.notify_roles(new.site_id, array['mess_owner', 'mess_operator']::public.app_role[], 'new_request',
        'New request ' || new.code, new.meal::text || ' · ' || new.kind::text, '/owner/requests/' || new.id, new.mess_id);
    end if;
    return new;
  end if;
  if new.host_state = 'approved' and old.host_state = 'waiting' then
    perform public.notify_roles(new.site_id, array['mess_owner', 'mess_operator']::public.app_role[], 'new_request',
      'New request ' || new.code, 'guest · ' || new.meal::text, '/owner/requests/' || new.id, new.mess_id);
  end if;
  if new.state is distinct from old.state then
    msg := case new.state when 'accepted' then 'Accepted' when 'refused' then 'Refused – ' || coalesce(new.refused_reason, '')
                          when 'ready' then 'Ready' when 'dispatched' then 'On the way' when 'delivered' then 'Delivered'
                          when 'failed' then 'Could not be delivered' end;
    if msg is not null then
      for who in select distinct x from (select new.requested_by x union select l.person_id from public.order_lines l where l.order_id = new.id) y loop
        perform public.notify(who, 'order_' || new.state::text, new.code || ' · ' || msg, null, '/app/orders/' || new.id);
      end loop;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_notify on public.orders;
create trigger orders_notify after insert or update on public.orders for each row execute function public.on_order_change();

create or replace function public.on_batch_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'assigned' and new.driver_id is not null and (tg_op = 'INSERT' or old.state is distinct from 'assigned' or old.driver_id is distinct from new.driver_id) then
    perform public.notify(new.driver_id, 'batch_assigned', 'New delivery ' || new.code, new.meal::text, '/driver/assignments/' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.state = 'draft' and old.state = 'assigned' then
    perform public.notify_roles(new.site_id, array['mess_owner', 'mess_operator']::public.app_role[], 'batch_refused',
      'The driver said no to ' || new.code, new.refused_reason, '/owner/batches/' || new.id || '/driver', new.mess_id);
  end if;
  return new;
end $$;
drop trigger if exists batches_notify on public.batches;
create trigger batches_notify after insert or update on public.batches for each row execute function public.on_batch_change();

create or replace function public.on_complaint_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify_roles(new.site_id, array['mess_owner']::public.app_role[], 'complaint',
      case when new.serious then 'Serious complaint ' else 'Complaint ' end || new.code, new.category::text, '/owner/complaints', new.mess_id);
    if new.serious then
      perform public.notify_roles(new.site_id, array['site_admin', 'mess_supervisor']::public.app_role[], 'complaint_serious',
        'Serious complaint ' || new.code, new.category::text, '/admin/complaints');
    end if;
  elsif new.state = 'answered' and old.state <> 'answered' then
    perform public.notify(new.raised_by, 'complaint_answered', new.code || ' · the mess replied', new.owner_reply, '/app/complaints/' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists complaints_notify on public.complaints;
create trigger complaints_notify after insert or update on public.complaints for each row execute function public.on_complaint_change();

-- "New Site User Registered — HR Employee Record Not Found" (his words) to the Site Admin; and the person told of each decision.
create or replace function public.on_registration_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n text;
begin
  select full_name into n from public.people where id = new.person_id;
  if tg_op = 'INSERT' and new.hr_result <> 'found' then
    perform public.notify_roles(new.site_id, array['site_admin']::public.app_role[], 'registration_not_found',
      'New Site User Registered — HR Employee Record Not Found', n || coalesce(' · typed ' || new.typed_rcl_id, ''), '/admin/registrations');
  elsif tg_op = 'INSERT' then
    perform public.notify_roles(new.site_id, array['site_admin']::public.app_role[], 'registration_check',
      'New site user registered – please check', n, '/admin/registrations');
  elsif new.info_asked is distinct from old.info_asked and new.info_asked is not null then
    perform public.notify(new.person_id, 'registration_info', 'The Site Admin asks', new.info_asked, '/start/temporary');
  elsif new.last_action is distinct from old.last_action or new.decided_at is distinct from old.decided_at then
    perform public.notify(new.person_id, 'registration_decided', 'Your registration: ' || replace(new.last_action, '_', ' '), new.reason, '/app');
  end if;
  return new;
end $$;
drop trigger if exists registrations_notify on public.registrations;
create trigger registrations_notify after insert or update on public.registrations for each row execute function public.on_registration_change();

create or replace function public.on_bill_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare roles public.app_role[];
begin
  if new.state is distinct from old.state then
    roles := case new.state when 'checked' then array['site_admin'] when 'site_admin_ok' then array['accounts']
                            when 'accounts_ok' then array['management'] when 'management_ok' then array['accounts']
                            when 'sent_back' then array['accounts', 'site_admin'] end::public.app_role[];
    if roles is not null then
      perform public.notify_roles(new.site_id, roles, 'bill_waiting', new.code || ' waits for you', new.state::text, '/admin/approvals');
    end if;
    if new.state = 'paid' then
      perform public.notify_roles(new.site_id, array['mess_owner']::public.app_role[], 'bill_paid', new.code || ' is paid', null, '/owner/billing', new.mess_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists monthly_bills_notify on public.monthly_bills;
create trigger monthly_bills_notify after update on public.monthly_bills for each row execute function public.on_bill_change();

-- ── once a day (the scheduler calls it with the service role) ────────────────────────────────────────────────────────────
create or replace function public.daily_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0; t date := public.local_today();
begin
  -- temporary access ending in 2 days
  for r in select * from public.people where state = 'temporary' and temporary_until between t and t + 2 loop
    perform public.notify(r.id, 'daily_temporary', 'Your temporary access ends on ' || to_char(r.temporary_until, 'DD Mon'), null, '/start/temporary');
    if r.home_site_id is not null then
      perform public.notify_roles(r.home_site_id, array['site_admin']::public.app_role[], 'daily_temporary',
        r.full_name || '''s temporary access ends on ' || to_char(r.temporary_until, 'DD Mon'), null, '/admin/registrations');
    end if;
    n := n + 1;
  end loop;
  -- a contractor's paper ending in 60, 30 or 7 days, or today
  for r in select d.*, c.name, m.site_id, m.id mess_id from public.contractor_documents d join public.contractors c on c.id = d.contractor_id
           join public.messes m on m.contractor_id = c.id
           where d.state <> 'rejected' and d.valid_to - t in (60, 30, 7, 0) loop
    perform public.notify_roles(r.site_id, array['site_admin', 'accounts', 'mess_owner']::public.app_role[], 'daily_document',
      r.name || ': ' || r.kind::text || case when r.valid_to = t then ' ends today' else ' ends in ' || (r.valid_to - t) || ' days' end,
      r.number, '/admin/contractors/' || r.contractor_id || '/documents', r.mess_id);
    n := n + 1;
  end loop;
  -- yesterday not locked
  for r in select m.* from public.messes m where m.active
           and exists (select 1 from public.orders o where o.mess_id = m.id and o.service_date = t - 1)
           and not public.day_is_locked(m.id, t - 1) loop
    perform public.notify_roles(r.site_id, array['mess_supervisor', 'site_admin']::public.app_role[], 'daily_closing',
      r.name || ': yesterday is not closed', null, '/admin/consumption');
    n := n + 1;
  end loop;
  -- complaints past their answer time
  for r in select * from public.complaints where state = 'open' and due_at < now() loop
    perform public.notify_roles(r.site_id, array['site_admin']::public.app_role[], 'daily_complaint_late', r.code || ' is not answered', null, '/admin/complaints');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.mark_read(p_id uuid default null) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where person_id = public.me() and read_at is null and (p_id is null or id = p_id)
$$;

alter table public.notifications enable row level security;
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (person_id = public.me());

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
revoke all on function public.notify(uuid, text, text, text, text), public.notify_roles(uuid, public.app_role[], text, text, text, text, uuid),
  public.on_order_change(), public.on_batch_change(), public.on_complaint_change(), public.on_registration_change(), public.on_bill_change(),
  public.daily_alerts(), public.mark_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_read(uuid) to authenticated;
grant execute on function public.daily_alerts() to service_role;
