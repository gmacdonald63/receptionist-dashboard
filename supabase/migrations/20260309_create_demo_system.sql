-- ============================================================
-- Demo System: client, business hours, tokens, seed function
-- ============================================================

-- A. Add demo_client_id column to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS demo_client_id BIGINT REFERENCES clients(id);

-- B. Insert the demo client row (id=9999)
INSERT INTO clients (id, email, company_name, retell_agent_id, is_admin, role, subscription_status, appointment_duration, buffer_time, timezone, invite_sent)
VALUES (
  9999,
  'demo@reliantsupport.com',
  'Reliant Support Heating & Air',
  'agent_be6189dedb9fa036a84c3dda19',
  false,
  'client',
  'active',
  120,
  0,
  'America/New_York',
  false
)
ON CONFLICT (id) DO UPDATE SET
  company_name = EXCLUDED.company_name,
  retell_agent_id = EXCLUDED.retell_agent_id,
  subscription_status = EXCLUDED.subscription_status;

-- C. Business hours for demo client (Mon-Fri 8am-6pm)
INSERT INTO business_hours (client_id, day_of_week, is_open, open_time, close_time) VALUES
  (9999, 0, false, '08:00', '18:00'), -- Sunday
  (9999, 1, true,  '08:00', '18:00'), -- Monday
  (9999, 2, true,  '08:00', '18:00'), -- Tuesday
  (9999, 3, true,  '08:00', '18:00'), -- Wednesday
  (9999, 4, true,  '08:00', '18:00'), -- Thursday
  (9999, 5, true,  '08:00', '18:00'), -- Friday
  (9999, 6, false, '08:00', '18:00')  -- Saturday
ON CONFLICT DO NOTHING;

-- D. Link all existing sales reps to the demo account
UPDATE clients SET demo_client_id = 9999 WHERE role = 'sales_rep';

-- E. Demo tokens table for public shareable demo links
CREATE TABLE IF NOT EXISTS demo_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + interval '1 hour'
);

-- RLS for demo_tokens
ALTER TABLE demo_tokens ENABLE ROW LEVEL SECURITY;

-- Authenticated users (sales reps) can create tokens
CREATE POLICY "Sales reps can create demo tokens"
  ON demo_tokens FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Anyone can read tokens (for validation)
CREATE POLICY "Anyone can validate demo tokens"
  ON demo_tokens FOR SELECT
  TO anon, authenticated
  USING (true);

-- F. RLS policies for demo data access
-- Allow users with demo_client_id to read/write demo client's data

-- Appointments: sales reps can access demo appointments
CREATE POLICY "Demo access to appointments"
  ON appointments FOR ALL
  TO authenticated
  USING (
    client_id = 9999
    AND EXISTS (
      SELECT 1 FROM clients WHERE clients.id = (auth.jwt() -> 'user_metadata' ->> 'client_id')::bigint
      AND clients.demo_client_id = 9999
    )
  )
  WITH CHECK (
    client_id = 9999
    AND EXISTS (
      SELECT 1 FROM clients WHERE clients.id = (auth.jwt() -> 'user_metadata' ->> 'client_id')::bigint
      AND clients.demo_client_id = 9999
    )
  );

-- Customers: sales reps can access demo customers
CREATE POLICY "Demo access to customers"
  ON customers FOR ALL
  TO authenticated
  USING (
    client_id = 9999
    AND EXISTS (
      SELECT 1 FROM clients WHERE clients.id = (auth.jwt() -> 'user_metadata' ->> 'client_id')::bigint
      AND clients.demo_client_id = 9999
    )
  )
  WITH CHECK (
    client_id = 9999
    AND EXISTS (
      SELECT 1 FROM clients WHERE clients.id = (auth.jwt() -> 'user_metadata' ->> 'client_id')::bigint
      AND clients.demo_client_id = 9999
    )
  );

-- G. Reset demo data function
CREATE OR REPLACE FUNCTION reset_demo_data()
RETURNS void AS $$
DECLARE
  demo_cid BIGINT := 9999;
