-- 20260426002_pricing_catalog_rls.sql
-- RLS for pricing_catalog. Pattern matches 20260325005_fix_rls_use_auth_email.sql:
-- always use auth.email(), never (SELECT email FROM auth.users WHERE id = auth.uid()).

ALTER TABLE pricing_catalog ENABLE ROW LEVEL SECURITY;

-- Owner (clients row keyed by email) can do anything to their own catalog.
-- Using IN (...) instead of = (...) defensively: if a future schema change ever lets
-- one email own multiple clients (unlikely but cheap insurance), = would throw
-- "more than one row returned by a subquery".
CREATE POLICY "owner_manage_pricing_catalog" ON pricing_catalog
  FOR ALL
  USING (
    client_id IN (SELECT id FROM clients WHERE email = auth.email())
  )
  WITH CHECK (
    client_id IN (SELECT id FROM clients WHERE email = auth.email())
  );

-- Admins (clients.is_admin = true) can read/write any client's catalog (for support).
CREATE POLICY "admin_manage_pricing_catalog" ON pricing_catalog
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true)
  );

-- Dispatchers can READ (needed for Phase 2 estimate building).
CREATE POLICY "dispatcher_read_pricing_catalog" ON pricing_catalog
  FOR SELECT
  USING (
    client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  );

-- Techs can READ (needed for Phase 2 tech-in-field estimates).
CREATE POLICY "tech_read_pricing_catalog" ON pricing_catalog
  FOR SELECT
  USING (
    client_id IN (
      SELECT client_id FROM technicians
      WHERE email = auth.email() AND is_active = true
    )
  );
