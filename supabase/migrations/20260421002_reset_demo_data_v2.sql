-- reset_demo_data() v2 — copies only flagged records from client_id=1 into the
-- demo client (9999), shifts dates by whole weeks anchored on the Sunday of
-- the current week, and seeds 3 tech_locations at Portland-area coords so the
-- Map tab has live-looking pins on every reset.
--
-- Changes from the previous version:
--   • ref_date moved to 2026-04-05 (Sunday of the flagged appointment week)
--   • customers / calls / appointments filtered by include_in_demo = true
--   • calls copy now includes recording_url (was missing)
--   • tech_locations seeded for Mike / Scott / Jake with now() timestamps
--   • tech_locations wipe added to the cleanup section

CREATE OR REPLACE FUNCTION public.reset_demo_data()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  demo_cid   BIGINT  := 9999;
  src_cid    BIGINT  := 1;
  demo_agent TEXT    := 'agent_2a4314820da33d77656a6e4693';
  src_agent  TEXT    := 'agent_3bec4ff7311350d9b19b93db05';
  -- Sunday of the week the flagged appointments were booked in (Mon 4/6 – Thu 4/9)
  ref_date   DATE   := '2026-04-05';
  cur_sunday DATE;
  day_offset INTEGER;
  mike_id    BIGINT;
  scott_id   BIGINT;
  jake_id    BIGINT;
