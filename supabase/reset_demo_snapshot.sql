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
  DELETE FROM calls WHERE agent_id = 'agent_c48b68df1da80f01e2c1eea6aa'; -- legacy demo agent

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

  -- ============================================================
  -- SEED DATA PLACEHOLDER — will be populated in next step
  -- ============================================================

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
