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
  'agent_2a4314820da33d77656a6e4693',
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
      SELECT 1 FROM clients
      WHERE clients.email = auth.email()
      AND clients.demo_client_id = 9999
    )
  )
  WITH CHECK (
    client_id = 9999
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.email = auth.email()
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
      SELECT 1 FROM clients
      WHERE clients.email = auth.email()
      AND clients.demo_client_id = 9999
    )
  )
  WITH CHECK (
    client_id = 9999
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.email = auth.email()
      AND clients.demo_client_id = 9999
    )
  );

-- Business hours: sales reps can read demo business hours
CREATE POLICY "Demo access to business_hours"
  ON business_hours FOR SELECT
  TO authenticated
  USING (
    client_id = 9999
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.email = auth.email()
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
  DELETE FROM calls WHERE agent_id = 'agent_2a4314820da33d77656a6e4693';

  -- Delete expired demo tokens
  DELETE FROM demo_tokens WHERE expires_at < now();

  -- Restore demo client fields
  UPDATE clients SET
    subscription_status = 'active',
    company_name = 'Reliant Support Heating & Air',
    retell_agent_id = 'agent_2a4314820da33d77656a6e4693',
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

  -- SEED: 15 Appointments (past + upcoming, AI + manual mix, repeat customers)
  -- 8 are AI-booked (from calls), 7 are manual
  INSERT INTO appointments (client_id, caller_name, caller_number, date, start_time, end_time, address, city, state, zip, notes, source, status, service_type, call_id) VALUES
    -- Past appointments
    (demo_cid, 'Maria Santos', '5551234567', CURRENT_DATE - 14, '09:00', '11:00', '142 Oak Ridge Dr', 'Springfield', 'IL', '62701', 'Annual furnace inspection completed. Filter replaced. System running well.', 'ai', 'confirmed', 'Furnace Inspection', 'demo_call_001'),
    (demo_cid, 'James Mitchell', '5559876543', CURRENT_DATE - 11, '13:00', '15:00', '89 Maple Ave', 'Springfield', 'IL', '62702', 'AC not cooling. Found low refrigerant. Recharged system.', 'ai', 'confirmed', 'AC Repair', 'demo_call_002'),
    (demo_cid, 'Robert Chen', '5555551234', CURRENT_DATE - 9, '10:00', '12:00', '2200 Commerce Blvd, Suite 400', 'Springfield', 'IL', '62703', 'Commercial HVAC quarterly maintenance. All units operational.', 'manual', 'confirmed', 'Commercial Maintenance', null),
    (demo_cid, 'Patricia Williams', '5553334444', CURRENT_DATE - 7, '14:00', '16:00', '567 Elm Street', 'Springfield', 'IL', '62704', 'Thermostat replacement. Installed Nest Learning Thermostat.', 'ai', 'confirmed', 'Thermostat Install', 'demo_call_003'),
    (demo_cid, 'Linda Garcia', '5552223333', CURRENT_DATE - 5, '08:00', '10:00', '305 Cedar Lane', 'Springfield', 'IL', '62701', 'Ductwork inspection. Recommended sealing in 2 areas.', 'ai', 'confirmed', 'Duct Inspection', 'demo_call_004'),
    (demo_cid, 'Michael Brown', '5556667777', CURRENT_DATE - 3, '11:00', '13:00', '48 Birch Court', 'Springfield', 'IL', '62702', 'Emergency call - no heat. Replaced ignitor. System restored.', 'ai', 'confirmed', 'Emergency Repair', 'demo_call_005'),
    (demo_cid, 'Maria Santos', '5551234567', CURRENT_DATE - 2, '09:00', '11:00', '142 Oak Ridge Dr', 'Springfield', 'IL', '62701', 'Follow-up on furnace. Checked heat exchanger. All clear.', 'manual', 'confirmed', 'Furnace Follow-Up', null),
    (demo_cid, 'Sarah Davis', '5558889999', CURRENT_DATE - 1, '14:00', '16:00', '720 Walnut St, Apt 3B', 'Springfield', 'IL', '62704', 'Replaced air filter and cleaned condenser coils.', 'ai', 'confirmed', 'AC Maintenance', 'demo_call_006'),
    -- Upcoming appointments
    (demo_cid, 'David Thompson', '5557778888', CURRENT_DATE + 1, '10:00', '12:00', '1100 Pine Road', 'Springfield', 'IL', '62703', 'New customer - initial system assessment.', 'ai', 'confirmed', 'System Assessment', 'demo_call_007'),
    (demo_cid, 'James Mitchell', '5559876543', CURRENT_DATE + 2, '09:00', '11:00', '89 Maple Ave', 'Springfield', 'IL', '62702', 'Follow-up check on AC repair from last week.', 'manual', 'confirmed', 'AC Follow-Up', null),
    (demo_cid, 'Robert Chen', '5555551234', CURRENT_DATE + 3, '08:00', '10:00', '2200 Commerce Blvd, Suite 400', 'Springfield', 'IL', '62703', 'Install new air handling unit for east wing.', 'manual', 'confirmed', 'AHU Installation', null),
    (demo_cid, 'Linda Garcia', '5552223333', CURRENT_DATE + 4, '13:00', '15:00', '305 Cedar Lane', 'Springfield', 'IL', '62701', 'Duct sealing - basement and attic areas.', 'ai', 'confirmed', 'Duct Sealing', 'demo_call_008'),
    (demo_cid, 'Patricia Williams', '5553334444', CURRENT_DATE + 5, '10:00', '12:00', '567 Elm Street', 'Springfield', 'IL', '62704', 'Check thermostat programming and test heating cycle.', 'manual', 'confirmed', 'Thermostat Check', null),
    (demo_cid, 'Maria Santos', '5551234567', CURRENT_DATE + 7, '09:00', '11:00', '142 Oak Ridge Dr', 'Springfield', 'IL', '62701', 'AC tune-up before summer season.', 'manual', 'confirmed', 'AC Tune-Up', null),
    (demo_cid, 'Michael Brown', '5556667777', CURRENT_DATE + 10, '11:00', '13:00', '48 Birch Court', 'Springfield', 'IL', '62702', 'Full system inspection. Check furnace age and efficiency.', 'manual', 'confirmed', 'System Inspection', null);

  -- SEED: 8 Call records matching the AI appointments (with summaries and transcripts)
  INSERT INTO calls (call_id, agent_id, caller_name, caller_number, summary, transcript, duration_seconds, appointment_booked, created_at) VALUES
    ('demo_call_001', 'agent_2a4314820da33d77656a6e4693', 'Maria Santos', '5551234567',
     'Maria Santos called to schedule her annual furnace inspection. She mentioned the furnace has been running fine but wants to stay on her regular maintenance schedule. Appointment booked for the morning at her home on Oak Ridge Dr.',
     'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nMaria: Hi, this is Maria Santos. I''d like to schedule my annual furnace inspection.\nAgent: Of course, Maria! I can see you''re one of our valued annual contract customers. When would work best for you?\nMaria: I prefer mornings if possible. Do you have anything available this week?\nAgent: Let me check... I have an opening this Thursday at 9 AM. Would that work?\nMaria: That''s perfect. Same address, 142 Oak Ridge Drive.\nAgent: Great, I''ve booked you for Thursday at 9 AM at 142 Oak Ridge Dr, Springfield. Our technician will inspect the furnace, check the filter, and make sure everything is running efficiently.\nMaria: Wonderful, thank you so much!\nAgent: You''re welcome, Maria. See you Thursday!',
     187, true, now() - interval '14 days'),

    ('demo_call_002', 'agent_2a4314820da33d77656a6e4693', 'James Mitchell', '5559876543',
     'James Mitchell called about his AC not cooling properly. He described warm air coming from vents despite thermostat being set to 72°F. Likely refrigerant issue. Appointment booked for afternoon service at his home on Maple Ave.',
     'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nJames: Hi, my AC isn''t cooling. It''s been running all day but the house is still warm.\nAgent: I''m sorry to hear that. Can I get your name?\nJames: James Mitchell.\nAgent: Thanks, James. Can you describe what''s happening? Is the unit running but blowing warm air?\nJames: Yeah, exactly. The fan is running and air is coming out, but it''s not cold at all. Thermostat is set to 72 but it''s reading 81 in here.\nAgent: That sounds like it could be a refrigerant issue. We should get a technician out to diagnose it. I have an opening tomorrow afternoon at 1 PM. Would that work?\nJames: Yes, the sooner the better. It''s getting hot in here.\nAgent: Totally understand. I''ve booked you for tomorrow at 1 PM at 89 Maple Ave. Our tech will check the refrigerant levels and get your AC back up and running.\nJames: Thank you so much!\nAgent: You''re welcome. Stay cool, James!',
     203, true, now() - interval '11 days'),

    ('demo_call_003', 'agent_2a4314820da33d77656a6e4693', 'Patricia Williams', '5553334444',
     'Patricia Williams called requesting a thermostat replacement. Her current thermostat is outdated and she wants a programmable smart thermostat. Appointment booked for installation at her home on Elm Street.',
     'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nPatricia: Hello, dear. My name is Patricia Williams. I was hoping to get a new thermostat put in.\nAgent: Of course, Patricia! What kind of thermostat are you looking for?\nPatricia: Well, my granddaughter was telling me about those smart ones that you can control from your phone. I think it would be nice to be able to adjust the temperature without getting up.\nAgent: A smart thermostat is a great choice! We install the Nest Learning Thermostat. It learns your schedule and adjusts automatically. Would you like us to come out and install one?\nPatricia: Yes, that sounds lovely. Can someone explain how to use it when they install it?\nAgent: Absolutely. Our technician will walk you through everything step by step. I have an opening on Friday at 2 PM. Does that work?\nPatricia: That would be fine. My address is 567 Elm Street.\nAgent: Perfect. I''ve booked you for Friday at 2 PM at 567 Elm Street. We''ll bring the Nest thermostat and have you up and running in no time.\nPatricia: Thank you so much, dear. You''ve been very helpful.\nAgent: My pleasure, Patricia. See you Friday!',
     245, true, now() - interval '7 days'),

    ('demo_call_004', 'agent_2a4314820da33d77656a6e4693', 'Linda Garcia', '5552223333',
     'Linda Garcia called about poor airflow in some rooms. Suspects ductwork issues. Wants an inspection to identify any leaks or blockages. Appointment booked for early morning duct inspection at her home on Cedar Lane.',
     'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nLinda: Hi, this is Linda Garcia. I''m having some issues with airflow in a couple of rooms in my house.\nAgent: I''d be happy to help, Linda. Can you tell me more about what you''re experiencing?\nLinda: The living room and the master bedroom don''t seem to get as much air as the rest of the house. It''s noticeably warmer in those rooms.\nAgent: That could be a ductwork issue - possibly leaks or blockages. I''d recommend a full duct inspection so we can identify the problem. Would you like to schedule that?\nLinda: Yes, please. What do you have available?\nAgent: I can get someone out there Monday morning at 8 AM. Would that work for you?\nLinda: Early morning is great. I''m at 305 Cedar Lane.\nAgent: Perfect. Booked for Monday at 8 AM at 305 Cedar Lane. Our technician will inspect all the ductwork and let you know what we find.\nLinda: Sounds good. Thank you!\nAgent: You''re welcome, Linda. Talk to you soon!',
     156, true, now() - interval '5 days'),

    ('demo_call_005', 'agent_2a4314820da33d77656a6e4693', 'Michael Brown', '5556667777',
     'Michael Brown called with an emergency - no heat in his home. Furnace is making clicking sounds but won''t ignite. Likely a faulty ignitor. Emergency appointment booked for next available slot.',
     'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nMichael: Hi, I need help fast. My furnace stopped working and it''s freezing in my house.\nAgent: I''m sorry to hear that. Let me get your information and we''ll get someone out as soon as possible. What''s your name?\nMichael: Michael Brown. I''m at 48 Birch Court.\nAgent: Got it. Can you tell me what''s happening with the furnace? Any sounds, lights, error codes?\nMichael: It clicks like it''s trying to start, but then nothing happens. No heat comes out at all. The thermostat shows it''s trying to run.\nAgent: That sounds like it could be a faulty ignitor. The good news is that''s a common repair and our technicians carry replacement parts. I can get someone out to you tomorrow at 11 AM - that''s our first available emergency slot. Would that work?\nMichael: Tomorrow? I was hoping today... but I guess tomorrow is okay. I''ll use space heaters tonight.\nAgent: I understand, and I''m sorry we can''t get there sooner. I''ve marked this as a priority call. Tomorrow at 11 AM at 48 Birch Court. Bundle up tonight, and we''ll get your heat back on tomorrow.\nMichael: Alright, thank you.\nAgent: Hang in there, Michael. We''ll take care of you.',
     178, true, now() - interval '3 days'),

    ('demo_call_006', 'agent_2a4314820da33d77656a6e4693', 'Sarah Davis', '5558889999',
     'Sarah Davis called to schedule AC maintenance for her apartment. She mentioned reduced cooling performance and a musty smell when the AC runs. Appointment booked for filter replacement and condenser cleaning.',
     'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nSarah: Hi, I''m Sarah Davis. I need to get my AC looked at.\nAgent: Sure thing, Sarah. What''s going on with it?\nSarah: It''s still cooling but not as well as it used to, and there''s kind of a musty smell when it kicks on.\nAgent: That often means the air filter needs replacing and the condenser coils could use a cleaning. When was the last time you had maintenance done?\nSarah: Honestly, I''m not sure. Maybe over a year ago?\nAgent: No worries. We can take care of that for you. I have an opening tomorrow afternoon at 2 PM. Does that work?\nSarah: That works. I''m in apartment 3B at 720 Walnut Street. You''ll need to check in with the building manager.\nAgent: Good to know. I''ve booked you for tomorrow at 2 PM at 720 Walnut St, Apt 3B. We''ll replace the filter, clean the coils, and get your AC running fresh again.\nSarah: Great, thank you!\nAgent: You''re welcome, Sarah. See you tomorrow!',
     142, true, now() - interval '1 day'),

    ('demo_call_007', 'agent_2a4314820da33d77656a6e4693', 'David Thompson', '5557778888',
     'David Thompson is a new customer who just moved in and wants a full system assessment. Not sure of the age or condition of the existing HVAC system. Appointment booked for a comprehensive evaluation.',
     'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nDavid: Hi, my name is David Thompson. I just bought a house and I''d like to get the HVAC system checked out. I have no idea how old it is or what condition it''s in.\nAgent: Welcome to the neighborhood, David! A full system assessment is a great idea when you move into a new home. We''ll inspect the furnace, AC unit, ductwork, and thermostat and give you a complete report on everything.\nDavid: That sounds perfect. What does something like that cost?\nAgent: The assessment is $150, and it includes a written report with recommendations. If you end up needing any repairs, we''ll credit the assessment fee toward the work.\nDavid: Fair enough. When can you come out?\nAgent: I have an opening day after tomorrow at 10 AM. What''s your address?\nDavid: 1100 Pine Road.\nAgent: Great. Booked for 10 AM at 1100 Pine Road. Our technician will go through everything and give you a full picture of your system''s health.\nDavid: Awesome, thanks a lot.\nAgent: You''re welcome, David. Looking forward to meeting you!',
     195, true, now() + interval '1 day'),

    ('demo_call_008', 'agent_2a4314820da33d77656a6e4693', 'Linda Garcia', '5552223333',
     'Linda Garcia called back to schedule the duct sealing work that was recommended during her previous inspection. Wants basement and attic areas sealed. Appointment booked for next week.',
     'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nLinda: Hi, it''s Linda Garcia again. I had the duct inspection done last week, and the technician recommended sealing in the basement and attic. I''d like to go ahead and schedule that.\nAgent: Great to hear from you again, Linda! Yes, I can see the notes from your inspection. The tech found two areas that need sealing. Let me get that scheduled for you.\nLinda: How long will it take?\nAgent: Typically about two hours for basement and attic sealing. I have an opening next Tuesday at 1 PM. Would that work?\nLinda: Tuesday afternoon is perfect.\nAgent: Wonderful. I''ve booked you for Tuesday at 1 PM at 305 Cedar Lane. The technician will seal both areas and verify improved airflow before they leave.\nLinda: That sounds great. And the price was $450, right?\nAgent: That''s correct, $450 for both areas. No surprises.\nLinda: Perfect. Thank you!\nAgent: You''re welcome, Linda. See you Tuesday!',
     134, true, now() + interval '4 days');

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
