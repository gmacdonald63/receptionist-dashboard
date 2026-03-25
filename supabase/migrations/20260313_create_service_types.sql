-- Create service_types table for HVAC scheduling
-- Each row represents a service type with a fixed duration for appointment booking

CREATE TABLE IF NOT EXISTS service_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,  -- 'emergency', 'diagnostic', 'repair', 'maintenance', 'estimate'
  duration_minutes INTEGER NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'standard',  -- 'emergency', 'same-day', 'standard', 'scheduled'
  customer_phrases TEXT[] NOT NULL DEFAULT '{}',  -- phrases callers use to describe this issue
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;

-- Everyone can read service types (they're shared reference data)
CREATE POLICY "Service types are readable by all authenticated users"
  ON service_types FOR SELECT
  TO authenticated
  USING (true);

-- Anon can also read (needed for edge functions called by Retell)
CREATE POLICY "Service types are readable by anon"
  ON service_types FOR SELECT
  TO anon
  USING (true);

-- Only admins can modify (via dashboard)
CREATE POLICY "Only admins can insert service types"
  ON service_types FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE clients.email = auth.email() AND clients.is_admin = true)
  );

CREATE POLICY "Only admins can update service types"
  ON service_types FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.email = auth.email() AND clients.is_admin = true)
  );

-- Seed data
INSERT INTO service_types (name, category, duration_minutes, urgency, customer_phrases, sort_order) VALUES
  -- Emergency
  ('Emergency - Gas or Carbon Monoxide', 'emergency', 90, 'emergency',
    ARRAY['smell gas', 'carbon monoxide', 'burning smell from furnace', 'CO alarm'], 1),
  ('Emergency - No Heat', 'emergency', 90, 'same-day',
    ARRAY['no heat at all', 'furnace completely stopped', 'house is freezing', 'heating emergency'], 2),
  ('Emergency - No AC', 'emergency', 90, 'same-day',
    ARRAY['AC completely dead', 'no air conditioning', 'AC stopped during heat wave'], 3),
  ('Emergency - Water Flooding', 'emergency', 90, 'same-day',
    ARRAY['water pouring from HVAC', 'flooding from unit', 'major water leak'], 4),

  -- Diagnostic
  ('Diagnostic - AC Not Cooling', 'diagnostic', 90, 'standard',
    ARRAY['AC running but not cooling', 'blowing warm air', 'house won''t cool down'], 10),
  ('Diagnostic - AC Not Turning On', 'diagnostic', 90, 'standard',
    ARRAY['AC won''t turn on', 'AC won''t start', 'nothing happens when I turn on AC'], 11),
  ('Diagnostic - AC Freezing Up', 'diagnostic', 90, 'standard',
    ARRAY['ice on the AC', 'AC is frozen', 'frost on the unit'], 12),
  ('Diagnostic - AC Noise', 'diagnostic', 90, 'standard',
    ARRAY['AC making loud noise', 'grinding sound', 'rattling', 'buzzing from AC'], 13),
  ('Diagnostic - Furnace Not Working', 'diagnostic', 90, 'standard',
    ARRAY['furnace won''t turn on', 'furnace stopped working', 'no heat from furnace'], 14),
  ('Diagnostic - Furnace Blowing Cold', 'diagnostic', 90, 'standard',
    ARRAY['furnace blowing cold air', 'heat is on but air is cold'], 15),
  ('Diagnostic - Heat Pump Not Heating', 'diagnostic', 90, 'standard',
    ARRAY['heat pump not heating', 'heat pump blowing cold air'], 16),
  ('Diagnostic - Thermostat Issue', 'diagnostic', 60, 'standard',
    ARRAY['thermostat not responding', 'thermostat blank', 'thermostat won''t change temperature'], 17),
  ('Diagnostic - Water Leak', 'diagnostic', 60, 'same-day',
    ARRAY['water dripping from unit', 'puddle under AC', 'condensation leak'], 18),
  ('Diagnostic - Electrical', 'diagnostic', 120, 'standard',
    ARRAY['breaker trips when AC runs', 'breaker keeps tripping', 'electrical problem with HVAC'], 19),
  ('Diagnostic - Airflow Weak', 'diagnostic', 90, 'standard',
    ARRAY['barely any air coming out', 'weak airflow', 'low air pressure from vents'], 20),
  ('Diagnostic - Uneven Temperature', 'diagnostic', 90, 'standard',
    ARRAY['some rooms hot and some cold', 'upstairs too hot', 'uneven heating'], 21),
  ('Diagnostic - Air Quality', 'diagnostic', 90, 'standard',
    ARRAY['house is too humid', 'dusty air', 'allergies getting worse', 'musty smell from vents'], 22),
  ('Diagnostic - General', 'diagnostic', 90, 'standard',
    ARRAY['HVAC problem', 'something wrong with my system', 'not sure what''s wrong'], 23),

  -- Repair
  ('Repair - Minor', 'repair', 60, 'standard',
    ARRAY['need a part replaced', 'capacitor', 'thermostat replacement', 'filter issue'], 30),
  ('Repair - Standard', 'repair', 120, 'standard',
    ARRAY['fan motor replacement', 'refrigerant recharge', 'drain line repair', 'blower motor'], 31),
  ('Repair - Major', 'repair', 240, 'scheduled',
    ARRAY['compressor replacement', 'coil replacement', 'heat exchanger repair', 'major component'], 32),

  -- Maintenance
  ('Maintenance - AC Tune-Up', 'maintenance', 90, 'scheduled',
    ARRAY['AC tune-up', 'get my AC ready for summer', 'annual AC service', 'AC maintenance'], 40),
  ('Maintenance - Furnace Tune-Up', 'maintenance', 90, 'scheduled',
    ARRAY['furnace tune-up', 'heating maintenance', 'get ready for winter', 'furnace service'], 41),
  ('Maintenance - Full System', 'maintenance', 120, 'scheduled',
    ARRAY['full HVAC maintenance', 'service both heating and cooling', 'complete tune-up'], 42),
  ('Maintenance - Filter Change', 'maintenance', 30, 'scheduled',
    ARRAY['just need a filter change', 'replace my filter', 'filter replacement'], 43),

  -- Estimate
  ('Estimate - System Replacement', 'estimate', 90, 'scheduled',
    ARRAY['quote for new AC', 'need to replace furnace', 'how much for a new system', 'replacement estimate'], 50),
  ('Estimate - New Installation', 'estimate', 90, 'scheduled',
    ARRAY['adding AC to home', 'installing a mini-split', 'new ductwork', 'new system install'], 51),
  ('Estimate - Duct Work', 'estimate', 90, 'scheduled',
    ARRAY['duct inspection', 'ductwork estimate', 'want ducts checked'], 52);
