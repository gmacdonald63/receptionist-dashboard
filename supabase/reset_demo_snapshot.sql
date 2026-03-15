-- reset_demo_snapshot.sql
-- Wipes all demo data for client_id 9999, then re-seeds from production-based data.
-- All dates are relative to CURRENT_DATE using business days (weekends skipped).
-- Run: SELECT reset_demo_data();

-- Helper: add N business days, skipping Saturday (6) and Sunday (0).
-- add_biz_days(date, 0) returns the date itself if a weekday,
-- or the following Monday if it falls on a weekend.
CREATE OR REPLACE FUNCTION add_biz_days(d date, n integer)
RETURNS date AS $$
DECLARE
  result date := d;
  added  integer := 0;
BEGIN
  -- Normalize: if start date is a weekend, advance to Monday
  WHILE EXTRACT(DOW FROM result) IN (0, 6) LOOP
    result := result + 1;
  END LOOP;
  -- Add n business days
  WHILE added < n LOOP
    result := result + 1;
    IF EXTRACT(DOW FROM result) NOT IN (0, 6) THEN
      added := added + 1;
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper: subtract N business days (for past dates).
CREATE OR REPLACE FUNCTION sub_biz_days(d date, n integer)
RETURNS date AS $$
DECLARE
  result date := d;
  removed integer := 0;
BEGIN
  WHILE EXTRACT(DOW FROM result) IN (0, 6) LOOP
    result := result - 1;
  END LOOP;
  WHILE removed < n LOOP
    result := result - 1;
    IF EXTRACT(DOW FROM result) NOT IN (0, 6) THEN
      removed := removed + 1;
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION reset_demo_data()
RETURNS void AS $$
DECLARE
  demo_cid  BIGINT := 9999;
  demo_agent TEXT := 'agent_2a4314820da33d77656a6e4693';
  tech_mike  BIGINT;
  tech_scott BIGINT;
  tech_jake  BIGINT;
