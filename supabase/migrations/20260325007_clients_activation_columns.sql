-- supabase/migrations/20260325007_clients_activation_columns.sql
-- Adds columns needed for the activation invite flow.
-- activation_token: UUID used in the ?activate= URL, cleared after use.
-- invite_token_hash: Supabase auth invite token stored server-side, cleared after use.
-- setup_complete: TRUE once Greg has sent the activation invite; controls Admin.jsx button.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS activation_token UUID,
  ADD COLUMN IF NOT EXISTS invite_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN DEFAULT FALSE;
