-- Add Stripe billing columns to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
