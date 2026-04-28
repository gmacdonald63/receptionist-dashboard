-- 20260501003_estimates_rls.sql
-- RLS for estimate tables. Pattern matches 20260426002_pricing_catalog_rls.sql.
-- CRITICAL: always auth.email(), never auth.uid() subquery on auth.users.

-- ─── estimates ───────────────────────────────────────────────────────────────

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_estimates" ON estimates
  FOR ALL
  USING   (client_id IN (SELECT id FROM clients WHERE email = auth.email()))
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE email = auth.email()));

CREATE POLICY "admin_manage_estimates" ON estimates
  FOR ALL
  USING   (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true));

CREATE POLICY "dispatcher_manage_estimates" ON estimates
  FOR ALL
  USING (
    client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  );

CREATE POLICY "tech_manage_estimates" ON estimates
  FOR ALL
  USING (
    client_id IN (
      SELECT client_id FROM technicians
      WHERE email = auth.email() AND is_active = true
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT client_id FROM technicians
      WHERE email = auth.email() AND is_active = true
    )
  );

-- ─── estimate_options ────────────────────────────────────────────────────────

ALTER TABLE estimate_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_estimate_options" ON estimate_options
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (SELECT id FROM clients WHERE email = auth.email())
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (SELECT id FROM clients WHERE email = auth.email())
    )
  );

CREATE POLICY "admin_manage_estimate_options" ON estimate_options
  FOR ALL
  USING   (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true));

CREATE POLICY "dispatcher_manage_estimate_options" ON estimate_options
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
      )
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
      )
    )
  );

CREATE POLICY "tech_manage_estimate_options" ON estimate_options
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM technicians WHERE email = auth.email() AND is_active = true
      )
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM technicians WHERE email = auth.email() AND is_active = true
      )
    )
  );

-- ─── estimate_line_items ─────────────────────────────────────────────────────

ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_estimate_line_items" ON estimate_line_items
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (SELECT id FROM clients WHERE email = auth.email())
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (SELECT id FROM clients WHERE email = auth.email())
    )
  );

CREATE POLICY "admin_manage_estimate_line_items" ON estimate_line_items
  FOR ALL
  USING   (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true));

CREATE POLICY "dispatcher_manage_estimate_line_items" ON estimate_line_items
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
      )
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
      )
    )
  );

CREATE POLICY "tech_manage_estimate_line_items" ON estimate_line_items
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM technicians WHERE email = auth.email() AND is_active = true
      )
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM technicians WHERE email = auth.email() AND is_active = true
      )
    )
  );

-- ─── estimate_tokens ─────────────────────────────────────────────────────────
-- No anon access. Token validation happens entirely inside service-role Edge Functions.
-- Authenticated users (owner/dispatcher) need SELECT to check token status in the UI.

ALTER TABLE estimate_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read_estimate_tokens" ON estimate_tokens
  FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE email = auth.email()));

CREATE POLICY "admin_manage_estimate_tokens" ON estimate_tokens
  FOR ALL
  USING   (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true));

CREATE POLICY "dispatcher_read_estimate_tokens" ON estimate_tokens
  FOR SELECT
  USING (
    client_id IN (
      SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
    )
  );
