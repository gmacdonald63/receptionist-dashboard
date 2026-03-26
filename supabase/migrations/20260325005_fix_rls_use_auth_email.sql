-- Fix: replace (SELECT email FROM auth.users WHERE id = auth.uid()) with auth.email()
-- The authenticated role does not have direct SELECT access to auth.users.
-- auth.email() is the correct Supabase built-in for current user's email in RLS policies.

-- ── technicians ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "client_manage_own_techs" ON technicians;
DROP POLICY IF EXISTS "tech_read_own" ON technicians;
DROP POLICY IF EXISTS "dispatcher_read_client_techs" ON technicians;

CREATE POLICY "client_manage_own_techs" ON technicians
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
  );

CREATE POLICY "tech_read_own" ON technicians
  FOR SELECT USING (
    is_active = true
    AND email IS NOT NULL
    AND email = auth.email()
  );

CREATE POLICY "dispatcher_read_client_techs" ON technicians
  FOR SELECT USING (
    client_id = (
      SELECT client_id FROM client_staff
      WHERE email = auth.email()
        AND active = true
    )
  );

-- ── appointments ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tech_read_own_appointments" ON appointments;
DROP POLICY IF EXISTS "tech_update_own_appointment_status" ON appointments;

CREATE POLICY "tech_read_own_appointments" ON appointments
  FOR SELECT USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email IS NOT NULL
        AND email = auth.email()
    )
  );

CREATE POLICY "tech_update_own_appointment_status" ON appointments
  FOR UPDATE
  USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email IS NOT NULL
        AND email = auth.email()
    )
  )
  WITH CHECK (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email IS NOT NULL
        AND email = auth.email()
    )
  );

-- ── technician_permissions ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "tech_read_own_permissions" ON technician_permissions;
DROP POLICY IF EXISTS "client_manage_tech_permissions" ON technician_permissions;

CREATE POLICY "tech_read_own_permissions" ON technician_permissions
  FOR SELECT USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email = auth.email()
    )
  );

CREATE POLICY "client_manage_tech_permissions" ON technician_permissions
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
  );

-- ── client_staff ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "staff_read_own" ON client_staff;
DROP POLICY IF EXISTS "owner_manage_staff" ON client_staff;

CREATE POLICY "staff_read_own" ON client_staff
  FOR SELECT USING (
    email = auth.email()
  );

CREATE POLICY "owner_manage_staff" ON client_staff
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
  );
