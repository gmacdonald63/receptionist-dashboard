-- Enable RLS on core tables that were created before migrations began.
-- Supabase security alert (2026-04-19): rls_disabled_in_public flagged
-- calls, clients, customers, customer_notes, follow_up_reminders.
--
-- All Edge Functions use the service-role key and bypass RLS.
-- SECURITY DEFINER helpers are used to avoid infinite recursion when
-- policies on other tables need to resolve the current user's client_id
-- or admin status by querying back into the clients table.

-- ── Helper functions ─────────────────────────────────────────────────────────

-- Returns true if the authenticated user is an admin.
-- SECURITY DEFINER bypasses RLS so it can read clients without recursion.
CREATE OR REPLACE FUNCTION current_user_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM clients WHERE email = auth.email() LIMIT 1),
    false
  );
$$;

-- Returns the retell_agent_id for the demo client (id = 9999).
-- Used in calls policies for sales-rep demo access; SECURITY DEFINER
-- lets us read the demo row without granting reps access to all of clients.
CREATE OR REPLACE FUNCTION demo_retell_agent_id()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT retell_agent_id FROM clients WHERE id = 9999 LIMIT 1;
$$;


-- ── clients ──────────────────────────────────────────────────────────────────
-- Only use auth.email() comparisons here — no sub-SELECTs on clients, which
-- would be recursive. Admin check is delegated to the SECURITY DEFINER fn.

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Each owner reads their own row; admins (Greg) read all rows.
CREATE POLICY "owner_or_admin_read_client" ON clients
  FOR SELECT TO authenticated
  USING (email = auth.email() OR current_user_is_admin());

-- Owners update only their own row.
CREATE POLICY "owner_update_own_client" ON clients
  FOR UPDATE TO authenticated
  USING  (email = auth.email())
  WITH CHECK (email = auth.email());

-- Admins can insert, update, and delete any client row (Admin dashboard).
CREATE POLICY "admin_insert_client" ON clients
  FOR INSERT TO authenticated
  WITH CHECK (current_user_is_admin());

CREATE POLICY "admin_update_any_client" ON clients
  FOR UPDATE TO authenticated
  USING  (current_user_is_admin())
  WITH CHECK (current_user_is_admin());

CREATE POLICY "admin_delete_client" ON clients
  FOR DELETE TO authenticated
  USING (current_user_is_admin());


-- ── calls ─────────────────────────────────────────────────────────────────────
-- No client_id column — access is via clients.retell_agent_id.
-- Inserts come exclusively from the retell-webhook Edge Function (service role).

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- Owners and dispatchers read calls for their client's Retell agent.
CREATE POLICY "client_read_own_calls" ON calls
  FOR SELECT TO authenticated
  USING (
    agent_id = (SELECT retell_agent_id FROM clients WHERE email = auth.email())
  );

-- Sales reps see demo calls when their clients row has demo_client_id = 9999.
CREATE POLICY "sales_rep_read_demo_calls" ON calls
  FOR SELECT TO authenticated
  USING (
    agent_id = demo_retell_agent_id()
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE email = auth.email()
        AND demo_client_id = 9999
    )
  );

-- Admins see all calls.
CREATE POLICY "admin_read_all_calls" ON calls
  FOR SELECT TO authenticated
  USING (current_user_is_admin());


-- ── customers ─────────────────────────────────────────────────────────────────
-- Demo-specific policies already exist from 20260309. This adds the general
-- access policy for regular owners and dispatchers.

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_manage_own_customers" ON customers
  FOR ALL TO authenticated
  USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
    OR client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
    OR client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  );


-- ── customer_notes ────────────────────────────────────────────────────────────

ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_manage_own_notes" ON customer_notes
  FOR ALL TO authenticated
  USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
    OR client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
    OR client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  );


-- ── follow_up_reminders ───────────────────────────────────────────────────────

ALTER TABLE follow_up_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_manage_own_reminders" ON follow_up_reminders
  FOR ALL TO authenticated
  USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
    OR client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
    OR client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  );
