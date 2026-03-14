-- Add client_id to service_types so each client can have their own service catalog
-- Existing rows (HVAC services) belong to client_id = 1

-- Add the column (nullable first so we can backfill)
ALTER TABLE service_types ADD COLUMN client_id INTEGER REFERENCES clients(id);

-- Backfill existing rows to the HVAC client
UPDATE service_types SET client_id = 1;

-- Now make it NOT NULL
ALTER TABLE service_types ALTER COLUMN client_id SET NOT NULL;

-- Index for fast lookups by client
CREATE INDEX idx_service_types_client_id ON service_types(client_id);

-- Unique constraint: no duplicate service names per client
CREATE UNIQUE INDEX idx_service_types_client_name ON service_types(client_id, name);

-- Drop old RLS policies and recreate with client_id scoping
DROP POLICY IF EXISTS "Service types are readable by all authenticated users" ON service_types;
DROP POLICY IF EXISTS "Service types are readable by anon" ON service_types;
DROP POLICY IF EXISTS "Only admins can insert service types" ON service_types;
DROP POLICY IF EXISTS "Only admins can update service types" ON service_types;

-- Authenticated users can read their own client's service types
CREATE POLICY "Users can read own client service types"
  ON service_types FOR SELECT
  TO authenticated
  USING (
    client_id IN (SELECT id FROM clients WHERE email = auth.email())
    OR EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true)
  );

-- Anon can read all (needed for edge functions called by Retell with service role key)
CREATE POLICY "Anon can read service types"
  ON service_types FOR SELECT
  TO anon
  USING (true);

-- Admins can insert/update
CREATE POLICY "Admins can insert service types"
  ON service_types FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE clients.email = auth.email() AND clients.is_admin = true)
  );

CREATE POLICY "Admins can update service types"
  ON service_types FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.email = auth.email() AND clients.is_admin = true)
  );

CREATE POLICY "Admins can delete service types"
  ON service_types FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.email = auth.email() AND clients.is_admin = true)
  );
