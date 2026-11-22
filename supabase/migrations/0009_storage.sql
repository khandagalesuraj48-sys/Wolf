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
