-- Add first_name and last_name columns to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Migrate existing name data: split on first space
-- "John Smith" → first_name: "John", last_name: "Smith"
-- "John" → first_name: "John", last_name: NULL
-- "John David Smith" → first_name: "John", last_name: "David Smith"
UPDATE customers
SET
  first_name = CASE
    WHEN name IS NOT NULL AND POSITION(' ' IN TRIM(name)) > 0
      THEN LEFT(TRIM(name), POSITION(' ' IN TRIM(name)) - 1)
    ELSE TRIM(name)
  END,
  last_name = CASE
    WHEN name IS NOT NULL AND POSITION(' ' IN TRIM(name)) > 0
      THEN SUBSTRING(TRIM(name) FROM POSITION(' ' IN TRIM(name)) + 1)
    ELSE NULL
  END
WHERE name IS NOT NULL AND first_name IS NULL;

-- Add index on last_name for searchability
CREATE INDEX IF NOT EXISTS idx_customers_last_name ON customers (last_name);
