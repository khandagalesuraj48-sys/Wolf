-- FALCON · migration 0014 · the company code first, a contractor's own code, limits on codes and look-ups, the work order's BOQ
-- (his decisions of 23-11-2026: "I work for RCL as nko … ERP sarkhe banau – company code takaych … mag employee code (RCL000) … tyachi
-- details … ani OTP"; "rate limit law nahi tr employee ughach OTP pathwat basel"; "owner … tyala pn ek code asel … admin contractor add
-- krel ani tyacha company code tharwel – toch code ala tr tyachya company cha owner aala"; "work contract madhe BOQ perfect – item wise
-- ani rate, name disawa"; his answers: the full details before the code (mobile masked), "I am a guest" under the employee code, the
-- mobiles the Admin gave for the contractor – owner and operators – may sign in, the BOQ = item, unit, quantity, rate, amount, total).
--   * contractors.login_code – set by the System Admin only (office_contractor_code); one code in all of FALCON: never the same as a
--     company's code or another contractor's.
--   * server_door – what a code typed on the first screen is: a company or a contractor (the server only; no list is ever shown).
--   * server_contractor_mobile – is this mobile given for this contractor (a live Mess owner / operator role at one of its messes)?
--   * start_hits + server_hit – limits: how often one mobile gets a code, how often one place (internet address) looks up codes.
--     Only a fingerprint (sha-256) of the mobile / address is kept, for one day.
--   * work_order_boq – the BOQ of a work order, item by item: the quantity (the rate stays the dated, approved rate of `rates`).
-- Safe to run again; it deletes no data.

-- ── a contractor's own sign-in code ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.contractors add column if not exists login_code text;
do $$ begin
  alter table public.contractors add constraint contractors_login_code_form check (login_code ~ '^[A-Z0-9]{2,12}$');
exception when duplicate_object then null; end $$;
create unique index if not exists contractors_one_login_code on public.contractors (login_code) where login_code is not null;

-- the code is set only through office_contractor_code (the System Admin, with the audit line) – never by a plain change of the row
create or replace function public.contractor_code_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.login_code is distinct from (case when tg_op = 'UPDATE' then old.login_code else null end)
     and coalesce(current_setting('falcon.contractor_code', true), '') <> 'on' then
    raise exception 'The sign-in code is set by the System Admin (Contractors → Sign-in code).' using errcode = '42501';
  end if;
  if new.login_code is not null and exists (select 1 from public.companies c where c.code = new.login_code) then
    raise exception 'The code % is a company''s code – choose another.', new.login_code using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists contractors_code_guard on public.contractors;
create trigger contractors_code_guard before insert or update of login_code on public.contractors
  for each row execute function public.contractor_code_guard();

-- a company's code never takes a contractor's
create or replace function public.company_code_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.contractors k where k.login_code = new.code) then
    raise exception 'The code % is a contractor''s sign-in code – choose another.', new.code using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists companies_code_guard on public.companies;
create trigger companies_code_guard before insert or update of code on public.companies
  for each row execute function public.company_code_guard();

create or replace function public.office_contractor_code(p_contractor uuid, p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare k public.contractors; c text := nullif(upper(trim(coalesce(p_code, ''))), '');
begin
  select * into k from public.contractors where id = p_contractor and company_id = public.my_company();
  if not found then raise exception 'Contractor not found.' using errcode = '42501'; end if;
  if not public.has_role(array['system_admin']::public.app_role[]) then
    raise exception 'Only the System Admin sets a contractor''s sign-in code.' using errcode = '42501';
  end if;
  if c is not null and c !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'The code has 2 to 12 letters and numbers only.' using errcode = '22023';
  end if;
  if c is not null and exists (select 1 from public.contractors x where x.login_code = c and x.id <> k.id) then
    raise exception 'The code % is taken – choose another.', c using errcode = '23505';
  end if;
  perform set_config('falcon.contractor_code', 'on', true);
  update public.contractors set login_code = c where id = k.id;
  perform set_config('falcon.contractor_code', '', true);
  insert into public.audit_log (company_id, actor, action, entity, entity_id, before, after)
  values (k.company_id, public.me(), 'contractor_code', 'contractors', k.id::text,
          jsonb_build_object('login_code', k.login_code), jsonb_build_object('login_code', c));
  return c;
end $$;

-- ── the first screen: what is this code? ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.server_door(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('kind', 'company', 'code', c.code, 'name', c.name, 'company', c.code, 'company_name', c.name)
       from public.companies c where c.code = upper(trim(p_code)) and c.active),
    (select jsonb_build_object('kind', 'contractor', 'code', k.login_code, 'name', k.name, 'company', c.code, 'company_name', c.name)
       from public.contractors k join public.companies c on c.id = k.company_id
      where k.login_code = upper(trim(p_code)) and k.active and c.active))
$$;

