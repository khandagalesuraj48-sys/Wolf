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
