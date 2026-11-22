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
