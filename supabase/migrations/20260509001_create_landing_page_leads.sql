create table public.landing_page_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Form inputs
  name text not null,
  company text not null,
  email text not null,
  phone text not null,

  -- Calculator inputs at time of submission
  missed_calls_per_day int not null,
  avg_job_value numeric not null,
  booking_rate numeric not null,

  -- Calculated outputs at time of submission (snapshot, in case we change formulas later)
  lost_revenue_per_month numeric not null,
  lost_jobs_per_month int not null,
  missed_calls_per_month int not null,

  -- Source tracking
  landing_page text not null default 'missed-revenue',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  user_agent text,
  referrer text,

  -- Lead status (sales rep updates this later)
  status text not null default 'new',
  assigned_to text,
  notes text
);

-- RLS: only authenticated users (the dashboard) can read; anyone can insert
alter table public.landing_page_leads enable row level security;

create policy "Anyone can insert leads"
  on public.landing_page_leads
  for insert to anon
  with check (true);

create policy "Authenticated users can read leads"
  on public.landing_page_leads
  for select to authenticated
  using (true);

create policy "Authenticated users can update leads"
  on public.landing_page_leads
  for update to authenticated
  using (true);
