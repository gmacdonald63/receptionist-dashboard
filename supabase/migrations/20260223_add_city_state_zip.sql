-- Add city, state, and zip columns to customers table
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS city  TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip   TEXT;

-- Add city, state, and zip columns to appointments table
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS city  TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip   TEXT;
