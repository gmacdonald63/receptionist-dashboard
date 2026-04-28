-- 20260501004_clients_estimate_settings.sql
-- Two new columns on clients for estimate portal customization.

-- Optional legal text shown on the portal approval page.
-- NULL = use the built-in default text.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS estimate_legal_text TEXT;

COMMENT ON COLUMN clients.estimate_legal_text IS
  'Optional custom legal disclosure shown on the customer estimate portal approval step. NULL = system default text.';

-- How long estimate portal links stay valid (days). Default 30.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS estimate_validity_days INTEGER NOT NULL DEFAULT 30
    CONSTRAINT clients_estimate_validity_days_range CHECK (estimate_validity_days BETWEEN 1 AND 365);

COMMENT ON COLUMN clients.estimate_validity_days IS
  'How many days estimate portal tokens remain valid. Stored in estimate_tokens.expires_at = created_at + this interval.';