-- Is this mobile given for this contractor: a live Mess owner / operator role at one of its messes (People and roles)?
create or replace function public.server_contractor_mobile(p_code text, p_mobile text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('person', p.id, 'name', p.full_name,
           'role', case when bool_or(g.role = 'mess_owner') then 'mess_owner' else 'mess_operator' end)
  from public.contractors k
  join public.messes m on m.contractor_id = k.id
  join public.role_grants g on g.mess_id = m.id and g.revoked_at is null and g.role in ('mess_owner', 'mess_operator')
       and g.valid_from <= public.local_today() and (g.valid_to is null or g.valid_to >= public.local_today())
  join public.people p on p.id = g.person_id
  where k.login_code = upper(trim(p_code)) and k.active and p.mobile = p_mobile and p.state not in ('rejected', 'suspended')
  group by p.id, p.full_name
  limit 1
$$;

-- ── limits: codes to one mobile, look-ups from one place ────────────────────────────────────────────────────────────────────
create table if not exists public.start_hits (
  what     text not null check (what in ('door', 'lookup', 'otp')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  at       timestamptz not null default now()
);
create index if not exists start_hits_key on public.start_hits (what, key_hash, at);
alter table public.start_hits enable row level security;                  -- no rule: only the server
revoke all on public.start_hits from anon, authenticated;

-- p_limits: [{"n": 5, "secs": 3600}, …] – "at most n in secs". Allowed: the hit is counted, {"ok": true}. Not allowed: nothing is
-- counted, {"ok": false, "wait": seconds until the next is allowed}. Fingerprints older than one day are dropped.
create or replace function public.server_hit(p_what text, p_key text, p_limits jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h text := encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex'); l jsonb; n int; secs int; cnt int; oldest timestamptz;
        wait_ int := 0;
begin
  delete from public.start_hits where what = p_what and at < now() - interval '1 day';
  for l in select * from jsonb_array_elements(coalesce(p_limits, '[]'::jsonb)) loop
    n := greatest(1, (l ->> 'n')::int); secs := least(86400, greatest(1, (l ->> 'secs')::int));
    select count(*), min(at) into cnt, oldest from (
      select at from public.start_hits where what = p_what and key_hash = h and at > now() - make_interval(secs => secs)
      order by at desc limit n) x;
    if cnt >= n then
      wait_ := greatest(wait_, ceil(extract(epoch from (oldest + make_interval(secs => secs) - now())))::int);
    end if;
  end loop;
  if wait_ > 0 then return jsonb_build_object('ok', false, 'wait', wait_); end if;
  insert into public.start_hits (what, key_hash) values (p_what, h);
  return jsonb_build_object('ok', true);
end $$;

-- ── the work order's BOQ, item by item ──────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.work_order_boq (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id),
  item_id       uuid not null references public.items(id),
  qty           numeric(14,2) not null check (qty >= 0),
  note          text check (length(note) <= 200),
  set_by        uuid references public.people(id),
  set_at        timestamptz not null default now(),
  unique (work_order_id, item_id)
);
alter table public.work_order_boq enable row level security;
revoke all on public.work_order_boq from anon, authenticated;
grant select on public.work_order_boq to authenticated;
drop policy if exists work_order_boq_read on public.work_order_boq;
create policy work_order_boq_read on public.work_order_boq for select to authenticated using (
  exists (select 1 from public.work_orders w where w.id = work_order_id));          -- whoever may see the work order

-- Accounts / the System Admin set a line's quantity (0 = not in the BOQ); every change is in the audit log with before and after.
create or replace function public.office_boq_set(p_work_order uuid, p_item uuid, p_qty numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare w public.work_orders; b public.work_order_boq; r public.work_order_boq;
begin
  select * into w from public.work_orders where id = p_work_order and company_id = public.my_company();
  if not found then raise exception 'Work order not found.' using errcode = '42501'; end if;
  if not public.has_role(array['system_admin', 'accounts']::public.app_role[]) then
    raise exception 'Only Accounts or the System Admin set the BOQ.' using errcode = '42501';
  end if;
  if p_qty is null or p_qty < 0 then raise exception 'The quantity is 0 or more.' using errcode = '22023'; end if;
  if not exists (select 1 from public.items i where i.id = p_item and i.company_id = w.company_id) then
    raise exception 'Item not found.' using errcode = '22023';
  end if;
  select * into b from public.work_order_boq where work_order_id = w.id and item_id = p_item;
  insert into public.work_order_boq (work_order_id, item_id, qty, note, set_by)
  values (w.id, p_item, p_qty, nullif(trim(coalesce(p_note, '')), ''), public.me())
  on conflict (work_order_id, item_id) do update set qty = excluded.qty, note = excluded.note, set_by = excluded.set_by, set_at = now()
  returning * into r;
  insert into public.audit_log (company_id, site_id, actor, action, entity, entity_id, before, after)
  values (w.company_id, w.site_id, public.me(), 'boq_set', 'work_order_boq', r.id::text,
          case when b.id is null then null else jsonb_build_object('qty', b.qty, 'note', b.note) end,
          jsonb_build_object('work_order', w.number, 'item', p_item, 'qty', r.qty, 'note', r.note));
  return r.id;
end $$;

revoke all on function public.contractor_code_guard(), public.company_code_guard() from public, anon, authenticated;
revoke all on function public.office_contractor_code(uuid, text), public.office_boq_set(uuid, uuid, numeric, text),
  public.server_door(text), public.server_contractor_mobile(text, text), public.server_hit(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.office_contractor_code(uuid, text), public.office_boq_set(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.server_door(text), public.server_contractor_mobile(text, text), public.server_hit(text, text, jsonb) to service_role;
