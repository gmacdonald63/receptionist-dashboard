-- 20260426003_clients_default_tax_rate.sql
-- Per-client default tax rate (Fork 6). Per-line `taxable` already lives on
-- pricing_catalog. Estimate/invoice math: line_total * (taxable ? client.default_tax_rate : 0).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS default_tax_rate NUMERIC(6,5) NOT NULL DEFAULT 0;

-- Storage example: 0.08750 = 8.750%. Five decimal places handles fractional rates
-- like 7.375% that some local jurisdictions use.

COMMENT ON COLUMN clients.default_tax_rate IS
  'Default sales tax rate for invoices/estimates. Stored as decimal: 0.08750 = 8.750%. Per-line taxable flag on pricing_catalog determines whether each line uses this rate.';

ALTER TABLE clients
  ADD CONSTRAINT clients_default_tax_rate_range
  CHECK (default_tax_rate >= 0 AND default_tax_rate < 1);
