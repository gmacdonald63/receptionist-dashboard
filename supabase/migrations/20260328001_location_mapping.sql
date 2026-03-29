-- ── tech_locations ──────────────────────────────────────────────────────────
CREATE TABLE tech_locations (
  technician_id   INT           PRIMARY KEY REFERENCES technicians(id) ON DELETE CASCADE,
  client_id       INT           NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lat             NUMERIC(10,7) NOT NULL,
  lng             NUMERIC(10,7) NOT NULL,
  accuracy_meters NUMERIC(6,1),
  heading         NUMERIC(5,2),
  speed_kmh       NUMERIC(6,2),
  non_job_status  TEXT,
  recorded_at     TIMESTAMPTZ   NOT NULL,
  received_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- non_job_status: free-form label matching client_destinations.label (e.g., 'Warehouse', 'Lunch Break')
-- Set by the tech when not currently en_route to a job. Cleared on next GPS write.
COMMENT ON COLUMN tech_locations.non_job_status IS 'Free-form status label from client_destinations.label. Set when tech is not en_route.';

ALTER TABLE tech_locations ENABLE ROW LEVEL SECURITY;

-- Dispatcher map query filter and Realtime subscription filter
CREATE INDEX ON tech_locations (client_id);

-- Dispatchers and owners can see all tech locations for their client
CREATE POLICY "dispatchers select tech locations"
ON tech_locations FOR SELECT
TO authenticated
USING (
  client_id IN (
    SELECT id FROM clients WHERE email = auth.email()
    UNION
    SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
  )
);

-- Techs can insert/update their own location row
CREATE POLICY "techs upsert own location"
ON tech_locations FOR INSERT
TO authenticated
WITH CHECK (
  technician_id IN (
    SELECT id FROM technicians WHERE email = auth.email()
  )
);

CREATE POLICY "techs update own location"
ON tech_locations FOR UPDATE
TO authenticated
USING (
  technician_id IN (
    SELECT id FROM technicians WHERE email = auth.email()
  )
);

-- ── upsert_tech_location function ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_tech_location(
  p_technician_id  INT,
  p_client_id      INT,
  p_lat            NUMERIC,
  p_lng            NUMERIC,
  p_accuracy       NUMERIC,
  p_heading        NUMERIC,
  p_speed_kmh      NUMERIC,
  p_non_job_status TEXT,
  p_recorded_at    TIMESTAMPTZ
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO tech_locations (
    technician_id, client_id, lat, lng, accuracy_meters,
    heading, speed_kmh, non_job_status, recorded_at, received_at
  ) VALUES (
    p_technician_id, p_client_id, p_lat, p_lng, p_accuracy,
    p_heading, p_speed_kmh, p_non_job_status, p_recorded_at, now()
  )
  ON CONFLICT (technician_id) DO UPDATE SET
    lat             = EXCLUDED.lat,
    lng             = EXCLUDED.lng,
    accuracy_meters = EXCLUDED.accuracy_meters,
    heading         = EXCLUDED.heading,
    speed_kmh       = EXCLUDED.speed_kmh,
    non_job_status  = EXCLUDED.non_job_status,
    recorded_at     = EXCLUDED.recorded_at,
    received_at     = now()
  WHERE EXCLUDED.recorded_at > tech_locations.recorded_at;
END;
$$;

-- ── tracking_tokens ────────────────────────────────────────────────────────
CREATE TABLE tracking_tokens (
  token           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  appointment_id  UUID        NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  technician_id   INT         NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  client_id       INT         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked         BOOL        NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tracking_tokens ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT policies for `anon` or `authenticated` — all reads and inserts go
-- through service-role Edge Functions (generate-tracking-token, get-tracking-data).
-- Exception: techs need to revoke their own tokens when marking a job complete.
CREATE POLICY "techs revoke own tracking tokens"
ON tracking_tokens FOR UPDATE
TO authenticated
USING (
  technician_id IN (
    SELECT id FROM technicians WHERE email = auth.email()
  )
)
WITH CHECK (revoked = true);  -- only allows setting revoked=true, never false

-- Bulk revoke by appointment + RLS policy evaluation
CREATE INDEX ON tracking_tokens (appointment_id);
CREATE INDEX ON tracking_tokens (technician_id);

-- ── client_destinations ────────────────────────────────────────────────────
CREATE TABLE client_destinations (
  id          SERIAL      PRIMARY KEY,
  client_id   INT         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label       TEXT        NOT NULL,
  sort_order  INT         NOT NULL DEFAULT 0,
  is_active   BOOL        NOT NULL DEFAULT true
);

ALTER TABLE client_destinations ADD CONSTRAINT client_destinations_client_label_unique UNIQUE (client_id, label);

ALTER TABLE client_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client members select destinations"
ON client_destinations FOR SELECT
TO authenticated
USING (
  client_id IN (
    SELECT id FROM clients WHERE email = auth.email()
    UNION
    SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
    UNION
    SELECT client_id FROM technicians WHERE email = auth.email() AND is_active = true
  )
);

CREATE POLICY "owners manage destinations"
ON client_destinations FOR ALL
TO authenticated
USING (
  client_id IN (
    SELECT id FROM clients WHERE email = auth.email()
  )
)
WITH CHECK (
  client_id IN (
    SELECT id FROM clients WHERE email = auth.email()
  )
);

-- Seed 4 default destinations for all existing clients
INSERT INTO client_destinations (client_id, label, sort_order)
SELECT clients.id, dest.label, dest.sort_order
FROM clients
CROSS JOIN (VALUES
  ('Warehouse',    1),
  ('Supply Store', 2),
  ('Lunch Break',  3),
  ('Home Base',    4)
) AS dest(label, sort_order)
ON CONFLICT (client_id, label) DO NOTHING;

-- ── appointments table additions ────────────────────────────────────────────
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS job_lat        NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS job_lng        NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS geocode_status TEXT DEFAULT 'pending' CHECK (geocode_status IN ('pending', 'success', 'failed'));

-- ── clients table additions ─────────────────────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS twilio_account_sid  TEXT,
  ADD COLUMN IF NOT EXISTS twilio_auth_token   TEXT,
  ADD COLUMN IF NOT EXISTS twilio_from_number  TEXT;
