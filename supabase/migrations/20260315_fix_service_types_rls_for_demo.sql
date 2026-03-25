-- Fix: service_types RLS policy blocks demo mode from reading client 9999's service types.
--
-- The current authenticated policy restricts reads to the user's own client_id,
-- but demo mode queries service_types for client_id 9999 while logged in as a
-- different user. Service types are non-sensitive reference data (service names
-- and durations), so authenticated users can safely read all of them.

-- Drop the restrictive policy
DROP POLICY IF EXISTS "Users can read own client service types" ON service_types;

-- Replace with a permissive policy matching the anon policy
CREATE POLICY "Authenticated users can read all service types"
  ON service_types FOR SELECT
  TO authenticated
  USING (true);
