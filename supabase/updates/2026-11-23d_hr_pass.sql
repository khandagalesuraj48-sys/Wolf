-- FALCON · DATABASE UPDATE of 23-11-2026 (fourth) · opened from HR – no second sign-in (pictures N6–N8). It adds part 0015
-- (supabase/migrations/0015_hr_pass.sql) – nothing else is changed. Run ONCE in FALCON's Supabase (SQL Editor), BEFORE the web
-- update of the same day is merged. One transaction: all or nothing. Safe to run again; it deletes nothing and changes no row of
-- before (two new functions for FALCON's server only).

begin;
set local client_min_messages = warning;

-- FALCON · migration 0015 · opened from HR – no second sign-in (his decision of 23-11-2026: "falcon la erp madhe nahi hr madhe
-- jodaych … erp madhe hr aahe ani falcon hr madhe asel"; the pictures N6–N8 approved: "ho banaw"). An employee signed in to RCL's HR
-- app taps "Mess": HR's server signs a pass for him (his RCL ID, name, mobile, site – nothing else), good for 2 minutes and once
-- (the pass's number is kept in portal_tickets_used – server_use_ticket – as the Portal's tickets are). FALCON's server checks it and:
--   * server_hr_pass_account – who the pass is for in FALCON (his RCL ID, else his mobile) and the sign-in account to use: his own,
--     else an account that already has this mobile (he took a WhatsApp code once). Nothing is changed by it.
--   * server_hr_pass_person – the person found or made as HR says, his sign-in account joined to him. A person stopped in FALCON
--     (rejected / suspended) stays stopped; a person joined to ANOTHER account is refused (never two accounts for one person).
-- Both for FALCON's server only. Safe to run again.

create or replace function public.server_hr_pass_account(p_company_code text, p_rcl_id text, p_mobile text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; p public.people; au uuid; em text;
begin
  select * into c from public.companies where code = upper(p_company_code) and active;
  if not found then raise exception 'Company % is not in FALCON.', p_company_code using errcode = '22023'; end if;
  select * into p from public.people where company_id = c.id and rcl_id = upper(trim(p_rcl_id));
  if not found and p_mobile is not null then
    select * into p from public.people where company_id = c.id and mobile = p_mobile;
  end if;
  if p.id is not null and p.state in ('rejected', 'suspended') then
    raise exception 'Your FALCON access is %. Ask the Site Admin.', p.state using errcode = '42501';
  end if;
  au := p.auth_user_id;
  if au is null and p_mobile is not null then
    select id into au from auth.users where phone = ltrim(p_mobile, '+') order by created_at limit 1;
  end if;
  if au is not null then select email into em from auth.users where id = au; end if;
  return jsonb_build_object('person', p.id, 'auth_user', au, 'email', em);
end $$;

create or replace function public.server_hr_pass_person(p_company_code text, p_auth_user uuid, p_rcl_id text, p_name text,
  p_mobile text, p_site_code text default null, p_designation text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.companies; p public.people; s public.sites; rid text := upper(trim(p_rcl_id)); how text;
begin
  select * into c from public.companies where code = upper(p_company_code) and active;
  if not found then raise exception 'Company % is not in FALCON.', p_company_code using errcode = '22023'; end if;
  if rid !~ '^[A-Z0-9-]{2,20}$' then raise exception 'HR''s pass has no employee code.' using errcode = '22023'; end if;
  if p_mobile is null or p_mobile !~ '^\+91[6-9][0-9]{9}$' then raise exception 'HR has no mobile for you.' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users where id = p_auth_user) then raise exception 'No such sign-in account.' using errcode = '22023'; end if;
  select * into s from public.sites where company_id = c.id and code = upper(trim(coalesce(p_site_code, '')));

  select * into p from public.people where auth_user_id = p_auth_user;
  if found then
    if p.rcl_id is not null and p.rcl_id <> rid then
      raise exception 'This sign-in belongs to another employee – ask the Site Admin.' using errcode = '42501';
    end if;
    how := 'known';
  else
    select * into p from public.people where company_id = c.id and rcl_id = rid;
    if not found then select * into p from public.people where company_id = c.id and mobile = p_mobile; end if;
    if found then how := 'joined'; end if;
  end if;

  if p.id is not null then
    if p.company_id <> c.id then raise exception 'This sign-in belongs to another company.' using errcode = '42501'; end if;
    if p.state in ('rejected', 'suspended') then raise exception 'Your FALCON access is %. Ask the Site Admin.', p.state using errcode = '42501'; end if;
    if p.kind <> 'employee' then raise exception 'This mobile is a % in FALCON – the Site Admin joins it to your employee code.', replace(p.kind::text, '_', ' ') using errcode = '22023'; end if;
    if p.auth_user_id is not null and p.auth_user_id <> p_auth_user then
      raise exception 'You are signed in to FALCON from another account – ask the Site Admin.' using errcode = '42501';
    end if;
    update public.people set
      auth_user_id = p_auth_user,
      rcl_id = coalesce(rcl_id, case when not exists (select 1 from public.people x where x.company_id = c.id and x.rcl_id = rid and x.id <> p.id) then rid end),
      mobile = coalesce(mobile, p_mobile),
      home_site_id = coalesce(home_site_id, s.id),
      work_role = coalesce(work_role, nullif(trim(p_designation), '')),
      state = case when state in ('verified', 'id_assigned', 'linked') then state else 'linked' end,
      temporary_until = case when state = 'temporary' then null else temporary_until end
    where id = p.id returning * into p;
  else
    insert into public.people (company_id, kind, auth_user_id, full_name, mobile, state, rcl_id, home_site_id, work_role)
    values (c.id, 'employee', p_auth_user, coalesce(nullif(trim(p_name), ''), rid), p_mobile, 'linked', rid, s.id, nullif(trim(p_designation), ''))
    returning * into p;
    how := 'made';
  end if;
  insert into public.audit_log (company_id, site_id, actor, action, entity, entity_id, after, how)
  values (c.id, p.home_site_id, p.id, 'opened_from_hr', 'people', p.id::text, jsonb_build_object('rcl_id', rid, 'site', s.code, 'how', how), 'hr_pass');
  return jsonb_build_object('person', p.id, 'state', p.state, 'how', how);
end $$;

revoke all on function public.server_hr_pass_account(text, text, text),
  public.server_hr_pass_person(text, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.server_hr_pass_account(text, text, text),
  public.server_hr_pass_person(text, uuid, text, text, text, text, text) to service_role;

commit;
