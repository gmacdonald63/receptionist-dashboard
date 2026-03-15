-- reset_demo_snapshot.sql
-- Wipes all demo data for client_id 9999, then re-seeds from real production data.
-- All dates are relative to CURRENT_DATE using business days (weekends skipped).
-- Data sourced from Comfort Heating & Air (Portland, OR metro area).
-- Run: SELECT reset_demo_data();

-- Helper: add N business days, skipping Saturday (6) and Sunday (0).
CREATE OR REPLACE FUNCTION add_biz_days(d date, n integer)
RETURNS date AS $$
DECLARE
  result date := d;
  added  integer := 0;
BEGIN
  WHILE EXTRACT(DOW FROM result) IN (0, 6) LOOP
    result := result + 1;
  END LOOP;
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
    company_name        = 'Comfort Heating & Air',
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
    (demo_cid, 'Compressor Replacement','Repairs',       270, ARRAY['compressor','replace compressor','compressor replacement']),
    (demo_cid, 'Heat Pump Diagnostic',  'Diagnostics',   60, ARRAY['heat pump','heat pump not working','heat pump problem']),
    (demo_cid, 'System Assessment',    'Diagnostics',   60, ARRAY['full inspection','system check','hvac assessment','new home inspection']);


  -- ============================================================
  -- 4. SEED CUSTOMERS (Portland, OR metro area)
  -- ============================================================

  INSERT INTO customers (client_id, first_name, last_name, name, phone, email, address, tags) VALUES
    (demo_cid, 'Mark',     'Adams',     'Mark Adams',     '503-555-0842', null, '1678 Valley View Drive, Portland, OR 97209',          ARRAY['Residential']),
    (demo_cid, 'Sarah',    'Price',     'Sarah Price',    '503-555-0278', null, '305 Birchwood Ln, Portland, OR 97210',                ARRAY['Residential']),
    (demo_cid, 'Robert',   'Garcia',    'Robert Garcia',  '503-555-0419', null, '7721 Sunset Ridge Road, Hillsboro, OR 97214',         ARRAY['Residential']),
    (demo_cid, 'Linda',    'Thompson',  'Linda Thompson', '503-555-0184', null, '490 Cloverhill Avenue, Beaverton, OR 97006',           ARRAY['Residential']),
    (demo_cid, 'Michael',  'Patel',     'Michael Patel',  '503-555-0347', null, '1133 Lakewood Boulevard, Lake Oswego, OR 97034',       ARRAY['Residential']),
    (demo_cid, 'David',    'Robinson',  'David Robinson', '503-555-0593', null, '2205 Stonegate Court, Wilsonville, OR 97070',           ARRAY['Residential']),
    (demo_cid, 'James',    'Mitchell',  'James Mitchell', '503-555-0132', null, '1842 Maple Creek Drive, Tigard, OR 97223',             ARRAY['Residential']),
    (demo_cid, 'Kevin',    'Washington','Kevin Washington','503-555-0163', null, '6012 Brookside Drive, Tualatin, OR 97062',             ARRAY['Residential']),
    (demo_cid, 'Rachel',   'Hernandez', 'Rachel Hernandez','503-555-0845', null, '3340 Millstone Court, Wilsonville, OR 97070',          ARRAY['Residential']),
    (demo_cid, 'Thomas',   'Bennett',   'Thomas Bennett', '503-555-0472', null, '1087 Willowbrook Lane, Oregon City, OR 97045',         ARRAY['Residential']),
    (demo_cid, 'Steven',   'Cooper',    'Steven Cooper',  '503-555-0683', null, '978 Walnut Grove Avenue, Gresham, OR 97030',           ARRAY['Residential']),
    (demo_cid, 'Dan',      'Morales',   'Dan Morales',    '503-555-0634', null, '745 Pine Crest Way, Portland, OR 97219',               ARRAY['Residential']),
    (demo_cid, 'Megan',    'Stewart',   'Megan Stewart',  '503-555-0549', null, '1534 Rolling Hills Rd, Tigard, OR 97224',              ARRAY['Residential']),
    (demo_cid, 'Nathan',   'Price',     'Nathan Price',   '503-555-0734', null, '3924 Tanglewood Way, Gresham, OR 97080',               ARRAY['Residential']),
    (demo_cid, 'Jason',    'Reed',      'Jason Reed',     '503-555-0417', null, '820 Magnolia Way, Wilsonville, OR 97070',               ARRAY['Residential']),
    (demo_cid, 'Travis',   'Long',      'Travis Long',    '503-555-0821', null, '2578 Brentwood Avenue, Tigard, OR 97224',               ARRAY['Residential']),
    (demo_cid, 'Patrick',  'Coleman',   'Patrick Coleman', '503-555-0648', null, '5783 Riverbend Way, Oregon City, OR 97045',            ARRAY['Annual Contract']),
    (demo_cid, 'Ryan',     'Foster',    'Ryan Foster',    '503-555-0623', null, '2847 Springvale Avenue, Beaverton, OR 97005',           ARRAY['Residential']),
    (demo_cid, 'Eric',     'Ramirez',   'Eric Ramirez',   '503-555-0563', null, '1447 Buckeye Trail, Portland, OR 97219',                ARRAY['Residential']),
    (demo_cid, 'Andrew',   'Thompson',  'Andrew Thompson','503-555-4976', null, '5463 Southwest Turtle Street, Hillsboro, OR 97229',     ARRAY['Residential']),
    (demo_cid, 'Bill',     'Wilson',    'Bill Wilson',    '503-555-6446', null, '1245 Main Street, Oregon City, OR 97352',                ARRAY['Residential']),
    (demo_cid, 'Bill',     'Thompson',  'Bill Thompson',  '503-888-4444', null, '9764 Southwest Garden Home Road, Portland, OR 97219',    ARRAY['Residential']),
    (demo_cid, 'Mike',     'Jackson',   'Mike Jackson',   '503-555-4321', null, '4862 Governor Street, Portland, OR 97239',               ARRAY['Residential']),
    (demo_cid, 'Greg',     'MacDonald', 'Greg MacDonald', '503-971-2345', null, '7700 Southwest Garden Home Road, Portland, OR 97219',    ARRAY['VIP']);


  -- ============================================================
  -- 5. SEED CALL RECORDS (real Retell transcripts)
  -- ============================================================

  INSERT INTO calls (call_id, agent_id, caller_name, caller_number, summary, transcript, duration_seconds, appointment_booked, created_at) VALUES

    ('demo_call_001', demo_agent, 'Robert Garcia', '',
     E'The user, Robert Garcia, called to schedule a compressor replacement for his heating system. The agent confirmed his contact details and address, offered available appointment times, and successfully booked the appointment for March 17, 2026, at 9:30 AM in Hillsboro, OR. The call concluded with confirmation and no further requests from the user.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. Hi. You guys were out previously to diagnose a problem with my system, and you told me that I needed a compressor replacement. So I''m ready to schedule that now. 
Agent: I''m glad you''re ready to move forward. Let''s get your compressor replacement scheduled. May I have your full name, please?
User: Robert Garcia. 
Agent: Okay, Robert. What’s the best phone number to reach you at in case we need to contact you about your appointment?
User: Five zero three five five five zero four one nine. 
Agent: Okay, Robert. What''s the address where you need the service?
User: Seventy seven twenty one Sunset Ridge Road, 
Agent: Got it. And what''s the city and zip code for that address?
User: That''s in Hillsboro. The ZIP code is nine seven two one four. 
Agent: Perfect. Now, just to confirm, you''ll need a compressor replacement. Is there anything else you''d like the technician to know about your system or the issue?
User: Nothing else I can think of. That should be good. Just get that scheduled. 
Agent: I have Tuesday the 17th at 9:00 AM or 9:30 AM available for your compressor replacement. Which time works better for you?
User: Nine thirty. 
Agent: Let me 
Agent: book that for you right now.Great, you''re all set! I have you scheduled for Tuesday, March 17th at 9:30 AM at 7721 Sunset Ridge Road in Hillsboro. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: Nope. 
Agent: Thank you, Robert. Have a great day!
',
     116, true, now() - interval '14 days'),

    ('demo_call_002', demo_agent, 'Jason Reed', '',
     E'The user, Jason Reed, called to report that his air conditioning is not working when switched to cooling mode. The agent scheduled an AC diagnostic appointment for March 16, 2026, at 1:00 PM at 820 Magnolia Way, Wilsonville, OR 97070. The appointment was successfully booked, and the user was satisfied with the service.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. I was calling because my air conditioning is not working. 
Agent: I''m sorry to hear that your AC isn''t working—let''s get someone out to help. Can you tell me a little more about what''s happening? For example, is the system running but not cooling, or is it completely off?
User: Well, the system works when I have it, like, in heating, but when I turn it on to AC, nothing happens. 
Agent: Okay, it sounds like your AC isn''t turning on at all when you switch to cooling mode. We''ll want to schedule a diagnostic appointment so a technician can take a look. Can I get your full name, please?
User: Yeah. Jason Reed. 
Agent: Okay, Jason. What’s the best phone number to reach you at in case we need to follow up or if the call drops?
User: It''s five zero three five five five zero four one seven. 
Agent: Got it, 503-555-0417. What’s the address where you need the service?
User: Eight two zero Magnolia Way, Wilsonville. 
Agent: Okay, and what’s the zip code there?
User: It''s nine seven zero seven zero. 
Agent: I have Monday the 16th at 12:30 PM or Monday the 16th at 1:00 PM available for an AC diagnostic. Which time works better for you?
User: One PM. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Monday, the 16th at 1:00 PM at 820 Magnolia Way in Wilsonville. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. That''s good. 
User: Thank you. 
Agent: Thank you, Jason. Have a great day!
',
     119, true, now() - interval '13 days'),

    ('demo_call_003', demo_agent, 'Mark Adams', '',
     E'The user, Mark Adams, called to schedule a filter replacement service at his home in Portland, OR. The agent confirmed the address and phone number, offered available appointment times, and successfully booked the appointment for March 17, 2026, at 8:00 AM. The user was satisfied and ended the call without further requests.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. I need to have my filters changed. 
Agent: Okay, we can help with that! Can you tell me a little about your system—are these standard 1-inch filters, or do you have thicker media filters? And is there anything else you''d like us to check while we''re there?
User: I''m not sure what the filters are. 
Agent: No problem at all—that’s pretty common! Our technician can take a look and make sure you get the right filters. What’s the address where you need the service?
User: Uh, the address is one six seven eight Valley View Drive in Portland. 
User: Nine seven two zero nine. 
Agent: Okay, I have 1678 Valley View Drive in Portland, OR, 97209. What’s the best phone number to reach you at in case we need to contact you?
User: It''s five zero three five five five zero eight four two. 
Agent: Got it. And can I get your full name, please?
User: Mark Adams. 
Agent: Okay, Mark. I have Monday the 16th at 12:00 PM or Tuesday the 17th at 8:00 AM available for your filter replacement. Which works better for you?
User: Um, the Tuesday appointment would be best. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Tuesday the 17th at 8:00 AM at 1678 Valley View Drive. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No, that will be good. Thank you. 
Agent: Thank you, Mark. Have a great day!
',
     114, true, now() - interval '12 days'),

    ('demo_call_004', demo_agent, 'David Robinson', '',
     E'The user, David Robinson, called to schedule a thermostat replacement due to a blank and unresponsive screen despite battery replacement. The agent successfully booked an appointment for March 16, 2026, at 4:30 PM at 2205 Stonegate Court, Wilsonville, OR 97070. The user was informed the appointment would last about an hour and the call ended positively.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. I need to have my thermostat replaced. 
Agent: Okay, I can help you with that! Can you tell me a little more about the issue you’re having with your thermostat? For example, is the screen blank, is it not responding, or are you seeing any error messages?
User: It''s just not responding. 
Agent: Got it. Is the screen blank, or does it show anything at all? And have you tried replacing the batteries yet?
User: The screen''s blank. 
User: And I have tried replacing the batteries. It doesn''t matter. 
Agent: Okay, thanks for letting me know. We can definitely help with a thermostat replacement. May I have your full name to get started with scheduling your appointment?
User: David Robinson. 
Agent: Okay, David. What’s the best phone number to reach you at in case we need to follow up?
User: Five zero three five five five zero five nine three. 
Agent: Okay, David. What’s the address where you need the thermostat replaced?
User: Two two zero five Stonegate Court in Wilsonville. 
Agent: Got it. And what''s the zip code there?
User: It''s nine seven zero seven zero. 
Agent: Perfect, 
Agent: thank 
Agent: you. Let me check 
Agent: our next available appointments 
Agent: for a thermostat replacement.I have Monday the 16th at 4:30 PM or Monday the 16th at 5:00 PM available for your thermostat replacement— which works better for you?
User: Four thirty works good. 
Agent: Let me 
Agent: book that for you right now.Great, you''re all set! I have you scheduled for Monday, the 16th at 4:30 PM at 2205 Stonegate Court in Wilsonville. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: Yeah. Just curious, um, how long that appointment would be expectedly. 
Agent: Okay, for a thermostat replacement, the appointment usually takes about an hour. The technician will let you know if it looks like it might take longer once they arrive.Thank you, David. Have a great day!
User: Okay. Thank you. Bye. 
Agent: Thank you, David. Have a great day!
',
     146, true, now() - interval '11 days'),

    ('demo_call_005', demo_agent, 'Nathan Price', '',
     E'The user, Nathan Price, called to schedule a replacement for a broken manual thermostat lever. The agent confirmed the details, offered available appointment times, and successfully booked the appointment for March 17, 2026, at 8:30 AM at 3924 Tanglewood Way, Gresham, OR 97080. The call concluded with the user satisfied and no further assistance needed.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Uh, Yeah. I need a new thermostat. 
Agent: Okay, I can help you with that! Are you looking to replace an existing thermostat, or is this for a new installation? And do you know what type of thermostat you’d like—such as a programmable, smart, or manual thermostat?
User: Just a manual thermostat. 
Agent: Got it, you’d like a manual thermostat installed. Can you tell me a little about the issue you’re having with your current thermostat, or is this just an upgrade? That way our technician knows what to expect.
User: Uh, it''s just a replacement of basically the same thing. The the lever broke off on the 
Agent: Okay, thanks for letting me know. We’ll get someone out to replace your manual thermostat. May I have your full name to get the appointment started?
User: Yeah. My name, excuse me, is Nathan Price. 
Agent: Okay, Nathan. What’s the best phone number to reach you at in case we need to contact you before your appointment?
User: Five zero three five five five zero seven three four. 
Agent: Okay, Nathan. What’s the address where you need the thermostat replaced?
User: Three nine two four Tanglewood Way in Gresham. 
Agent: Got it. And what''s the zip code there?
User: Nine seven zero eight zero. 
Agent: Nathan, I have Tuesday the 17th at 8:00 AM or Tuesday the 17th at 8:30 AM available for your thermostat replacement. Which time works better for you?
User: Tuesday at eight thirty AM. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Tuesday, the 17th at 8:30 AM at 3924 Tanglewood Way in Gresham. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. Thank you. 
Agent: Thank you, Nathan. Have a great day!
',
     137, true, now() - interval '10 days'),

    ('demo_call_006', demo_agent, 'Travis Long', '',
     E'The user, Travis Long, called to schedule an installation of a new programmable thermostat to replace an older basic one. The agent confirmed the address and phone number, offered available appointment times, and successfully booked the appointment for March 16, 2026, at 4:00 PM at 2578 Brentwood Avenue, Tigard, OR 97224. The call concluded with confirmation and no further requests from the user.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. I wanted to get a new thermostat installed. 
Agent: Okay, we can help with that! Could you tell me a little about the thermostat you’d like installed? For example, is it a smart thermostat, programmable, or a basic manual one? And are you replacing an old thermostat or adding a new one?
User: Um, the thermostat I have is an older one. It''s not programmable, and I want a programmable one. 
Agent: Got it, you’d like to upgrade from a basic thermostat to a programmable one. Is your current thermostat still working, or are you having any issues with it right now?
User: It''s working fine. I just would like to be able to program it. 
Agent: Okay, that makes sense! We can definitely help with installing a new programmable thermostat. What’s the address where you need the service?
User: Twenty five seventy eight Brentwood Avenue in Tigard. 
User: ZIP code is nine seven two two four. 
Agent: Okay, thanks for providing the address. May I have your full name, please?
User: Travis Long. 
Agent: Okay, Travis. What’s the best phone number to reach you at?
User: Five zero three five five five zero eight two one. 
Agent: Travis, I have Monday, March 16 at 3:30 PM or Monday, March 16 at 4:00 PM available for your thermostat installation. Which time works better for you?
User: Four o''clock. 
Agent: Let me book that for you 
Agent: right now.Great, you''re all set! I have you scheduled for Monday, March 16 at 4:00 PM at 2578 Brentwood Avenue in Tigard. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. That''s all. 
Agent: Thank you, Travis. Have a great day!
',
     118, true, now() - interval '9 days'),

    ('demo_call_007', demo_agent, 'Nathan Price', '',
     E'The user, Nathan Price, called to schedule a replacement for his broken smart thermostat. The agent booked an appointment for March 16, 2026, at 2:00 PM at 3924 Tanglewood Way, Gresham, OR 97080. The call concluded successfully with all details confirmed and no further assistance requested.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. Hi. I, um, need to get a new thermostat. 
Agent: Okay, I can help with that! Are you looking to replace your current thermostat with a similar model, or are you interested in upgrading to a smart thermostat that you can control remotely?
User: I have a smart thermostat now, so it''d just be a replacement. 
Agent: Got it. Can you tell me a little about the issue you''re having with your current smart thermostat? For example, is the screen blank, not responding, or showing any error messages?
User: I hit something against it, it broke. So do you need a new one? 
Agent: I''m sorry to hear that happened! Yes, we can definitely help with replacing your broken smart thermostat. May I get your full name to get started with scheduling an appointment?
User: Nathan Price. 
Agent: Okay, Nathan. What’s the best phone number to reach you at in case we need to follow up?
User: Five zero three five five five zero seven three four. 
Agent: Okay, Nathan. What''s the address where you need the thermostat replacement service?
User: Thirty nine twenty four Tanglewood Way in Gresham. 
Agent: Got it. And what''s the zip code there?
User: Nine seven zero eight zero. 
Agent: We’re normally available for regular appointments Monday through Friday. I have Monday the 16th at 1:30 PM or 2:00 PM—would either of those work for you?
User: Two o''clock works good. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Monday, the 16th at 2:00 PM at 3924 Tanglewood Way in Gresham. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. That''s all. 
Agent: Thank you, Nathan. Have a great day!
',
     129, true, now() - interval '8 days'),

    ('demo_call_008', demo_agent, 'James Mitchell', '',
     E'The user, James Mitchell, called to schedule a filter change service. The agent confirmed the user''s details and booked an appointment for March 16, 2026, at 11:00 AM at 1842 Maple Creek Drive, Portland, OR 97201. The call ended with the user satisfied and no further requests.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. Hi. I just need to have my filters changed. 
Agent: Okay, we can help with that! Can I get your full name to get started?
User: James Mitchell. 
Agent: Okay, James. What’s the best phone number to reach you at in case we need to contact you?
User: Five zero three five five five zero one three two. 
Agent: Got it. What''s the address where you need the filter change service?
User: Eighteen forty two Maple Creek Drive in Portland. 
Agent: Okay, and what''s the zip code there?
User: Nine seven two zero one. 
Agent: James, I have Monday the 16th at 11:00 AM or 11:30 AM available for your filter change. Which time works better for you?
User: Eleven. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Monday, the 16th at 11:00 AM at 1842 Maple Creek Drive. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No, thank you. That''s good. 
Agent: Thank you, James. Have a great day!
',
     81, true, now() - interval '7 days'),

    ('demo_call_009', demo_agent, 'Patrick Coleman', '',
     E'The user, Patrick Coleman, scheduled a full preventive HVAC maintenance appointment for March 16, 2026, at 11:00 AM at 578 Riverbend Way, Oregon City, OR 97045. The agent confirmed the appointment and provided details about the technician and the service. The call concluded successfully with no further requests from the user.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. Um, I''ve gone to get a a routine maintenance done on my system. 
Agent: Absolutely, we can help with that! Is this for an AC tune-up, a furnace tune-up, or do you need maintenance on both heating and cooling systems?
User: Yeah. A complete maintenance. 
Agent: Okay, a full HVAC maintenance. Can you tell me a little about your system—are you experiencing any issues, or is this just preventive care?
User: Just preventive care. 
Agent: Great, preventive maintenance is a smart choice. May I have your full name, please?
User: Patrick Coleman, 
Agent: Okay, Patrick. What’s the best phone number to reach you at, including the area code?
User: Five zero three five five five zero six four eight. 
Agent: Got it. What''s the address where you need the service?
User: Five seven eight Riverbend Way, Oregon City nine seven zero four five. 
Agent: Okay, 
Agent: I have 578 Riverbend 
Agent: Way in Oregon City, zip code 97045. I’ll get the next available appointments for a full HVAC maintenance. One moment while I check our schedule.I have Monday the 16th at 10:30 AM or Monday the 16th at 11:00 AM available. Which works better for you?
User: Eleven AM. 
Agent: Let me 
Agent: book that for you right now.Great, you''re all set! I have you scheduled for Monday, the 16th at 11:00 AM at 578 Riverbend Way. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. That''ll do it. 
Agent: Thank you, Patrick. Have a great day!
',
     112, true, now() - interval '6 days'),

    ('demo_call_010', demo_agent, 'Patrick Coleman', '',
     E'Patrick Coleman called to schedule a full HVAC system maintenance at his address in Oregon City. The agent offered appointment slots on March 16 and 17, but was unable to book the appointment due to technical issues. Patrick declined a callback and ended the call without a confirmed appointment.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. I need to schedule a system maintenance. 
Agent: Okay, I can help you with that! Are you looking for a full HVAC maintenance for both heating and cooling, or just a 
User: Yes. 
Agent: tune-up for your AC or furnace?
User: A full system. 
Agent: Great, a full HVAC maintenance is a smart choice. Can I get your full name to get started with the booking?
User: Yeah. My name is Patrick Coleman. 
Agent: Okay, Patrick. What’s the best phone number to reach you at in case we need to follow up?
User: Five zero three five five five zero six four eight. 
Agent: Got it. What''s the address where you need the service?
User: Five seven eight Riverbend Way, Oregon City. 
Agent: Okay, and what''s the zip code there?
User: Nine seven zero four five. 
Agent: Patrick, I have Monday the 16th at 10:30 AM or Monday the 16th at 11:00 AM available for your full system maintenance. Which time works better for you?
User: Monday at ten thirty. 
Agent: Let 
Agent: me book that for you right now.I''m sorry, it looks like I wasn''t able to book that appointment just now. Would you like me to have someone give you a call back to finish scheduling?
User: Uh, can you try Tuesday? 
Agent: I have Tuesday the 17th at 8:00 AM or Tuesday the 17th at 8:30 AM available. Would either of those times work for you?
User: Yeah. Eight AM would be good. 
Agent: Let me book that for you right now.I''m sorry, it looks like I''m still unable to book the appointment directly. I can have someone from our team call you back right away to finish scheduling. Would you like to do that?
User: No. Thank you. 
Agent: Thank you, Patrick. Have a great day!
',
     131, true, now() - interval '5 days'),

    ('demo_call_011', demo_agent, 'Patrick Coleman', '',
     E'The user, Patrick Coleman, called to schedule a full system maintenance for heating and cooling at his address in Oregon City, OR. The agent found available slots but was unable to book the appointment due to technical issues. Patrick declined a callback and ended the call without a confirmed appointment.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Um, Yeah. I need to schedule a routine maintenance on my system. 
Agent: Absolutely, I can help with that. Are you looking for an AC tune-up, a furnace tune-up, or a full system maintenance for both heating and cooling?
User: Full system maintenance. 
Agent: Okay, full system maintenance for both heating and cooling. Can I get your full name, please?
User: Patrick Coleman. 
Agent: Okay, Patrick. What’s the best phone number to reach you at, including the area code?
User: It''s five zero three five five five zero six four eight. 
Agent: Got it. What’s the address where you need the service?
User: Five seven eight Riverbend Way, 
Agent: Okay, and what city and zip code is that in?
User: That''s in Oregon City, and the ZIP code is nine seven zero four five. 
Agent: I have Monday, March 16 at 10:30 AM or Monday, March 16 at 11:00 AM available for your full system maintenance. Which time works better for you?
User: Eleven AM. 
Agent: Let me book that for you 
Agent: right now.I''m sorry, it looks like I wasn''t able to book that appointment just now. Would you like me to have someone call you back to finish scheduling, or would you prefer to try a different time?
User: Can you try and find a time that is available? 
Agent: The next available times I have are Monday, March 16 at 10:30 AM or 11:00 AM. Would you like to try booking one of these again, or would you prefer a different day?
User: Well, I just tried booking one of those, and you said it''s not available. So, um, how about the next day? 
Agent: I have Tuesday, March 17 at 8:00 AM or 8:30 AM available. Would either of those times work for you?
User: Eight AM. 
Agent: Let 
Agent: me book that for you right now.I''m sorry, it looks like I''m still unable to book the appointment. Would you like me to have someone call you back right away to help finish scheduling?
User: No, thank you. 
Agent: Thank you, Patrick. Have a great day!
',
     152, true, now() - interval '4 days'),

    ('demo_call_012', demo_agent, 'Michael Patel', '',
     E'The user, Michael Patel, called to schedule a routine filter change for his heating and air system. The agent confirmed his contact details and address, then booked an appointment for March 16, 2026, at 8:00 AM with technician Terry Powell. The call concluded successfully with the user satisfied.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. I need to have my filters changed. 
Agent: Okay, we can help with that! May I have your full name to get started with scheduling your appointment?
User: Michael Patel. 
Agent: Okay, Michael. What’s the best phone number to reach you at, including the area code?
User: Five zero three five five five zero three four seven. 
Agent: Got it. What''s the address where you need the service?
User: Eleven thirty three Lakewood Boulevard. 
Agent: Okay, and what''s the city and zip code for that address?
User: Tigard, and that''s nine seven two two three. 
Agent: I have Monday the 16th at 8:00 AM or Monday the 16th at 8:30 AM available. Which time works better for you?
User: Eight AM is good. 
Agent: Okay, could you briefly describe if you''re experiencing any issues with your system, or is this just a routine filter change and maintenance?
User: Um, no issues, really. I just know that anything that''s changed. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Monday the 16th at 8:00 AM at 1133 Lakewood Boulevard. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. Thank you. 
Agent: Thank you, Michael. Have a great day!
',
     100, true, now() - interval '3 days'),

    ('demo_call_013', demo_agent, 'Eric Ramirez', '',
     E'The user, Eric Ramirez, called to report a non-working heat pump and successfully scheduled a diagnostic appointment for March 16, 2026, at 8:30 AM at 1447 Buckeye Trail, Portland, OR 97219. The agent confirmed the booking and provided details about the technician and appointment timing. The call ended positively with no further requests from the user.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. My, uh, heat pump isn''t working. 
Agent: I''m sorry to hear that — let''s get someone out to help. Can I get your full name, please?
User: Eric Ramirez. 
Agent: Okay, Eric. What’s the best phone number to reach you at, including the area code?
User: Five zero three five five five zero five six three. 
Agent: Got it. What''s the address where you need the service?
User: Fourteen forty seven Buckeye Trail in Portland. 
Agent: Okay, and what''s the zip code there?
User: Nine seven two one nine. 
Agent: Eric, I have Monday the 16th at 8:00 AM or Monday the 16th at 8:30 AM available. Which works better for you?
User: Eight thirty. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Monday, the 16th at 8:30 AM at 1447 Buckeye Trail in Portland. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: That''s all I need. Thank you. 
Agent: Thank you, Eric. Have a great day!
',
     90, true, now() - interval '2 days'),

    ('demo_call_014', demo_agent, 'Ryan Foster', '',
     E'The user, Ryan Foster, reported an issue with his furnace short cycling. The agent scheduled a heating repair appointment for March 16, 2026, at 1:00 PM at 2847 Springvale Avenue, Beaverton, OR 97005. The appointment was successfully booked, and the user was satisfied with the service.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. Hi. My furnace seems to just not stay on where it keep stay on for long. It just keeps turning on and off. 
Agent: I''m sorry to hear your furnace is short cycling—that can be really frustrating, especially when you need reliable heat. Let''s get someone out to take a look. Can I get your full name, please?
User: Ryan Foster. 
Agent: Okay, Ryan. What’s the best phone number to reach you at in case we need to follow up or if the call drops?
User: Five zero three five five five zero six two three. 
Agent: Got it, 503-555-0623. What''s the address where you need the service?
User: Twenty eight forty seven Springvale Avenue. 
Agent: Okay, and what''s the city and zip code for that address?
User: That''s Beaverton nine seven zero zero five. 
Agent: I have Monday the 16th at 8:00 AM or Monday the 16th at 8:30 AM available. Which time works better for you?
User: Do you have later in the day available? 
Agent: Yes, we do have Monday the 16th at 2:00 PM available. Would you like to book that time?
User: Yeah. By any chance, is one o''clock available? 
Agent: Yes, 1:00 PM on Monday the 16th is available. Would you like to schedule your appointment for that time?
User: Yes, please. 
User: please. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Monday the 16th at 1:00 PM at 2847 Springvale Avenue in Beaverton. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. That''ll that''s all. Thank you. 
User: you. 
Agent: Thank you, Ryan. Have a great day!
',
     127, true, now() - interval '1 days'),

    ('demo_call_015', demo_agent, 'Steven Cooper', '',
     E'The user, Steven Cooper, called to report that his furnace wasn''t turning on and the thermostat was blank despite battery replacement. The agent scheduled a heating repair appointment for March 13, 2026, at 3:30 PM at 978 Walnut Grove Avenue, Gresham, OR 97030. The call concluded successfully with the appointment booked and no further assistance needed.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. My furnace isn''t turning on. 
Agent: I''m sorry to hear that — let''s get someone out to help. Can you tell me a little more about what''s happening? For example, is the thermostat set to heat, and do you hear the system trying to start at all?
User: No. The thermostat''s just blank. 
Agent: Okay, thanks for letting me know. Have you tried replacing the batteries in your thermostat, or is it hardwired? And do you know what type of thermostat you have—like programmable, smart, or manual?
User: It''s programmable, and I replace the batteries. 
Agent: Okay. Since the thermostat is still blank after replacing the batteries, it could be a wiring or power issue. Let''s get a technician scheduled to take a look. May I have your full name, please?
User: Steven Cooper. 
Agent: Okay, Steven. What’s the best phone number to reach you at in case we need to contact you before your appointment?
User: Five zero three five five five zero six eight three. 
Agent: Got it. What''s the address where you need the service?
User: Nine seven eight Walnut Grove Avenue in Gresham. 
Agent: Okay. And what''s the zip code there?
User: Nine seven zero three zero. 
Agent: I have Friday the 13th at 3:30 PM or Friday the 13th at 4:00 PM available. Which works better for you?
User: Three thirty. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Friday the 13th at 3:30 PM at 978 Walnut Grove Avenue. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. Thank you. That''s good. 
Agent: Thank you, Steven. Have a great day!
',
     123, true, now() - interval '0 days'),

    ('demo_call_016', demo_agent, 'Bill Thompson', '',
     E'The user, Bill Thompson, called to schedule a routine checkup and servicing of his heating and air system at his new home. The agent successfully booked an appointment for March 13, 2026, at 2:00 PM at 9764 Southwest Garden Home Road, Portland, OR 97223. The call concluded with confirmation and no further requests from the user.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. Hi. I, uh, just moved into a new house, and I wanna have the my system checked out and serviced. 
Agent: Congratulations on your new home! I’m happy to help get your system checked and serviced. Could you tell me your full name, please?
User: It is Bill Thompson. 
Agent: Okay, Bill. What’s the best phone number to reach you at, including the area code?
User: Five zero three eight eight eight four four four four. 
User: four. 
Agent: Got it.
Agent: Okay, Bill. What''s the address where you need the service?
User: Ninety seven sixty four. Southwest 
User: Garden Home Road. 
Agent: Okay, and what''s the city and zip code for that address?
User: Portland nine seven two two three 
Agent: I have Friday the 13th at 2:00 PM or Friday the 13th at 2:30 PM available. Which time works better for you?
User: Two o''clock. 
Agent: Okay, and could you briefly describe any issues you’ve noticed with your system, or is this just a routine checkup?
User: It''s a routine checkup. 
Agent: Let me book that for you right now.Great, you''re all set! I have you scheduled for Friday the 13th at 2:00 PM at 9764 Southwest Garden Home Road. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. Thank you. 
Agent: Thank you, Bill. Have a great day!
',
     117, true, now() - interval '0 days'),

    ('demo_call_017', demo_agent, 'Mike Jackson', '',
     E'The user, Mike Jackson, called to schedule air conditioning service due to inconsistent cooling. The agent booked an appointment for March 13, 2026, at 1:00 PM at 4862 Governor Street, Tualatin, OR 97225. The technician Terry Powell will handle the service and will call 30 minutes before arrival.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. Hi. I need to have my air conditioning serviced. 
Agent: Absolutely, I can help with that. Can you tell me a little about what’s going on with your air conditioning?
User: Yeah. It just doesn''t seem very consistent. It''s it''s not very cold. 
User: Sometimes it seems even warm. 
Agent: I''m sorry to hear that—let''s get someone out to take a look. Is the system running at all, or is it completely off? And is air blowing from the vents, just not cold?
User: Yeah. It got air blowing. It''s just not cold. 
Agent: Okay, that helps. When did you last change the air filter, and do you know what temperature your thermostat is set to right now?
User: The thermostat''s set for seventy two, and the filters, I don''t know. It''s been a while. I I''m not sure when they were changed. 
Agent: Okay, thanks for letting me know. We''ll make sure the technician checks the filter and the system settings. What''s the address where you need the service?
User: It''s four eight six two Governor Street, 
Agent: Got it. And what''s the city and zip code for that address?
User: That''s in Tualatin, and the ZIP code is nine seven two two five. 
Agent: I have Friday the 13th at 12:30 PM or Friday the 13th at 1:00 PM available. Which works better for you?
User: One PM. 
Agent: Great, I’ll reserve the 1:00 PM slot for you. Can I get your full name, first and last?
User: It is 
User: pardon me, what was your question? 
User: question? 
Agent: No problem! I just need your full name, first and last, so I can book your appointment.
User: Hello? 
Agent: Yes, I’m here! Could you 
User: I''m 
Agent: please tell me your 
User: sorry. Yeah. I''m sorry. Was distracted. My name is Mike Jackson. 
Agent: Okay, thanks Mike. And what’s the best phone number to reach you, including area code?
User: Five zero three five five five four three two one. 
Agent: Perfect, thanks. Just to confirm, you’d like air conditioning service at 4862 Governor Street in Tualatin, OR 97225, and your system is blowing air but not cooling properly. Is there anything else about the issue you’d like the technician to know? For example, any unusual noises, smells, leaks, or anything else you’ve noticed?
User: No. That''s it. Thank you. 
User: you. 
Agent: Great, you''re 
Agent: all set! I have you scheduled for Friday, March 13 at 1:00 PM at 4862 Governor Street in Tualatin. Our technician will call you about 30 minutes before arrival.Is there anything else I can help you with?
User: Nope. 
Agent: Thank you, Mike. Have a great day!
',
     188, true, now() - interval '0 days'),

    ('demo_call_018', demo_agent, 'Andrew Thompson', '',
     E'The user, Andrew Thompson, called to report rattling and squealing noises from his furnace. The agent scheduled a heating repair appointment for March 13, 2026, at 11:30 AM at 5463 Southwest Turtle Street, Hillsboro, OR 97229. The appointment was successfully booked and the user was satisfied with the service.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. Hi. My furnace is making a bunch of noise. 
Agent: I''m sorry to hear that—let''s get someone out to help. Can you tell me a little more about the noise your furnace is making? For example, is it banging, rattling, squealing, or something else?
User: Rattling and squealing noise. 
Agent: Okay, thanks for letting me know. That could be a loose part or a motor issue, so it''s good you''re getting it checked out. Can I get your full name to get started with scheduling a service appointment?
User: Yes. Andrew Thompson. 
Agent: Okay, Andrew. What’s the best phone number to reach you, including the area code?
User: Five zero three five five five four nine seven six. 
Agent: Got it. What''s the address where you need the service?
User: It''s five four six three Southwest Turtle Street. 
Agent: Okay, and what''s the city and zip code for that address?
User: That''s in Hillsboro. ZIP code is nine seven two two nine. 
Agent: Perfect, 
Agent: thanks. Now, let me check our next available appointments 
Agent: for you.Andrew, I have Friday the 13th at 11:00 AM or Friday the 13th at 11:30 AM available. Which time works better for you?
User: Eleven thirty. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Friday the 13th at 11:30 AM at 5463 Southwest Turtle Street in Hillsboro. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. That''s all. Thank you. 
Agent: Thank you, Andrew. Have a great day!
',
     120, true, now() - interval '0 days'),

    ('demo_call_019', demo_agent, 'Bill Wilson', '',
     E'The user, Bill Wilson, reported that his heater was not turning on and scheduled a heating repair appointment for March 13, 2026, at 10:00 AM at 1245 Main Street, Beaverton, OR 97005. The agent confirmed the appointment and provided details about the technician and the service call. The call concluded successfully with the user satisfied.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. My heater doesn''t, uh, turn on. 
Agent: I''m sorry to hear that—let''s get someone out to help. Can you tell me a little more about what''s happening? For example, is the thermostat set to heat mode, and do you hear the system trying to start at all?
User: Yeah. I''ve got it switched to heat, but I don''t hear it trying to start at all or anything. 
Agent: Okay, thanks for letting me know. When was the last time your system was serviced, and have you checked your breaker to see if it might have tripped?
User: Yeah. The breaker is on, um, and I don''t know when the last time it''s been serviced. 
Agent: Okay, that''s helpful. Let''s get you scheduled for a service visit. What''s the address where you need the service?
User: Twelve forty five Main Street in Beaverton. 
Agent: Got it. And what''s the zip code there?
User: Nine seven zero zero five. 
Agent: Okay, thanks. Can I get your full name, please?
User: Bill Wilson? 
Agent: Thanks, Bill. And what''s the best phone number to reach you at?
User: Five zero three five five five six four four six. 
Agent: Okay, Bill.
Agent:  Let me check our next 
Agent: available appointments 
Agent: for you.Let me check what''s available.I have Friday the 13th at 10:00 AM or Friday the 13th at 10:30 AM—would either of those work for you?
User: (inaudible speech)
User: Friday at ten o''clock. 
Agent: Let 
Agent: me book that for you right now.Great, you''re all set! I have you scheduled for Friday the 13th at 10:00 AM at 1245 Main Street in Beaverton. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. That''s it. Thank you. 
Agent: Thank you, Bill. Have a great day!
',
     129, true, now() - interval '0 days'),

    ('demo_call_020', demo_agent, 'Greg MacDonald', '',
     E'The user, Greg MacDonald, called to report a blank screen on his hardwired programmable thermostat. The agent scheduled a thermostat repair appointment for March 13, 2026, at 8:30 AM at 7700 Southwest Garden Home Road, Portland, OR 97223. The appointment was successfully booked, and the user was satisfied with the service.',
     E'Agent: Hi, thank you for calling Comfort Heating and Air, how can I help you today?
User: Yeah. I''ve got I have a problem with my thermostat. I''m not sure what''s going on, but it it doesn''t there''s nothing under display. It''s blank. 
Agent: I''m sorry to hear that — let''s get someone out to help. Just to check, have you tried replacing the batteries in your thermostat yet? And do you know if it''s a programmable, smart, or manual thermostat?
User: Yeah. It''s programmable, but I don''t I don''t think there''s batteries in it. I think it''s hardwired to just they don''t they''re just wires. It''s not any batteries. 
Agent: Okay, thanks for letting me know. Sometimes a blank screen on a hardwired programmable thermostat can be caused by a tripped breaker or a wiring issue. Let’s get a technician scheduled to take a look for you.

Can I get your full name, please?
User: Greg. 
Agent: Okay, and what''s your last name, Greg?
User: MacDonald? 
Agent: Great, Greg MacDonald. What''s the best phone number to reach you at in case we need to call you before your appointment?
User: It''s five zero three nine seven or yeah. Five zero three nine seven one two three four five. 
User: five. 
Agent: Okay, got it.
Agent: Just to confirm, your phone number is 503-971-2345. 

What''s the address where you need the service?
User: Seven seven zero zero Southwest Garden Home Road. 
Agent: Okay, and what''s the city and zip code for that address?
User: That''s Portland nine seven two two three. 
Agent: Perfect, 
Agent: thanks.
Agent:  Let me check 
Agent: what''s available for an appointment.Let me check what''s available.I have Friday, March 13 at 8:00 AM or Friday, March 13 at 8:30 AM — which works better for you?
User: Friday at eight thirty. 
Agent: Let me 
Agent: book that for you right now.Great, you''re all set! I have you scheduled for Friday, March 13 at 8:30 AM at 7700 Southwest Garden Home Road. Our technician will call you about 30 minutes before arrival.

Is there anything else I can help you with?
User: No. That''s all. Thank you. 
User: you. 
Agent: Thank you, Greg. Have a great day!
',
     138, true, now() - interval '0 days');


  -- ============================================================
  -- 6. SEED APPOINTMENTS (real Portland data with relative dates)
  -- ============================================================
  -- Past appointments have technician assignments; upcoming ones may not

  INSERT INTO appointments (client_id, caller_name, first_name, last_name, caller_number, date, start_time, end_time, address, city, state, zip, notes, source, status, service_type, call_id, technician_id, duration) VALUES
    -- ---- PAST APPOINTMENTS ----
    -- ~12 biz days ago (late Feb)
    (demo_cid, 'Robert Garcia',     'Robert',  'Garcia',    '503-555-0419', sub_biz_days(CURRENT_DATE, 12), '12:00', '14:00', '7721 Sunset Ridge Road',         'Hillsboro',    'OR', '97214', 'Furnace Repair',                                                    'ai',     'confirmed', 'Furnace Repair',          'demo_call_001', tech_mike,  60),
    (demo_cid, 'Linda Thompson',    'Linda',   'Thompson',  '503-555-0184', sub_biz_days(CURRENT_DATE, 12), '14:00', '16:00', '490 Cloverhill Avenue',           'Beaverton',    'OR', '97006', 'Furnace check',                                                     'ai',     'confirmed', 'Furnace Diagnostic',      null,            tech_jake,  60),
    -- ~9 biz days ago (early Mar)
    (demo_cid, 'Michael Patel',     'Michael', 'Patel',     '503-555-0347', sub_biz_days(CURRENT_DATE, 9),  '08:00', '10:00', '1133 Lakewood Boulevard',         'Lake Oswego',  'OR', '97034', 'AC not turning on.',                                                'ai',     'confirmed', 'AC Diagnostic',           'demo_call_012', tech_scott, 60),
    (demo_cid, 'David Robinson',    'David',   'Robinson',  '503-555-0593', sub_biz_days(CURRENT_DATE, 9),  '12:00', '14:00', '2205 Stonegate Court',            'Wilsonville',  'OR', '97070', 'Furnace not turning on',                                            'ai',     'confirmed', 'Furnace Repair',          'demo_call_004', tech_jake,  60),
    (demo_cid, 'Greg Macdonald',    'Greg',    'Macdonald', '503-599-3322', sub_biz_days(CURRENT_DATE, 9),  '10:00', '12:00', '1234 Main Street',                'Portland',     'OR', '97223', 'Furnace not turning on',                                            'ai',     'confirmed', 'Furnace Repair',          'demo_call_020', tech_mike,  60),
    (demo_cid, 'Bill Wilson',       'Bill',    'Wilson',    '503-555-6446', sub_biz_days(CURRENT_DATE, 9),  '14:00', '16:00', '1245 Main Street',                'Oregon City',  'OR', '97352', 'Furnace does not turn on.',                                         'ai',     'confirmed', 'Furnace Repair',          'demo_call_019', tech_scott, 60),
    -- ~8 biz days ago
    (demo_cid, 'Greg McDonald',     'Greg',    'McDonald',  '503-555-6789', sub_biz_days(CURRENT_DATE, 8),  '08:00', '10:00', '123 Main Street',                 'Portland',     'OR', '97223', 'Furnace blowing cold air',                                          'ai',     'confirmed', 'Furnace Repair',          null,            tech_jake,  60),
    -- ~7 biz days ago
    (demo_cid, 'Kevin Washington',  'Kevin',   'Washington','503-555-0163', sub_biz_days(CURRENT_DATE, 7),  '12:00', '14:00', '6012 Brookside Drive',            'Tualatin',     'OR', '97062', 'Furnace is making a lot of noise.',                                  'ai',     'confirmed', 'Furnace Repair',          null,            tech_mike,  60),
    (demo_cid, 'Rachel Hernandez',  'Rachel',  'Hernandez', '503-555-0845', sub_biz_days(CURRENT_DATE, 7),  '14:00', '16:00', '3340 Millstone Court',            'Wilsonville',  'OR', '97070', 'Thermostat not working; both air conditioner and heater affected.',   'ai',     'confirmed', 'Thermostat Diagnostic',   null,            tech_scott, 60),
    -- ~6 biz days ago
    (demo_cid, 'Thomas Bennett',    'Thomas',  'Bennett',   '503-555-0472', sub_biz_days(CURRENT_DATE, 6),  '08:00', '10:00', '1087 Willowbrook Lane',           'Oregon City',  'OR', '97045', 'Furnace blowing cold air.',                                         'ai',     'confirmed', 'Furnace Repair',          null,            tech_jake,  60),
    (demo_cid, 'Steven Cooper',     'Steven',  'Cooper',    '503-555-0683', sub_biz_days(CURRENT_DATE, 6),  '12:00', '14:00', '978 Walnut Grove Avenue',          'Gresham',      'OR', '97030', 'Furnace not turning on',                                            'ai',     'confirmed', 'Furnace Repair',          'demo_call_015', tech_mike,  60),
    -- ~2 biz days ago (recent)
    (demo_cid, 'Andrew Thompson',   'Andrew',  'Thompson',  '503-555-4976', sub_biz_days(CURRENT_DATE, 2),  '11:30', '13:30', '5463 Southwest Turtle Street',     'Hillsboro',    'OR', '97229', 'Furnace making rattling and squealing noise',                       'ai',     'confirmed', 'Furnace Repair',          'demo_call_018', tech_scott, 60),

    -- ---- UPCOMING APPOINTMENTS (next business day = Monday) ----
    (demo_cid, 'Eric Ramirez',      'Eric',    'Ramirez',   '503-555-0563', add_biz_days(CURRENT_DATE, 1),  '08:30', '10:30', '1447 Buckeye Trail',              'Portland',     'OR', '97219', 'Heat pump isn''t working',                                          'ai',     'confirmed', 'Heat Pump Diagnostic',    'demo_call_013', tech_mike,  60),
    (demo_cid, 'Patrick Coleman',   'Patrick', 'Coleman',   '503-555-0648', add_biz_days(CURRENT_DATE, 1),  '11:00', '13:00', '5783 Riverbend Way',              'Oregon City',  'OR', '97045', 'Preventive full HVAC maintenance, no active issues reported.',       'ai',     'confirmed', 'Furnace Tune-Up',         'demo_call_009', tech_jake,  120),
    (demo_cid, 'Ryan Foster',       'Ryan',    'Foster',    '503-555-0623', add_biz_days(CURRENT_DATE, 1),  '13:00', '15:00', '2847 Springvale Avenue',           'Beaverton',    'OR', '97005', 'Furnace keeps turning on and off (short cycling)',                   'ai',     'confirmed', 'Furnace Repair',          'demo_call_014', tech_mike,  60),
    (demo_cid, 'Nathan Price',      'Nathan',  'Price',     '503-555-0734', add_biz_days(CURRENT_DATE, 1),  '14:00', '16:00', '3924 Tanglewood Way',             'Gresham',      'OR', '97080', 'Smart thermostat replacement—current unit broken due to impact.',     'ai',     'confirmed', 'Thermostat Install',      'demo_call_007', tech_scott, 120),
    (demo_cid, 'Travis Long',       'Travis',  'Long',      '503-555-0821', add_biz_days(CURRENT_DATE, 1),  '16:00', '17:00', '2578 Brentwood Avenue',            'Tigard',       'OR', '97224', 'Upgrade from basic thermostat to programmable thermostat.',           'ai',     'confirmed', 'Thermostat Install',      'demo_call_006', null,       60),
    (demo_cid, 'David Robinson',    'David',   'Robinson',  '503-555-0593', add_biz_days(CURRENT_DATE, 1),  '16:30', '17:30', '2205 Stonegate Court',             'Wilsonville',  'OR', '97070', 'Thermostat screen is blank and unresponsive. Batteries already replaced.', 'ai', 'confirmed', 'Thermostat Install',      'demo_call_004', null,       60),
    (demo_cid, 'Jason Reed',        'Jason',   'Reed',      '503-555-0417', add_biz_days(CURRENT_DATE, 1),  '13:00', '13:45', '820 Magnolia Way',                'Wilsonville',  'OR', '97070', 'AC does not turn on when switched to cooling mode.',                 'ai',     'confirmed', 'AC Diagnostic',           'demo_call_002', null,       45),
    -- Next business day +2 (Tuesday)
    (demo_cid, 'Mark Adams',        'Mark',    'Adams',     '503-555-0842', add_biz_days(CURRENT_DATE, 2),  '08:00', '08:20', '1678 Valley View Drive',           'Portland',     'OR', '97209', 'Customer is unsure of filter type; technician to check and replace.', 'ai',     'confirmed', 'Filter Replacement',      'demo_call_003', null,       20),
    (demo_cid, 'Nathan Price',      'Nathan',  'Price',     '503-555-0734', add_biz_days(CURRENT_DATE, 2),  '08:30', '09:30', '3924 Tanglewood Way',             'Gresham',      'OR', '97080', 'Manual thermostat replacement—lever broke off.',                      'ai',     'confirmed', 'Thermostat Install',      'demo_call_005', null,       60),
    (demo_cid, 'Robert Garcia',     'Robert',  'Garcia',    '503-555-0419', add_biz_days(CURRENT_DATE, 2),  '09:30', '14:00', '7721 Sunset Ridge Road',           'Hillsboro',    'OR', '97214', 'Compressor replacement needed, previously diagnosed.',               'ai',     'confirmed', 'Compressor Replacement',  'demo_call_001', null,       270);


  -- ============================================================
  -- 7. SEED CUSTOMER NOTES (from real production notes)
  -- ============================================================

  INSERT INTO customer_notes (customer_id, client_id, note) VALUES
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Robert'  AND last_name = 'Garcia'   LIMIT 1), demo_cid, 'Ductwork needs sealing in basement and attic. Quoted $450.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Mark'    AND last_name = 'Adams'    LIMIT 1), demo_cid, 'Loyal customer since 2019. Has annual maintenance contract.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'David'   AND last_name = 'Robinson' LIMIT 1), demo_cid, 'Had emergency no-heat call. Very satisfied with fast response.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Linda'   AND last_name = 'Thompson' LIMIT 1), demo_cid, 'Elderly homeowner. Please call 30 min before arrival.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Robert'  AND last_name = 'Garcia'   LIMIT 1), demo_cid, 'Loyal customer since 2022. Has annual maintenance contract. Prefers morning appointments.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Patrick' AND last_name = 'Coleman'  LIMIT 1), demo_cid, 'Commercial account - 6 rooftop units. Quarterly maintenance contract.'),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Steven'  AND last_name = 'Cooper'   LIMIT 1), demo_cid, 'Furnace is 12 years old - may need replacement within 2 years.');


  -- ============================================================
  -- 8. SEED FOLLOW-UP REMINDERS
  -- ============================================================

  INSERT INTO follow_up_reminders (customer_id, client_id, title, note, due_date, completed) VALUES
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'David'   AND last_name = 'Robinson' LIMIT 1), demo_cid, 'Check on thermostat',             'Call David to see how the new thermostat is working after replacement.',                           add_biz_days(CURRENT_DATE, 2), false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Robert'  AND last_name = 'Garcia'   LIMIT 1), demo_cid, 'Follow up on compressor',         'Robert''s compressor replacement is scheduled. Confirm parts are ordered and ready.',               add_biz_days(CURRENT_DATE, 1), false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Nathan'  AND last_name = 'Price'    LIMIT 1), demo_cid, 'Confirm thermostat appointment',   'Nathan has two thermostat jobs scheduled. Verify both are on the calendar.',                        CURRENT_DATE, false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Patrick' AND last_name = 'Coleman'  LIMIT 1), demo_cid, 'Quarterly maintenance review',    'Patrick''s full system maintenance is Monday. Prepare maintenance checklist for 6 rooftop units.',  add_biz_days(CURRENT_DATE, 1), false),
    ((SELECT id FROM customers WHERE client_id = demo_cid AND first_name = 'Steven'  AND last_name = 'Cooper'   LIMIT 1), demo_cid, 'Discuss furnace replacement',     'Steven''s furnace is 12 years old. Bring replacement brochures and financing info.',                add_biz_days(CURRENT_DATE, 5), false);

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
