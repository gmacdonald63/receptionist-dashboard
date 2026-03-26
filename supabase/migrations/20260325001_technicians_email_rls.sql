-- supabase/migrations/20260325001_technicians_email_rls.sql

-- Add email column (nullable — existing rows get NULL; they cannot log in until email is set)
ALTER TABLE technicians ADD COLUMN email text UNIQUE;

-- Enable RLS
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;

-- Clients manage their own techs (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "client_manage_own_techs" ON technicians
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );

-- Techs read their own row
CREATE POLICY "tech_read_own" ON technicians
  FOR SELECT USING (
    is_active = true
    AND email IS NOT NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Dispatchers read all techs for their client (needed for Team tab read-only list)
CREATE POLICY "dispatcher_read_client_techs" ON technicians
  FOR SELECT USING (
    client_id = (
      SELECT client_id FROM client_staff
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
        AND active = true
    )
  );
