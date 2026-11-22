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
