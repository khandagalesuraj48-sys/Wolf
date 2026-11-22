-- FALCON – Food & Site Operations · Sketchline Industries
-- MASTER DATABASE SCRIPT · built from supabase/migrations/ by supabase/build_master.sh – do not edit by hand.
--
-- Run it ONCE on the FALCON Supabase project (SQL Editor → New query → paste → Run). It is safe to run again: every
-- table, type, function, rule and policy is made only if it is missing, or replaced with the same definition. It deletes
-- no data. It runs in ONE transaction: if any statement fails, nothing of it stays.
-- After it: supabase/seed/seed.sql (the company and the items), once.
--
-- Execution order (each part as in its file):
--   0001_foundation.sql
--   0002_mess_and_contracts.sql
--   0003_orders.sql
--   0004_delivery.sql
--   0005_complaints_and_closing.sql
--   0006_billing.sql
--   0007_registration.sql
--   0008_notifications.sql
--   0009_storage.sql
--   0010_realtime.sql
--   0011_app_helpers.sql
--   0012_admin.sql
--   0013_hr_people.sql
--
-- Needs on Supabase: the extensions schema (always there) – btree_gist and pgcrypto are created in it by part 0001.

begin;
set local client_min_messages = warning;

-- ═════════════════════════════════════════════════════════════════════════ 0001_foundation.sql
-- FALCON · migration 0001 · the foundation: companies, sites, circles and sections; people (employees and guests), their roles,
-- their phones; dated settings; the audit log; the helpers every rule of Row Level Security uses.
-- Safe to run again: every object is made only when it is not there.

-- Supabase keeps extensions in the schema "extensions" (pgcrypto is already there); FALCON uses the same place.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- India: a day and its clock times are the site's (meal windows, today's orders).
create or replace function public.local_now() returns timestamp language sql stable as $$ select now() at time zone 'Asia/Kolkata' $$;
create or replace function public.local_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ── kinds ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.app_role as enum ('employee', 'guest', 'mess_owner', 'mess_operator', 'mess_supervisor', 'driver',
    'site_admin', 'accounts', 'management', 'system_admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.person_kind as enum ('employee', 'guest', 'contractor_staff');   -- contractor_staff: a mess owner, operator or
                                                                                    -- driver who is not on RCL's roll
exception when duplicate_object then null; end $$;

-- The states of docs/PERMISSIONS.md → Registration states.
do $$ begin
  create type public.person_state as enum ('mobile_pending', 'whatsapp_verified', 'id_found', 'id_not_found', 'new_registration',
    'pending_verification', 'temporary', 'verified', 'id_assigned', 'linked', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;

-- ── where ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z0-9]{2,12}$'),
  name       text not null check (length(trim(name)) between 2 and 120),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sites (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code       text not null check (code ~ '^[A-Z0-9-]{2,16}$'),
  name       text not null check (length(trim(name)) between 2 and 120),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id)
);

create table if not exists public.circles (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites(id),
  code       text not null check (code ~ '^[A-Z0-9-]{1,12}$'),
  name       text not null check (length(trim(name)) between 1 and 80),
  km_from    numeric(9,3),
  km_to      numeric(9,3),
  active     boolean not null default true,
  unique (site_id, code),
  unique (id, site_id),
  check (km_from is null or km_to is null or km_to > km_from)
);

create table if not exists public.sections (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null,
  circle_id  uuid not null,
  code       text not null check (code ~ '^[A-Z0-9-]{1,12}$'),
  name       text not null check (length(trim(name)) between 1 and 80),
  km         numeric(9,3),
  place      text,
  lat        numeric(9,6) check (lat between -90 and 90),
  lng        numeric(9,6) check (lng between -180 and 180),
  active     boolean not null default true,
  unique (site_id, code),
  unique (id, site_id),
  -- a section belongs to a circle of the SAME site
  foreign key (circle_id, site_id) references public.circles(id, site_id)
);

-- ── who ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- One row a person – an employee or a guest – for ever. The mobile is unique in a company, so a guest can never get a second
-- profile; an RCL ID can be linked to one person only, so a link never makes a duplicate.
create sequence if not exists public.guest_code_seq;

create table if not exists public.people (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  kind               public.person_kind not null,
  auth_user_id       uuid unique references auth.users(id),
  portal_user        text unique check (portal_user = lower(portal_user)),   -- the LION Portal's user ID (his ticket's "sub")
  full_name          text not null check (length(trim(full_name)) between 2 and 120),
  mobile             text check (mobile ~ '^\+[1-9][0-9]{7,14}$'),
  mobile_verified_at timestamptz,
  rcl_id             text check (rcl_id ~ '^[A-Z0-9-]{2,20}$'),               -- given by HR only, never made here
  hr_ref             text,                                                     -- HR's own key of his record, when linked
  state              public.person_state not null default 'mobile_pending',
  state_reason       text,
  temporary_until    date,
  home_site_id       uuid,
  home_section_id    uuid,
  work_role          text check (length(work_role) <= 80),
  works_with         text check (length(works_with) <= 120),                   -- a contractor not on RCL's roll
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, mobile),
  unique (id, company_id),
  foreign key (home_site_id, company_id) references public.sites(id, company_id),
  foreign key (home_section_id, home_site_id) references public.sections(id, site_id),
  check (kind = 'employee' or rcl_id is null),
  check (state <> 'temporary' or temporary_until is not null),
  check (state not in ('rejected', 'suspended') or length(trim(coalesce(state_reason, ''))) > 0),
  check (mobile_verified_at is null or mobile is not null)
);
create unique index if not exists people_one_rcl_id on public.people (company_id, rcl_id) where rcl_id is not null;

create table if not exists public.guest_profiles (
  person_id    uuid primary key references public.people(id),
  guest_code   text not null unique default ('GST-' || lpad(nextval('public.guest_code_seq')::text, 4, '0')),
  organisation text check (length(organisation) <= 120),
  designation  text check (length(designation) <= 80)
);

