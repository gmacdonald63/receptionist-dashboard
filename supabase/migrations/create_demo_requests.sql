-- Create demo_requests table for landing page form submissions
CREATE TABLE IF NOT EXISTS demo_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE demo_requests ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (landing page form submissions)
CREATE POLICY "Allow anonymous inserts" ON demo_requests
  FOR INSERT
  WITH CHECK (true);

-- Allow authenticated admins to read all requests
CREATE POLICY "Allow admin reads" ON demo_requests
  FOR SELECT
  USING (true);
