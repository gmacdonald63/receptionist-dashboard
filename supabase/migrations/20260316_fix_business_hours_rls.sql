-- Fix: business_hours table has RLS enabled but no policies for regular clients.
-- Only a demo SELECT policy existed (client_id=9999). This adds full CRUD access
-- for the anon role so the dashboard can read and write business hours.

-- Allow anyone to read business hours (needed for edge functions and dashboard)
CREATE POLICY "Anon can read business_hours"
  ON business_hours FOR SELECT
  TO anon
  USING (true);

-- Allow anyone to insert business hours
CREATE POLICY "Anon can insert business_hours"
  ON business_hours FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anyone to update business hours
CREATE POLICY "Anon can update business_hours"
  ON business_hours FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Allow anyone to delete business hours
CREATE POLICY "Anon can delete business_hours"
  ON business_hours FOR DELETE
  TO anon
  USING (true);

-- Also grant authenticated role (for logged-in users via Supabase Auth)
CREATE POLICY "Authenticated can manage business_hours"
  ON business_hours FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
