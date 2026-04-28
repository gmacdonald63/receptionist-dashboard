-- 20260501001_create_estimates.sql
-- Phase 2 invoicing: estimates, estimate_options, estimate_line_items tables.
-- See docs/superpowers/plans/2026-04-27-invoicing-phase-2-estimates.md

-- ─── estimates ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimates (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  appointment_id UUID    REFERENCES appointments(id) ON DELETE SET NULL,
  customer_id    UUID    REFERENCES customers(id)    ON DELETE SET NULL,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','viewed','approved','declined','expired','converted')),

  -- Content
  title       TEXT NOT NULL DEFAULT '',
  notes       TEXT,
  expires_at  TIMESTAMPTZ,

  -- Approval capture (legally sufficient: timestamp + IP + checkbox acknowledgement)
  approved_at      TIMESTAMPTZ,
  approved_by_ip   TEXT,
  accepted_option_id UUID,    -- FK filled by approve-estimate Edge Function (references estimate_options.id)

  -- Phase 3 hook
  invoice_id UUID,            -- set when estimate is converted to invoice

  -- Audit
  created_by_email TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estimates_client_id_idx    ON estimates(client_id);
CREATE INDEX IF NOT EXISTS estimates_appointment_idx  ON estimates(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimates_customer_idx     ON estimates(customer_id)    WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimates_status_idx       ON estimates(client_id, status);

-- ─── estimate_options (good / better / best groups) ──────────────────────────

CREATE TABLE IF NOT EXISTS estimate_options (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,

  label      TEXT    NOT NULL,           -- e.g. "Standard", "Good", "Better", "Best"
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Computed totals (denormalized for fast portal reads; recalculated on every save)
  subtotal   NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total      NUMERIC(12,2) NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estimate_options_estimate_idx ON estimate_options(estimate_id);

-- ─── estimate_line_items ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimate_line_items (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id UUID NOT NULL REFERENCES estimates(id)          ON DELETE CASCADE,
  option_id   UUID NOT NULL REFERENCES estimate_options(id)   ON DELETE CASCADE,

  -- Optional back-link to catalog; NULL for ad-hoc lines
  catalog_item_id INTEGER REFERENCES pricing_catalog(id) ON DELETE SET NULL,

  -- Line content (denormalized from catalog at save time so edits don't cascade)
  name        TEXT           NOT NULL,
  description TEXT,
  unit_type   TEXT           NOT NULL DEFAULT 'each'
    CHECK (unit_type IN ('each','hour','pound','foot','sqft','ton','trip')),
  quantity    NUMERIC(10,3)  NOT NULL DEFAULT 1
    CHECK (quantity > 0),
  unit_price  NUMERIC(10,2)  NOT NULL DEFAULT 0
    CHECK (unit_price >= 0),
  taxable     BOOLEAN        NOT NULL DEFAULT false,
  sort_order  INTEGER        NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estimate_line_items_estimate_idx ON estimate_line_items(estimate_id);
CREATE INDEX IF NOT EXISTS estimate_line_items_option_idx   ON estimate_line_items(option_id);

-- ─── updated_at triggers ─────────────────────────────────────────────────────

-- Reuse the trigger function created in Phase 1 migration 20260426001.
-- If that migration hasn't been applied (fresh DB), create the function here:
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER set_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_estimate_options_updated_at
  BEFORE UPDATE ON estimate_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_estimate_line_items_updated_at
  BEFORE UPDATE ON estimate_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