BEGIN

  -- ============================================================
  -- 1. WIPE — order matters for FK constraints
  -- ============================================================

  DELETE FROM follow_up_reminders
  WHERE customer_id IN (SELECT id FROM customers WHERE client_id = demo_cid);

  DELETE FROM customer_notes
  WHERE customer_id IN (SELECT id FROM customers WHERE client_id = demo_cid);

  DELETE FROM customers WHERE client_id = demo_cid;

  UPDATE appointments SET technician_id = NULL WHERE client_id = demo_cid;
  DELETE FROM appointments WHERE client_id = demo_cid;

  DELETE FROM technicians WHERE client_id = demo_cid
    AND name NOT IN ('Mike Rodriguez', 'Scott Russell', 'Jake Thompson');

  DELETE FROM calls WHERE agent_id = demo_agent;
  DELETE FROM calls WHERE agent_id = 'agent_c48b68df1da80f01e2c1eea6aa';
  DELETE FROM calls WHERE call_id LIKE 'demo_%';

  DELETE FROM service_types WHERE client_id = demo_cid;

  BEGIN
    DELETE FROM demo_tokens WHERE expires_at < now();
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- ============================================================
  -- 2. RESET DEMO CLIENT FIELDS
  -- ============================================================

  UPDATE clients SET
    subscription_status = 'active',
    company_name        = 'Reliant Support Heating & Air',
    retell_agent_id     = demo_agent,
    appointment_duration = 60,
    buffer_time         = 0,
    timezone            = 'America/Los_Angeles'
  WHERE id = demo_cid;

  -- Look up technician IDs
  SELECT id INTO tech_mike  FROM technicians WHERE client_id = demo_cid AND name = 'Mike Rodriguez' LIMIT 1;
  SELECT id INTO tech_scott FROM technicians WHERE client_id = demo_cid AND name = 'Scott Russell'  LIMIT 1;
  SELECT id INTO tech_jake  FROM technicians WHERE client_id = demo_cid AND name = 'Jake Thompson'  LIMIT 1;

  -- ============================================================
  -- 3. SEED SERVICE TYPES
  -- ============================================================

  INSERT INTO service_types (client_id, name, category, duration_minutes, customer_phrases) VALUES
    (demo_cid, 'AC Diagnostic',           'Diagnostics',   45, ARRAY['ac not working','ac problem','no cold air','not cooling']),
    (demo_cid, 'Furnace Diagnostic',      'Diagnostics',   45, ARRAY['furnace not working','no heat','furnace problem']),
    (demo_cid, 'Thermostat Diagnostic',   'Diagnostics',   30, ARRAY['thermostat problem','wrong temperature','thermostat broken']),
    (demo_cid, 'AC Tune-Up',             'Maintenance',   60, ARRAY['ac maintenance','ac tune up','ac checkup','summer tune up']),
    (demo_cid, 'Furnace Tune-Up',        'Maintenance',   60, ARRAY['furnace maintenance','furnace tune up','furnace checkup','winter tune up']),
    (demo_cid, 'Filter Replacement',     'Maintenance',   30, ARRAY['change filter','replace filter','new filter']),
    (demo_cid, 'Duct Cleaning',          'Maintenance',   120, ARRAY['clean ducts','duct cleaning','air duct cleaning']),
    (demo_cid, 'AC Repair',             'Repairs',       90, ARRAY['fix ac','ac repair','ac broken']),
    (demo_cid, 'Furnace Repair',        'Repairs',       90, ARRAY['fix furnace','furnace repair','furnace broken']),
    (demo_cid, 'Refrigerant Recharge',  'Repairs',       60, ARRAY['recharge','refrigerant','freon','low refrigerant']),
    (demo_cid, 'Thermostat Install',    'Installation',  60, ARRAY['new thermostat','install thermostat','smart thermostat']),
    (demo_cid, 'AC Install',           'Installation',  480, ARRAY['new ac','install ac','replace ac','new air conditioner']),
    (demo_cid, 'Furnace Install',      'Installation',  480, ARRAY['new furnace','install furnace','replace furnace']),
    (demo_cid, 'Duct Sealing',         'Installation',  120, ARRAY['seal ducts','duct sealing','leaky ducts']),
    (demo_cid, 'System Assessment',    'Diagnostics',   60, ARRAY['full inspection','system check','hvac assessment','new home inspection']);

  -- ============================================================
  -- 4. SEED CUSTOMERS (Sacramento, CA area)
  -- ============================================================

  INSERT INTO customers (client_id, first_name, last_name, name, phone, email, address, tags) VALUES
    (demo_cid, 'Maria',    'Santos',   'Maria Santos',    '9165551234', 'maria.santos@email.com',  '4821 Folsom Blvd, Sacramento, CA 95819',       ARRAY['VIP','Annual Contract']),
    (demo_cid, 'James',    'Mitchell', 'James Mitchell',  '9165559876', 'j.mitchell@email.com',    '2307 Fair Oaks Blvd, Sacramento, CA 95825',     ARRAY['Residential']),
    (demo_cid, 'Robert',   'Chen',     'Robert Chen',     '9165555512', 'rchen@techcorp.com',      '1800 Capitol Ave, Suite 200, Sacramento, CA 95811', ARRAY['Commercial','Priority']),
    (demo_cid, 'Patricia', 'Williams', 'Patricia Williams','9165553334', null,                     '610 Alhambra Blvd, Sacramento, CA 95816',       ARRAY['Residential']),
    (demo_cid, 'David',    'Thompson', 'David Thompson',  '9165557778', 'dthompson@email.com',     '3045 Freeport Blvd, Sacramento, CA 95818',      ARRAY['New Customer']),
    (demo_cid, 'Linda',    'Garcia',   'Linda Garcia',    '9165552223', 'lgarcia@email.com',       '1520 Del Paso Blvd, Sacramento, CA 95815',      ARRAY['Annual Contract','Residential']),
    (demo_cid, 'Michael',  'Brown',    'Michael Brown',   '9165556667', null,                      '785 Riverside Dr, Sacramento, CA 95831',        ARRAY[]::text[]),
    (demo_cid, 'Sarah',    'Davis',    'Sarah Davis',     '9165558889', 'sarah.davis@email.com',   '2100 J St, Apt 4C, Sacramento, CA 95816',       ARRAY['Residential','VIP']);

  -- ============================================================
  -- 5. SEED CALL RECORDS
  -- ============================================================

  INSERT INTO calls (call_id, agent_id, caller_name, caller_number, summary, transcript, duration_seconds, appointment_booked, created_at) VALUES
    ('demo_call_001', demo_agent, 'Maria Santos', '9165551234',
     'Maria Santos called to schedule her annual furnace tune-up. She mentioned the furnace has been running fine but wants to stay on her regular maintenance schedule. Appointment booked for the morning at her home on Folsom Blvd.',
     E'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nMaria: Hi, this is Maria Santos. I''d like to schedule my annual furnace tune-up.\nAgent: Of course, Maria! I can see you''re one of our valued annual contract customers. When would work best for you?\nMaria: I prefer mornings if possible. Do you have anything available this week?\nAgent: Let me check... I have an opening Thursday at 9 AM. Would that work?\nMaria: That''s perfect. Same address, 4821 Folsom Blvd.\nAgent: Great, I''ve booked you for Thursday at 9 AM. Our technician will inspect the furnace, check the filter, and make sure everything is running efficiently.\nMaria: Wonderful, thank you so much!\nAgent: You''re welcome, Maria. See you Thursday!',
     187, true, now() - interval '10 days'),

    ('demo_call_002', demo_agent, 'James Mitchell', '9165559876',
     'James Mitchell called about his AC not cooling properly. Warm air from vents despite thermostat set to 72°F. Likely refrigerant issue. Appointment booked for afternoon service.',
     E'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nJames: Hi, my AC isn''t cooling. It''s been running all day but the house is still warm.\nAgent: I''m sorry to hear that. Can I get your name?\nJames: James Mitchell.\nAgent: Can you describe what''s happening?\nJames: The fan is running and air is coming out, but it''s not cold at all. Thermostat is set to 72 but it''s reading 81.\nAgent: That sounds like it could be a refrigerant issue. I have an opening tomorrow afternoon at 1 PM. Would that work?\nJames: Yes, the sooner the better.\nAgent: I''ve booked you for tomorrow at 1 PM at 2307 Fair Oaks Blvd. Our tech will check the refrigerant levels and get your AC back up and running.\nJames: Thank you so much!',
     203, true, now() - interval '8 days'),

    ('demo_call_003', demo_agent, 'Patricia Williams', '9165553334',
     'Patricia Williams called requesting a smart thermostat installation. Her current thermostat is outdated. Wants a Nest thermostat she can control from her phone. Appointment booked.',
     E'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nPatricia: Hello, dear. My name is Patricia Williams. I was hoping to get a new thermostat put in.\nAgent: Of course! What kind of thermostat are you looking for?\nPatricia: My granddaughter told me about those smart ones you can control from your phone.\nAgent: A smart thermostat is a great choice! We install the Nest Learning Thermostat. I have an opening Friday at 2 PM. Does that work?\nPatricia: That would be fine. My address is 610 Alhambra Blvd.\nAgent: Perfect. I''ve booked you for Friday at 2 PM. We''ll bring the Nest thermostat and walk you through everything step by step.\nPatricia: Thank you so much, dear.',
     245, true, now() - interval '6 days'),

    ('demo_call_004', demo_agent, 'Linda Garcia', '9165552223',
     'Linda Garcia called about poor airflow in some rooms. Suspects ductwork issues. Wants an inspection. Appointment booked for early morning duct inspection.',
     E'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nLinda: Hi, this is Linda Garcia. I''m having airflow issues in a couple of rooms.\nAgent: Can you tell me more?\nLinda: The living room and master bedroom don''t get as much air as the rest of the house.\nAgent: That could be a ductwork issue — possibly leaks or blockages. I can get someone out Monday at 8 AM. Would that work?\nLinda: Early morning is great. I''m at 1520 Del Paso Blvd.\nAgent: Booked for Monday at 8 AM. Our technician will inspect the ductwork and let you know what we find.\nLinda: Thank you!',
     156, true, now() - interval '4 days'),

    ('demo_call_005', demo_agent, 'Michael Brown', '9165556667',
     'Michael Brown called with an emergency — no heat. Furnace clicking but won''t ignite. Likely faulty ignitor. Emergency appointment booked for next available slot.',
     E'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nMichael: I need help fast. My furnace stopped working and it''s cold in my house.\nAgent: I''m sorry. What''s your name?\nMichael: Michael Brown. I''m at 785 Riverside Dr.\nAgent: Can you tell me what''s happening with the furnace?\nMichael: It clicks like it''s trying to start, but nothing happens. No heat at all.\nAgent: That sounds like a faulty ignitor. I can get someone out tomorrow at 11 AM — our first available slot.\nMichael: Tomorrow? I was hoping today... but okay. I''ll use space heaters.\nAgent: I''ve marked this as priority. Tomorrow at 11 AM at 785 Riverside Dr.\nMichael: Alright, thank you.',
     178, true, now() - interval '2 days'),

    ('demo_call_006', demo_agent, 'Sarah Davis', '9165558889',
     'Sarah Davis called to schedule AC maintenance. Reduced cooling and musty smell. Needs filter replacement and condenser cleaning. Appointment booked.',
     E'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nSarah: Hi, I''m Sarah Davis. I need to get my AC looked at.\nAgent: What''s going on with it?\nSarah: It''s still cooling but not as well as it used to, and there''s a musty smell when it kicks on.\nAgent: That often means the air filter needs replacing and the coils could use a cleaning. I have an opening tomorrow at 2 PM.\nSarah: That works. I''m in apartment 4C at 2100 J Street. You''ll need to check in with the building manager.\nAgent: Noted. I''ve booked you for tomorrow at 2 PM. We''ll replace the filter and clean the coils.\nSarah: Great, thank you!',
     142, true, now() - interval '1 day'),

    ('demo_call_007', demo_agent, 'David Thompson', '9165557778',
     'David Thompson is a new customer who just moved in. Wants a full HVAC system assessment. Not sure of the age or condition of the existing system. Appointment booked.',
     E'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nDavid: Hi, I''m David Thompson. I just bought a house and want to get the HVAC system checked out.\nAgent: Welcome! A full system assessment is a great idea. We''ll inspect the furnace, AC, ductwork, and thermostat.\nDavid: That sounds perfect. What does it cost?\nAgent: The assessment is $150, and if you need repairs, we''ll credit that toward the work.\nDavid: Fair enough. When can you come out?\nAgent: I have an opening day after tomorrow at 10 AM. Address?\nDavid: 3045 Freeport Blvd.\nAgent: Booked for 10 AM at 3045 Freeport Blvd. Looking forward to it!\nDavid: Thanks a lot.',
     195, true, now() + interval '1 day'),

    ('demo_call_008', demo_agent, 'Linda Garcia', '9165552223',
     'Linda Garcia called back to schedule duct sealing recommended during her previous inspection. Wants basement and attic areas sealed. Appointment booked.',
     E'Agent: Thank you for calling Reliant Support Heating and Air. How can I help you today?\nLinda: Hi, it''s Linda Garcia again. I had the duct inspection done last week, and the technician recommended sealing. I''d like to schedule that.\nAgent: Great to hear from you again! I can see the notes. Let me get that scheduled.\nLinda: How long will it take?\nAgent: About two hours for basement and attic sealing. I have an opening next Tuesday at 1 PM.\nLinda: Tuesday afternoon is perfect.\nAgent: Booked for Tuesday at 1 PM at 1520 Del Paso Blvd. $450 for both areas.\nLinda: Perfect. Thank you!',
     134, true, now() + interval '4 days');

  -- ============================================================
  -- 6. SEED APPOINTMENTS (past + upcoming, mix of AI and manual)
  -- ============================================================
  -- Past appointments use sub_biz_days, future use add_biz_days
  -- Past ones get technician assignments; future ones are unassigned

  INSERT INTO appointments (client_id, caller_name, first_name, last_name, caller_number, date, start_time, end_time, address, city, state, zip, notes, source, status, service_type, call_id, technician_id) VALUES
    -- Past appointments (with technician assignments)
    (demo_cid, 'Maria Santos',    'Maria',    'Santos',   '9165551234', sub_biz_days(CURRENT_DATE, 8), '09:00', '10:00', '4821 Folsom Blvd',         'Sacramento', 'CA', '95819', 'Annual furnace tune-up completed. Filter replaced. System running well.',             'ai',     'completed', 'Furnace Tune-Up',    'demo_call_001', tech_mike),
    (demo_cid, 'James Mitchell',  'James',    'Mitchell', '9165559876', sub_biz_days(CURRENT_DATE, 6), '13:00', '14:30', '2307 Fair Oaks Blvd',      'Sacramento', 'CA', '95825', 'AC not cooling. Found low refrigerant. Recharged system.',                            'ai',     'completed', 'Refrigerant Recharge','demo_call_002', tech_scott),
    (demo_cid, 'Robert Chen',     'Robert',   'Chen',     '9165555512', sub_biz_days(CURRENT_DATE, 5), '10:00', '12:00', '1800 Capitol Ave, Ste 200','Sacramento', 'CA', '95811', 'Commercial HVAC quarterly maintenance. All 6 rooftop units operational.',             'manual', 'completed', 'AC Tune-Up',         null,            tech_jake),
    (demo_cid, 'Patricia Williams','Patricia', 'Williams', '9165553334', sub_biz_days(CURRENT_DATE, 4), '14:00', '15:00', '610 Alhambra Blvd',        'Sacramento', 'CA', '95816', 'Thermostat replacement. Installed Nest Learning Thermostat. Walked customer through setup.', 'ai', 'completed', 'Thermostat Install', 'demo_call_003', tech_mike),
    (demo_cid, 'Linda Garcia',    'Linda',    'Garcia',   '9165552223', sub_biz_days(CURRENT_DATE, 3), '08:00', '10:00', '1520 Del Paso Blvd',       'Sacramento', 'CA', '95815', 'Ductwork inspection. Found leaks in 2 areas — basement and attic. Quoted $450 to seal.', 'ai', 'completed', 'Duct Cleaning',     'demo_call_004', tech_scott),
    (demo_cid, 'Michael Brown',   'Michael',  'Brown',    '9165556667', sub_biz_days(CURRENT_DATE, 2), '11:00', '12:30', '785 Riverside Dr',         'Sacramento', 'CA', '95831', 'Emergency no-heat call. Replaced faulty ignitor. System restored.',                   'ai',     'completed', 'Furnace Repair',     'demo_call_005', tech_jake),
    (demo_cid, 'Maria Santos',    'Maria',    'Santos',   '9165551234', sub_biz_days(CURRENT_DATE, 1), '09:00', '10:00', '4821 Folsom Blvd',         'Sacramento', 'CA', '95819', 'Follow-up on furnace. Checked heat exchanger. All clear.',                            'manual', 'completed', 'Furnace Diagnostic', null,            tech_mike),
    (demo_cid, 'Sarah Davis',     'Sarah',    'Davis',    '9165558889', sub_biz_days(CURRENT_DATE, 0), '14:00', '15:00', '2100 J St, Apt 4C',        'Sacramento', 'CA', '95816', 'Replaced air filter and cleaned condenser coils. Musty smell resolved.',              'ai',     'completed', 'AC Tune-Up',         'demo_call_006', tech_scott),
    -- Upcoming appointments (no technician yet)
    (demo_cid, 'David Thompson',  'David',    'Thompson', '9165557778', add_biz_days(CURRENT_DATE, 1), '10:00', '11:00', '3045 Freeport Blvd',       'Sacramento', 'CA', '95818', 'New customer — initial system assessment.',                                            'ai',     'confirmed', 'System Assessment',  'demo_call_007', null),
    (demo_cid, 'James Mitchell',  'James',    'Mitchell', '9165559876', add_biz_days(CURRENT_DATE, 2), '09:00', '10:00', '2307 Fair Oaks Blvd',      'Sacramento', 'CA', '95825', 'Follow-up check on AC repair from last week.',                                        'manual', 'confirmed', 'AC Diagnostic',      null,            null),
    (demo_cid, 'Robert Chen',     'Robert',   'Chen',     '9165555512', add_biz_days(CURRENT_DATE, 3), '08:00', '10:00', '1800 Capitol Ave, Ste 200','Sacramento', 'CA', '95811', 'Install new air handling unit for east wing.',                                        'manual', 'confirmed', 'AC Install',         null,            null),
    (demo_cid, 'Linda Garcia',    'Linda',    'Garcia',   '9165552223', add_biz_days(CURRENT_DATE, 4), '13:00', '15:00', '1520 Del Paso Blvd',       'Sacramento', 'CA', '95815', 'Duct sealing — basement and attic areas. $450 quoted.',                               'ai',     'confirmed', 'Duct Sealing',       'demo_call_008', null),
    (demo_cid, 'Patricia Williams','Patricia', 'Williams', '9165553334', add_biz_days(CURRENT_DATE, 5), '10:00', '11:00', '610 Alhambra Blvd',        'Sacramento', 'CA', '95816', 'Check thermostat programming and test heating cycle.',                                'manual', 'confirmed', 'Thermostat Diagnostic', null,         null),
    (demo_cid, 'Maria Santos',    'Maria',    'Santos',   '9165551234', add_biz_days(CURRENT_DATE, 7), '09:00', '10:00', '4821 Folsom Blvd',         'Sacramento', 'CA', '95819', 'AC tune-up before summer season.',                                                    'manual', 'confirmed', 'AC Tune-Up',         null,            null),
    (demo_cid, 'Michael Brown',   'Michael',  'Brown',    '9165556667', add_biz_days(CURRENT_DATE, 9), '11:00', '12:00', '785 Riverside Dr',         'Sacramento', 'CA', '95831', 'Full system inspection. Check furnace age and efficiency.',                           'manual', 'confirmed', 'System Assessment',  null,            null);

  -- ============================================================
  -- 7. SEED CUSTOMER NOTES
  -- ============================================================

  INSERT INTO customer_notes (customer_id, client_id, note) VALUES
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Maria'    LIMIT 1), demo_cid, 'Loyal customer since 2022. Has annual maintenance contract. Prefers morning appointments.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Maria'    LIMIT 1), demo_cid, 'Furnace is 8 years old — may need replacement within 2 years. Discuss options at next visit.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Robert'   LIMIT 1), demo_cid, 'Commercial account — 6 rooftop units. Quarterly maintenance contract. Contact front desk to access roof.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Patricia' LIMIT 1), demo_cid, 'Elderly homeowner. Please call 30 min before arrival. Prefers to be walked through any work being done.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Linda'    LIMIT 1), demo_cid, 'Ductwork needs sealing in basement and attic. Quoted $450. Customer has approved — scheduled.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Michael'  LIMIT 1), demo_cid, 'Had emergency no-heat call. Very satisfied with fast response. Good referral candidate.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Sarah'    LIMIT 1), demo_cid, 'Apartment unit — must coordinate with building manager for access. Manager: 916-555-0123.');

  -- ============================================================
  -- 8. SEED FOLLOW-UP REMINDERS
  -- ============================================================

  INSERT INTO follow_up_reminders (customer_id, client_id, title, note, due_date, completed) VALUES
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Patricia' LIMIT 1), demo_cid, 'Check on thermostat',             'Call Patricia to see how the new Nest thermostat is working. Offer to set up smart scheduling.', add_biz_days(CURRENT_DATE, 2), false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Linda'    LIMIT 1), demo_cid, 'Confirm duct sealing appointment', 'Linda confirmed the $450 duct sealing job. Verify she received the appointment confirmation.',   add_biz_days(CURRENT_DATE, 3), false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Michael'  LIMIT 1), demo_cid, 'Ask for referral',                'Michael was very happy with emergency service. Ask if he knows anyone who needs HVAC work.',     add_biz_days(CURRENT_DATE, 1), false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'David'    LIMIT 1), demo_cid, 'Prepare assessment report',       'David''s system assessment is coming up. Prepare report template and pricing for potential upgrades.', CURRENT_DATE, false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Maria'    LIMIT 1), demo_cid, 'Discuss furnace replacement',     'Maria''s furnace is aging. Bring replacement brochures and financing info to next appointment.',  add_biz_days(CURRENT_DATE, 6), false);

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
