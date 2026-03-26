-- supabase/migrations/20260325004_client_staff.sql

CREATE TABLE client_staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email       text NOT NULL,
  UNIQUE(client_id, email),  -- same person can be dispatcher for multiple clients
  name        text NOT NULL,
  role        text NOT NULL DEFAULT 'dispatcher',
  active      bool NOT NULL DEFAULT true,
  invited_at  timestamptz DEFAULT now()
);

ALTER TABLE client_staff ENABLE ROW LEVEL SECURITY;

-- Staff read their own row (for resolveRole() lookup)
CREATE POLICY "staff_read_own" ON client_staff
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Owners manage staff for their client
CREATE POLICY "owner_manage_staff" ON client_staff
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
