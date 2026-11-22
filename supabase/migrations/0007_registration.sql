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
