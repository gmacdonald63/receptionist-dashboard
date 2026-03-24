-- ============================================================
-- Sub-Plan 1: Sales Rep Commission System — Foundation
-- Adds is_sales_rep + commission_option to clients.
-- Creates deals and commissions tables.
-- Note: clients.id is BIGINT (not UUID), so all FKs to
-- clients.id use BIGINT regardless of what the spec states.
-- ============================================================


-- ── 1. Modify clients table ──────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_sales_rep    BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_option INTEGER DEFAULT NULL;

COMMENT ON COLUMN clients.is_sales_rep      IS 'True for sales rep accounts (role=sales_rep)';
COMMENT ON COLUMN clients.commission_option IS '1 = full upfront, 2 = split+residual. NULL for non-rep accounts.';


-- ── 2. Create deals table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS deals (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id                  BIGINT      NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  client_name             TEXT        NOT NULL,
  client_email            TEXT        NOT NULL,
  client_phone            TEXT,
  company_name            TEXT        NOT NULL,
  plan                    TEXT        NOT NULL CHECK (plan IN ('standard', 'pro')),
  billing_cycle           TEXT        NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  status                  TEXT        NOT NULL DEFAULT 'onboarding_sent'
                            CHECK (status IN ('onboarding_sent', 'setup_in_progress', 'active', 'cancelled')),
  onboarding_token        UUID        UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  onboarding_data         JSONB,
  stripe_setup_payment_id TEXT,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  hubspot_deal_id         TEXT,
  supabase_client_id      BIGINT      REFERENCES clients(id) ON DELETE SET NULL,
  clawback_safe           BOOLEAN     NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  deals                        IS 'One row per sales deal from creation through active subscription.';
COMMENT ON COLUMN deals.rep_id                 IS 'FK to clients — the sales rep who created this deal.';
COMMENT ON COLUMN deals.onboarding_token       IS 'UUID used in the public onboarding URL: /onboard?token=<uuid>';
COMMENT ON COLUMN deals.onboarding_data        IS 'JSON blob of all form fields submitted by the client.';
COMMENT ON COLUMN deals.supabase_client_id     IS 'FK to clients — set by Greg when he creates the client account.';
COMMENT ON COLUMN deals.clawback_safe          IS 'False until 2nd subscription payment clears (or annual payment clears immediately).';


-- ── 3. updated_at auto-trigger for deals ────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deals_updated_at ON deals;
CREATE TRIGGER deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ── 4. Indexes for deals ─────────────────────────────────────

CREATE INDEX        IF NOT EXISTS deals_rep_id_idx           ON deals (rep_id);
CREATE UNIQUE INDEX IF NOT EXISTS deals_onboarding_token_idx ON deals (onboarding_token);
CREATE INDEX        IF NOT EXISTS deals_status_idx           ON deals (status);


-- ── 5. Create commissions table ──────────────────────────────

CREATE TABLE IF NOT EXISTS commissions (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      UUID          NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  rep_id       BIGINT        NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  type         TEXT          NOT NULL CHECK (type IN ('upfront', 'residual')),
  month_number INTEGER       CHECK (month_number BETWEEN 1 AND 12),
  amount       NUMERIC(10,2) NOT NULL,
  status       TEXT          NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'due', 'paid', 'voided')),
  due_date     DATE,
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  commissions               IS 'One row per commission payment — upfront and residual installments.';
COMMENT ON COLUMN commissions.type         IS 'upfront = one-time or 50% payment; residual = monthly 10% payment.';
COMMENT ON COLUMN commissions.month_number IS '1–12 for residuals; NULL for upfront records. Month 1 is due same day as upfront.';
COMMENT ON COLUMN commissions.status       IS 'pending=scheduled not yet due; due=ready to pay; paid=Greg marked paid; voided=clawback.';


-- ── 6. Indexes for commissions ───────────────────────────────

CREATE INDEX IF NOT EXISTS commissions_deal_id_idx  ON commissions (deal_id);
CREATE INDEX IF NOT EXISTS commissions_rep_id_idx   ON commissions (rep_id);
CREATE INDEX IF NOT EXISTS commissions_status_idx   ON commissions (status);
CREATE INDEX IF NOT EXISTS commissions_due_date_idx ON commissions (due_date);


-- ── 7. Row Level Security ────────────────────────────────────
-- RLS is enabled now; full policies are added in Sub-Plan 3
-- (rep dashboard) when frontend access patterns are defined.
-- Edge functions use the service role key and bypass RLS.

ALTER TABLE deals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
