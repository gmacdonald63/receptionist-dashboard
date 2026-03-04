-- Add stripe_price_id column to track which plan (Standard vs Pro) the client is subscribed to
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
