-- ============================================================
-- Sub-Plan 3: RLS policies for deals and commissions
--
-- RLS is already ENABLED on both tables (done in Sub-Plan 1).
-- Edge functions use service role and bypass RLS automatically.
--
-- Key constraint: clients.id is BIGINT; auth.uid() is UUID.
-- We join via email: auth.jwt() ->> 'email' matches clients.email.
-- ============================================================


-- ── DEALS: rep can SELECT their own deals ─────────────────────
DROP POLICY IF EXISTS "Reps can view their own deals" ON deals;
CREATE POLICY "Reps can view their own deals"
  ON deals
  FOR SELECT
  TO authenticated
  USING (
    rep_id = (
      SELECT id FROM clients
      WHERE email = auth.jwt() ->> 'email'
      LIMIT 1
    )
  );


-- ── DEALS: admin can SELECT all deals ─────────────────────────
DROP POLICY IF EXISTS "Admins can view all deals" ON deals;
CREATE POLICY "Admins can view all deals"
  ON deals
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE email = auth.jwt() ->> 'email'
        AND is_admin = true
    )
  );


-- ── COMMISSIONS: rep can SELECT their own commissions ──────────
DROP POLICY IF EXISTS "Reps can view their own commissions" ON commissions;
CREATE POLICY "Reps can view their own commissions"
  ON commissions
  FOR SELECT
  TO authenticated
  USING (
    rep_id = (
      SELECT id FROM clients
      WHERE email = auth.jwt() ->> 'email'
      LIMIT 1
    )
  );


-- ── COMMISSIONS: admin can SELECT all commissions ─────────────
DROP POLICY IF EXISTS "Admins can view all commissions" ON commissions;
CREATE POLICY "Admins can view all commissions"
  ON commissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE email = auth.jwt() ->> 'email'
        AND is_admin = true
    )
  );


-- ── COMMISSIONS: admin can UPDATE all commissions ─────────────
-- Used by Sub-Plan 4 "Mark as Paid" action.
DROP POLICY IF EXISTS "Admins can update all commissions" ON commissions;
CREATE POLICY "Admins can update all commissions"
  ON commissions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE email = auth.jwt() ->> 'email'
        AND is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients
      WHERE email = auth.jwt() ->> 'email'
        AND is_admin = true
    )
  );
