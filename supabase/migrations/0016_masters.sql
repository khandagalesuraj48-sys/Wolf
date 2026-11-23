-- FALCON · migration 0016 · the masters: Edit, Remove and From date on every record, and the Km by itself (his words of
-- 23-11-2026: "pratek gost edit delet fromdate as sagle asaw proper"; the pictures M1–M8 approved: "tu dilel pages images approved
-- aahe sagle ek sath banwayla ghe"; his answers: a removal leaves the list and stays in the record; "KM mi kuthe taknar nahi apan
-- coordinated denar aahot auto km" – the Km in the order of the sections, the first one Km 0).
--   * sites, circles, sections, messes, contractors: "From" (valid_from) and "Till" (valid_to – the last day in use; one day before
--     its From = never in use), and who removed it, when and why (removed_at, removed_by, removed_reason). A record is in use on a
--     day between its From and its Till (public.in_use).
--   * the dated versions (meal_windows, rates, penalty_rules), the papers (contractor_documents) and the work orders: removed_at /
--     _by / _reason. A version removed before its first day (a waiting rate withdrawn, a draft work order) is out of every rule and
--     every count; one already in use is ENDED instead (its Till) – never wiped out.
--   * office_remove – Remove from a date (today or later) with the reason; office_meal_times / office_penalty / office_rate_edit –
--     Edit from a date (a new version; the days before keep the old one) or a correction from its start; office_note – the "why"
--     of a plain edit; office_history – the History of one record: who, when, before → after, why.
--   * the Km: public.site_km – a site's sections that have a place, in the order of their circle and code (A1, A2 … B1 …): the
--     first Km 0, each next one the distance from the one before; a circle's Km from–to from its sections. It runs by itself when
--     a section's place, code, circle or dates change.
--   * the rules that read these (request_order, kitchen_decide, order_for_guest, start_places, rate_on, build_bill, decide_rate,
--     daily_alerts, server_door, server_contractor_mobile) are the same, with only these filters added.
-- Nothing is deleted. No row of before is changed except the Km of the sections that have a place (worked out from their places –
-- his word) and the Km of their circles. Safe to run again.

-- ── the new columns ──────────────────────────────────────────────────────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['sites', 'circles', 'sections', 'messes', 'contractors'] loop
    execute format('alter table public.%I add column if not exists valid_from date, add column if not exists valid_to date', t);
    if not exists (select 1 from pg_constraint where conname = t || '_dates_ok' and conrelid = format('public.%I', t)::regclass) then
      execute format('alter table public.%I add constraint %I check (valid_to is null or valid_from is null or valid_to >= valid_from - 1)', t, t || '_dates_ok');
    end if;
  end loop;
  foreach t in array array['sites', 'circles', 'sections', 'messes', 'contractors', 'contractor_documents', 'meal_windows', 'rates',
                           'penalty_rules', 'work_orders'] loop
    execute format('alter table public.%I add column if not exists removed_at timestamptz, '
                   'add column if not exists removed_by uuid references public.people(id), add column if not exists removed_reason text', t);
    if not exists (select 1 from pg_constraint where conname = t || '_removed_why' and conrelid = format('public.%I', t)::regclass) then
      execute format('alter table public.%I add constraint %I check (removed_at is null or (removed_by is not null and length(trim(coalesce(removed_reason, ''''))) >= 3))',
                     t, t || '_removed_why');
    end if;
  end loop;
end $$;

-- ── one version a day, among the versions not removed ─────────────────────────────────────────────────────────────────────
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'meal_windows_mess_id_meal_daterange_excl') then
    alter table public.meal_windows drop constraint meal_windows_mess_id_meal_daterange_excl;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meal_windows_one_version') then
    alter table public.meal_windows add constraint meal_windows_one_version
      exclude using gist (mess_id with =, meal with =, daterange(valid_from, valid_to, '[]') with &&) where (removed_at is null);
  end if;
  if exists (select 1 from pg_constraint where conname = 'penalty_rules_work_order_id_code_daterange_excl') then
    alter table public.penalty_rules drop constraint penalty_rules_work_order_id_code_daterange_excl;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'penalty_rules_one_version') then
    alter table public.penalty_rules add constraint penalty_rules_one_version
      exclude using gist (work_order_id with =, code with =, daterange(valid_from, valid_to, '[]') with &&) where (removed_at is null);
  end if;
  if exists (select 1 from pg_constraint where conname = 'rates_work_order_id_item_id_daterange_excl') then
    alter table public.rates drop constraint rates_work_order_id_item_id_daterange_excl;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rates_one_approved') then
    alter table public.rates add constraint rates_one_approved
      exclude using gist (work_order_id with =, item_id with =, daterange(valid_from, valid_to, '[]') with &&)
      where (state = 'approved' and removed_at is null);
  end if;
end $$;

-- ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- In use on a day (today when no day is given): between its From and its Till.
create or replace function public.in_use(p_from date, p_to date, p_day date default null) returns boolean
language sql stable set search_path = '' as $$
  select (p_from is null or p_from <= coalesce(p_day, public.local_today())) and (p_to is null or p_to >= coalesce(p_day, public.local_today()))
$$;

-- metres between two points (the straight line)
create or replace function public.metres_between(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric) returns numeric
language sql immutable set search_path = '' as $$
  select (2 * 6371000 * asin(least(1, sqrt(power(sin(radians((b_lat - a_lat)::float8) / 2), 2)
    + cos(radians(a_lat::float8)) * cos(radians(b_lat::float8)) * power(sin(radians((b_lng - a_lng)::float8) / 2), 2)))))::numeric
$$;

-- The company a record of the masters belongs to (null: no such record, or not one of these).
create or replace function public.office_company_of(p_entity text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_entity
    when 'sites' then (select company_id from public.sites where id = p_id)
    when 'circles' then (select s.company_id from public.circles x join public.sites s on s.id = x.site_id where x.id = p_id)
    when 'sections' then (select s.company_id from public.sections x join public.sites s on s.id = x.site_id where x.id = p_id)
    when 'messes' then (select company_id from public.messes where id = p_id)
    when 'contractors' then (select company_id from public.contractors where id = p_id)
    when 'contractor_documents' then (select c.company_id from public.contractor_documents d join public.contractors c on c.id = d.contractor_id where d.id = p_id)
    when 'meal_windows' then (select m.company_id from public.meal_windows w join public.messes m on m.id = w.mess_id where w.id = p_id)
    when 'work_orders' then (select company_id from public.work_orders where id = p_id)
    when 'rates' then (select w.company_id from public.rates r join public.work_orders w on w.id = r.work_order_id where r.id = p_id)
    when 'penalty_rules' then (select w.company_id from public.penalty_rules r join public.work_orders w on w.id = r.work_order_id where r.id = p_id)
    when 'work_order_boq' then (select w.company_id from public.work_order_boq b join public.work_orders w on w.id = b.work_order_id where b.id = p_id)
  end
$$;

-- ── the Km by itself ──────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.site_km(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; plat numeric; plng numeric; acc numeric := 0; first boolean := true; k numeric;
begin
  for r in select x.id, x.lat, x.lng from public.sections x join public.circles ci on ci.id = x.circle_id
           where x.site_id = p_site and x.active and public.in_use(x.valid_from, x.valid_to) and x.lat is not null and x.lng is not null
           order by regexp_replace(ci.code, '[0-9]+', '', 'g'), coalesce(substring(ci.code from '[0-9]+')::numeric, 0), ci.code,
                    regexp_replace(x.code, '[0-9]+', '', 'g'), coalesce(substring(x.code from '[0-9]+')::numeric, 0), x.code loop
    if not first then acc := acc + public.metres_between(plat, plng, r.lat, r.lng); end if;
    k := round(acc / 1000.0, 3);
    update public.sections set km = k where id = r.id and km is distinct from k;
    plat := r.lat; plng := r.lng; first := false;
  end loop;
  update public.circles ci set km_from = q.lo, km_to = case when q.hi > q.lo then q.hi end
  from (select circle_id, min(km) lo, max(km) hi from public.sections
        where site_id = p_site and active and public.in_use(valid_from, valid_to) and lat is not null and lng is not null and km is not null
        group by circle_id) q
  where ci.id = q.circle_id and (ci.km_from is distinct from q.lo or ci.km_to is distinct from (case when q.hi > q.lo then q.hi end));
end $$;

create or replace function public.sections_km() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.site_km(new.site_id);
  if tg_op = 'UPDATE' and old.site_id is distinct from new.site_id then perform public.site_km(old.site_id); end if;
  return null;
end $$;
drop trigger if exists sections_km on public.sections;
create trigger sections_km after insert or update of lat, lng, code, circle_id, active, valid_from, valid_to on public.sections
  for each row execute function public.sections_km();
drop trigger if exists circles_km on public.circles;
create trigger circles_km after update of code, active, valid_from, valid_to on public.circles
  for each row execute function public.sections_km();

-- ── Remove from a date, with the reason ────────────────────────────────────────────────────────────────────────────────
-- p_kind: site · circle · section · mess · contractor · paper · meal_time · rate · penalty · work_order. Returns {how, till}.
create or replace function public.office_remove(p_kind text, p_id uuid, p_from date, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me(); t date := public.local_today(); why text := nullif(trim(coalesce(p_reason, '')), '');
  ent text; j jsonb; site uuid; vf date; vt date; till date; n integer; ok boolean;
  w public.meal_windows; p public.penalty_rules; r public.rates; o public.work_orders; d public.contractor_documents; m public.messes;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if why is null or length(why) < 3 then raise exception 'Write the reason for removing it.' using errcode = '22023'; end if;
  if p_from is null or p_from < t then
    raise exception 'Remove from today or a later day – the days before stay as they are.' using errcode = '22023';
  end if;
  ent := case p_kind when 'site' then 'sites' when 'circle' then 'circles' when 'section' then 'sections' when 'mess' then 'messes'
    when 'contractor' then 'contractors' when 'paper' then 'contractor_documents' when 'meal_time' then 'meal_windows'
    when 'rate' then 'rates' when 'penalty' then 'penalty_rules' when 'work_order' then 'work_orders' end;
  if ent is null then raise exception 'Nothing of this kind is removed here.' using errcode = '22023'; end if;
  if public.office_company_of(ent, p_id) is distinct from public.my_company() then raise exception 'Not found.' using errcode = '42501'; end if;

  -- the masters: in use till the day before
  if p_kind in ('site', 'circle', 'section', 'mess', 'contractor') then
    execute format('select to_jsonb(x) from public.%I x where id = $1', ent) into j using p_id;
    site := case when p_kind = 'site' then p_id else (j ->> 'site_id')::uuid end;
    ok := case p_kind
         when 'site' then public.has_role(array['system_admin']::public.app_role[])
         when 'circle' then public.has_role(array['system_admin']::public.app_role[])
         when 'contractor' then public.has_role(array['system_admin', 'accounts']::public.app_role[])
         else public.has_role(array['system_admin', 'site_admin']::public.app_role[], site) end;
    if not ok then raise exception 'Removing this is not your work.' using errcode = '42501'; end if;
    if j ->> 'removed_at' is not null then raise exception 'It was removed already.' using errcode = '22023'; end if;
    vf := (j ->> 'valid_from')::date; vt := (j ->> 'valid_to')::date;
    till := greatest(p_from, coalesce(vf, p_from)) - 1;
    if vt is not null and vt < till then raise exception 'It is in use only till % already.', to_char(vt, 'DD Mon YYYY') using errcode = '22023'; end if;
    -- what still hangs on it on that day stays first
    if p_kind = 'site' then
      select count(*) into n from public.messes x where x.site_id = p_id and x.removed_at is null and (x.valid_to is null or x.valid_to >= p_from);
      if n > 0 then raise exception 'This site has % mess(es) in use – remove them first.', n using errcode = '22023'; end if;
      select count(*) into n from public.circles x where x.site_id = p_id and x.removed_at is null and (x.valid_to is null or x.valid_to >= p_from);
      if n > 0 then raise exception 'This site has % circle(s) in use – remove them first.', n using errcode = '22023'; end if;
    elsif p_kind = 'circle' then
      select count(*) into n from public.sections x where x.circle_id = p_id and x.removed_at is null and (x.valid_to is null or x.valid_to >= p_from);
      if n > 0 then raise exception 'This circle has % section(s) in use – remove them first.', n using errcode = '22023'; end if;
    elsif p_kind = 'contractor' then
      select * into m from public.messes x where x.contractor_id = p_id and x.removed_at is null and (x.valid_to is null or x.valid_to >= p_from) limit 1;
      if found then raise exception '% is the contractor of % – give that mess another contractor, or remove it, first.', j ->> 'name', m.name using errcode = '22023'; end if;
    end if;
    execute format('update public.%I set valid_to = $2, removed_at = now(), removed_by = $3, removed_reason = $4 where id = $1', ent)
      using p_id, till, me, why;
    return jsonb_build_object('how', 'removed', 'till', till);
  end if;

  if p_kind = 'paper' then
    select * into d from public.contractor_documents where id = p_id for update;
    if not public.has_role(array['site_admin', 'accounts', 'system_admin']::public.app_role[]) then
      raise exception 'Removing a paper is not your work.' using errcode = '42501';
    end if;
    if d.removed_at is not null then raise exception 'It was removed already.' using errcode = '22023'; end if;
    update public.contractor_documents set removed_at = now(), removed_by = me, removed_reason = why where id = d.id;
    return jsonb_build_object('how', 'removed');
  end if;

  if p_kind = 'meal_time' then
    select * into w from public.meal_windows where id = p_id for update;
    select * into m from public.messes where id = w.mess_id;
    if not public.has_role(array['system_admin', 'site_admin']::public.app_role[], m.site_id) then
      raise exception 'Removing meal times is not your work.' using errcode = '42501';
    end if;
    if w.removed_at is not null then raise exception 'It was removed already.' using errcode = '22023'; end if;
    if p_from <= w.valid_from then
      update public.meal_windows set removed_at = now(), removed_by = me, removed_reason = why where id = w.id;
      return jsonb_build_object('how', 'removed');
    end if;
    if w.valid_to is not null and w.valid_to < p_from then raise exception 'These times end on % already.', to_char(w.valid_to, 'DD Mon YYYY') using errcode = '22023'; end if;
    update public.meal_windows set valid_to = p_from - 1 where id = w.id;
    perform public.audit_write('end', 'meal_windows', w.id::text, null, jsonb_build_object('till', p_from - 1), m.site_id, 'office', why);
    return jsonb_build_object('how', 'ended', 'till', p_from - 1);
  end if;

  if not public.has_role(array['system_admin', 'accounts']::public.app_role[]) then
    raise exception 'Only Accounts or the System Admin change a work order, its rates and its penalties.' using errcode = '42501';
  end if;

  if p_kind = 'penalty' then
    select * into p from public.penalty_rules where id = p_id for update;
    if p.removed_at is not null then raise exception 'It was removed already.' using errcode = '22023'; end if;
    if p_from <= p.valid_from then
      update public.penalty_rules set removed_at = now(), removed_by = me, removed_reason = why where id = p.id;
      return jsonb_build_object('how', 'removed');
    end if;
    if p.valid_to is not null and p.valid_to < p_from then raise exception 'This penalty ends on % already.', to_char(p.valid_to, 'DD Mon YYYY') using errcode = '22023'; end if;
    update public.penalty_rules set valid_to = p_from - 1 where id = p.id;
    perform public.audit_write('end', 'penalty_rules', p.id::text, null, jsonb_build_object('till', p_from - 1), null, 'office', why);
    return jsonb_build_object('how', 'ended', 'till', p_from - 1);
  end if;

  if p_kind = 'rate' then
    select * into r from public.rates where id = p_id for update;
    if r.removed_at is not null then raise exception 'It was withdrawn already.' using errcode = '22023'; end if;
    if r.state = 'refused' then raise exception 'A refused rate is not in use – nothing to remove.' using errcode = '22023'; end if;
    if r.state = 'waiting' or p_from <= r.valid_from then
      update public.rates set removed_at = now(), removed_by = me, removed_reason = why where id = r.id;
      return jsonb_build_object('how', case when r.state = 'waiting' then 'withdrawn' else 'removed' end);
    end if;
    if r.valid_to is not null and r.valid_to < p_from then raise exception 'This rate ends on % already.', to_char(r.valid_to, 'DD Mon YYYY') using errcode = '22023'; end if;
    update public.rates set valid_to = p_from - 1 where id = r.id;
    perform public.audit_write('end', 'rates', r.id::text, null, jsonb_build_object('till', p_from - 1), null, 'office', why);
    return jsonb_build_object('how', 'ended', 'till', p_from - 1);
  end if;

  -- a work order: a draft (or one not started yet) is removed; a live one ends from that day
  select * into o from public.work_orders where id = p_id for update;
  if o.removed_at is not null then raise exception 'It was removed already.' using errcode = '22023'; end if;
  if o.state = 'closed' then raise exception 'This work order is closed already.' using errcode = '22023'; end if;
  if o.state = 'draft' or p_from <= o.valid_from then
    update public.work_orders set removed_at = now(), removed_by = me, removed_reason = why,
      state = case when o.state = 'active' then 'closed'::public.wo_state else o.state end where id = o.id;
    return jsonb_build_object('how', 'removed');
  end if;
  if o.valid_to < p_from then raise exception 'This work order ends on % already.', to_char(o.valid_to, 'DD Mon YYYY') using errcode = '22023'; end if;
  update public.work_orders set valid_to = p_from - 1 where id = o.id;
  perform public.audit_write('end', 'work_orders', o.id::text, null, jsonb_build_object('till', p_from - 1), o.site_id, 'office', why);
  return jsonb_build_object('how', 'ended', 'till', p_from - 1);
end $$;

-- ── Edit meal times: from a date (a new version) or a correction from its start; or new times for a meal ─────────────────────
-- p_window given: that version is edited (p_from null or on/before its first day = corrected; a later day = new times from it).
-- p_window null: new times for p_meal from p_from (the version on that day ends the day before).
create or replace function public.office_meal_times(p_mess uuid, p_meal public.meal, p_window uuid, p_from date, p_serve_from time,
  p_serve_to time, p_order_by time, p_change integer, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.messes; w public.meal_windows; t date := public.local_today(); nto date; nid uuid; why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into m from public.messes where id = p_mess and company_id = public.my_company();
  if not found then raise exception 'Mess not found.' using errcode = '42501'; end if;
  if not public.has_role(array['system_admin', 'site_admin']::public.app_role[], m.site_id) then
    raise exception 'Setting the meal times is not your work.' using errcode = '42501';
  end if;
  if p_serve_from is null or p_serve_to is null or p_order_by is null then raise exception 'Give the serving times and the parcel order time.' using errcode = '22023'; end if;
  if p_serve_to <= p_serve_from then raise exception 'Serving ends after it starts.' using errcode = '22023'; end if;
  if p_change is null or p_change not between 0 and 240 then raise exception 'The change window is 0 to 240 minutes.' using errcode = '22023'; end if;
  if p_window is not null then
    select * into w from public.meal_windows where id = p_window and mess_id = m.id and removed_at is null for update;
    if not found then raise exception 'These times are not there.' using errcode = '22023'; end if;
    if p_from is null or p_from <= w.valid_from then
      if w.valid_to is not null and w.valid_to < t then
        raise exception 'Ended times are kept as they were – give new times from a date.' using errcode = '22023';
      end if;
      update public.meal_windows set serve_from = p_serve_from, serve_to = p_serve_to, order_by = p_order_by, change_minutes = p_change
       where id = w.id;
      nid := w.id;
    else
      if p_from < t then raise exception 'New times start today or later – the days before keep their times.' using errcode = '22023'; end if;
      if w.valid_to is not null and p_from > w.valid_to then
        raise exception 'These times end on % – choose a day up to it.', to_char(w.valid_to, 'DD Mon YYYY') using errcode = '22023';
      end if;
      update public.meal_windows set valid_to = p_from - 1 where id = w.id;
      insert into public.meal_windows (mess_id, meal, serve_from, serve_to, order_by, change_minutes, valid_from, valid_to)
      values (m.id, w.meal, p_serve_from, p_serve_to, p_order_by, p_change, p_from, w.valid_to) returning id into nid;
    end if;
  else
    if p_meal is null then raise exception 'Choose the meal.' using errcode = '22023'; end if;
    if p_from is null or p_from < t then raise exception 'New times start today or later – the days before keep their times.' using errcode = '22023'; end if;
    select * into w from public.meal_windows where mess_id = m.id and meal = p_meal and removed_at is null
      and valid_from <= p_from and (valid_to is null or valid_to >= p_from) for update;
    if found then
      if w.valid_from = p_from then raise exception 'Times from that day are there already – Edit them.' using errcode = '22023'; end if;
      update public.meal_windows set valid_to = p_from - 1 where id = w.id;
      nto := w.valid_to;
    else
      select min(valid_from) - 1 into nto from public.meal_windows where mess_id = m.id and meal = p_meal and removed_at is null and valid_from > p_from;
    end if;
    insert into public.meal_windows (mess_id, meal, serve_from, serve_to, order_by, change_minutes, valid_from, valid_to)
    values (m.id, p_meal, p_serve_from, p_serve_to, p_order_by, p_change, p_from, nto) returning id into nid;
  end if;
  if why is not null then perform public.audit_write('reason', 'meal_windows', nid::text, null, null, m.site_id, 'office', why); end if;
  return nid;
end $$;

-- ── Edit a penalty the same way (keyed by its code in the work order) ───────────────────────────────────────────────────
create or replace function public.office_penalty(p_work_order uuid, p_rule uuid, p_from date, p_code text, p_what text, p_amount numeric,
  p_per text, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.work_orders; p public.penalty_rules; t date := public.local_today(); nto date; nid uuid; c text := lower(trim(coalesce(p_code, '')));
  why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into o from public.work_orders where id = p_work_order and company_id = public.my_company();
  if not found then raise exception 'Work order not found.' using errcode = '42501'; end if;
  if not public.has_role(array['system_admin', 'accounts']::public.app_role[]) then
    raise exception 'Only Accounts or the System Admin set the penalties.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_what, ''))) < 3 then raise exception 'Write what the penalty is for.' using errcode = '22023'; end if;
  if p_amount is not null and p_amount < 0 then raise exception 'The amount is 0 or more.' using errcode = '22023'; end if;
  if p_per not in ('batch', 'case', 'day', 'month') then raise exception 'Choose: a batch, a case, a day or a month.' using errcode = '22023'; end if;
  if p_rule is not null then
    select * into p from public.penalty_rules where id = p_rule and work_order_id = o.id and removed_at is null for update;
    if not found then raise exception 'This penalty is not there.' using errcode = '22023'; end if;
    if p_from is null or p_from <= p.valid_from then
      if p.valid_to is not null and p.valid_to < t then raise exception 'An ended penalty is kept as it was – give a new one from a date.' using errcode = '22023'; end if;
      update public.penalty_rules set what = trim(p_what), amount = p_amount, per = p_per where id = p.id;
      nid := p.id;
    else
      if p_from < t then raise exception 'A change starts today or later.' using errcode = '22023'; end if;
      if p.valid_to is not null and p_from > p.valid_to then raise exception 'This penalty ends on % – choose a day up to it.', to_char(p.valid_to, 'DD Mon YYYY') using errcode = '22023'; end if;
      update public.penalty_rules set valid_to = p_from - 1 where id = p.id;
      insert into public.penalty_rules (work_order_id, code, what, amount, per, valid_from, valid_to)
      values (o.id, p.code, trim(p_what), p_amount, p_per, p_from, p.valid_to) returning id into nid;
    end if;
  else
    if c !~ '^[a-z][a-z0-9_]{1,30}$' then raise exception 'The code is small letters, numbers and _ (e.g. late_van).' using errcode = '22023'; end if;
    if p_from is null then raise exception 'Choose the day it starts.' using errcode = '22023'; end if;
    select * into p from public.penalty_rules where work_order_id = o.id and code = c and removed_at is null
      and valid_from <= p_from and (valid_to is null or valid_to >= p_from) for update;
    if found then
      if p.valid_from = p_from then raise exception 'This penalty starts on that day already – Edit it.' using errcode = '22023'; end if;
      if p_from < t then raise exception 'A change starts today or later.' using errcode = '22023'; end if;
      update public.penalty_rules set valid_to = p_from - 1 where id = p.id;
      nto := p.valid_to;
    else
      select min(valid_from) - 1 into nto from public.penalty_rules where work_order_id = o.id and code = c and removed_at is null and valid_from > p_from;
    end if;
    insert into public.penalty_rules (work_order_id, code, what, amount, per, valid_from, valid_to)
    values (o.id, c, trim(p_what), p_amount, p_per, p_from, nto) returning id into nid;
  end if;
  if why is not null then perform public.audit_write('reason', 'penalty_rules', nid::text, null, null, o.site_id, 'office', why); end if;
  return nid;
end $$;

-- ── Edit a rate: a waiting one is corrected; an approved one not in a bill is corrected and waits for Accounts again; one in a
-- bill gets a new rate from a later date (the bills made stay as they are). Nobody approves the rate he asked (decide_rate). ──
create or replace function public.office_rate_edit(p_rate uuid, p_value numeric, p_from date, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rates; o public.work_orders; me uuid := public.me(); billed_to date; nid uuid; how text;
  why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into r from public.rates where id = p_rate for update;
  select * into o from public.work_orders where id = r.work_order_id and company_id = public.my_company();
  if r.id is null or o.id is null then raise exception 'Rate not found.' using errcode = '42501'; end if;
  if not public.has_role(array['system_admin', 'accounts']::public.app_role[]) then
    raise exception 'Only Accounts or the System Admin change a rate.' using errcode = '42501';
  end if;
  if r.removed_at is not null then raise exception 'This rate was withdrawn – ask a new one.' using errcode = '22023'; end if;
  if r.state = 'refused' then raise exception 'A refused rate is not changed – ask a new one.' using errcode = '22023'; end if;
  if p_value is null or p_value < 0 then raise exception 'The rate is 0 or more.' using errcode = '22023'; end if;
  -- the last day a bill of this work order is made for, among the days of this rate
  select max((b.month + interval '1 month')::date - 1) into billed_to from public.monthly_bills b
   where b.work_order_id = r.work_order_id and b.month <= coalesce(r.valid_to, b.month)
     and (b.month + interval '1 month')::date - 1 >= r.valid_from;
  if r.state = 'waiting' then
    update public.rates set rate = p_value, valid_from = coalesce(p_from, r.valid_from) where id = r.id;
    nid := r.id; how := 'corrected';
  elsif billed_to is null and (p_from is null or p_from <= r.valid_from) then
    update public.rates set rate = p_value, valid_from = coalesce(p_from, r.valid_from), state = 'waiting', decided_by = null, decided_at = null,
      asked_by = me, asked_at = now(), reason = null where id = r.id;
    nid := r.id; how := 'corrected – waits for approval';
  else
    if p_from is null or p_from <= coalesce(billed_to, r.valid_from) then
      raise exception 'This rate is in a bill up to % – the new rate starts on % or later.', to_char(coalesce(billed_to, r.valid_from), 'DD Mon YYYY'),
        to_char(coalesce(billed_to, r.valid_from) + 1, 'DD Mon YYYY') using errcode = '22023';
    end if;
    if r.valid_to is not null and p_from > r.valid_to then raise exception 'This rate ends on % – a rate after it is a new rate.', to_char(r.valid_to, 'DD Mon YYYY') using errcode = '22023'; end if;
    insert into public.rates (work_order_id, item_id, rate, valid_from, state, asked_by) values (r.work_order_id, r.item_id, p_value, p_from, 'waiting', me)
    returning id into nid;
    how := 'new from a date – waits for approval';
  end if;
  if why is not null then perform public.audit_write('reason', 'rates', nid::text, null, null, o.site_id, 'office', why); end if;
  return jsonb_build_object('id', nid, 'how', how);
end $$;

-- ── the "why" of a plain edit, and the History of one record ─────────────────────────────────────────────────────────
create or replace function public.office_note(p_entity text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if why is null then return; end if;
  if public.office_company_of(p_entity, p_id) is distinct from public.my_company()
     or not public.has_role(array['system_admin', 'site_admin', 'accounts']::public.app_role[]) then
    raise exception 'Not found.' using errcode = '42501';
  end if;
  perform public.audit_write('reason', p_entity, p_id::text, null, null, null, 'office', left(why, 400));
end $$;

create or replace function public.office_history(p_entity text, p_id uuid)
returns table (at timestamptz, who text, action text, before jsonb, after jsonb, how text, reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.office_company_of(p_entity, p_id) is distinct from public.my_company()
     or not public.has_role(array['system_admin', 'site_admin', 'accounts', 'management']::public.app_role[]) then
    raise exception 'Only the office sees the History.' using errcode = '42501';
  end if;
  return query select a.at, p.full_name, a.action, a.before, a.after, a.how, a.reason
    from public.audit_log a left join public.people p on p.id = a.actor
   where a.entity = p_entity and a.entity_id = p_id::text
   order by a.at desc, a.id desc limit 200;
end $$;

-- ── the rules that read these: the same, with only the filters of above ───────────────────────────────────────────────────
-- request_order (as in 0003_orders.sql) – a mess / section not in use that day, and a removed meal-time version, are not asked
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
  select * into m from public.messes where id = p_mess and active and public.in_use(valid_from, valid_to, p_date);
  if not found or m.company_id <> who.company_id then raise exception 'This mess is not open to you.' using errcode = '42501'; end if;
  select * into s from public.sites where id = m.site_id;
  if p_date < public.local_today() then raise exception 'A day that has passed cannot be asked.' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Nothing was asked.' using errcode = '22023'; end if;
  select * into w from public.meal_windows where mess_id = p_mess and meal = p_meal and removed_at is null
    and p_date >= valid_from and (valid_to is null or p_date <= valid_to);
  if not found then raise exception 'This mess does not serve this meal on that day.' using errcode = '22023'; end if;
  dl := p_date + (case when p_kind = 'meal' then w.serve_to else w.order_by end);
  if public.local_now() > dl then
    raise exception 'Too late for this meal – asking closed at %.', to_char(dl, 'HH24:MI') using errcode = '22023';
  end if;
  if p_kind = 'delivery' and (p_section is null or not exists (select 1 from public.sections where id = p_section and site_id = m.site_id and active and public.in_use(valid_from, valid_to, p_date))) then
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


-- kitchen_decide (as in 0003_orders.sql) – a removed meal-time version gives no change window
create or replace function public.kitchen_decide(p_order uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; mins integer;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not public.is_kitchen_of_order(o.id) then raise exception 'Only this mess''s kitchen decides it.' using errcode = '42501'; end if;
  if o.state <> 'requested' or o.host_state not in ('not_needed', 'approved') then raise exception 'This request is not waiting.' using errcode = '22023'; end if;
  if p_accept then
    select coalesce(max(w.change_minutes), 0) into mins from public.meal_windows w where w.mess_id = o.mess_id and w.meal = o.meal and w.removed_at is null
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


-- order_for_guest (as in 0011_app_helpers.sql) – the same for a guest
create or replace function public.order_for_guest(p_visit uuid, p_mess uuid, p_date date, p_meal public.meal, p_kind public.order_kind,
  p_section uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.guest_visits; m public.messes; s public.sites; w public.meal_windows; it uuid; o public.orders; dl timestamp;
begin
  select * into v from public.guest_visits where id = p_visit and ended_at is null and host_id = public.me();
  if not found then raise exception 'Only the guest''s host orders for him.' using errcode = '42501'; end if;
  select * into m from public.messes where id = p_mess and site_id = v.site_id and active and public.in_use(valid_from, valid_to, p_date);
  if not found then raise exception 'Choose a mess of the guest''s site.' using errcode = '22023'; end if;
  select * into w from public.meal_windows where mess_id = p_mess and meal = p_meal and removed_at is null and p_date >= valid_from and (valid_to is null or p_date <= valid_to);
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


-- start_places (as in 0007_registration.sql) – only sites and sections in use today are offered at registration
create or replace function public.start_places(p_company text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('company', c.id, 'name', c.name, 'sites', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name, 'circle', ci.code) order by ci.code, x.code)
      from public.sections x join public.circles ci on ci.id = x.circle_id where x.site_id = s.id and x.active and public.in_use(x.valid_from, x.valid_to)), '[]')) order by s.code)
    from public.sites s where s.company_id = c.id and s.active and public.in_use(s.valid_from, s.valid_to)), '[]'))
  from public.companies c where c.code = upper(p_company) and c.active
$$;

-- rate_on (as in 0006_billing.sql) – a removed rate is never billed
create or replace function public.rate_on(p_wo uuid, p_item uuid, p_day date) returns numeric
language sql stable security definer set search_path = '' as $$
  select rate from public.rates where work_order_id = p_wo and item_id = p_item and state = 'approved' and removed_at is null
    and p_day >= valid_from and (valid_to is null or p_day <= valid_to)
$$;


-- build_bill (as in 0006_billing.sql) – a removed penalty version is never applied
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
  select * into late_rule from public.penalty_rules where work_order_id = w.id and code = 'late_van' and removed_at is null
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


-- decide_rate (as in 0002_mess_and_contracts.sql) – a withdrawn rate is not decided; approving ends only a rate that is not removed
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
  if r.removed_at is not null then raise exception 'This rate was withdrawn.' using errcode = 'P0001'; end if;
  if r.state <> 'waiting' then raise exception 'This rate was decided already.' using errcode = 'P0001'; end if;
  if r.asked_by = public.me() then raise exception 'Nobody decides the rate he asked.' using errcode = '42501'; end if;
  if p_approve then
    update public.rates set valid_to = r.valid_from - 1
     where work_order_id = r.work_order_id and item_id = r.item_id and state = 'approved' and removed_at is null
       and valid_from < r.valid_from and (valid_to is null or valid_to >= r.valid_from);
    update public.rates set state = 'approved', decided_by = public.me(), decided_at = now(), reason = p_reason where id = p_rate;
  else
    if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Refusing a rate needs the reason.' using errcode = '22023'; end if;
    update public.rates set state = 'refused', decided_by = public.me(), decided_at = now(), reason = p_reason where id = p_rate;
  end if;
end $$;


-- daily_alerts (as in 0008_notifications.sql) – no alert for a removed paper or a mess not in use
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
           where d.state <> 'rejected' and d.removed_at is null and d.valid_to - t in (60, 30, 7, 0) loop
    perform public.notify_roles(r.site_id, array['site_admin', 'accounts', 'mess_owner']::public.app_role[], 'daily_document',
      r.name || ': ' || r.kind::text || case when r.valid_to = t then ' ends today' else ' ends in ' || (r.valid_to - t) || ' days' end,
      r.number, '/admin/contractors/' || r.contractor_id || '/documents', r.mess_id);
    n := n + 1;
  end loop;
  -- yesterday not locked
  for r in select m.* from public.messes m where m.active and public.in_use(m.valid_from, m.valid_to, t - 1)
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


-- server_door (as in 0014_start_codes.sql) – a removed contractor's code opens nothing
create or replace function public.server_door(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('kind', 'company', 'code', c.code, 'name', c.name, 'company', c.code, 'company_name', c.name)
       from public.companies c where c.code = upper(trim(p_code)) and c.active),
    (select jsonb_build_object('kind', 'contractor', 'code', k.login_code, 'name', k.name, 'company', c.code, 'company_name', c.name)
       from public.contractors k join public.companies c on c.id = k.company_id
      where k.login_code = upper(trim(p_code)) and k.active and public.in_use(k.valid_from, k.valid_to) and c.active))
$$;


-- server_contractor_mobile (as in 0014_start_codes.sql) – the same for his people
create or replace function public.server_contractor_mobile(p_code text, p_mobile text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('person', p.id, 'name', p.full_name,
           'role', case when bool_or(g.role = 'mess_owner') then 'mess_owner' else 'mess_operator' end)
  from public.contractors k
  join public.messes m on m.contractor_id = k.id
  join public.role_grants g on g.mess_id = m.id and g.revoked_at is null and g.role in ('mess_owner', 'mess_operator')
       and g.valid_from <= public.local_today() and (g.valid_to is null or g.valid_to >= public.local_today())
  join public.people p on p.id = g.person_id
  where k.login_code = upper(trim(p_code)) and k.active and public.in_use(k.valid_from, k.valid_to) and p.mobile = p_mobile and p.state not in ('rejected', 'suspended')
  group by p.id, p.full_name
  limit 1
$$;


-- ── the Km of today's sections, once (his word: the Km comes from the places) ───────────────────────────────────────────────
do $$ declare s uuid; begin
  for s in select id from public.sites loop perform public.site_km(s); end loop;
end $$;

-- ── who may call what ──────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.office_remove(text, uuid, date, text), public.office_meal_times(uuid, public.meal, uuid, date, time, time, time, integer, text),
  public.office_penalty(uuid, uuid, date, text, text, numeric, text, text), public.office_rate_edit(uuid, numeric, date, text),
  public.office_note(text, uuid, text), public.office_history(text, uuid), public.office_company_of(text, uuid),
  public.site_km(uuid), public.sections_km() from public, anon;
grant execute on function public.office_remove(text, uuid, date, text), public.office_meal_times(uuid, public.meal, uuid, date, time, time, time, integer, text),
  public.office_penalty(uuid, uuid, date, text, text, numeric, text, text), public.office_rate_edit(uuid, numeric, date, text),
  public.office_note(text, uuid, text), public.office_history(text, uuid) to authenticated;
revoke all on function public.site_km(uuid), public.sections_km(), public.office_company_of(text, uuid) from authenticated;