-- Who may do what, where: a role on one site, or on every site of the company when site_id is empty. Dated; taken away by
-- revoking (the row stays).
create table if not exists public.role_grants (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null,
  company_id  uuid not null,
  site_id     uuid,
  role        public.app_role not null,
  valid_from  date not null default public.local_today(),
  valid_to    date,
  granted_by  uuid references public.people(id),
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references public.people(id),
  reason      text,
  foreign key (person_id, company_id) references public.people(id, company_id),
  foreign key (site_id, company_id) references public.sites(id, company_id),
  check (valid_to is null or valid_to >= valid_from),
  check (revoked_at is null or revoked_by is not null),
  check (role not in ('employee', 'guest'))      -- those come from the person's own kind and state, not from a grant
);
create unique index if not exists role_grants_one_live on public.role_grants
  (person_id, role, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;

-- A phone that has been used: only a fingerprint of its token is kept. It SUGGESTS who is there – a code is still asked
-- on a new phone, after 30 days, or when anything is doubtful.
create table if not exists public.devices (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people(id),
  device_hash  text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  label        text check (length(label) <= 80),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  last_code_at timestamptz,
  unique (person_id, device_hash)
);

-- Settings with dates (meal windows, cut-off times, scorecard weights, GST / TDS …): a new value is a new row from a date; a day
-- is always read with the value of that day. Two values of one setting never overlap.
create table if not exists public.settings (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  site_id    uuid,
  key        text not null check (key ~ '^[a-z][a-z0-9_.]{2,60}$'),
  value      jsonb not null,
  valid_from date not null,
  valid_to   date,
  note       text,
  set_by     uuid references public.people(id),
  set_at     timestamptz not null default now(),
  foreign key (site_id, company_id) references public.sites(id, company_id),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (company_id with =, (coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =, key with =,
                      daterange(valid_from, valid_to, '[]') with &&)
);

-- Every change, with who, when, before and after. Nobody changes or deletes a line – not even the owner of the database by
-- mistake: the trigger below refuses it.
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  company_id uuid,
  site_id    uuid,
  actor      uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  how        text,
  reason     text
);
create index if not exists audit_log_entity on public.audit_log (entity, entity_id);
create index if not exists audit_log_site_at on public.audit_log (site_id, at desc);

create or replace function public.audit_log_is_kept() returns trigger language plpgsql as $$
begin
  raise exception 'The audit log is kept as it is – a line is never changed or deleted.' using errcode = 'P0001';
end $$;
drop trigger if exists audit_log_kept on public.audit_log;
create trigger audit_log_kept before update or delete on public.audit_log
  for each row execute function public.audit_log_is_kept();
drop trigger if exists audit_log_kept_truncate on public.audit_log;
create trigger audit_log_kept_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_is_kept();

-- ── the helpers of every rule ────────────────────────────────────────────────────────────────────────────────────────────
-- The person signed in now – nobody when he is rejected or suspended, so every rule then shows him nothing.
create or replace function public.me() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.people p
  where p.auth_user_id = auth.uid() and p.state not in ('rejected', 'suspended')
    and (p.state <> 'temporary' or p.temporary_until >= public.local_today())
$$;

create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.company_id from public.people p where p.id = public.me()
$$;

-- Has the person signed in now one of these roles – on this site (a grant for every site counts too), today?
create or replace function public.has_role(roles public.app_role[], site uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_grants g
    where g.person_id = public.me() and g.revoked_at is null and g.role = any (roles)
      and public.local_today() >= g.valid_from and (g.valid_to is null or public.local_today() <= g.valid_to)
      and (site is null or g.site_id is null or g.site_id = site))
$$;

-- Is this site one of the company of the person signed in now?
create or replace function public.in_my_company(site uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sites s where s.id = site and s.company_id = public.my_company())
$$;

-- One line of the audit log, written by FALCON's own functions.
create or replace function public.audit_write(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb,
  p_site uuid default null, p_how text default null, p_reason text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (company_id, site_id, actor, action, entity, entity_id, before, after, how, reason)
  values (coalesce(public.my_company(), (select s.company_id from public.sites s where s.id = p_site)), p_site, public.me(),
          p_action, p_entity, p_entity_id, p_before, p_after, p_how, p_reason)
$$;

-- The same for any table: every insert, change and delete of a guarded table is written down by itself.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  a jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(a, b);
begin
  if tg_op = 'UPDATE' and b = a then return new; end if;
  insert into public.audit_log (company_id, site_id, actor, action, entity, entity_id, before, after, how)
  values (coalesce((r ->> 'company_id')::uuid, public.my_company()),
          coalesce((r ->> 'site_id')::uuid, (r ->> 'home_site_id')::uuid), public.me(),
          lower(tg_op), tg_table_name, coalesce(r ->> 'id', r ->> 'person_id'), b, a, 'database');
  return coalesce(new, old);
end $$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['companies', 'sites', 'circles', 'sections', 'people', 'guest_profiles', 'role_grants', 'settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;
drop trigger if exists people_touch on public.people;
create trigger people_touch before update on public.people for each row execute function public.touch_updated_at();

-- ── Row Level Security: nothing is seen or changed unless a rule below says so ───────────────────────────────────────────
alter table public.companies      enable row level security;
alter table public.sites          enable row level security;
alter table public.circles        enable row level security;
alter table public.sections       enable row level security;
alter table public.people         enable row level security;
alter table public.guest_profiles enable row level security;
alter table public.role_grants    enable row level security;
alter table public.devices        enable row level security;
alter table public.settings       enable row level security;
alter table public.audit_log      enable row level security;

-- Reading. Changes to these tables come only through FALCON's checked functions (and the System Admin's below).
drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies for select to authenticated using (id = public.my_company());

drop policy if exists sites_read on public.sites;
create policy sites_read on public.sites for select to authenticated using (company_id = public.my_company());

drop policy if exists circles_read on public.circles;
create policy circles_read on public.circles for select to authenticated using (public.in_my_company(site_id));

drop policy if exists sections_read on public.sections;
create policy sections_read on public.sections for select to authenticated using (public.in_my_company(site_id));

-- A person sees himself; the site's office (Site Admin, Supervisor) and the company's (System Admin, Management, Accounts) see
-- the people of their sites. The mess owner and the driver see names only through their own orders (later migrations).
drop policy if exists people_read on public.people;
create policy people_read on public.people for select to authenticated using (
  id = public.me()
  or (company_id = public.my_company() and public.has_role(
        array['site_admin', 'mess_supervisor', 'system_admin', 'management', 'accounts']::public.app_role[], home_site_id)));

drop policy if exists guest_profiles_read on public.guest_profiles;
create policy guest_profiles_read on public.guest_profiles for select to authenticated using (
  exists (select 1 from public.people p where p.id = person_id));        -- whoever may see the person (rule above)

drop policy if exists role_grants_read on public.role_grants;
create policy role_grants_read on public.role_grants for select to authenticated using (
  person_id = public.me()
  or (company_id = public.my_company() and public.has_role(array['system_admin']::public.app_role[]))
  or (company_id = public.my_company() and site_id is not null and public.has_role(array['site_admin']::public.app_role[], site_id)));

drop policy if exists devices_read on public.devices;
create policy devices_read on public.devices for select to authenticated using (person_id = public.me());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (company_id = public.my_company());

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (
  company_id = public.my_company()
  and (public.has_role(array['system_admin', 'management']::public.app_role[])
       or (site_id is not null and public.has_role(array['site_admin']::public.app_role[], site_id))));

-- The System Admin keeps the places (sites, circles, sections) of his company.
drop policy if exists sites_admin on public.sites;
create policy sites_admin on public.sites for all to authenticated
  using (company_id = public.my_company() and public.has_role(array['system_admin']::public.app_role[]))
  with check (company_id = public.my_company() and public.has_role(array['system_admin']::public.app_role[]));

drop policy if exists circles_admin on public.circles;
create policy circles_admin on public.circles for all to authenticated
  using (public.in_my_company(site_id) and public.has_role(array['system_admin']::public.app_role[]))
  with check (public.in_my_company(site_id) and public.has_role(array['system_admin']::public.app_role[]));

drop policy if exists sections_admin on public.sections;
create policy sections_admin on public.sections for all to authenticated
  using (public.in_my_company(site_id) and public.has_role(array['system_admin', 'site_admin']::public.app_role[], site_id))
  with check (public.in_my_company(site_id) and public.has_role(array['system_admin', 'site_admin']::public.app_role[], site_id));

-- ── what the API roles may touch at all (RLS still decides the rows) ─────────────────────────────────────────────────────
revoke all on public.companies, public.sites, public.circles, public.sections, public.people, public.guest_profiles,
  public.role_grants, public.devices, public.settings, public.audit_log from anon;
revoke all on public.companies, public.sites, public.circles, public.sections, public.people, public.guest_profiles,
  public.role_grants, public.devices, public.settings, public.audit_log from authenticated;
grant select on public.companies, public.people, public.guest_profiles, public.role_grants, public.devices, public.settings,
  public.audit_log to authenticated;
grant select, insert, update on public.sites, public.circles, public.sections to authenticated;
revoke all on sequence public.guest_code_seq from anon, authenticated;

revoke all on function public.me(), public.my_company(), public.has_role(public.app_role[], uuid), public.in_my_company(uuid),
  public.audit_write(text, text, text, jsonb, jsonb, uuid, text, text), public.audit_row(), public.audit_log_is_kept(),
  public.touch_updated_at() from public, anon;
grant execute on function public.me(), public.my_company(), public.has_role(public.app_role[], uuid), public.in_my_company(uuid)
  to authenticated;

-- ═════════════════════════════════════════════════════════════════════════ 0002_mess_and_contracts.sql
-- FALCON · migration 0002 · the messes and their contractors: contractor master (bank details apart), documents, messes, the
-- things a mess sells, work orders, rates with dates, penalties, GST / TDS rules with dates, meal windows and menus.
-- Safe to run again.

do $$ begin create type public.meal as enum ('breakfast', 'lunch', 'snacks', 'dinner');
exception when duplicate_object then null; end $$;
do $$ begin create type public.item_kind as enum ('meal', 'extra', 'service');
exception when duplicate_object then null; end $$;
do $$ begin create type public.firm_kind as enum ('proprietor', 'partnership', 'llp', 'company', 'other');
exception when duplicate_object then null; end $$;
do $$ begin create type public.doc_kind as enum ('fssai', 'gst', 'pan', 'udyam', 'shop_act', 'work_order', 'agreement', 'bank_proof',
  'medical_fitness', 'pest_control', 'other');
exception when duplicate_object then null; end $$;
do $$ begin create type public.doc_state as enum ('asked', 'attached', 'verified', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin create type public.wo_state as enum ('draft', 'active', 'closed');
exception when duplicate_object then null; end $$;
do $$ begin create type public.rate_state as enum ('waiting', 'approved', 'refused');
exception when duplicate_object then null; end $$;
do $$ begin create type public.tax_kind as enum ('gst', 'tds');
exception when duplicate_object then null; end $$;

-- ── contractors ──────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.contractors (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  name           text not null check (length(trim(name)) between 2 and 160),
  kind           public.firm_kind not null,
  contact_name   text check (length(contact_name) <= 120),
  contact_mobile text check (contact_mobile ~ '^\+[1-9][0-9]{7,14}$'),
  gstin          text check (gstin ~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$'),
  pan            text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  udyam          text check (length(udyam) <= 40),
  address        text check (length(address) <= 400),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (id, company_id)
);
create unique index if not exists contractors_one_gstin on public.contractors (company_id, gstin) where gstin is not null;

-- The bank details stay in their own table: only Accounts, the System Admin and the contractor's own mess owner read them.
create table if not exists public.contractor_bank (
  contractor_id uuid primary key references public.contractors(id),
  bank_name     text not null check (length(bank_name) <= 120),
  ifsc          text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  account_no    text not null check (account_no ~ '^[0-9]{6,20}$'),
  verified_by   uuid references public.people(id),
  verified_at   timestamptz,
  updated_at    timestamptz not null default now()
);

create table if not exists public.contractor_documents (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id),
  kind          public.doc_kind not null,
  title         text check (length(title) <= 120),
  number        text check (length(number) <= 60),
  valid_from    date,
  valid_to      date,
  file_path     text,                                   -- in the private bucket "contractor-papers"
  state         public.doc_state not null default 'attached',
  asked_at      timestamptz,
  verified_by   uuid references public.people(id),
  verified_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check (state <> 'verified' or (verified_by is not null and verified_at is not null)),
  check (state = 'asked' or file_path is not null)
);
create index if not exists contractor_documents_ending on public.contractor_documents (valid_to) where state <> 'rejected';

-- ── messes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.messes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  site_id       uuid not null,
  name          text not null check (length(trim(name)) between 2 and 120),
  contractor_id uuid,
  lat           numeric(9,6) check (lat between -90 and 90),
  lng           numeric(9,6) check (lng between -180 and 180),
  radius_m      integer check (radius_m between 10 and 5000),
  counters      integer check (counters between 1 and 50),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (site_id, name),
  unique (id, site_id),
  foreign key (site_id, company_id) references public.sites(id, company_id),
  foreign key (contractor_id, company_id) references public.contractors(id, company_id)
);

-- A mess owner or operator works for one mess: his grant names it.
alter table public.role_grants add column if not exists mess_id uuid references public.messes(id);
do $$ begin
  alter table public.role_grants add constraint role_grants_mess_for_kitchen
    check ((role in ('mess_owner', 'mess_operator')) = (mess_id is not null));
exception when duplicate_object then null; end $$;

-- What a mess sells (the lines of a bill).
create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code       text not null check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name       text not null check (length(trim(name)) between 2 and 80),
  kind       public.item_kind not null,
  meal       public.meal,
  unit       text not null default 'each' check (length(unit) <= 20),
  active     boolean not null default true,
  unique (company_id, code),
  check ((kind = 'meal') = (meal is not null))
);

-- ── work orders, rates, penalties ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.work_orders (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null,
  site_id              uuid not null,
  mess_id              uuid not null,
  contractor_id        uuid not null,
  number               text not null check (length(trim(number)) between 2 and 40),
  valid_from           date not null,
  valid_to             date not null,
  payment_days         integer not null check (payment_days between 0 and 180),
  advance_amount       numeric(14,2) not null default 0 check (advance_amount >= 0),
  advance_recovery_pct numeric(5,2) not null default 0 check (advance_recovery_pct between 0 and 100),
  security_deposit     numeric(14,2) not null default 0 check (security_deposit >= 0),
  retention_pct        numeric(5,2) not null default 0 check (retention_pct between 0 and 100),
  state                public.wo_state not null default 'draft',
  created_by           uuid references public.people(id),
  created_at           timestamptz not null default now(),
  unique (company_id, number),
  foreign key (site_id, company_id) references public.sites(id, company_id),
  foreign key (mess_id, site_id) references public.messes(id, site_id),
  foreign key (contractor_id, company_id) references public.contractors(id, company_id),
  check (valid_to >= valid_from),
  -- one live work order a mess on any day
  exclude using gist (mess_id with =, daterange(valid_from, valid_to, '[]') with &&) where (state = 'active')
);

create table if not exists public.rates (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id),
  item_id       uuid not null references public.items(id),
  rate          numeric(10,2) not null check (rate >= 0),
  valid_from    date not null,
  valid_to      date,
  state         public.rate_state not null default 'waiting',
  asked_by      uuid references public.people(id),
  asked_at      timestamptz not null default now(),
  decided_by    uuid references public.people(id),
  decided_at    timestamptz,
  reason        text,
  check (valid_to is null or valid_to >= valid_from),
  check (state = 'waiting' or (decided_by is not null and decided_at is not null)),
  check (state <> 'refused' or length(trim(coalesce(reason, ''))) > 0),
  check (decided_by is null or asked_by is null or decided_by <> asked_by),       -- nobody approves his own rate
  -- one approved rate an item on any day; the old ones are kept with their dates
  exclude using gist (work_order_id with =, item_id with =, daterange(valid_from, valid_to, '[]') with &&) where (state = 'approved')
);

create table if not exists public.penalty_rules (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id),
  code          text not null check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  what          text not null check (length(trim(what)) between 3 and 200),
  amount        numeric(10,2) check (amount >= 0),                 -- empty = no money (e.g. "bill on hold")
  per           text not null check (per in ('batch', 'case', 'day', 'month')),
  valid_from    date not null,
  valid_to      date,
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (work_order_id with =, code with =, daterange(valid_from, valid_to, '[]') with &&)
);

-- GST / TDS: never assumed – a rule with its dates, the section and the CA's check, kept by Accounts.
create table if not exists public.tax_rules (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  tax           public.tax_kind not null,
  applies_to    text not null check (applies_to ~ '^[a-z][a-z0-9_]{1,40}$'),   -- e.g. mess_services, proprietor, company
  section       text check (length(section) <= 20),                           -- e.g. 194C
  rate          numeric(6,3) not null check (rate between 0 and 100),
  valid_from    date not null,
  valid_to      date,
  checked_by_ca boolean not null default false,
  ca_note       text,
  set_by        uuid references public.people(id),
  set_at        timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (company_id with =, tax with =, applies_to with =, daterange(valid_from, valid_to, '[]') with &&)
);

-- ── meal windows and menus ───────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meal_windows (
  id             uuid primary key default gen_random_uuid(),
  mess_id        uuid not null references public.messes(id),
  meal           public.meal not null,
  serve_from     time not null,
  serve_to       time not null,
  order_by       time not null,                       -- a parcel / delivery must be asked by this time
  change_minutes integer not null default 0 check (change_minutes between 0 and 240),
  valid_from     date not null,
  valid_to       date,
  check (serve_to > serve_from),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (mess_id with =, meal with =, daterange(valid_from, valid_to, '[]') with &&)
);

create table if not exists public.menus (
  id           uuid primary key default gen_random_uuid(),
  mess_id      uuid not null references public.messes(id),
  service_date date not null,
  meal         public.meal not null,
  dishes       text[] not null check (cardinality(dishes) between 1 and 20),
  note         text check (length(note) <= 300),
  published_by uuid references public.people(id),
  published_at timestamptz not null default now(),
  unique (mess_id, service_date, meal)
);

-- ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Is the person signed in now the owner (or, when allowed, an operator) of this mess, today?
create or replace function public.works_at_mess(m uuid, roles public.app_role[] default array['mess_owner']::public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_grants g
    where g.person_id = public.me() and g.revoked_at is null and g.mess_id = m and g.role = any (roles)
      and public.local_today() >= g.valid_from and (g.valid_to is null or public.local_today() <= g.valid_to))
$$;

-- Is the person signed in now the owner of a mess run by this contractor?
create or replace function public.owns_contractor(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.messes m where m.contractor_id = c and public.works_at_mess(m.id))
$$;

