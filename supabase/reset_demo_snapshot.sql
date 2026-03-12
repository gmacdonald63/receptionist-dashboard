-- reset_demo_snapshot.sql
-- Wipes and re-seeds all demo data for client_id 9999.
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

CREATE OR REPLACE FUNCTION reset_demo_data()
RETURNS void AS $$
DECLARE
  demo_cid BIGINT := 9999;
  demo_agent TEXT := 'agent_2a4314820da33d77656a6e4693';
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

  -- Only delete techs added during the demo (not the 3 core ones — their IDs must stay stable)
  DELETE FROM technicians WHERE client_id = demo_cid
    AND name NOT IN ('Mike Rodriguez', 'Scott Russell', 'Jake Thompson');

  DELETE FROM calls WHERE agent_id = demo_agent;

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
    timezone            = 'America/New_York'
  WHERE id = demo_cid;

  -- ============================================================
  -- 3. SEED CUSTOMERS (16)
  -- ============================================================

  INSERT INTO customers (client_id, first_name, last_name, name, phone, email, address, tags)
  VALUES
    (demo_cid, 'Courtney', 'Bell',       'Courtney Bell',    '503-555-0396',   NULL, '642 Silverleaf Drive',     ARRAY[]::text[]),
    (demo_cid, 'Dan',      'Morales',    'Dan Morales',      '(503) 555-0634', NULL, '745 Pine Crest Way',       ARRAY[]::text[]),
    (demo_cid, 'Derek',    'Wright',     'Derek Wright',     '(503) 555-0253', NULL, '8914 Juniper Ct',          ARRAY[]::text[]),
    (demo_cid, 'Greg',     'Barnes',     'Greg Barnes',      '(503) 555-0935', NULL, '4102 Stone Bridge Dr',     ARRAY[]::text[]),
    (demo_cid, 'Jackh',    'Hansen',     'Jackh Hansen',     '(503) 555-2222', NULL, '2267 Shade Tree Ln',       ARRAY[]::text[]),
    (demo_cid, 'James',    'Mitchell',   'James Mitchell',   '5035550132',     NULL, '1842 Maple Creek Drive',   ARRAY[]::text[]),
    (demo_cid, 'Megan',    'Chamberlin', 'Megan Chamberlin', '(503) 555-4444', NULL, '6532 Bumpy Rd',            ARRAY[]::text[]),
    (demo_cid, 'Megan',    'Stewart',    'Megan Stewart',    '(503) 555-0549', NULL, '1534 Rolling Hills Rd',    ARRAY[]::text[]),
    (demo_cid, 'Monica',   'Jenkins',    'Monica Jenkins',   '503-555-0568',   NULL, '1785 Evergreen Boulevard', ARRAY[]::text[]),
    (demo_cid, 'Nicole',   'Reed',       'Nicole Reed',      '(503) 555-0356', NULL, '4412 Foxglove Terr',       ARRAY[]::text[]),
    (demo_cid, 'Patrick',  'Coleman',    'Patrick Coleman',  '(503) 555-0648', NULL, '5783 Riverbend Way',       ARRAY[]::text[]),
    (demo_cid, 'Steven',   'Cooper',     'Steven Cooper',    '5035550683',     NULL, '978 Walnut Grove Avenue',  ARRAY[]::text[]),
    (demo_cid, 'Tiffany',  'Diaz',       'Tiffany Diaz',     '(503) 555-0358', NULL, '3087 Fern Valley Rd',      ARRAY[]::text[]),
    (demo_cid, 'Tim',      'Powell',     'Tim Powell',       '(503) 555-0142', NULL, '3570 Ridgewood Dr',        ARRAY[]::text[]),
    (demo_cid, 'Travis',   'Long',       'Travis Long',      '503-555-0821',   NULL, '2578 Brentwood Avenue',    ARRAY[]::text[]),
    (demo_cid, 'Travis',   'Long',       'Travis Long',      '(503) 555-9999', NULL, '4934 Steep Hill Rd',       ARRAY[]::text[]);

  -- ============================================================
  -- 4. SEED TECHNICIANS (3)
  -- ============================================================

  -- Upsert with fixed IDs so technician_id FKs in appointments never go stale.
  -- OVERRIDING SYSTEM VALUE required because id is GENERATED ALWAYS AS IDENTITY.
  INSERT INTO technicians (id, client_id, name, phone, color, is_active)
  OVERRIDING SYSTEM VALUE VALUES
    (1528, demo_cid, 'Mike Rodriguez', '(503) 555-0901', '#3B82F6', true),
    (1529, demo_cid, 'Scott Russell',  '(503) 555-0902', '#10B981', true),
    (1530, demo_cid, 'Jake Thompson',  '(503) 555-0903', '#F59E0B', true)
  ON CONFLICT (id) DO UPDATE SET
    client_id  = EXCLUDED.client_id,
    name       = EXCLUDED.name,
    phone      = EXCLUDED.phone,
    color      = EXCLUDED.color,
    is_active  = EXCLUDED.is_active;

  -- ============================================================
  -- 5. SEED APPOINTMENTS (16) — all dates use add_biz_days() to skip weekends
  -- ============================================================

  INSERT INTO appointments (
    client_id, caller_name, caller_number, date, start_time, end_time,
    address, city, state, zip, notes, source, status, service_type, call_id,
    technician_id
  ) VALUES

    -- 1. Dan Morales — biz+0 today (Mike)
    (demo_cid, 'Dan Morales', '(503) 555-0634',
     add_biz_days(CURRENT_DATE,0), '11:00', '12:00',
     '745 Pine Crest Way', 'Gresham', 'OR', '97080',
     'Furnace is blowing cold air.',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Mike Rodriguez')),

    -- 2. Travis Long — biz+0 today (Scott)
    (demo_cid, 'Travis Long', '(503) 555-9999',
     add_biz_days(CURRENT_DATE,0), '11:30', '12:30',
     '4934 Steep Hill Rd', 'Beaverton', 'OR', '97002',
     'Condensate pump isn''t working',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Scott Russell')),

    -- 3. Megan Chamberlin — biz+1 (Mike)
    (demo_cid, 'Megan Chamberlin', '(503) 555-4444',
     add_biz_days(CURRENT_DATE,1), '09:00', '10:00',
     '6532 Bumpy Rd', 'Hillsboro', 'OR', '97006',
     'System isn''t working. Thermostat screen is blank.',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Mike Rodriguez')),

    -- 4. Derek Wright — biz+1 (Scott)
    (demo_cid, 'Derek Wright', '(503) 555-0253',
     add_biz_days(CURRENT_DATE,1), '09:30', '10:30',
     '8914 Juniper Ct', 'Wilsonville', 'OR', '97070',
     'The furnace smells like something is burning or melting. It is currently turned off at the breaker so it won''t come on.',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Scott Russell')),

    -- 5. Jackh Hansen — biz+1 (Jake)
    (demo_cid, 'Jackh Hansen', '(503) 555-2222',
     add_biz_days(CURRENT_DATE,1), '09:30', '10:30',
     '2267 Shade Tree Ln', 'Tigard', 'OR', '97223',
     'Filter change and maintenance',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Jake Thompson')),

    -- 6. Megan Stewart — biz+1 (Jake)
    (demo_cid, 'Megan Stewart', '(503) 555-0549',
     add_biz_days(CURRENT_DATE,1), '13:30', '14:30',
     '1534 Rolling Hills Rd', 'Oregon City', 'OR', '97045',
     'Furnace is making a squeaking/grinding noise.',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Jake Thompson')),

    -- 7. Nicole Reed — biz+2 (Mike)
    (demo_cid, 'Nicole Reed', '(503) 555-0356',
     add_biz_days(CURRENT_DATE,2), '08:00', '09:00',
     '4412 Foxglove Terr', 'Portland', 'OR', '97215',
     'The AC isn''t very cold. Airflow is strong.',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Mike Rodriguez')),

    -- 8. James Mitchell — biz+2 (AI call) (Scott)
    (demo_cid, 'James Mitchell', '5035550132',
     add_biz_days(CURRENT_DATE,2), '16:00', '17:00',
     '1842 Maple Creek Drive', 'Portland', 'OR', '97201',
     'Furnace not turning on; thermostat says it''s on but nothing happens.',
     'ai', 'confirmed', 'Heating Repair', 'call_d0464b90542de2ac010d5c8b6d1',
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Scott Russell')),

    -- 9. Steven Cooper — biz+3 (AI call) (Mike)
    (demo_cid, 'Steven Cooper', '5035550683',
     add_biz_days(CURRENT_DATE,3), '08:00', '09:00',
     '978 Walnut Grove Avenue', 'Gresham', 'OR', '97030',
     'AC not turning on, thermostat display works but system unresponsive. Circuit breaker checked.',
     'ai', 'confirmed', 'Air Conditioning Repair', 'call_cd492b208b2dff19e53c25dcad2',
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Mike Rodriguez')),

    -- 10. Courtney Bell — biz+3 (AI call) (Scott)
    (demo_cid, 'Courtney Bell', '503-555-0396',
     add_biz_days(CURRENT_DATE,3), '10:00', '11:00',
     '642 Silverleaf Drive', 'Hillsborough', 'OR', '97123',
     'Customer requests filter change and system checkup.',
     'ai', 'confirmed', 'Preventative Maintenance and Filter Change', 'call_2dd4de63ad36bb8d0a695bdfc31',
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Scott Russell')),

    -- 11. Tiffany Diaz — biz+3 (Jake)
    (demo_cid, 'Tiffany Diaz', '(503) 555-0358',
     add_biz_days(CURRENT_DATE,3), '13:30', '14:30',
     '3087 Fern Valley Rd', 'Tigard', 'OR', '97223',
     'There''s water leaking from the air handler in the garage.',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Jake Thompson')),

    -- 12. Monica Jenkins — biz+6 (AI call) (Mike)
    (demo_cid, 'Monica Jenkins', '503-555-0568',
     add_biz_days(CURRENT_DATE,6), '08:00', '09:00',
     '1785 Evergreen Boulevard', 'Portland', 'OR', '97211',
     'Furnace not turning on, no sound or attempt to start.',
     'ai', 'confirmed', 'Heating Repair', 'call_57da93e096cbc58ca5a5392fb17',
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Mike Rodriguez')),

    -- 13. Greg Barnes — biz+6 (Scott)
    (demo_cid, 'Greg Barnes', '(503) 555-0935',
     add_biz_days(CURRENT_DATE,6), '13:00', '14:00',
     '4102 Stone Bridge Dr', 'Gresham', 'OR', '97030',
     'The furnace won''t turn off and it is just blowing cold air.',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Scott Russell')),

    -- 14. Tim Powell — biz+6 (Jake)
    (demo_cid, 'Tim Powell', '(503) 555-0142',
     add_biz_days(CURRENT_DATE,6), '14:30', '15:30',
     '3570 Ridgewood Dr', 'Beaverton', 'OR', '97006',
     'The outdoor condensing unit is frozen.',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Jake Thompson')),

    -- 15. Travis Long — biz+7 (AI call) (Jake)
    (demo_cid, 'Travis Long', '503-555-0821',
     add_biz_days(CURRENT_DATE,7), '10:00', '11:00',
     '2578 Brentwood Avenue', 'Tigard', 'OR', '97224',
     'Customer requested seasonal tune-up and filter replacement.',
     'ai', 'confirmed', 'Seasonal tune-up and filter service', 'call_a1e21951b2240c142a3be8fa6d9',
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Jake Thompson')),

    -- 16. Patrick Coleman — biz+8 (Mike)
    (demo_cid, 'Patrick Coleman', '(503) 555-0648',
     add_biz_days(CURRENT_DATE,8), '09:30', '10:30',
     '5783 Riverbend Way', 'Oregon City', 'OR', '97045',
     'Regular 6 month maintenance.',
     'manual', 'confirmed', NULL, NULL,
     (SELECT id FROM technicians WHERE client_id=demo_cid AND name='Mike Rodriguez'));

  -- ============================================================
  -- 6. SEED CALLS (5)
  -- ============================================================

  -- Call 1: James Mitchell (5 hours ago)
  INSERT INTO calls (call_id, agent_id, caller_name, caller_number, summary, transcript, recording_url, duration_seconds, appointment_booked, created_at) VALUES (
    'call_d0464b90542de2ac010d5c8b6d1', demo_agent, 'James Mitchell', '5035550132',
    'The user, James Mitchell, reported that his furnace was not turning on despite the thermostat indicating it was on. The agent scheduled a heating repair appointment.',
    $tx$Agent: Hi, thank you for calling Reliant Support Heating & Air, how can I help you today?
User: Yeah. Hi. My furnace isn't turning on. I don't know if there's a problem with the furnace or the thermostat. The thermostat says it's on, but nothing's happening.
Agent: I'm sorry to hear that—let's get someone out to help. Can you tell me your full name, please?
User: James Mitchell.
Agent: Okay, James. What's the best phone number to reach you at?
User: It's five zero three five five five zero one three two.
Agent: Got it. What's the address where you need the service?
User: One eight four two Maple Creek Drive.
Agent: And what's the city and zip code?
User: Portland, nine seven two zero one.
Agent: I have Thursday at 4:00 PM or Friday at 8:00 AM — which works better for you?
User: Thursday at twelve.
Agent: Thursday at 12:00 PM is already booked, but I do have Thursday at 4:00 PM available. Would you like to take that slot?
User: Yes. Four PM would be good.
Agent: Great, you're all set! I have you scheduled for Thursday at 4:00 PM at 1842 Maple Creek Drive. Our technician will call you about 30 minutes before arrival. Is there anything else I can help you with?
User: No. That'll be good. Thank you.
Agent: Thank you, James. Have a great day!$tx$,
    'https://dxc03zgurdly9.cloudfront.net/b381a504ab73553b603bd14675b57ce1df3adb18d6215489850e4c053d42361f/recording.wav',
    NULL, true, now() - interval '5 hours');

  -- Call 2: Steven Cooper (4 hours ago)
  INSERT INTO calls (call_id, agent_id, caller_name, caller_number, summary, transcript, recording_url, duration_seconds, appointment_booked, created_at) VALUES (
    'call_cd492b208b2dff19e53c25dcad2', demo_agent, 'Steven Cooper', '5035550683',
    'The user, Steven Cooper, called to report that his air conditioning is not turning on. The agent scheduled a service appointment for air conditioning repair.',
    $tx$Agent: Hi, thank you for calling Reliant Support Heating & Air, how can I help you today?
User: Yeah. Hi. I was calling because my air conditioning is not turning on at all.
Agent: I'm sorry to hear that — let's get someone out to help. Is your thermostat showing anything on the display, or is it completely blank?
User: It's not blank, but it just doesn't do anything when I try to select air conditioning.
Agent: Have you checked your circuit breaker to see if anything has tripped?
User: I have checked the circuit breaker. The display is working. It's just nothing comes on.
Agent: Okay, that's helpful. We'll make sure the technician knows. Can I get your full name, please?
User: Steven Cooper.
Agent: What's the best phone number to reach you at?
User: It's five zero three five five five zero six eight three.
Agent: What's the address where you need the service?
User: Nine seven eight Walnut Grove Avenue in Gresham. Zip is nine seven zero three zero.
Agent: I have Thursday at 4:00 PM or Friday at 8:00 AM — which works better for you?
User: Friday at eight AM.
Agent: Great, you're all set! I have you scheduled for Friday at 8:00 AM at 978 Walnut Grove Avenue. Our technician will call you about 30 minutes before arrival. Is there anything else I can help you with?
User: No. That's it. Thank you.
Agent: Thank you, Steven. Have a great day!$tx$,
    'https://dxc03zgurdly9.cloudfront.net/4851d440d72307510b83af84663607a7a7250aa5c62e4f58b6ea7714abde9396/recording.wav',
    NULL, true, now() - interval '4 hours');

  -- Call 3: Courtney Bell (3 hours ago)
  INSERT INTO calls (call_id, agent_id, caller_name, caller_number, summary, transcript, recording_url, duration_seconds, appointment_booked, created_at) VALUES (
    'call_2dd4de63ad36bb8d0a695bdfc31', demo_agent, 'Courtney Bell', '503-555-0396',
    'The user, Courtney Bell, called to schedule a preventative maintenance and filter change service. The appointment was successfully booked.',
    $tx$Agent: Hi, thank you for calling Reliant Support Heating & Air, how can I help you today?
User: Hi. I need to have my filters changed and my system checked out.
Agent: We can definitely help with that. May I have your full name, please?
User: Courtney Bell.
Agent: What's the best phone number to reach you at?
User: Five zero three, five five five zero three nine six.
Agent: What's the address where you need the service?
User: Six four two Silverleaf Drive, Hillsborough. Zip nine seven one two three.
Agent: I have Thursday at 4:00 PM available.
User: Okay. That works.
Agent: It looks like that slot just got booked. Would you prefer Friday at 8:00 AM?
User: Check for Thursday if possible.
Agent: The next available is Friday at 8:00 AM. Would you like that?
User: Yes, please. That works.
Agent: It looks like Friday at 8:00 AM is also no longer available. Would you like me to check other times on Friday?
User: Other times on Friday would be great.
Agent: I have Friday at 10:00 AM available. Would you like to book that?
User: Yes, please.
Agent: Great, you're all set! I have you scheduled for Friday at 10:00 AM at 642 Silverleaf Drive in Hillsborough. Our technician will call you about 30 minutes before arrival. Is there anything else I can help you with?
User: I don't think so.
Agent: Thank you, Courtney. Have a great day!$tx$,
    'https://dxc03zgurdly9.cloudfront.net/ea9c0ddc030b5ee7d2283f8c659dbe00fb2ebd9cc763dcf16dfc50aa95a4fbcc/recording.wav',
    NULL, true, now() - interval '3 hours');

  -- Call 4: Monica Jenkins (2 hours ago)
  INSERT INTO calls (call_id, agent_id, caller_name, caller_number, summary, transcript, recording_url, duration_seconds, appointment_booked, created_at) VALUES (
    'call_57da93e096cbc58ca5a5392fb17', demo_agent, 'Monica Jenkins', '503-555-0568',
    'The user, Monica Jenkins, called to report that her furnace was not turning on. The agent successfully scheduled an appointment for heating repair.',
    $tx$Agent: Hi, thank you for calling Reliant Support Heating & Air, how can I help you today?
User: Hi. I'm having a problem with my furnace. It's not turning on.
Agent: I'm sorry to hear that — let's get someone out to help. Is the thermostat set to heat mode, and do you hear the system trying to start at all?
User: No. It's not starting at all. I don't hear it trying.
Agent: Let's get an appointment set up. Can I get your full name, please?
User: Monica Jenkins.
Agent: What's the best phone number to reach you at?
User: Five zero three five five five zero five six eight.
Agent: What's the address where you need the service?
User: One seven eight five Evergreen Boulevard, Portland. Zip nine seven two one one.
Agent: I have Thursday at 4:00 PM or Friday at 8:00 AM — which works better for you?
User: Thursday is great.
Agent: It looks like Thursday at 4:00 PM just got booked. Would you prefer the Friday morning slot?
User: Friday morning's good.
Agent: It looks like the Friday morning slot is also no longer available. Would you like me to check other times?
User: Can we just go to Monday?
Agent: I have Monday at 8:00 AM or 10:00 AM — which works better?
User: Eight AM.
Agent: Great, you're all set! I have you scheduled for Monday at 8:00 AM at 1785 Evergreen Boulevard. Our technician will call you about 30 minutes before arrival. Is there anything else I can help you with?
User: No. Thanks.
Agent: Thank you, Monica. Have a great day!$tx$,
    'https://dxc03zgurdly9.cloudfront.net/150ba81fc229f96d766a9b5e761c8578e3f6654347023fba352466c2dd840eea/recording.wav',
    NULL, true, now() - interval '2 hours');

  -- Call 5: Travis Long (1 hour ago)
  INSERT INTO calls (call_id, agent_id, caller_name, caller_number, summary, transcript, recording_url, duration_seconds, appointment_booked, created_at) VALUES (
    'call_a1e21951b2240c142a3be8fa6d9', demo_agent, 'Travis Long', '503-555-0821',
    'The user, Travis Long, scheduled a seasonal tune-up and filter service appointment. The appointment was successfully booked.',
    $tx$Agent: Hi, thank you for calling Reliant Support Heating & Air, how can I help you today?
User: Yeah. I just need to schedule some maintenance on my system.
Agent: Absolutely. May I have your full name to get started?
User: Travis Long.
Agent: What's the best phone number to reach you at?
User: It's five zero three five five five zero eight two one.
Agent: What's the address where you need the maintenance service?
User: Two thousand five hundred seventy eight Brentwood Avenue in Tigard. Zip nine seven two two four.
Agent: Can you briefly describe what type of maintenance you need?
User: Probably a seasonal tune up and filters for sure.
Agent: I have Thursday at 4:00 PM or Friday at 8:00 AM — which works better for you?
User: Do you happen to have anything available Tuesday?
Agent: We do! I have Tuesday at 8:00 AM or 10:00 AM. Would either of those work?
User: Ten AM would be perfect.
Agent: Great, you're all set! I have you scheduled for Tuesday at 10:00 AM at 2578 Brentwood Avenue in Tigard. Our technician will call you about 30 minutes before arrival. Is there anything else I can help you with?
User: No. That'll be all.
Agent: Thank you, Travis. Have a great day!$tx$,
    'https://dxc03zgurdly9.cloudfront.net/637d25a23fbd3782e2298e72d6d149e9df6fbdeddf63df9b57b95094e2ffda04/recording.wav',
    NULL, true, now() - interval '1 hour');

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
