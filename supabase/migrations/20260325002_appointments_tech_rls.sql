-- supabase/migrations/20260325002_appointments_tech_rls.sql
-- RLS is already enabled on appointments — no ALTER TABLE needed.

-- Techs read appointments assigned to them (for today's jobs query)
CREATE POLICY "tech_read_own_appointments" ON appointments
  FOR SELECT USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email IS NOT NULL
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Techs update status on their assigned appointments (en_route, complete)
CREATE POLICY "tech_update_own_appointment_status" ON appointments
  FOR UPDATE
  USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email IS NOT NULL
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email IS NOT NULL
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );
