-- supabase/migrations/20260325003_technician_permissions.sql

CREATE TABLE technician_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id  int  NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  client_id      int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  feature        text NOT NULL,
  -- Phase 1 values: 'job_notes' | 'on_my_way' | 'mark_complete'
  -- Phase 2 values: 'gps_tracking' | 'customer_sms' | 'customer_tracking_link'
  enabled        bool NOT NULL DEFAULT true,
  UNIQUE(technician_id, feature)
);

ALTER TABLE technician_permissions ENABLE ROW LEVEL SECURITY;

-- Techs read their own permissions (to know which buttons to show)
CREATE POLICY "tech_read_own_permissions" ON technician_permissions
  FOR SELECT USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Owners manage permissions for their client's techs
CREATE POLICY "client_manage_tech_permissions" ON technician_permissions
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
