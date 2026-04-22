-- Add include_in_demo flag to the three tables that seed the demo dashboard.
-- Records marked true on client_id=1 (appointments/customers) or the matching
-- agent_id (calls) are copied into the demo client by reset_demo_data().

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS include_in_demo boolean NOT NULL DEFAULT false;
ALTER TABLE customers    ADD COLUMN IF NOT EXISTS include_in_demo boolean NOT NULL DEFAULT false;
ALTER TABLE calls        ADD COLUMN IF NOT EXISTS include_in_demo boolean NOT NULL DEFAULT false;

-- Partial indexes — narrow since only a small subset will be flagged.
CREATE INDEX IF NOT EXISTS appointments_include_in_demo_idx
  ON appointments (client_id) WHERE include_in_demo = true;

CREATE INDEX IF NOT EXISTS customers_include_in_demo_idx
  ON customers (client_id) WHERE include_in_demo = true;

-- calls is scoped by agent_id (no client_id column)
CREATE INDEX IF NOT EXISTS calls_include_in_demo_idx
  ON calls (agent_id) WHERE include_in_demo = true;
