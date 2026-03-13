-- Add first_name and last_name columns to appointments table
-- Keeps caller_name for backward compatibility (AI/webhook still write to it)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Migrate existing caller_name data into first_name/last_name
-- "John Smith" → first_name: "John", last_name: "Smith"
-- "John" → first_name: "John", last_name: NULL
-- "John David Smith" → first_name: "John", last_name: "David Smith"
UPDATE appointments
SET
  first_name = CASE
    WHEN caller_name IS NOT NULL AND POSITION(' ' IN TRIM(caller_name)) > 0
      THEN LEFT(TRIM(caller_name), POSITION(' ' IN TRIM(caller_name)) - 1)
    ELSE TRIM(caller_name)
  END,
  last_name = CASE
    WHEN caller_name IS NOT NULL AND POSITION(' ' IN TRIM(caller_name)) > 0
      THEN SUBSTRING(TRIM(caller_name) FROM POSITION(' ' IN TRIM(caller_name)) + 1)
    ELSE NULL
  END
WHERE caller_name IS NOT NULL AND first_name IS NULL;

-- Index on last_name for sorting/searching
CREATE INDEX IF NOT EXISTS idx_appointments_last_name ON appointments (last_name);
CREATE INDEX IF NOT EXISTS idx_appointments_first_name ON appointments (first_name);
