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
