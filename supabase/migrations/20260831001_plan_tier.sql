-- 20260831001_plan_tier.sql
-- AI-only service tier. Splits the product into two purchasable tiers so the AI
-- receptionist can be sold standalone below the full-platform price.
--
-- Tier is a second dimension, independent of the existing minute bucket:
--   deals.plan     -> minute bucket  (standard = 1k min, pro = 2k min)
--   deals.tier     -> what they get  (ai_only = voice + visibility, platform = everything)
--
-- Spec: docs/superpowers/specs/2026-07-18-ai-only-tier-design.md

-- Clients: the tier that gates the dashboard. Written by stripe-webhook from the
-- subscription's price ID — never hand-edited, so Stripe stays the source of truth.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'platform';

-- Deals: the tier the rep sold, set at plan selection during onboarding. Drives
-- both the checkout price and the commission base.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'platform';

-- Defaulting both to 'platform' makes the backfill a no-op: every existing row is
-- already correct, since everything sold to date has been the full platform at
-- $495/$695. Nothing can regress into a locked state.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_plan_tier_valid'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_plan_tier_valid
      CHECK (plan_tier IN ('ai_only', 'platform'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_tier_valid'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_tier_valid
      CHECK (tier IN ('ai_only', 'platform'));
  END IF;
END $$;

COMMENT ON COLUMN clients.plan_tier IS
  'Service tier gating the dashboard: ai_only (calendar, calls, billing, settings) or platform (everything). Written by stripe-webhook from the subscription price ID; do not edit by hand.';

COMMENT ON COLUMN deals.tier IS
  'Service tier sold on this deal: ai_only or platform. Independent of `plan`, which encodes the minute bucket. Selects the checkout price and the commission base.';
