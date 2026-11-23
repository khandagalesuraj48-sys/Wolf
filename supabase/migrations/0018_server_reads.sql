-- FALCON · migration 0018 · the server may READ what the Mess card shows (his picture of 23-11-2026: HR's Mess card said
-- "42501 permission denied for table companies"; his check: service_role has only REFERENCES, TRIGGER, TRUNCATE on companies).
--   This Supabase project gives its server role (service_role) NO reading of new tables by itself. FALCON's server reads only
--   through its own functions – except the Mess card HR asks for (api/hr.js), which reads five tables: the company, the site, its
--   messes, their meal times and today's menu. It may now READ those five – nothing else, no writing.
--   (service_role passes the row rules anyway; only this server holds its key – never a page or an app.) Safe to run again.
grant select on public.companies, public.sites, public.messes, public.meal_windows, public.menus to service_role;
