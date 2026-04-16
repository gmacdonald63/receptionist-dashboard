-- Add review request settings to clients table
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS google_review_url TEXT,
  ADD COLUMN IF NOT EXISTS review_request_mode TEXT DEFAULT 'manual';

-- Track when a review request SMS was sent for each appointment
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS review_sms_sent_at TIMESTAMPTZ;
