-- reset_demo_snapshot.sql
-- Wipes all demo data for client_id 9999, then re-seeds by COPYING live data
-- from client_id 1 (Comfort Heating & Air, Portland OR).
--
-- Dates are shifted by whole weeks so appointments land on the same weekday.
-- Reference date: 2026-03-15 (Sunday when snapshot pattern was established).
--
-- Run: SELECT reset_demo_data();

CREATE OR REPLACE FUNCTION reset_demo_data()
RETURNS void AS $$
DECLARE
  demo_cid   BIGINT  := 9999;
  src_cid    BIGINT  := 1;
  demo_agent TEXT    := 'agent_2a4314820da33d77656a6e4693';
  src_agent  TEXT    := 'agent_3bec4ff7311350d9b19b93db05';
  ref_date   DATE   := '2026-03-15';   -- Sunday when data pattern was captured
  cur_sunday DATE;
  day_offset INTEGER;
BEGIN

  -- ============================================================
  -- 0. COMPUTE DATE OFFSET (whole weeks so weekdays stay aligned)
  -- ============================================================
  -- Find the Sunday of the current week
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
  -- 3. COPY SERVICE TYPES (all 157 from production)
  -- ============================================================

  INSERT INTO service_types (client_id, name, category, duration_minutes, urgency,
                             customer_phrases, sort_order, is_active)
  SELECT demo_cid, name, category, duration_minutes, urgency,
         customer_phrases, sort_order, is_active
  FROM service_types
  WHERE client_id = src_cid;

  -- ============================================================
  -- 4. COPY CUSTOMERS (all from production)
  -- ============================================================

  -- Use a temp table to map old customer IDs to new ones (for notes/reminders)
  CREATE TEMP TABLE _cust_map (old_id uuid, new_id uuid) ON COMMIT DROP;

  INSERT INTO customers (client_id, first_name, last_name, name, phone, email, address, tags)
  SELECT demo_cid, first_name, last_name, name, phone, email, address, tags
  FROM customers
  WHERE client_id = src_cid;

  -- Build the mapping: match on (first_name, last_name, phone) which is unique per customer
  INSERT INTO _cust_map (old_id, new_id)
  SELECT src.id, demo.id
  FROM customers src
  JOIN customers demo
    ON demo.client_id = demo_cid
   AND src.first_name = demo.first_name
   AND COALESCE(src.last_name,'') = COALESCE(demo.last_name,'')
   AND src.phone = demo.phone
  WHERE src.client_id = src_cid;

  -- ============================================================
  -- 5. COPY CALLS (unique per call_id, prefer rows with summary)
  -- ============================================================
  -- The webhook fires multiple times per call. Keep the best row per call_id.

  INSERT INTO calls (call_id, agent_id, caller_name, caller_number, summary,
                     transcript, duration_seconds, appointment_booked, created_at)
  SELECT DISTINCT ON (call_id)
         'demo_' || call_id,  -- prefix to avoid collision with real call IDs
         demo_agent,
         caller_name,
         caller_number,
         summary,
         transcript,
         duration_seconds,
         appointment_booked,
         created_at + (day_offset || ' days')::interval
  FROM calls
  WHERE agent_id = src_agent
  ORDER BY call_id,
           (summary IS NOT NULL)::int DESC,
           (caller_name IS NOT NULL AND caller_name != '')::int DESC,
           created_at DESC;

  -- ============================================================
  -- 6. COPY APPOINTMENTS (with date offset + technician mapping)
  -- ============================================================

  -- Build technician mapping: match by name
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
    a.date + day_offset,          -- shift date by whole weeks
    a.start_time, a.end_time,
    a.address, a.city, a.state, a.zip,
    a.notes, a.source, a.status, a.service_type,
    CASE WHEN a.call_id IS NOT NULL THEN 'demo_' || a.call_id ELSE NULL END,
    tm.new_id,                    -- mapped technician ID
    a.duration
  FROM appointments a
  LEFT JOIN _tech_map tm ON tm.old_id = a.technician_id
  WHERE a.client_id = src_cid;

  -- ============================================================
  -- 7. COPY CUSTOMER NOTES
  -- ============================================================

  INSERT INTO customer_notes (customer_id, client_id, note)
  SELECT cm.new_id, demo_cid, cn.note
  FROM customer_notes cn
  JOIN _cust_map cm ON cm.old_id = cn.customer_id
  WHERE cn.client_id = src_cid;

  -- ============================================================
  -- 8. COPY FOLLOW-UP REMINDERS
  -- ============================================================

  INSERT INTO follow_up_reminders (customer_id, client_id, title, note, due_date, completed)
  SELECT cm.new_id, demo_cid, fr.title, fr.note,
         fr.due_date + day_offset,    -- shift due dates too
         fr.completed
  FROM follow_up_reminders fr
  JOIN _cust_map cm ON cm.old_id = fr.customer_id
  WHERE fr.client_id = src_cid;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