BEGIN
  -- Wipe all demo data
  DELETE FROM follow_up_reminders WHERE client_id = demo_cid;
  DELETE FROM customer_notes WHERE customer_id IN (SELECT id FROM customers WHERE client_id = demo_cid);
  DELETE FROM customers WHERE client_id = demo_cid;
  DELETE FROM appointments WHERE client_id = demo_cid;
  DELETE FROM calls WHERE agent_id = 'agent_be6189dedb9fa036a84c3dda19';

  -- Delete expired demo tokens
  DELETE FROM demo_tokens WHERE expires_at < now();

  -- Restore demo client fields
  UPDATE clients SET
    subscription_status = 'active',
    company_name = 'Reliant Support Heating & Air',
    retell_agent_id = 'agent_be6189dedb9fa036a84c3dda19',
    appointment_duration = 120,
    buffer_time = 0,
    timezone = 'America/New_York'
  WHERE id = demo_cid;

  -- SEED: 8 Customers (address is single field, tags is text[])
  INSERT INTO customers (client_id, first_name, last_name, name, phone, email, address, tags) VALUES
    (demo_cid, 'Maria', 'Santos', 'Maria Santos', '5551234567', 'maria.santos@email.com', '142 Oak Ridge Dr, Springfield, IL 62701', ARRAY['VIP','Annual Contract']),
    (demo_cid, 'James', 'Mitchell', 'James Mitchell', '5559876543', 'j.mitchell@email.com', '89 Maple Ave, Springfield, IL 62702', ARRAY['Residential']),
    (demo_cid, 'Robert', 'Chen', 'Robert Chen', '5555551234', 'rchen@techcorp.com', '2200 Commerce Blvd, Suite 400, Springfield, IL 62703', ARRAY['Commercial','Priority']),
    (demo_cid, 'Patricia', 'Williams', 'Patricia Williams', '5553334444', null, '567 Elm Street, Springfield, IL 62704', ARRAY['Residential']),
    (demo_cid, 'David', 'Thompson', 'David Thompson', '5557778888', 'dthompson@email.com', '1100 Pine Road, Springfield, IL 62703', ARRAY['New Customer']),
    (demo_cid, 'Linda', 'Garcia', 'Linda Garcia', '5552223333', 'lgarcia@email.com', '305 Cedar Lane, Springfield, IL 62701', ARRAY['Annual Contract','Residential']),
    (demo_cid, 'Michael', 'Brown', 'Michael Brown', '5556667777', null, '48 Birch Court, Springfield, IL 62702', ARRAY[]::text[]),
    (demo_cid, 'Sarah', 'Davis', 'Sarah Davis', '5558889999', 'sarah.davis@email.com', '720 Walnut St, Apt 3B, Springfield, IL 62704', ARRAY['Residential','VIP']);

  -- SEED: Appointments (past + upcoming, relative to today)
  INSERT INTO appointments (client_id, caller_name, caller_number, date, start_time, end_time, address, city, state, zip, notes, source, status, service_type) VALUES
    -- Past appointments
    (demo_cid, 'Maria Santos', '5551234567', CURRENT_DATE - 12, '09:00', '11:00', '142 Oak Ridge Dr', 'Springfield', 'IL', '62701', 'Annual furnace inspection completed. Filter replaced. System running well.', 'manual', 'confirmed', 'Furnace Inspection'),
    (demo_cid, 'James Mitchell', '5559876543', CURRENT_DATE - 10, '13:00', '15:00', '89 Maple Ave', 'Springfield', 'IL', '62702', 'AC not cooling. Found low refrigerant. Recharged system.', 'manual', 'confirmed', 'AC Repair'),
    (demo_cid, 'Robert Chen', '5555551234', CURRENT_DATE - 7, '10:00', '12:00', '2200 Commerce Blvd, Suite 400', 'Springfield', 'IL', '62703', 'Commercial HVAC quarterly maintenance. All units operational.', 'manual', 'confirmed', 'Commercial Maintenance'),
    (demo_cid, 'Patricia Williams', '5553334444', CURRENT_DATE - 5, '14:00', '16:00', '567 Elm Street', 'Springfield', 'IL', '62704', 'Thermostat replacement. Installed Nest Learning Thermostat.', 'manual', 'confirmed', 'Thermostat Install'),
    (demo_cid, 'Linda Garcia', '5552223333', CURRENT_DATE - 3, '08:00', '10:00', '305 Cedar Lane', 'Springfield', 'IL', '62701', 'Ductwork inspection. Recommended sealing in 2 areas.', 'manual', 'confirmed', 'Duct Inspection'),
    (demo_cid, 'Michael Brown', '5556667777', CURRENT_DATE - 1, '11:00', '13:00', '48 Birch Court', 'Springfield', 'IL', '62702', 'Emergency call - no heat. Replaced ignitor. System restored.', 'manual', 'confirmed', 'Emergency Repair'),
    -- Upcoming appointments
    (demo_cid, 'Maria Santos', '5551234567', CURRENT_DATE + 1, '09:00', '11:00', '142 Oak Ridge Dr', 'Springfield', 'IL', '62701', 'AC tune-up before summer season.', 'manual', 'confirmed', 'AC Tune-Up'),
    (demo_cid, 'David Thompson', '5557778888', CURRENT_DATE + 2, '10:00', '12:00', '1100 Pine Road', 'Springfield', 'IL', '62703', 'New customer - initial system assessment.', 'manual', 'confirmed', 'System Assessment'),
    (demo_cid, 'Sarah Davis', '5558889999', CURRENT_DATE + 3, '14:00', '16:00', '720 Walnut St, Apt 3B', 'Springfield', 'IL', '62704', 'Annual maintenance check.', 'manual', 'confirmed', 'Annual Maintenance'),
    (demo_cid, 'Robert Chen', '5555551234', CURRENT_DATE + 5, '08:00', '10:00', '2200 Commerce Blvd, Suite 400', 'Springfield', 'IL', '62703', 'Follow-up: install new air handling unit.', 'manual', 'confirmed', 'AHU Installation'),
    (demo_cid, 'James Mitchell', '5559876543', CURRENT_DATE + 7, '13:00', '15:00', '89 Maple Ave', 'Springfield', 'IL', '62702', 'Follow-up check on AC repair.', 'manual', 'confirmed', 'AC Follow-Up');

  -- SEED: Customer notes (using subqueries to find customer IDs)
  INSERT INTO customer_notes (customer_id, client_id, note) VALUES
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Maria' LIMIT 1), demo_cid, 'Loyal customer since 2022. Has annual maintenance contract. Prefers morning appointments.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Maria' LIMIT 1), demo_cid, 'Furnace is 8 years old - may need replacement within 2 years. Discuss options at next visit.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Robert' LIMIT 1), demo_cid, 'Commercial account - 6 rooftop units. Quarterly maintenance contract. Contact front desk to access roof.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Patricia' LIMIT 1), demo_cid, 'Elderly homeowner. Please call 30 min before arrival. Prefers to be walked through any work being done.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Linda' LIMIT 1), demo_cid, 'Ductwork needs sealing in basement and attic. Quoted $450. Customer is considering.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Michael' LIMIT 1), demo_cid, 'Had emergency no-heat call. Very satisfied with fast response. Good referral candidate.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Sarah' LIMIT 1), demo_cid, 'Apartment unit. Must coordinate with building manager for access. Manager number: 555-000-1234.');

  -- SEED: Follow-up reminders
  INSERT INTO follow_up_reminders (customer_id, client_id, title, note, due_date, completed) VALUES
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Patricia' LIMIT 1), demo_cid, 'Check on thermostat', 'Call Patricia to see how the new Nest thermostat is working. Offer to set up smart scheduling.', CURRENT_DATE + 2, false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Linda' LIMIT 1), demo_cid, 'Follow up on duct sealing quote', 'Linda was considering the $450 duct sealing job. Follow up to see if she wants to proceed.', CURRENT_DATE + 4, false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Michael' LIMIT 1), demo_cid, 'Ask for referral', 'Michael was very happy with emergency service. Ask if he knows anyone who needs HVAC work.', CURRENT_DATE + 1, false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'David' LIMIT 1), demo_cid, 'Schedule initial assessment', 'David called asking about service. Needs full system assessment for his new home.', CURRENT_DATE, false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Maria' LIMIT 1), demo_cid, 'Discuss furnace replacement', 'Maria''s furnace is aging. Bring replacement brochures to next appointment.', CURRENT_DATE + 8, false);

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run the seed function to populate initial demo data
SELECT reset_demo_data();
