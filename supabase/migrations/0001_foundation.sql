-- FALCON · migration 0001 · the foundation: companies, sites, circles and sections; people (employees and guests), their roles,
-- their phones; dated settings; the audit log; the helpers every rule of Row Level Security uses.
-- Safe to run again: every object is made only when it is not there.

create extension if not exists btree_gist;

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
  valid_from  date not null default current_date,
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
    and (p.state <> 'temporary' or p.temporary_until >= current_date)
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
      and current_date >= g.valid_from and (g.valid_to is null or current_date <= g.valid_to)
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
