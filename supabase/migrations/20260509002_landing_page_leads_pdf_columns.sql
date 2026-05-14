alter table public.landing_page_leads
  add column if not exists pdf_storage_path text,
  add column if not exists prospect_email_sent_at timestamptz;

-- Storage bucket for generated audit PDFs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audit-pdfs', 'audit-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- Service role write access
create policy "Service role can write audit PDFs"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'audit-pdfs');

create policy "Service role can update audit PDFs"
  on storage.objects for update
  to service_role
  using (bucket_id = 'audit-pdfs');

create policy "Service role can delete audit PDFs"
  on storage.objects for delete
  to service_role
  using (bucket_id = 'audit-pdfs');

-- Authenticated dashboard users can read
create policy "Authenticated users can read audit PDFs"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'audit-pdfs');