BEGIN

  -- ============================================================
  -- 0. COMPUTE DATE OFFSET (whole weeks so weekdays stay aligned)
  -- ============================================================
  cur_sunday := CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int;
  day_offset := cur_sunday - ref_date;

  -- ============================================================
  -- 1. WIPE — order matters for FK constraints
  -- ============================================================

  DELETE FROM follow_up_reminders
    WHERE customer_id IN (SELECT id FROM customers WHERE client_id = demo_cid);

  DELETE FROM customer_notes
    WHERE customer_id IN (SELECT id FROM customers WHERE client_id = demo_cid);

  DELETE FROM customers WHERE client_id = demo_cid;

  -- Tech locations: wipe before technicians (FK CASCADE would handle it, but explicit is clearer)
  DELETE FROM tech_locations WHERE client_id = demo_cid;

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
    subscription_status  = 'active',
    company_name         = 'Comfort Heating & Air',
    retell_agent_id      = demo_agent,
    appointment_duration = 60,
    buffer_time          = 0,
    timezone             = 'America/Los_Angeles'
  WHERE id = demo_cid;

  -- ============================================================
  -- 3. COPY SERVICE TYPES (full catalog)
  -- ============================================================

  INSERT INTO service_types (client_id, name, category, duration_minutes, urgency,
                             customer_phrases, sort_order, is_active)
  SELECT demo_cid, name, category, duration_minutes, urgency,
         customer_phrases, sort_order, is_active
  FROM service_types
  WHERE client_id = src_cid;

  -- ============================================================
  -- 4. COPY CUSTOMERS (only flagged include_in_demo = true)
  -- ============================================================

  CREATE TEMP TABLE _cust_map (old_id uuid, new_id uuid) ON COMMIT DROP;

  INSERT INTO customers (client_id, first_name, last_name, name, phone, email, address, tags)
  SELECT demo_cid, first_name, last_name, name, phone, email, address, tags
  FROM customers
  WHERE client_id = src_cid
    AND include_in_demo = true;

  INSERT INTO _cust_map (old_id, new_id)
  SELECT src.id, demo.id
  FROM customers src
  JOIN customers demo
    ON demo.client_id = demo_cid
   AND src.first_name = demo.first_name
   AND COALESCE(src.last_name,'') = COALESCE(demo.last_name,'')
   AND src.phone = demo.phone
  WHERE src.client_id = src_cid
    AND src.include_in_demo = true;

  -- ============================================================
  -- 5. COPY CALLS (only flagged)
  -- ============================================================

  INSERT INTO calls (call_id, agent_id, caller_name, caller_number, summary,
                     transcript, recording_url, duration_seconds, appointment_booked,
                     created_at)
  SELECT DISTINCT ON (call_id)
         'demo_' || call_id,
         demo_agent,
         caller_name,
         caller_number,
         summary,
         transcript,
         recording_url,
         duration_seconds,
         appointment_booked,
         created_at + (day_offset || ' days')::interval
  FROM calls
  WHERE agent_id = src_agent
    AND include_in_demo = true
  ORDER BY call_id,
           (summary IS NOT NULL)::int DESC,
           (caller_name IS NOT NULL AND caller_name != '')::int DESC,
           created_at DESC;

  -- ============================================================
  -- 6. COPY APPOINTMENTS (only flagged; date-shifted, tech-mapped)
  -- ============================================================

  CREATE TEMP TABLE _tech_map (old_id bigint, new_id bigint) ON COMMIT DROP;

  INSERT INTO _tech_map (old_id, new_id)
  SELECT src.id, demo.id
  FROM technicians src
  JOIN technicians demo ON demo.client_id = demo_cid AND src.name = demo.name
  WHERE src.client_id = src_cid;

  INSERT INTO appointments (
    client_id, caller_name, first_name, last_name, caller_number,
    date, start_time, end_time,
    address, city, state, zip,
    notes, source, status, service_type,
    call_id, technician_id, duration
  )
  SELECT
    demo_cid,
    a.caller_name, a.first_name, a.last_name, a.caller_number,
    a.date + day_offset,
    a.start_time, a.end_time,
    a.address, a.city, a.state, a.zip,
    a.notes, a.source, a.status, a.service_type,
    CASE WHEN a.call_id IS NOT NULL THEN 'demo_' || a.call_id ELSE NULL END,
    tm.new_id,
    a.duration
  FROM appointments a
  LEFT JOIN _tech_map tm ON tm.old_id = a.technician_id
  WHERE a.client_id = src_cid
    AND a.include_in_demo = true;

  -- ============================================================
  -- 7. COPY CUSTOMER NOTES (auto-inherit via _cust_map)
  -- ============================================================

  INSERT INTO customer_notes (customer_id, client_id, note)
  SELECT cm.new_id, demo_cid, cn.note
  FROM customer_notes cn
  JOIN _cust_map cm ON cm.old_id = cn.customer_id
  WHERE cn.client_id = src_cid;

  -- ============================================================
  -- 8. COPY FOLLOW-UP REMINDERS (auto-inherit, dates shifted)
  -- ============================================================

  INSERT INTO follow_up_reminders (customer_id, client_id, title, note, due_date, completed)
  SELECT cm.new_id, demo_cid, fr.title, fr.note,
         fr.due_date + day_offset,
         fr.completed
  FROM follow_up_reminders fr
  JOIN _cust_map cm ON cm.old_id = fr.customer_id
  WHERE fr.client_id = src_cid;

  -- ============================================================
  -- 9. SEED TECH LOCATIONS (3 demo techs, Portland metro spread)
  -- ============================================================
  -- Hardcoded coords are stable markers so the Map tab always has pins.
  -- Timestamps use now() so techs appear live on a fresh reset; they will
  -- gray out ~15 min later. validate-demo-token can be wired to touch these
  -- timestamps on each demo session start (see follow-up task).

  SELECT id INTO mike_id  FROM technicians WHERE client_id = demo_cid AND name = 'Mike Rodriguez' LIMIT 1;
  SELECT id INTO scott_id FROM technicians WHERE client_id = demo_cid AND name = 'Scott Russell'  LIMIT 1;
  SELECT id INTO jake_id  FROM technicians WHERE client_id = demo_cid AND name = 'Jake Thompson'  LIMIT 1;

  IF mike_id IS NOT NULL THEN
    INSERT INTO tech_locations (technician_id, client_id, lat, lng, heading, speed_kmh, recorded_at, received_at)
    VALUES (mike_id, demo_cid, 45.5230, -122.6780, 180, 0, now(), now());
  END IF;
  IF scott_id IS NOT NULL THEN
    INSERT INTO tech_locations (technician_id, client_id, lat, lng, heading, speed_kmh, recorded_at, received_at)
    VALUES (scott_id, demo_cid, 45.4870, -122.8040, 90, 0, now(), now());
  END IF;
  IF jake_id IS NOT NULL THEN
    INSERT INTO tech_locations (technician_id, client_id, lat, lng, heading, speed_kmh, recorded_at, received_at)
    VALUES (jake_id, demo_cid, 45.5000, -122.4300, 270, 0, now(), now());
  END IF;

END;
$function$;
