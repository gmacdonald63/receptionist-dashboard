-- 20260501002_estimate_tokens.sql
-- Token table for customer-facing estimate portal.
-- Mirrors tracking_tokens pattern (20260328001_location_mapping.sql:91-114).
-- No anon RLS — public access goes through service-role Edge Functions only.

CREATE TABLE IF NOT EXISTS estimate_tokens (
  token       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id UUID    NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  client_id   INTEGER NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,

  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  revoked    BOOLEAN     NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estimate_tokens_estimate_idx ON estimate_tokens(estimate_id);
-- Partial index: fast lookup of valid tokens only
CREATE INDEX IF NOT EXISTS estimate_tokens_valid_idx
  ON estimate_tokens(token) WHERE revoked = false;
