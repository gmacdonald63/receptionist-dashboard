-- 20260426001_create_pricing_catalog.sql
-- Phase 1 of invoicing build: per-client pricing catalog.
-- See docs/superpowers/plans/2026-04-26-invoicing-phase-1-catalog.md

CREATE TABLE IF NOT EXISTS pricing_catalog (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,                                  -- e.g. 'Diagnostics', 'Equipment', 'Parts', 'Labor', 'Materials'

  -- Pricing
  unit_type TEXT NOT NULL DEFAULT 'each',         -- 'each' | 'hour' | 'pound' | 'foot' | 'unit' | shop-defined
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,    -- 0 means "needs pricing"

  -- Tax (Fork 6)
  taxable BOOLEAN NOT NULL DEFAULT true,

  -- Tier (forward-compat for Phase 2 good/better/best — present from Phase 1 to avoid future migration)
  tier TEXT,                                      -- NULL | 'good' | 'better' | 'best' | shop-defined
  tier_group TEXT,                                -- groups tiered rows; NULL for non-tiered entries

  -- Optional linkage to service_types (lets Phase 2 estimate UI auto-suggest the catalog item)
  service_type_id INT REFERENCES service_types(id) ON DELETE SET NULL,

  -- Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Note: name uniqueness is NOT enforced. A shop may legitimately have two "Capacitor"
  -- entries at different prices for different brands. Sort + filter handles disambiguation.
  CONSTRAINT pricing_catalog_unit_price_nonneg CHECK (unit_price >= 0),
  CONSTRAINT pricing_catalog_unit_type_nonempty CHECK (length(trim(unit_type)) > 0),
  CONSTRAINT pricing_catalog_name_nonempty CHECK (length(trim(name)) > 0)
);

-- Indexes for query patterns: list-by-client, filter-by-category, active-only
CREATE INDEX IF NOT EXISTS idx_pricing_catalog_client
  ON pricing_catalog(client_id);
CREATE INDEX IF NOT EXISTS idx_pricing_catalog_client_category
  ON pricing_catalog(client_id, category) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pricing_catalog_client_tier_group
  ON pricing_catalog(client_id, tier_group) WHERE tier_group IS NOT NULL;

-- updated_at maintenance via trigger (cleaner than asking app code to set it).
-- Reuse the existing update_updated_at_column() function defined in
-- supabase/migrations/20260324_add_sales_rep_commission_tables.sql:55. Do NOT add a
-- duplicate function — the codebase convention is one trigger function for all tables.
DROP TRIGGER IF EXISTS pricing_catalog_set_updated_at ON pricing_catalog;
CREATE TRIGGER pricing_catalog_set_updated_at
  BEFORE UPDATE ON pricing_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