create or replace function public.site_of_work_order(w uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select site_id from public.work_orders where id = w $$;

create or replace function public.mess_of_work_order(w uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select mess_id from public.work_orders where id = w $$;

-- Accounts / the System Admin decide a waiting rate – never the one who asked it. Approving it ends the rate in force before it
-- on the day before (the old one is kept with its dates); refusing needs the reason. Nothing else can change a rate.
create or replace function public.decide_rate(p_rate uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.rates; w public.work_orders;
begin
  select * into r from public.rates where id = p_rate for update;
  if not found then raise exception 'This rate is not there.' using errcode = 'P0002'; end if;
  select * into w from public.work_orders where id = r.work_order_id;
  if w.company_id is distinct from public.my_company() or not public.has_role(array['accounts', 'system_admin']::public.app_role[]) then
    raise exception 'Only Accounts or the System Admin decide a rate.' using errcode = '42501';
  end if;
  if r.state <> 'waiting' then raise exception 'This rate was decided already.' using errcode = 'P0001'; end if;
  if r.asked_by = public.me() then raise exception 'Nobody decides the rate he asked.' using errcode = '42501'; end if;
  if p_approve then
    update public.rates set valid_to = r.valid_from - 1
     where work_order_id = r.work_order_id and item_id = r.item_id and state = 'approved'
       and valid_from < r.valid_from and (valid_to is null or valid_to >= r.valid_from);
    update public.rates set state = 'approved', decided_by = public.me(), decided_at = now(), reason = p_reason where id = p_rate;
  else
    if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Refusing a rate needs the reason.' using errcode = '22023'; end if;
    update public.rates set state = 'refused', decided_by = public.me(), decided_at = now(), reason = p_reason where id = p_rate;
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['contractors', 'contractor_bank', 'contractor_documents', 'messes', 'items', 'work_orders', 'rates',
                           'penalty_rules', 'tax_rules', 'meal_windows', 'menus'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

-- ── Row Level Security ───────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.contractors          enable row level security;
alter table public.contractor_bank      enable row level security;
alter table public.contractor_documents enable row level security;
alter table public.messes               enable row level security;
alter table public.items                enable row level security;
alter table public.work_orders          enable row level security;
alter table public.rates                enable row level security;
alter table public.penalty_rules        enable row level security;
alter table public.tax_rules            enable row level security;
alter table public.meal_windows         enable row level security;
alter table public.menus                enable row level security;

-- Contractors and their papers: the office (never an employee or a guest – no contractor's money or papers for them) and the
-- contractor's own mess owner.
drop policy if exists contractors_read on public.contractors;
create policy contractors_read on public.contractors for select to authenticated using (
  company_id = public.my_company() and (
    public.has_role(array['site_admin', 'mess_supervisor', 'accounts', 'management', 'system_admin']::public.app_role[])
    or public.owns_contractor(id)));
drop policy if exists contractors_write on public.contractors;
create policy contractors_write on public.contractors for all to authenticated
  using (company_id = public.my_company() and public.has_role(array['system_admin', 'accounts']::public.app_role[]))
  with check (company_id = public.my_company() and public.has_role(array['system_admin', 'accounts']::public.app_role[]));

drop policy if exists contractor_bank_read on public.contractor_bank;
create policy contractor_bank_read on public.contractor_bank for select to authenticated using (
  exists (select 1 from public.contractors c where c.id = contractor_id and c.company_id = public.my_company())
  and (public.has_role(array['accounts', 'system_admin']::public.app_role[]) or public.owns_contractor(contractor_id)));
drop policy if exists contractor_bank_write on public.contractor_bank;
create policy contractor_bank_write on public.contractor_bank for all to authenticated
  using (exists (select 1 from public.contractors c where c.id = contractor_id and c.company_id = public.my_company())
         and public.has_role(array['accounts', 'system_admin']::public.app_role[]))
  with check (exists (select 1 from public.contractors c where c.id = contractor_id and c.company_id = public.my_company())
              and public.has_role(array['accounts', 'system_admin']::public.app_role[]));

drop policy if exists contractor_documents_read on public.contractor_documents;
create policy contractor_documents_read on public.contractor_documents for select to authenticated using (
  exists (select 1 from public.contractors c where c.id = contractor_id));          -- whoever may see the contractor
drop policy if exists contractor_documents_add on public.contractor_documents;
create policy contractor_documents_add on public.contractor_documents for insert to authenticated with check (
  exists (select 1 from public.contractors c where c.id = contractor_id and c.company_id = public.my_company())
  and state in ('asked', 'attached')
  and (public.has_role(array['site_admin', 'accounts', 'system_admin']::public.app_role[]) or public.owns_contractor(contractor_id)));
drop policy if exists contractor_documents_check on public.contractor_documents;
create policy contractor_documents_check on public.contractor_documents for update to authenticated
  using (exists (select 1 from public.contractors c where c.id = contractor_id and c.company_id = public.my_company())
         and public.has_role(array['site_admin', 'accounts', 'system_admin']::public.app_role[]))
  with check (state <> 'verified' or verified_by = public.me());

-- Messes, the things sold, windows and menus: everybody of the company may read them.
drop policy if exists messes_read on public.messes;
create policy messes_read on public.messes for select to authenticated using (company_id = public.my_company());
drop policy if exists messes_write on public.messes;
create policy messes_write on public.messes for all to authenticated
  using (company_id = public.my_company() and public.has_role(array['system_admin', 'site_admin']::public.app_role[], site_id))
  with check (company_id = public.my_company() and public.has_role(array['system_admin', 'site_admin']::public.app_role[], site_id));

drop policy if exists items_read on public.items;
create policy items_read on public.items for select to authenticated using (company_id = public.my_company());
drop policy if exists items_write on public.items;
create policy items_write on public.items for all to authenticated
  using (company_id = public.my_company() and public.has_role(array['system_admin']::public.app_role[]))
  with check (company_id = public.my_company() and public.has_role(array['system_admin']::public.app_role[]));

drop policy if exists meal_windows_read on public.meal_windows;
create policy meal_windows_read on public.meal_windows for select to authenticated using (
  exists (select 1 from public.messes m where m.id = mess_id));
drop policy if exists meal_windows_write on public.meal_windows;
create policy meal_windows_write on public.meal_windows for all to authenticated
  using (exists (select 1 from public.messes m where m.id = mess_id and m.company_id = public.my_company()
                 and public.has_role(array['system_admin', 'site_admin']::public.app_role[], m.site_id)))
  with check (exists (select 1 from public.messes m where m.id = mess_id and m.company_id = public.my_company()
                      and public.has_role(array['system_admin', 'site_admin']::public.app_role[], m.site_id)));

drop policy if exists menus_read on public.menus;
create policy menus_read on public.menus for select to authenticated using (exists (select 1 from public.messes m where m.id = mess_id));
drop policy if exists menus_publish on public.menus;
create policy menus_publish on public.menus for all to authenticated
  using (public.works_at_mess(mess_id, array['mess_owner', 'mess_operator']::public.app_role[])
         or exists (select 1 from public.messes m where m.id = mess_id and m.company_id = public.my_company()
                    and public.has_role(array['site_admin']::public.app_role[], m.site_id)))
  with check (published_by = public.me() and (
         public.works_at_mess(mess_id, array['mess_owner', 'mess_operator']::public.app_role[])
         or exists (select 1 from public.messes m where m.id = mess_id and m.company_id = public.my_company()
                    and public.has_role(array['site_admin']::public.app_role[], m.site_id))));

-- Work orders, rates and penalties: contractor money – the office of that site and the company, and the mess's own owner.
drop policy if exists work_orders_read on public.work_orders;
create policy work_orders_read on public.work_orders for select to authenticated using (
  company_id = public.my_company() and (
    public.has_role(array['site_admin']::public.app_role[], site_id)
    or public.has_role(array['accounts', 'management', 'system_admin']::public.app_role[])
    or public.works_at_mess(mess_id)));
drop policy if exists work_orders_write on public.work_orders;
create policy work_orders_write on public.work_orders for all to authenticated
  using (company_id = public.my_company() and public.has_role(array['system_admin', 'accounts']::public.app_role[]))
  with check (company_id = public.my_company() and public.has_role(array['system_admin', 'accounts']::public.app_role[]));

drop policy if exists rates_read on public.rates;
create policy rates_read on public.rates for select to authenticated using (
  exists (select 1 from public.work_orders w where w.id = work_order_id));          -- whoever may see the work order
-- A new rate is asked (waiting) by the office or by the mess owner; only Accounts / the System Admin decide it – never the one
-- who asked (the table's own rule).
drop policy if exists rates_ask on public.rates;
create policy rates_ask on public.rates for insert to authenticated with check (
  state = 'waiting' and asked_by = public.me() and exists (select 1 from public.work_orders w where w.id = work_order_id)
  and (public.has_role(array['system_admin', 'accounts']::public.app_role[])
       or public.works_at_mess(public.mess_of_work_order(work_order_id))));
drop policy if exists rates_decide on public.rates;      -- (decisions only through decide_rate below)

drop policy if exists penalty_rules_read on public.penalty_rules;
create policy penalty_rules_read on public.penalty_rules for select to authenticated using (
  exists (select 1 from public.work_orders w where w.id = work_order_id));
drop policy if exists penalty_rules_write on public.penalty_rules;
create policy penalty_rules_write on public.penalty_rules for all to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.company_id = public.my_company())
         and public.has_role(array['system_admin', 'accounts']::public.app_role[]))
  with check (exists (select 1 from public.work_orders w where w.id = work_order_id and w.company_id = public.my_company())
              and public.has_role(array['system_admin', 'accounts']::public.app_role[]));

-- Tax rules: read by the money people; set only by Accounts.
drop policy if exists tax_rules_read on public.tax_rules;
create policy tax_rules_read on public.tax_rules for select to authenticated using (
  company_id = public.my_company() and public.has_role(array['accounts', 'management', 'system_admin', 'site_admin']::public.app_role[]));
drop policy if exists tax_rules_write on public.tax_rules;
create policy tax_rules_write on public.tax_rules for all to authenticated
  using (company_id = public.my_company() and public.has_role(array['accounts']::public.app_role[]))
  with check (company_id = public.my_company() and set_by = public.me() and public.has_role(array['accounts']::public.app_role[]));

-- ── what the API roles may touch (RLS still decides the rows; nothing is deleted through the API) ────────────────────────
revoke all on public.contractors, public.contractor_bank, public.contractor_documents, public.messes, public.items,
  public.work_orders, public.rates, public.penalty_rules, public.tax_rules, public.meal_windows, public.menus from anon, authenticated;
grant select, insert, update on public.contractors, public.contractor_bank, public.contractor_documents, public.messes, public.items,
  public.work_orders, public.penalty_rules, public.tax_rules, public.meal_windows, public.menus to authenticated;
grant select, insert on public.rates to authenticated;
revoke all on function public.works_at_mess(uuid, public.app_role[]), public.owns_contractor(uuid), public.site_of_work_order(uuid),
  public.mess_of_work_order(uuid), public.decide_rate(uuid, boolean, text) from public, anon;
grant execute on function public.decide_rate(uuid, boolean, text) to authenticated;
grant execute on function public.works_at_mess(uuid, public.app_role[]), public.owns_contractor(uuid), public.site_of_work_order(uuid),
  public.mess_of_work_order(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════ 0003_orders.sql
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

-- ═════════════════════════════════════════════════════════════════════════ 0004_delivery.sql
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

-- ═════════════════════════════════════════════════════════════════════════ 0005_complaints_and_closing.sql
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

-- ═════════════════════════════════════════════════════════════════════════ 0006_billing.sql
-- FALCON · migration 0006 · billing: the month's bill from verified consumption only (confirmed lines of locked days) × the rate
-- of each day; GST and TDS from Accounts' dated rules (never assumed); retention, advance recovery, penalties; the contractor's
-- invoice checked against it line by line; Site Admin → Accounts → Management → ERP posting → payment, each by a different
-- person. Safe to run again.

do $$ begin create type public.bill_state as enum ('draft', 'invoice_uploaded', 'checked', 'site_admin_ok', 'accounts_ok',
  'management_ok', 'posted', 'paid', 'sent_back', 'on_hold');
exception when duplicate_object then null; end $$;

create table if not exists public.monthly_bills (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  company_id       uuid not null references public.companies(id),
  site_id          uuid not null references public.sites(id),
  mess_id          uuid not null references public.messes(id),
  work_order_id    uuid not null references public.work_orders(id),
  month            date not null check (extract(day from month) = 1),
  state            public.bill_state not null default 'draft',
  held_at_state    public.bill_state,
  lines            jsonb not null default '[]',        -- [{item, name, qty, amount, rates:[{rate, qty}]}]
  not_billable     jsonb not null default '{}',        -- why some lines are not billed (not confirmed, failed, cancelled …)
  taxable          numeric(14,2) not null default 0,
  gst_rate         numeric(6,3),
  gst_amount       numeric(14,2) not null default 0,
  tds_section      text,
  tds_rate         numeric(6,3),
  tds_amount       numeric(14,2) not null default 0,
  retention        numeric(14,2) not null default 0,
  advance_recovery numeric(14,2) not null default 0,
  penalties        numeric(14,2) not null default 0,
  penalty_lines    jsonb not null default '[]',
  net_payable      numeric(14,2) not null default 0,
  invoice_number   text,
  invoice_path     text,
  invoice_amount   numeric(14,2),
  invoice_lines    jsonb,                              -- [{item, qty, rate}] as on the contractor's invoice
  recon            jsonb,                              -- the check of the invoice against the system, line by line
  erp_ref          text,
  built_by         uuid references public.people(id),
  built_at         timestamptz,
  unique (work_order_id, month)
);

create table if not exists public.bill_steps (
  id       uuid primary key default gen_random_uuid(),
  bill_id  uuid not null references public.monthly_bills(id),
  step     text not null check (step in ('site_admin', 'accounts', 'management', 'posting')),
  decision text not null check (decision in ('approve', 'send_back', 'hold')),
  by_person uuid not null references public.people(id),
  at       timestamptz not null default now(),
  reason   text,
  check (decision = 'approve' or length(trim(coalesce(reason, ''))) > 0)
);

create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid not null unique references public.monthly_bills(id),
  amount     numeric(14,2) not null check (amount > 0),
  utr        text not null check (utr ~ '^[A-Za-z0-9]{6,30}$'),
  paid_on    date not null,
  entered_by uuid not null references public.people(id),
  entered_at timestamptz not null default now()
);

-- ── building the bill ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.rate_on(p_wo uuid, p_item uuid, p_day date) returns numeric
language sql stable security definer set search_path = '' as $$
  select rate from public.rates where work_order_id = p_wo and item_id = p_item and state = 'approved'
    and p_day >= valid_from and (valid_to is null or p_day <= valid_to)
$$;

create or replace function public.setting_int(p_company uuid, p_key text, p_day date, p_default integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::integer from public.settings where company_id = p_company and site_id is null and key = p_key
                   and p_day >= valid_from and (valid_to is null or p_day <= valid_to)), p_default)
$$;

create or replace function public.build_bill(p_wo uuid, p_month date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w public.work_orders; k public.contractors; s public.sites; b public.monthly_bills; m_from date; m_to date;
  r record; v_lines jsonb := '[]'; v_taxable numeric := 0; missing text; open_days text; gst public.tax_rules; tds public.tax_rules;
  adv numeric; adv_done numeric; pen numeric := 0; pen_lines jsonb := '[]'; late_min integer; late_n integer; late_rule public.penalty_rules;
  nb jsonb; guest_item uuid; pack_item uuid;
begin
  select * into w from public.work_orders where id = p_wo;
  if not found or w.company_id <> public.my_company()
     or not (public.has_role(array['accounts']::public.app_role[]) or public.has_role(array['site_admin']::public.app_role[], w.site_id)) then
    raise exception 'Only Accounts or the Site Admin makes a bill.' using errcode = '42501';
  end if;
  m_from := date_trunc('month', p_month)::date;
  m_to := (m_from + interval '1 month' - interval '1 day')::date;
  if m_to >= public.local_today() then raise exception 'A month is billed after it is over.' using errcode = '22023'; end if;
  select * into b from public.monthly_bills where work_order_id = w.id and month = m_from for update;
  if found and b.state not in ('draft', 'invoice_uploaded', 'checked', 'sent_back') then
    raise exception 'This bill is with its approvals – it cannot be made again.' using errcode = '22023';
  end if;
  -- every day of the month with an order must be closed and locked
  select string_agg(distinct to_char(l.service_date, 'DD Mon'), ', ') into open_days
  from public.order_lines l join public.orders o on o.id = l.order_id
  where o.mess_id = w.mess_id and l.service_date between greatest(m_from, w.valid_from) and least(m_to, w.valid_to)
    and not public.day_is_locked(w.mess_id, l.service_date);
  if open_days is not null then raise exception 'These days are not locked yet: %', open_days using errcode = '22023'; end if;
  select id into guest_item from public.items where company_id = w.company_id and code = 'guest_meal';
  select id into pack_item from public.items where company_id = w.company_id and code = 'parcel_packing';

  -- the billable units: confirmed lines of the month (a guest's meal at the guest rate; a parcel's packing on top)
  create temporary table if not exists bill_units (day date, item uuid, qty numeric) on commit drop;
  truncate bill_units;
  insert into bill_units
  select l.service_date, case when l.is_meal and o.guest_visit_id is not null then guest_item else l.item_id end,
         case when l.is_meal then 1 else least(coalesce(c.qty_received, l.delivered_qty, l.qty), coalesce(l.delivered_qty, l.qty)) end
  from public.order_lines l join public.orders o on o.id = l.order_id join public.confirmations c on c.order_line_id = l.id
  where o.mess_id = w.mess_id and l.service_date between greatest(m_from, w.valid_from) and least(m_to, w.valid_to)
    and l.state in ('served', 'delivered', 'short');
  insert into bill_units
  select l.service_date, pack_item, 1
  from public.order_lines l join public.orders o on o.id = l.order_id join public.confirmations c on c.order_line_id = l.id
  where o.mess_id = w.mess_id and l.service_date between greatest(m_from, w.valid_from) and least(m_to, w.valid_to)
    and l.is_meal and o.kind in ('parcel', 'delivery') and l.state in ('delivered', 'short');
  if exists (select 1 from bill_units where item is null) then
    raise exception 'The items "guest_meal" and "parcel_packing" must be in the item list first.' using errcode = '22023';
  end if;
  select string_agg(distinct i.name || ' on ' || to_char(u.day, 'DD Mon'), ', ') into missing
  from bill_units u join public.items i on i.id = u.item where public.rate_on(w.id, u.item, u.day) is null;
  if missing is not null then raise exception 'No approved rate for: %', missing using errcode = '22023'; end if;

  for r in select i.code, i.name, sum(u.qty) qty, sum(u.qty * public.rate_on(w.id, u.item, u.day)) amount,
                  jsonb_agg(distinct jsonb_build_object('rate', public.rate_on(w.id, u.item, u.day))) rates
           from bill_units u join public.items i on i.id = u.item group by i.code, i.name order by min(i.kind::text), i.code loop
    v_lines := v_lines || jsonb_build_object('item', r.code, 'name', r.name, 'qty', r.qty, 'amount', round(r.amount, 2), 'rates', r.rates);
    v_taxable := v_taxable + round(r.amount, 2);
  end loop;

  -- what was not billed, and why
  select jsonb_build_object(
    'not_confirmed', count(*) filter (where l.state in ('served', 'delivered', 'short') and c.id is null),
    'failed', count(*) filter (where l.state = 'failed'),
    'cancelled_after_accept', count(*) filter (where l.state = 'cancelled' and o.accepted_at is not null))
  into nb
  from public.order_lines l join public.orders o on o.id = l.order_id left join public.confirmations c on c.order_line_id = l.id
  where o.mess_id = w.mess_id and l.is_meal and l.service_date between m_from and m_to;

  -- taxes: Accounts' rules of the month's last day – never assumed
  select * into k from public.contractors where id = w.contractor_id;
  select * into gst from public.tax_rules where company_id = w.company_id and tax = 'gst' and applies_to = 'mess_services'
    and m_to >= valid_from and (valid_to is null or m_to <= valid_to);
  if not found then raise exception 'Accounts must set the GST rule (gst · mess_services) for this month first.' using errcode = '22023'; end if;
  select * into tds from public.tax_rules where company_id = w.company_id and tax = 'tds' and applies_to = k.kind::text
    and m_to >= valid_from and (valid_to is null or m_to <= valid_to);
  if not found then raise exception 'Accounts must set the TDS rule (tds · %) for this month first.', k.kind using errcode = '22023'; end if;

  -- penalties of the month: complaints found true, and late vans by the work order's rule
  select coalesce(sum(penalty), 0), coalesce(jsonb_agg(jsonb_build_object('what', 'Complaint ' || code, 'amount', penalty)) filter (where penalty > 0), '[]')
    into pen, pen_lines
  from public.complaints where mess_id = w.mess_id and found_true and penalty > 0 and decided_at::date between m_from and m_to;
  select * into late_rule from public.penalty_rules where work_order_id = w.id and code = 'late_van'
    and m_to >= valid_from and (valid_to is null or m_to <= valid_to);
  if found and late_rule.amount > 0 then
    late_min := public.setting_int(w.company_id, 'delivery.late_minutes', m_to, 30);
    select count(distinct x.id) into late_n from public.batches x join public.batch_stops t on t.batch_id = x.id
    where x.mess_id = w.mess_id and x.service_date between m_from and m_to and x.state = 'completed'
      and t.eta is not null and t.reached_at > t.eta + make_interval(mins => late_min);
    if late_n > 0 then
      pen := pen + late_n * late_rule.amount;
      pen_lines := pen_lines || jsonb_build_object('what', late_n || ' late van(s)', 'amount', late_n * late_rule.amount);
    end if;
  end if;

  -- the advance comes back month by month until it is all back
  select coalesce(sum(advance_recovery), 0) into adv_done from public.monthly_bills
   where work_order_id = w.id and month < m_from and state <> 'sent_back';
  adv := least(round(w.advance_amount * w.advance_recovery_pct / 100, 2), greatest(w.advance_amount - adv_done, 0));

  select * into s from public.sites where id = w.site_id;
  if b.id is null then
    insert into public.monthly_bills (code, company_id, site_id, mess_id, work_order_id, month)
    values ('MB-' || s.code || '-' || to_char(m_from, 'YYMM'), w.company_id, w.site_id, w.mess_id, w.id, m_from) returning * into b;
  end if;
  update public.monthly_bills set
    lines = lines_, not_billable = nb, taxable = taxable_, gst_rate = gst.rate, gst_amount = round(taxable_ * gst.rate / 100, 2),
    tds_section = tds.section, tds_rate = tds.rate, tds_amount = round(taxable_ * tds.rate / 100),
    retention = round(taxable_ * w.retention_pct / 100, 2), advance_recovery = adv, penalties = pen, penalty_lines = pen_lines,
    net_payable = taxable_ + round(taxable_ * gst.rate / 100, 2) - round(taxable_ * tds.rate / 100) - round(taxable_ * w.retention_pct / 100, 2) - adv - pen,
    state = case when b.state = 'sent_back' then 'draft' else b.state end, built_by = public.me(), built_at = now()
  from (select v_lines as lines_, v_taxable as taxable_) v
  where id = b.id;
  return b.id;
end $$;

-- The contractor's invoice: uploaded by the mess owner or Accounts, then checked line by line against the system.
create or replace function public.upload_invoice(p_bill uuid, p_number text, p_path text, p_amount numeric, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.monthly_bills;
begin
  select * into b from public.monthly_bills where id = p_bill for update;
  if not found or not (public.works_at_mess(b.mess_id) or (b.company_id = public.my_company() and public.has_role(array['accounts']::public.app_role[]))) then
    raise exception 'Only the mess owner or Accounts uploads the invoice.' using errcode = '42501';
  end if;
  if b.state not in ('draft', 'invoice_uploaded', 'checked') then raise exception 'This bill is with its approvals.' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'The invoice lines are missing.' using errcode = '22023'; end if;
  update public.monthly_bills set invoice_number = p_number, invoice_path = p_path, invoice_amount = p_amount, invoice_lines = p_lines,
    state = 'invoice_uploaded', recon = null where id = b.id;
end $$;

-- Line by line: quantity, rate and amount of the invoice against the system's – and duplicates on the invoice.
create or replace function public.check_invoice(p_bill uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.monthly_bills; rows_ jsonb; dup jsonb;
begin
  select * into b from public.monthly_bills where id = p_bill for update;
  if not found or b.company_id <> public.my_company()
     or not (public.has_role(array['accounts']::public.app_role[]) or public.has_role(array['site_admin']::public.app_role[], b.site_id)) then
    raise exception 'Only Accounts or the Site Admin checks an invoice.' using errcode = '42501';
  end if;
  if b.invoice_lines is null then raise exception 'Upload the invoice first.' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(x ->> 'item'), '[]') into dup from (
    select x from jsonb_array_elements(b.invoice_lines) x group by x ->> 'item', x having count(*) > 1) d;
  with sys as (select x ->> 'item' item, x ->> 'name' name, (x ->> 'qty')::numeric qty, (x ->> 'amount')::numeric amount,
                      ((x -> 'rates') -> 0 ->> 'rate')::numeric rate, jsonb_array_length(x -> 'rates') nrates
               from jsonb_array_elements(b.lines) x),
       inv as (select x ->> 'item' item, sum((x ->> 'qty')::numeric) qty, max((x ->> 'rate')::numeric) rate,
                      sum((x ->> 'qty')::numeric * (x ->> 'rate')::numeric) amount
               from jsonb_array_elements(b.invoice_lines) x group by x ->> 'item')
  select coalesce(jsonb_agg(jsonb_build_object('item', coalesce(sys.item, inv.item), 'name', sys.name,
           'system_qty', sys.qty, 'invoice_qty', inv.qty, 'contract_rate', case when sys.nrates = 1 then sys.rate end,
           'invoice_rate', inv.rate, 'difference', round(coalesce(inv.amount, 0) - coalesce(sys.amount, 0), 2),
           'why', case when sys.item is null then 'not in the system'
                       when inv.item is null then 'not on the invoice'
                       when inv.qty > sys.qty then 'more than served, delivered and confirmed'
                       when inv.qty < sys.qty then 'less than the system'
                       when sys.nrates = 1 and inv.rate <> sys.rate then 'rate not as the contract'
                       when round(inv.amount, 2) <> round(sys.amount, 2) then 'amount differs'
                       else 'matches' end) order by coalesce(sys.item, inv.item)), '[]')
    into rows_
  from sys full join inv on inv.item = sys.item;
  update public.monthly_bills set recon = jsonb_build_object('lines', rows_, 'duplicates', dup, 'checked_at', now(), 'checked_by', public.me()),
    state = 'checked' where id = b.id;
  return rows_;
end $$;

-- One step of the chain. Approve moves it on; send back returns it to be made again; hold stops it (approve at the same step
-- goes on). Each approval (Site Admin, Accounts, Management) by a different person; the ERP posting is a record, not an approval.
create or replace function public.bill_step(p_bill uuid, p_decision text, p_reason text default null, p_ref text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.monthly_bills; cur public.bill_state; step_ text; next_ public.bill_state;
begin
  select * into b from public.monthly_bills where id = p_bill for update;
  if not found or b.company_id <> public.my_company() then raise exception 'This bill is not open to you.' using errcode = '42501'; end if;
  cur := case when b.state = 'on_hold' then b.held_at_state else b.state end;
  step_ := case cur when 'checked' then 'site_admin' when 'site_admin_ok' then 'accounts' when 'accounts_ok' then 'management'
                    when 'management_ok' then 'posting' end;
  if step_ is null then raise exception 'This bill is not waiting for an approval.' using errcode = '22023'; end if;
  if (step_ = 'site_admin' and not public.has_role(array['site_admin']::public.app_role[], b.site_id))
     or (step_ in ('accounts', 'posting') and not public.has_role(array['accounts']::public.app_role[]))
     or (step_ = 'management' and not public.has_role(array['management']::public.app_role[])) then
    raise exception 'This step is not yours.' using errcode = '42501';
  end if;
  if p_decision = 'approve' and step_ <> 'posting' and exists (select 1 from public.bill_steps where bill_id = b.id and by_person = public.me()
                                         and decision = 'approve' and step <> 'posting'
                                         and at > coalesce((select max(at) from public.bill_steps where bill_id = b.id and decision = 'send_back'), '-infinity')) then
    raise exception 'Each step is done by a different person – you approved this bill already.' using errcode = '42501';
  end if;
  if step_ = 'posting' and p_decision = 'approve' and length(trim(coalesce(p_ref, ''))) = 0 then
    raise exception 'Write the ERP entry''s reference.' using errcode = '22023';
  end if;
  insert into public.bill_steps (bill_id, step, decision, by_person, reason) values (b.id, step_, p_decision, public.me(), p_reason);
  next_ := case p_decision
             when 'approve' then case step_ when 'site_admin' then 'site_admin_ok' when 'accounts' then 'accounts_ok'
                                            when 'management' then 'management_ok' else 'posted' end
             when 'send_back' then 'sent_back' else 'on_hold' end::public.bill_state;
  update public.monthly_bills set state = next_, held_at_state = case when next_ = 'on_hold' then cur end,
    erp_ref = case when step_ = 'posting' and p_decision = 'approve' then p_ref else erp_ref end where id = b.id;
end $$;

create or replace function public.record_payment(p_bill uuid, p_amount numeric, p_utr text, p_paid_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.monthly_bills;
begin
  select * into b from public.monthly_bills where id = p_bill for update;
  if not found or b.company_id <> public.my_company() or not public.has_role(array['accounts']::public.app_role[]) then
    raise exception 'Only Accounts enters a payment.' using errcode = '42501';
  end if;
  if b.state <> 'posted' then raise exception 'A bill is paid after it is posted in the ERP.' using errcode = '22023'; end if;
  if p_amount <> b.net_payable then raise exception 'The amount must be the net payable (%).', b.net_payable using errcode = '22023'; end if;
  insert into public.payments (bill_id, amount, utr, paid_on, entered_by) values (b.id, p_amount, p_utr, p_paid_on, public.me());
  update public.monthly_bills set state = 'paid' where id = b.id;
end $$;

do $$ declare t text; begin
  foreach t in array array['monthly_bills', 'bill_steps', 'payments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

alter table public.monthly_bills enable row level security;
alter table public.bill_steps    enable row level security;
alter table public.payments      enable row level security;

drop policy if exists monthly_bills_read on public.monthly_bills;
create policy monthly_bills_read on public.monthly_bills for select to authenticated using (
  company_id = public.my_company() and (
    public.has_role(array['site_admin']::public.app_role[], site_id)
    or public.has_role(array['accounts', 'management', 'system_admin']::public.app_role[])
    or public.works_at_mess(mess_id)));
drop policy if exists bill_steps_read on public.bill_steps;
create policy bill_steps_read on public.bill_steps for select to authenticated using (exists (select 1 from public.monthly_bills b where b.id = bill_id));
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated using (exists (select 1 from public.monthly_bills b where b.id = bill_id));

revoke all on public.monthly_bills, public.bill_steps, public.payments from anon, authenticated;
grant select on public.monthly_bills, public.bill_steps, public.payments to authenticated;

revoke all on function public.rate_on(uuid, uuid, date), public.setting_int(uuid, text, date, integer), public.build_bill(uuid, date),
  public.upload_invoice(uuid, text, text, numeric, jsonb), public.check_invoice(uuid), public.bill_step(uuid, text, text, text),
  public.record_payment(uuid, numeric, text, date) from public, anon;
grant execute on function public.build_bill(uuid, date), public.upload_invoice(uuid, text, text, numeric, jsonb), public.check_invoice(uuid),
  public.bill_step(uuid, text, text, text), public.record_payment(uuid, numeric, text, date) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════ 0007_registration.sql
-- FALCON · migration 0007 · who is who: the LION Portal's one sign-in for a verified company employee; FALCON's own registration
-- for everybody else (after the WhatsApp code proved the mobile – and only the mobile); the RCL ID looked up in HR by the server;
-- the Site Admin's inbox (verify, link, ask HR, temporary, section, details, reject, suspend, release); linking without a second
-- record; guests and their phones. Safe to run again.

create table if not exists public.registrations (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  company_id     uuid not null references public.companies(id),
  person_id      uuid not null references public.people(id),
  site_id        uuid references public.sites(id),
  section_id     uuid references public.sections(id),
  typed_rcl_id   text check (typed_rcl_id ~ '^[A-Z0-9-]{2,20}$'),
  hr_result      text not null check (hr_result in ('found', 'not_found', 'maybe', 'not_checked')),
  hr_name        text,                                   -- what HR answered (name, designation, its key) – never KYC, bank or pay
  hr_designation text,
  hr_ref         text,
  mobile_matches boolean,
  category       text check (category in ('staff', 'operator', 'driver', 'labour')),
  work_role      text check (length(work_role) <= 80),
  works_with     text check (length(works_with) <= 120),
  photo_path     text,
  info_asked     text,
  info_answer    text,
  asked_hr_at    timestamptz,
  decided_by     uuid references public.people(id),
  decided_at     timestamptz,
  last_action    text,
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists registrations_site on public.registrations (site_id, created_at desc);

-- A Portal ticket is used once: its id is kept until it has expired anyway.
create table if not exists public.portal_tickets_used (
  jti     text primary key check (length(jti) between 8 and 80),
  exp     timestamptz not null,
  used_at timestamptz not null default now()
);
alter table public.portal_tickets_used enable row level security;          -- no rule: only the server (service role) reaches it
revoke all on public.portal_tickets_used from anon, authenticated;

create or replace function public.server_use_ticket(p_jti text, p_exp timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.portal_tickets_used where exp < now() - interval '1 day';
  insert into public.portal_tickets_used (jti, exp) values (p_jti, p_exp);
  return true;
exception when unique_violation then
  return false;
end $$;

-- "Is this you?" before the code (r02 → r03 → r04): HR's mobile stays on the server; the browser holds only a 10-minute token.
create table if not exists public.start_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  phone      text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  rcl_id     text not null,
  hr         jsonb not null,
  exp        timestamptz not null
);
alter table public.start_tokens enable row level security;               -- no rule: only the server
revoke all on public.start_tokens from anon, authenticated;

create or replace function public.server_start_token(p_phone text, p_rcl text, p_hr jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare t text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from public.start_tokens where exp < now();
  insert into public.start_tokens (token_hash, phone, rcl_id, hr, exp)
  values (encode(extensions.digest(t, 'sha256'), 'hex'), p_phone, upper(p_rcl), p_hr - 'mobile', now() + interval '10 minutes');
  return t;
end $$;

create or replace function public.server_start_resolve(p_token text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('phone', phone, 'rcl_id', rcl_id, 'hr', hr) from public.start_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and exp > now()
$$;

-- ── the server's steps (service role only – the browser can never claim "found in HR") ───────────────────────────────────
-- A verified company employee coming with his LION sign-in: found by his Portal user ID, or by his mobile when he registered
-- here before (the same person – no second record), or made now. The Portal's Super Admin is FALCON's System Admin.
create or replace function public.server_portal_person(p_company_code text, p_portal_user text, p_name text, p_auth_user uuid,
  p_mobile text default null, p_site_code text default null, p_is_super boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.companies; p public.people; s public.sites; u text := lower(trim(p_portal_user));
begin
  select * into c from public.companies where code = upper(p_company_code) and active;
  if not found then raise exception 'Company % is not in FALCON.', p_company_code using errcode = '22023'; end if;
  select * into s from public.sites where company_id = c.id and code = upper(p_site_code);
  select * into p from public.people where portal_user = u;
  if not found and p_mobile is not null then
    select * into p from public.people where company_id = c.id and mobile = p_mobile and kind = 'employee';
  end if;
  if p.id is null then
    insert into public.people (company_id, kind, auth_user_id, portal_user, full_name, mobile, state, home_site_id)
    values (c.id, 'employee', p_auth_user, u, coalesce(nullif(trim(p_name), ''), u), p_mobile, 'verified', s.id) returning * into p;
  else
    if p.state in ('rejected', 'suspended') then raise exception 'This person is %.', p.state using errcode = '42501'; end if;
    update public.people set portal_user = u, auth_user_id = coalesce(auth_user_id, p_auth_user),
      full_name = coalesce(nullif(trim(p_name), ''), full_name), home_site_id = coalesce(home_site_id, s.id),
      state = case when state in ('verified', 'id_assigned', 'linked') then state else 'verified' end,
      temporary_until = case when state = 'temporary' then null else temporary_until end
    where id = p.id returning * into p;
  end if;
  if p.auth_user_id is distinct from p_auth_user then raise exception 'This person is signed in from another account.' using errcode = '42501'; end if;
  if p_is_super and not exists (select 1 from public.role_grants where person_id = p.id and role = 'system_admin' and revoked_at is null and site_id is null) then
    insert into public.role_grants (person_id, company_id, role, reason) values (p.id, c.id, 'system_admin', 'The LION Portal''s Super Admin');
  end if;
  return p.id;
end $$;

-- FALCON's own registration, after the WhatsApp code: the auth user's phone is the proven mobile. p_hr is what the server got
-- from HR: {"result": "found|not_found|maybe|not_checked", "name", "designation", "ref", "mobile_matches"}.
create or replace function public.server_register(p_auth_user uuid, p_company_code text, p_kind public.person_kind, p_full_name text,
  p_site uuid default null, p_section uuid default null, p_rcl_id text default null, p_hr jsonb default '{}', p_category text default null,
  p_work_role text default null, p_works_with text default null, p_photo text default null, p_organisation text default null,
  p_designation text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.companies; ph text; p public.people; r public.registrations; res text := coalesce(p_hr ->> 'result', 'not_checked');
        matches boolean := coalesce((p_hr ->> 'mobile_matches')::boolean, false); st public.person_state; s public.sites;
begin
  select * into c from public.companies where code = upper(p_company_code) and active;
  if not found then raise exception 'Company % is not in FALCON.', p_company_code using errcode = '22023'; end if;
  select '+' || ltrim(phone, '+') into ph from auth.users where id = p_auth_user;
  if ph is null then raise exception 'The mobile is not verified.' using errcode = '42501'; end if;
  if exists (select 1 from public.people where auth_user_id = p_auth_user) then raise exception 'You are registered already.' using errcode = '22023'; end if;
  if p_kind = 'contractor_staff' then raise exception 'A contractor''s person is added by the System Admin.' using errcode = '42501'; end if;
  select * into s from public.sites where id = p_site and company_id = c.id;
  if p_kind = 'employee' and s.id is null then raise exception 'Choose your site.' using errcode = '22023'; end if;

  select * into p from public.people where company_id = c.id and mobile = ph;
  if found then
    -- the same mobile: the same person (a guest's one profile for ever; an employee registered by the office) – never a second one
    if p.auth_user_id is not null then raise exception 'This mobile is registered to another account.' using errcode = '22023'; end if;
    update public.people set auth_user_id = p_auth_user, mobile_verified_at = now() where id = p.id returning * into p;
    if p.kind = 'guest' and not exists (select 1 from public.guest_profiles where person_id = p.id) then
      insert into public.guest_profiles (person_id, organisation, designation) values (p.id, p_organisation, p_designation);
    end if;
    return jsonb_build_object('person', p.id, 'state', p.state, 'returning', true);
  end if;

  if p_kind = 'guest' then
    insert into public.people (company_id, kind, auth_user_id, full_name, mobile, mobile_verified_at, state)
    values (c.id, 'guest', p_auth_user, p_full_name, ph, now(), 'verified') returning * into p;
    insert into public.guest_profiles (person_id, organisation, designation) values (p.id, p_organisation, p_designation);
    return jsonb_build_object('person', p.id, 'state', p.state);
  end if;

  -- an employee: found in HR with his own mobile → verified at once; anything else waits for the Site Admin / HR
  st := case when res = 'found' and matches and p_rcl_id is not null
                  and not exists (select 1 from public.people where company_id = c.id and rcl_id = upper(p_rcl_id)) then 'verified'
             else 'pending_verification' end;
  insert into public.people (company_id, kind, auth_user_id, full_name, mobile, mobile_verified_at, state, rcl_id, hr_ref, home_site_id,
                             home_section_id, work_role, works_with)
  values (c.id, 'employee', p_auth_user, coalesce(case when st = 'verified' then p_hr ->> 'name' end, p_full_name), ph, now(), st,
          case when st = 'verified' then upper(p_rcl_id) end, case when st = 'verified' then p_hr ->> 'ref' end, s.id, p_section,
          p_work_role, p_works_with)
  returning * into p;
  insert into public.registrations (code, company_id, person_id, site_id, section_id, typed_rcl_id, hr_result, hr_name, hr_designation,
                                    hr_ref, mobile_matches, category, work_role, works_with, photo_path, last_action)
  values (public.next_code('registration:' || s.id, 'REG-' || s.code || '-'), c.id, p.id, s.id, p_section, upper(p_rcl_id), res,
          p_hr ->> 'name', p_hr ->> 'designation', p_hr ->> 'ref', matches, p_category, p_work_role, p_works_with, p_photo,
          case when st = 'verified' then 'verified by HR' else 'waiting' end)
  returning * into r;
  return jsonb_build_object('person', p.id, 'state', p.state, 'registration', r.code, 'hr', res);
end $$;

-- A phone: known (it only suggests the profile) and whether a new WhatsApp code is needed (new phone, or 30 days since the last).
create or replace function public.server_device(p_auth_user uuid, p_device_hash text, p_code_now boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.people; d public.devices;
begin
  select * into p from public.people where auth_user_id = p_auth_user;
  if not found then return jsonb_build_object('known', false, 'code_needed', true); end if;
  insert into public.devices (person_id, device_hash) values (p.id, p_device_hash)
  on conflict (person_id, device_hash) do update set last_seen = now() returning * into d;
  if p_code_now then update public.devices set last_code_at = now() where id = d.id returning * into d; end if;
  return jsonb_build_object('known', true, 'code_needed', d.last_code_at is null or d.last_code_at < now() - interval '30 days');
end $$;

-- ── merging: a person registered twice becomes ONE – his meals, complaints and visits move to the record that stays ──────
create or replace function public.merge_people(p_from uuid, p_into uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.people; b public.people;
begin
  select * into a from public.people where id = p_from for update;
  select * into b from public.people where id = p_into for update;
  if a.id is null or b.id is null or a.id = b.id or a.company_id <> b.company_id then raise exception 'These two cannot be joined.' using errcode = '22023'; end if;
  if b.auth_user_id is not null and a.auth_user_id is not null then
    raise exception 'Both records have their own sign-in – one must stop using it first.' using errcode = '22023';
  end if;
  perform set_config('falcon.correcting', 'on', true);         -- moving a person's lines is not changing a locked day's numbers
  update public.order_lines set person_id = b.id where person_id = a.id;
  update public.orders set requested_by = b.id where requested_by = a.id;
  update public.delivery_codes set person_id = b.id where person_id = a.id;
  update public.complaints set raised_by = b.id where raised_by = a.id;
  update public.reviews set person_id = b.id where person_id = a.id;
  update public.devices set person_id = b.id where person_id = a.id
    and not exists (select 1 from public.devices x where x.person_id = b.id and x.device_hash = public.devices.device_hash);
  update public.registrations set person_id = b.id where person_id = a.id;
  perform set_config('falcon.correcting', 'off', true);
  update public.people set auth_user_id = null, mobile = null, mobile_verified_at = null, state = 'linked',
    state_reason = 'Joined to ' || b.id::text || ' – ' || p_reason where id = a.id;
  update public.people set auth_user_id = coalesce(b.auth_user_id, a.auth_user_id), mobile = coalesce(b.mobile, a.mobile),
    mobile_verified_at = coalesce(b.mobile_verified_at, a.mobile_verified_at) where id = b.id;
  perform public.audit_write('merge', 'people', b.id::text, to_jsonb(a), to_jsonb(b), b.home_site_id, 'registration', p_reason);
end $$;

-- ── the Site Admin's inbox ───────────────────────────────────────────────────────────────────────────────────────────────
-- p_action: verify · link {"rcl_id","hr_ref"} or {"person"} · ask_hr · temporary {"until"} · section {"site","section"} ·
-- info {"question"} · reject · suspend · release. Reject, suspend and release need the reason.
create or replace function public.decide_registration(p_reg uuid, p_action text, p_args jsonb default '{}', p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.registrations; p public.people; site_ uuid; until_ date; other uuid;
begin
  select * into r from public.registrations where id = p_reg for update;
  if not found then raise exception 'This registration is not there.' using errcode = 'P0002'; end if;
  select * into p from public.people where id = r.person_id for update;
  site_ := coalesce(r.site_id, p.home_site_id);
  if r.company_id <> public.my_company() or not public.has_role(array['site_admin', 'system_admin']::public.app_role[], site_) then
    raise exception 'Only the Site Admin of this site decides it.' using errcode = '42501';
  end if;
  if p_action in ('reject', 'suspend', 'release') and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'This needs the reason.' using errcode = '22023';
  end if;
  case p_action
    when 'verify' then
      update public.people set state = 'verified', temporary_until = null, state_reason = null where id = p.id;
    when 'link' then
      if p_args ? 'person' then
        other := (p_args ->> 'person')::uuid;
        perform public.merge_people(p.id, other, coalesce(p_reason, 'linked by the Site Admin'));
      else
        if coalesce(p_args ->> 'rcl_id', '') = '' then raise exception 'Give the RCL ID from HR.' using errcode = '22023'; end if;
        select id into other from public.people where company_id = p.company_id and rcl_id = upper(p_args ->> 'rcl_id') and id <> p.id;
        if other is not null then
          perform public.merge_people(p.id, other, coalesce(p_reason, 'the same RCL ID'));
        else
          update public.people set rcl_id = upper(p_args ->> 'rcl_id'), hr_ref = p_args ->> 'hr_ref',
            state = (case when coalesce((p_args ->> 'new_in_hr')::boolean, false) then 'id_assigned' else 'linked' end)::public.person_state,
            temporary_until = null, state_reason = null where id = p.id;
        end if;
      end if;
    when 'ask_hr' then
      update public.registrations set asked_hr_at = now() where id = r.id;
      update public.people set state = 'pending_verification' where id = p.id and state not in ('temporary');
    when 'temporary' then
      until_ := (p_args ->> 'until')::date;
      if until_ is null or until_ < public.local_today() or until_ > public.local_today() + 30 then
        raise exception 'Temporary access is given up to 30 days.' using errcode = '22023';
      end if;
      update public.people set state = 'temporary', temporary_until = until_ where id = p.id;
    when 'section' then
      update public.people set home_site_id = coalesce((p_args ->> 'site')::uuid, home_site_id),
        home_section_id = (p_args ->> 'section')::uuid where id = p.id;
      update public.registrations set site_id = coalesce((p_args ->> 'site')::uuid, site_id), section_id = (p_args ->> 'section')::uuid where id = r.id;
    when 'info' then
      if coalesce(trim(p_args ->> 'question'), '') = '' then raise exception 'Write what to ask.' using errcode = '22023'; end if;
      update public.registrations set info_asked = p_args ->> 'question', info_answer = null where id = r.id;
    when 'reject' then
      update public.people set state = 'rejected', state_reason = p_reason where id = p.id;
    when 'suspend' then
      update public.people set state = 'suspended', state_reason = p_reason where id = p.id;
    when 'release' then
      if p.state <> 'suspended' then raise exception 'Only a suspended person is released.' using errcode = '22023'; end if;
      update public.people set state = (case when rcl_id is not null then 'linked' else 'verified' end)::public.person_state, state_reason = null where id = p.id;
    else raise exception 'Unknown action: %', p_action using errcode = '22023';
  end case;
  update public.registrations set decided_by = public.me(), decided_at = now(), last_action = p_action, reason = coalesce(p_reason, reason)
  where id = r.id;
  perform public.audit_write('registration_' || p_action, 'registrations', r.id::text, null, p_args, site_ , 'web', p_reason);
end $$;

create or replace function public.answer_registration(p_reg uuid, p_answer text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.registrations set info_answer = p_answer where id = p_reg and person_id = public.me() and info_asked is not null;
  if not found then raise exception 'Nothing was asked of you.' using errcode = '22023'; end if;
end $$;

-- The places to choose from when registering (before one is signed in): sites, circles and sections – codes and names only.
create or replace function public.start_places(p_company text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('company', c.id, 'name', c.name, 'sites', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name, 'circle', ci.code) order by ci.code, x.code)
      from public.sections x join public.circles ci on ci.id = x.circle_id where x.site_id = s.id and x.active), '[]')) order by s.code)
    from public.sites s where s.company_id = c.id and s.active), '[]'))
  from public.companies c where c.code = upper(p_company) and c.active
$$;
grant execute on function public.start_places(text) to anon, authenticated;

-- A person always learns where he stands – also when he is suspended, rejected or his temporary access ended (the rules then
-- show him nothing else).
create or replace function public.my_standing() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('state', state, 'reason', state_reason, 'until', temporary_until, 'name', full_name)
  from public.people where auth_user_id = auth.uid()
$$;

-- The Site Admin lets a person ask meals for others (a group request), or takes it back.
create or replace function public.allow_group(p_person uuid, p_allow boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.people;
begin
  select * into p from public.people where id = p_person;
  if not found or p.company_id <> public.my_company() or not public.has_role(array['site_admin', 'system_admin']::public.app_role[], p.home_site_id) then
    raise exception 'Only the Site Admin of his site allows it.' using errcode = '42501';
  end if;
  update public.people set may_group = p_allow where id = p.id;
end $$;

-- The System Admin gives or takes a role (never his own).
create or replace function public.grant_role(p_person uuid, p_role public.app_role, p_site uuid default null, p_mess uuid default null,
  p_from date default null, p_to date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.people; g uuid;
begin
  select * into p from public.people where id = p_person;
  if not found or p.company_id <> public.my_company() or not public.has_role(array['system_admin']::public.app_role[]) then
    raise exception 'Only the System Admin gives roles.' using errcode = '42501';
  end if;
  if p.id = public.me() then raise exception 'Nobody gives a role to himself.' using errcode = '42501'; end if;
  insert into public.role_grants (person_id, company_id, site_id, role, mess_id, valid_from, valid_to, granted_by)
  values (p.id, p.company_id, p_site, p_role, p_mess, coalesce(p_from, public.local_today()), p_to, public.me()) returning id into g;
  return g;
end $$;

create or replace function public.revoke_role(p_grant uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.role_grants;
begin
  select * into g from public.role_grants where id = p_grant for update;
  if not found or g.company_id <> public.my_company() or not public.has_role(array['system_admin']::public.app_role[]) then
    raise exception 'Only the System Admin takes roles away.' using errcode = '42501';
  end if;
  if g.person_id = public.me() then raise exception 'Nobody takes his own role.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'This needs the reason.' using errcode = '22023'; end if;
  update public.role_grants set revoked_at = now(), revoked_by = public.me(), reason = p_reason where id = g.id;
end $$;

-- The office adds a contractor's person (mess owner, operator, driver) – he signs in later with the WhatsApp code of this mobile.
create or replace function public.add_contractor_person(p_full_name text, p_mobile text, p_site uuid, p_work_role text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id_ uuid;
begin
  if not public.in_my_company(p_site) or not public.has_role(array['site_admin', 'system_admin']::public.app_role[], p_site) then
    raise exception 'Only the Site Admin or the System Admin adds a contractor''s person.' using errcode = '42501';
  end if;
  insert into public.people (company_id, kind, full_name, mobile, state, home_site_id, work_role)
  values (public.my_company(), 'contractor_staff', p_full_name, p_mobile, 'verified', p_site, p_work_role) returning id into id_;
  return id_;
end $$;

drop trigger if exists registrations_audit on public.registrations;
create trigger registrations_audit after insert or update or delete on public.registrations for each row execute function public.audit_row();

alter table public.registrations enable row level security;
drop policy if exists registrations_read on public.registrations;
create policy registrations_read on public.registrations for select to authenticated using (
  person_id = public.me()
  or (company_id = public.my_company() and public.has_role(array['site_admin', 'system_admin', 'management']::public.app_role[], site_id)));

revoke all on public.registrations from anon, authenticated;
grant select on public.registrations to authenticated;

revoke all on function public.server_start_token(text, text, jsonb), public.server_start_resolve(text), public.server_use_ticket(text, timestamptz), public.server_portal_person(text, text, text, uuid, text, text, boolean),
  public.server_register(uuid, text, public.person_kind, text, uuid, uuid, text, jsonb, text, text, text, text, text, text),
  public.server_device(uuid, text, boolean), public.merge_people(uuid, uuid, text),
  public.decide_registration(uuid, text, jsonb, text), public.answer_registration(uuid, text), public.allow_group(uuid, boolean),
  public.grant_role(uuid, public.app_role, uuid, uuid, date, date), public.revoke_role(uuid, text),
  public.add_contractor_person(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.server_start_token(text, text, jsonb), public.server_start_resolve(text), public.server_use_ticket(text, timestamptz), public.server_portal_person(text, text, text, uuid, text, text, boolean),
  public.server_register(uuid, text, public.person_kind, text, uuid, uuid, text, jsonb, text, text, text, text, text, text),
  public.server_device(uuid, text, boolean) to service_role;
grant execute on function public.my_standing(), public.decide_registration(uuid, text, jsonb, text), public.answer_registration(uuid, text),
  public.allow_group(uuid, boolean), public.grant_role(uuid, public.app_role, uuid, uuid, date, date), public.revoke_role(uuid, text),
  public.add_contractor_person(text, text, uuid, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════ 0008_notifications.sql
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

-- ═════════════════════════════════════════════════════════════════════════ 0009_storage.sql
-- FALCON · migration 0009 · files: private buckets (nothing is public) and who may put and read what. A file's path always
-- starts with the company's id: <company>/<…>. Safe to run again.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('complaint-media',   'complaint-media',   false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']),
  ('contractor-papers', 'contractor-papers', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('invoices',          'invoices',          false, 15728640, array['application/pdf', 'image/jpeg', 'image/png']),
  ('menu-posters',      'menu-posters',      false, 5242880,  array['image/jpeg', 'image/png', 'image/webp']),
  ('registration-photos','registration-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.path_company(p_name text) returns uuid
language sql immutable as $$
  select case when (storage.foldername(p_name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(p_name))[1])::uuid end
$$;

-- complaint photos and voice: the one who complained puts them; he, the mess's owner and the site's office read them
drop policy if exists falcon_complaint_put on storage.objects;
create policy falcon_complaint_put on storage.objects for insert to authenticated with check (
  bucket_id = 'complaint-media' and public.path_company(name) = public.my_company() and public.me() is not null);
drop policy if exists falcon_complaint_read on storage.objects;
create policy falcon_complaint_read on storage.objects for select to authenticated using (
  bucket_id = 'complaint-media' and public.path_company(name) = public.my_company() and (
    owner = auth.uid()
    or exists (select 1 from public.complaints c where name = any (c.photo_paths) or c.voice_path = name)));   -- complaints' own rule

-- contractors' papers: the office and the contractor's own mess owner (the same as the papers' rows)
drop policy if exists falcon_papers_put on storage.objects;
create policy falcon_papers_put on storage.objects for insert to authenticated with check (
  bucket_id = 'contractor-papers' and public.path_company(name) = public.my_company() and (
    public.has_role(array['site_admin', 'accounts', 'system_admin']::public.app_role[])
    or exists (select 1 from public.messes m where public.works_at_mess(m.id))));
drop policy if exists falcon_papers_read on storage.objects;
create policy falcon_papers_read on storage.objects for select to authenticated using (
  bucket_id = 'contractor-papers' and public.path_company(name) = public.my_company() and (
    owner = auth.uid() or exists (select 1 from public.contractor_documents d where d.file_path = name)));

-- invoices: the mess owner and Accounts put them; whoever sees the bill reads them
drop policy if exists falcon_invoice_put on storage.objects;
create policy falcon_invoice_put on storage.objects for insert to authenticated with check (
  bucket_id = 'invoices' and public.path_company(name) = public.my_company() and (
    public.has_role(array['accounts']::public.app_role[]) or exists (select 1 from public.messes m where public.works_at_mess(m.id))));
drop policy if exists falcon_invoice_read on storage.objects;
create policy falcon_invoice_read on storage.objects for select to authenticated using (
  bucket_id = 'invoices' and public.path_company(name) = public.my_company() and (
    owner = auth.uid() or exists (select 1 from public.monthly_bills b where b.invoice_path = name)));

-- menu posters: the kitchen puts them; everybody of the company reads them
drop policy if exists falcon_poster_put on storage.objects;
create policy falcon_poster_put on storage.objects for insert to authenticated with check (
  bucket_id = 'menu-posters' and public.path_company(name) = public.my_company()
  and exists (select 1 from public.messes m where public.works_at_mess(m.id, array['mess_owner', 'mess_operator']::public.app_role[])));
drop policy if exists falcon_poster_read on storage.objects;
create policy falcon_poster_read on storage.objects for select to authenticated using (
  bucket_id = 'menu-posters' and public.path_company(name) = public.my_company());

-- a registration's photo: the person puts his own; he and the site's office read it
drop policy if exists falcon_regphoto_put on storage.objects;
create policy falcon_regphoto_put on storage.objects for insert to authenticated with check (
  bucket_id = 'registration-photos' and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists falcon_regphoto_read on storage.objects;
create policy falcon_regphoto_read on storage.objects for select to authenticated using (
  bucket_id = 'registration-photos' and (owner = auth.uid() or exists (select 1 from public.registrations r where r.photo_path = name)));

grant execute on function public.path_company(text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════ 0010_realtime.sql
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

-- ═════════════════════════════════════════════════════════════════════════ 0011_app_helpers.sql
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

-- ═════════════════════════════════════════════════════════════════════════ 0012_admin.sql
-- FALCON · migration 0012 · the office's settings page: a dated setting (complaint reply minutes, a van's late minutes …) gets a
-- new value from a date – the value before it ends the day before and stays in the record, so a day is always read with the
-- value of that day. Only the System Admin sets them; nothing is changed backwards. Safe to run again.

create or replace function public.set_setting(p_key text, p_value jsonb, p_from date, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cur public.settings; id_ uuid;
begin
  if not public.has_role(array['system_admin']::public.app_role[]) then
    raise exception 'Only the System Admin changes a setting.' using errcode = '42501';
  end if;
  if p_key !~ '^[a-z][a-z0-9_.]{2,60}$' then raise exception 'This is not a setting''s name.' using errcode = '22023'; end if;
  if p_value is null or jsonb_typeof(p_value) = 'null' then raise exception 'Give the value.' using errcode = '22023'; end if;
  if p_from is null or p_from < public.local_today() then
    raise exception 'A new value starts today or later – days already counted are not changed.' using errcode = '22023';
  end if;
  select * into cur from public.settings where company_id = public.my_company() and site_id is null and key = p_key and valid_to is null
    for update;
  if found then
    if cur.valid_from >= p_from then
      raise exception 'The new value must start after % (the value now in force).', to_char(cur.valid_from, 'DD Mon YYYY') using errcode = '22023';
    end if;
    update public.settings set valid_to = p_from - 1 where id = cur.id;
  end if;
  insert into public.settings (company_id, key, value, valid_from, note, set_by)
  values (public.my_company(), p_key, p_value, p_from, p_note, public.me()) returning id into id_;
  return id_;
end $$;

revoke all on function public.set_setting(text, jsonb, date, text) from public, anon;
grant execute on function public.set_setting(text, jsonb, date, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════ 0013_hr_people.sql
-- FALCON · migration 0013 · HR's employees in FALCON (his decision of 23-11-2026: "HR cha data base FALCON la connect kr … all RCL
-- che je astil … new site … new employee HR madhe aala tri te yat yeyla hawa"; his yes to the plan: HR's list kept here, only these
-- fields, HR stays the master and is never changed from here) and the first System Admin (FALCON_FIRST_ADMIN, his yes of the same day).
--   * hr_people: every employee of every site as HR gives it (RCL ID, name, designation, category, site, mobile, status, left day) –
--     never birth date, e-mail, KYC, bank, pay, photo or face. Read only by FALCON's server; the office sees it with the mobile masked.
--   * server_hr_sync: the hourly copy – a new site of HR becomes a FALCON site by itself (its mess and sections are the System
--     Admin's); an employee who LEFT in HR is stopped in FALCON (and let in again when HR takes the "left" back); names follow HR.
--   * server_welcome: after a WhatsApp code – a person already known; a FALCON person with that mobile; an HR employee with that
--     mobile who has not LEFT (made at once – no registration form, no Site Admin check); the first System Admin (only while there is
--     none).
--   (23-11-2026, the first copy: all 86 of HR's people were "pending" or "incomplete" in HR – HR's own steps of activation. His word
--   was ALL of RCL's employees, a new joiner too, so every employee in HR's list counts unless he LEFT; HR's statuses are only shown.)
-- Safe to run again.

create table if not exists public.hr_people (
  company_id  uuid not null references public.companies(id),
  hr_id       text not null check (length(hr_id) between 1 and 64),          -- HR's own key of the employee
  rcl_id      text check (rcl_id ~ '^[A-Z0-9-]{2,20}$'),
  full_name   text not null check (length(trim(full_name)) between 1 and 120),
  designation text check (length(designation) <= 80),
  category    text check (category in ('staff', 'operator', 'driver', 'labour')),
  site_code   text check (site_code ~ '^[A-Z0-9-]{1,16}$'),
  mobile      text check (mobile ~ '^\+[1-9][0-9]{7,14}$'),
  status      text not null check (status in ('incomplete', 'pending', 'active', 'left')),
  left_on     date,
  gone        boolean not null default false,                                -- no longer in HR's list
  seen_at     timestamptz not null default now(),
  primary key (company_id, hr_id)
);
create index if not exists hr_people_mobile on public.hr_people (company_id, mobile) where mobile is not null;
create index if not exists hr_people_rcl on public.hr_people (company_id, rcl_id) where rcl_id is not null;
create index if not exists hr_people_site on public.hr_people (company_id, site_code, status);

create table if not exists public.hr_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  at          timestamptz not null default now(),
  how         text not null check (how in ('timer', 'office')),
  ok          boolean not null,
  total       integer not null default 0,
  added       integer not null default 0,
  changed     integer not null default 0,
  gone        integer not null default 0,
  stopped     integer not null default 0,
  released    integer not null default 0,
  new_sites   text[] not null default '{}',
  message     text check (length(message) <= 400)
);
create index if not exists hr_sync_runs_at on public.hr_sync_runs (company_id, at desc);

-- A run that could not reach HR is written too (the office sees why).
create or replace function public.server_hr_failed(p_company_code text, p_how text, p_message text) returns void
language sql security definer set search_path = '' as $$
  insert into public.hr_sync_runs (company_id, how, ok, message)
  select c.id, p_how, false, left(p_message, 400) from public.companies c where c.code = upper(p_company_code)
$$;

-- The copy. p_rows: HR's whole list [{id, code, name, designation, category, site, mobile, status, left}] – everything at once, so a
-- person missing from it is known to be gone. All in one transaction.
create or replace function public.server_hr_sync(p_company_code text, p_rows jsonb, p_how text default 'timer') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.companies; n_total integer; n_added integer := 0; n_changed integer := 0; n_gone integer := 0; n_stopped integer := 0;
  n_released integer := 0; sites_new text[] := '{}'; r record; s text; run uuid; site_ uuid;
begin
  select * into c from public.companies where code = upper(p_company_code) and active;
  if not found then raise exception 'Company % is not in FALCON.', p_company_code using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'HR''s list is missing.' using errcode = '22023'; end if;
  n_total := jsonb_array_length(p_rows);
  if n_total = 0 then raise exception 'HR gave an empty list – nothing is changed.' using errcode = '22023'; end if;

  create temporary table if not exists hr_in (hr_id text, rcl_id text, full_name text, designation text, category text, site_code text,
    mobile text, status text, left_on date) on commit drop;
  truncate hr_in;
  insert into hr_in
  select left(trim(x ->> 'id'), 64),
         case when upper(trim(coalesce(x ->> 'code', ''))) ~ '^[A-Z0-9-]{2,20}$' then upper(trim(x ->> 'code')) end,
         left(coalesce(nullif(trim(x ->> 'name'), ''), '(no name in HR)'), 120),
         nullif(left(trim(coalesce(x ->> 'designation', '')), 80), ''),
         case when lower(x ->> 'category') in ('staff', 'operator', 'driver', 'labour') then lower(x ->> 'category') end,
         case when upper(trim(coalesce(x ->> 'site', ''))) ~ '^[A-Z0-9-]{1,16}$' then upper(trim(x ->> 'site')) end,
         case when regexp_replace(coalesce(x ->> 'mobile', ''), '\D', '', 'g') ~ '^(91)?[6-9][0-9]{9}$'
              then '+91' || right(regexp_replace(x ->> 'mobile', '\D', '', 'g'), 10) end,
         case when lower(x ->> 'status') in ('incomplete', 'pending', 'active', 'left') then lower(x ->> 'status') else 'incomplete' end,
         case when coalesce(x ->> 'left', '') ~ '^\d{4}-\d{2}-\d{2}$' then (x ->> 'left')::date end
  from jsonb_array_elements(p_rows) x
  where coalesce(trim(x ->> 'id'), '') <> '';
  -- one RCL ID and one mobile belong to one employee (as in HR); a second is left out of the match, never guessed
  delete from hr_in a using hr_in b where a.hr_id = b.hr_id and a.ctid > b.ctid;

  select count(*) into n_added from hr_in i where not exists (select 1 from public.hr_people p where p.company_id = c.id and p.hr_id = i.hr_id);
  select count(*) into n_changed from hr_in i join public.hr_people p on p.company_id = c.id and p.hr_id = i.hr_id
   where (p.rcl_id, p.full_name, p.designation, p.category, p.site_code, p.mobile, p.status, p.left_on, p.gone)
         is distinct from (i.rcl_id, i.full_name, i.designation, i.category, i.site_code, i.mobile, i.status, i.left_on, false);
  insert into public.hr_people (company_id, hr_id, rcl_id, full_name, designation, category, site_code, mobile, status, left_on, gone, seen_at)
  select c.id, hr_id, rcl_id, full_name, designation, category, site_code, mobile, status, left_on, false, now() from hr_in
  on conflict (company_id, hr_id) do update set rcl_id = excluded.rcl_id, full_name = excluded.full_name, designation = excluded.designation,
    category = excluded.category, site_code = excluded.site_code, mobile = excluded.mobile, status = excluded.status,
    left_on = excluded.left_on, gone = false, seen_at = excluded.seen_at;
  update public.hr_people p set gone = true where p.company_id = c.id and not p.gone and not exists (select 1 from hr_in i where i.hr_id = p.hr_id);
  get diagnostics n_gone = row_count;

  -- a new site of HR becomes a FALCON site (its code; the System Admin names it and sets its mess and sections)
  for s in select distinct h.site_code from public.hr_people h where h.company_id = c.id and not h.gone and h.status <> 'left'
             and h.site_code ~ '^[A-Z0-9-]{2,16}$' and not exists (select 1 from public.sites t where t.company_id = c.id and t.code = h.site_code)
           order by 1 loop
    insert into public.sites (company_id, code, name) values (c.id, s, s) returning id into site_;
    sites_new := sites_new || s;
    perform public.notify_roles(site_, array['system_admin']::public.app_role[], 'hr_new_site', 'New site from HR: ' || s,
      'Give it its name, its mess and its sections in FALCON.', '/admin/sites');
  end loop;

  -- FALCON's people of an RCL ID: the name follows HR; who LEFT (or is no longer in HR) is stopped; "left" taken back = let in again
  for r in select p.id, p.state, p.state_reason, p.full_name, h.full_name hr_name, h.status, h.left_on, h.gone
           from public.people p join public.hr_people h on h.company_id = p.company_id and h.rcl_id = p.rcl_id
           where p.company_id = c.id and p.kind = 'employee' loop
    if r.status = 'left' or r.gone then
      if r.state not in ('rejected', 'suspended') then
        update public.people set state = 'suspended', state_reason = 'Left the company in HR' || coalesce(' on ' || to_char(r.left_on, 'DD Mon YYYY'), '')
         where id = r.id;
        n_stopped := n_stopped + 1;
      end if;
    else
      if r.state = 'suspended' and r.state_reason like 'Left the company in HR%' then
        update public.people set state = 'linked', state_reason = null where id = r.id;
        n_released := n_released + 1;
      end if;
      if r.full_name is distinct from r.hr_name and r.hr_name <> '(no name in HR)' then
        update public.people set full_name = r.hr_name where id = r.id;
      end if;
    end if;
  end loop;

  insert into public.hr_sync_runs (company_id, how, ok, total, added, changed, gone, stopped, released, new_sites)
  values (c.id, case when p_how = 'office' then 'office' else 'timer' end, true, n_total, n_added, n_changed, n_gone, n_stopped, n_released, sites_new)
  returning id into run;
  insert into public.audit_log (company_id, action, entity, entity_id, after, how)
  values (c.id, 'hr_sync', 'hr_people', run::text, jsonb_build_object('total', n_total, 'added', n_added, 'changed', n_changed, 'gone', n_gone,
          'stopped', n_stopped, 'released', n_released, 'new_sites', sites_new), p_how);
  return jsonb_build_object('total', n_total, 'added', n_added, 'changed', n_changed, 'gone', n_gone, 'stopped', n_stopped,
    'released', n_released, 'new_sites', sites_new);
end $$;

-- The RCL ID look-up (the start of an RCL employee, the Site Admin's "Link"): from the kept list. Nothing kept yet → "not checked".
create or replace function public.server_hr_find(p_company_code text, p_rcl_id text, p_mobile text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; h public.hr_people;
begin
  select * into c from public.companies where code = upper(p_company_code) and active;
  if not found or not exists (select 1 from public.hr_people where company_id = c.id) then return jsonb_build_object('result', 'not_checked'); end if;
  select * into h from public.hr_people where company_id = c.id and rcl_id = upper(trim(p_rcl_id)) and not gone;
  if not found or h.status = 'left' then return jsonb_build_object('result', 'not_found'); end if;
  return jsonb_build_object('result', 'found', 'hr_status', h.status, 'name', h.full_name,
    'designation', h.designation, 'category', h.category, 'site', h.site_code, 'ref', h.hr_id, 'mobile', h.mobile,
    'mobile_matches', h.mobile is not null and h.mobile = p_mobile);
end $$;

-- After a WhatsApp code: who is this? (See the top of this file.) p_first_admin: FALCON_FIRST_ADMIN as "+91…", or null.
create or replace function public.server_welcome(p_auth_user uuid, p_company_code text, p_first_admin text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.companies; ph text; p public.people; h public.hr_people; site_ uuid; how text; admin_made boolean := false;
begin
  select * into c from public.companies where code = upper(p_company_code) and active;
  if not found then raise exception 'Company % is not in FALCON.', p_company_code using errcode = '22023'; end if;
  select '+' || ltrim(phone, '+') into ph from auth.users where id = p_auth_user and coalesce(phone, '') <> '';
  select * into p from public.people where auth_user_id = p_auth_user;
  if found then how := 'known';
  elsif ph is null then return jsonb_build_object('person', null, 'how', 'no_mobile');
  else
    select * into p from public.people where company_id = c.id and mobile = ph;
    if found then
      if p.auth_user_id is not null then raise exception 'This mobile is registered to another account.' using errcode = '22023'; end if;
      update public.people set auth_user_id = p_auth_user, mobile_verified_at = now() where id = p.id returning * into p;
      how := 'mobile';
    else
      select * into h from public.hr_people where company_id = c.id and mobile = ph and status <> 'left' and not gone and rcl_id is not null
        order by seen_at desc limit 1;
      if found and not exists (select 1 from public.people where company_id = c.id and rcl_id = h.rcl_id) then
        select id into site_ from public.sites where company_id = c.id and code = h.site_code;
        insert into public.people (company_id, kind, auth_user_id, full_name, mobile, mobile_verified_at, state, rcl_id, hr_ref, home_site_id, work_role)
        values (c.id, 'employee', p_auth_user, h.full_name, ph, now(), 'linked', h.rcl_id, h.hr_id, site_, h.designation) returning * into p;
        insert into public.audit_log (company_id, site_id, actor, action, entity, entity_id, after, how)
        values (c.id, site_, p.id, 'welcome_from_hr', 'people', p.id::text, jsonb_build_object('rcl_id', h.rcl_id, 'site', h.site_code), 'whatsapp_code');
        how := 'hr';
      end if;
    end if;
  end if;

  -- the first System Admin: his mobile set in Vercel, and only while the company has none
  if ph is not null and p_first_admin is not null and ph = p_first_admin
     and not exists (select 1 from public.role_grants g where g.company_id = c.id and g.role = 'system_admin' and g.revoked_at is null) then
    if p.id is null then
      insert into public.people (company_id, kind, auth_user_id, full_name, mobile, mobile_verified_at, state)
      values (c.id, 'employee', p_auth_user, 'System Admin', ph, now(), 'verified') returning * into p;
      how := coalesce(how, 'first_admin');
    elsif p.state in ('rejected', 'suspended') then
      return jsonb_build_object('person', p.id, 'state', p.state, 'how', how);
    end if;
    insert into public.role_grants (person_id, company_id, site_id, role, granted_by) values (p.id, c.id, null, 'system_admin', null);
    insert into public.audit_log (company_id, actor, action, entity, entity_id, after, how)
    values (c.id, p.id, 'first_system_admin', 'role_grants', p.id::text, jsonb_build_object('person', p.id), 'FALCON_FIRST_ADMIN');
    admin_made := true;
  end if;
  if p.id is null then return jsonb_build_object('person', null, 'how', 'unknown'); end if;
  return jsonb_build_object('person', p.id, 'state', p.state, 'how', how, 'first_admin', admin_made);
end $$;

-- The office's view: the state of the copy, and the list with the mobile masked.
create or replace function public.office_hr_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not public.has_role(array['system_admin', 'site_admin', 'management']::public.app_role[]) then null else jsonb_build_object(
    'last', (select to_jsonb(r) - 'company_id' from public.hr_sync_runs r where r.company_id = public.my_company() order by at desc limit 1),
    'last_ok', (select max(at) from public.hr_sync_runs r where r.company_id = public.my_company() and ok),
    'sites', coalesce((select jsonb_agg(jsonb_build_object('site', site_code, 'active', a, 'left', l, 'other', o, 'in_falcon', f) order by site_code)
      from (select h.site_code, count(*) filter (where h.status <> 'left' and not h.gone) a, count(*) filter (where h.status = 'left' or h.gone) l,
                   count(*) filter (where h.status in ('incomplete', 'pending') and not h.gone) o,
                   count(*) filter (where exists (select 1 from public.people p where p.company_id = h.company_id and p.rcl_id = h.rcl_id)) f
            from public.hr_people h where h.company_id = public.my_company() group by h.site_code) x), '[]')) end
$$;

create or replace function public.office_hr_people(p_site text default null, p_find text default null, p_limit integer default 300)
returns table (rcl_id text, full_name text, designation text, category text, site_code text, mobile text, status text, left_on date,
               gone boolean, in_falcon text)
language sql stable security definer set search_path = '' as $$
  select h.rcl_id, h.full_name, h.designation, h.category, h.site_code,
         case when h.mobile is null then null else left(h.mobile, 3) || ' ' || substr(h.mobile, 4, 2) || 'XXX XX' || right(h.mobile, 3) end,
         h.status, h.left_on, h.gone, (select p.state::text from public.people p where p.company_id = h.company_id and p.rcl_id = h.rcl_id)
  from public.hr_people h
  where h.company_id = public.my_company() and public.has_role(array['system_admin', 'site_admin', 'management']::public.app_role[])
    and (p_site is null or h.site_code = upper(p_site))
    and (p_find is null or h.full_name ilike '%' || p_find || '%' or h.rcl_id ilike '%' || p_find || '%')
  order by h.site_code, h.full_name
  limit greatest(1, least(coalesce(p_limit, 300), 2000))
$$;

alter table public.hr_people    enable row level security;
alter table public.hr_sync_runs enable row level security;
revoke all on public.hr_people, public.hr_sync_runs from anon, authenticated;

revoke all on function public.server_hr_failed(text, text, text), public.server_hr_sync(text, jsonb, text), public.server_hr_find(text, text, text),
  public.server_welcome(uuid, text, text), public.office_hr_status(), public.office_hr_people(text, text, integer) from public, anon, authenticated;
grant execute on function public.server_hr_failed(text, text, text), public.server_hr_sync(text, jsonb, text), public.server_hr_find(text, text, text),
  public.server_welcome(uuid, text, text) to service_role;
grant execute on function public.office_hr_status(), public.office_hr_people(text, text, integer) to authenticated;

commit;
