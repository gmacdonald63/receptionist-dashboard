-- Fix RLS: allow both anon and authenticated users to insert leads.
-- Original policy only allowed anon, which caused 403s when tested
-- while logged into the dashboard (requests go out as authenticated).
drop policy if exists "Anyone can insert leads" on public.landing_page_leads;

create policy "Anyone can insert leads"
  on public.landing_page_leads
  for insert to anon, authenticated
  with check (true);
