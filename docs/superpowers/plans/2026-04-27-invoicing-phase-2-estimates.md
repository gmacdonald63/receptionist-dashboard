# Invoicing Phase 2 — Estimates + Customer Portal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dispatchers and techs can build multi-option estimates (good/better/best) from the
pricing catalog, send a secure link to the customer via SMS, and the customer can view the
estimate, select an option, and approve it from their phone — no login required.

**Architecture:** Four new Postgres tables (estimates, estimate_options, estimate_line_items,
estimate_tokens) with the same client_id-keyed RLS pattern as Phase 1. Four new Edge Functions
(generate-estimate-token, get-estimate, approve-estimate, send-estimate) — the two public
functions use service-role key like `get-tracking-data`, no anon RLS. Two new React components
(EstimateBuilder.jsx for the office/tech UI, EstimateViewerPublic.jsx for the customer portal).
App.jsx gets a `?estimate=` URL param short-circuit identical to the existing `?track=` pattern.

**Tech Stack:** Postgres (Supabase MCP), React 18, Vite, Tailwind CSS 3, supabase-js v2,
Deno Edge Functions. No new npm dependencies — EstimateBuilder reuses PapaParse installed in
Phase 1 (not needed here; just noting it's available). No payment processing in Phase 2 —
that's Phase 4.

---

## How to use this plan

1. Work top-to-bottom. Don't skip ahead.
2. Each chunk ends with a verification step and a commit. Don't advance until verification passes.
3. If you hit a blocker, stop and diagnose — do not patch around it.
4. **No test runner** is configured in this codebase. Verification is via:
   - SQL: Supabase MCP `execute_sql` for schema inspection
   - UI: `preview_*` tools for browser verification
5. **Migration prefixes** use `20260501` as a placeholder. When executing, replace with
   the actual date (YYYYMMDD) of execution to ensure correct migration ordering.
6. **CRITICAL:** All RLS policies use `auth.email()`. Never `(SELECT email FROM auth.users WHERE id = auth.uid())`.
   Reference: `supabase/migrations/20260325005_fix_rls_use_auth_email.sql:10-33`.

---

## Reference: existing patterns this plan reuses

| Pattern | File | Lines |
|---|---|---|
| RLS via `auth.email()` (canonical) | `supabase/migrations/20260325005_fix_rls_use_auth_email.sql` | 10-33, 81-88 |
| Token-based public table | `supabase/migrations/20260328001_location_mapping.sql` | 91-114 |
| Token-based public Edge Function | `supabase/functions/get-tracking-data/index.ts` | full file |
| Authenticated Edge Function | `supabase/functions/generate-tracking-token/index.ts` | full file |
| SMS dispatch via send-sms | `supabase/functions/generate-tracking-token/index.ts` | 73-93 |
| URL param short-circuit render | `src/App.jsx` | 241-242 |
| PricingCatalog.jsx (form/modal patterns) | `src/PricingCatalog.jsx` | full file |
| Pricing catalog RLS pattern | `supabase/migrations/20260426002_pricing_catalog_rls.sql` | full file |
| Tailwind input class | `src/AppointmentSidePanel.jsx` | 35-37 |
| Modal overlay structure | `src/Admin.jsx` | 491-550 |
| DispatcherDashboard nav pattern | `src/DispatcherDashboard.jsx` | ownerNavItems array |
| TechDashboard job card structure | `src/TechDashboard.jsx` | job detail section |

---

## Chunk 1: Database Schema

Creates all four tables, RLS, and two client setting columns. No frontend work yet.
After this chunk: `estimates`, `estimate_options`, `estimate_line_items`, and `estimate_tokens`
exist and are queryable; `clients.estimate_legal_text` and `clients.estimate_validity_days` exist.

---

### Task 1.1: Core estimate tables

**Files:**
- Create: `supabase/migrations/20260501001_create_estimates.sql`

- [ ] **Step 1.1.1: Write the migration file**

```sql
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
```

- [ ] **Step 1.1.2: Apply the migration**

Use Supabase MCP `apply_migration`:
- Name: `create_estimates`
- Query: contents of `supabase/migrations/20260501001_create_estimates.sql`

- [ ] **Step 1.1.3: Verify tables exist**

Run via `execute_sql`:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('estimates','estimate_options','estimate_line_items')
ORDER BY table_name;
```
Expected: 3 rows.

- [ ] **Step 1.1.4: Commit**

```bash
git add supabase/migrations/20260501001_create_estimates.sql
git commit -m "feat(db): add estimates, estimate_options, estimate_line_items tables"
```

---

### Task 1.2: estimate_tokens table

**Files:**
- Create: `supabase/migrations/20260501002_estimate_tokens.sql`

- [ ] **Step 1.2.1: Write the migration file**

```sql
-- 20260501002_estimate_tokens.sql
-- Token table for customer-facing estimate portal.
-- Mirrors tracking_tokens pattern (20260328001_location_mapping.sql:91-114).
-- No anon RLS — public access goes through service-role Edge Functions only.

CREATE TABLE IF NOT EXISTS estimate_tokens (
  token       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id UUID    NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  client_id   INTEGER NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,

  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  revoked    BOOLEAN     NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estimate_tokens_estimate_idx ON estimate_tokens(estimate_id);
-- Partial index: fast lookup of valid tokens only
CREATE INDEX IF NOT EXISTS estimate_tokens_valid_idx
  ON estimate_tokens(token) WHERE revoked = false;
```

- [ ] **Step 1.2.2: Apply the migration**

Use Supabase MCP `apply_migration`:
- Name: `estimate_tokens`
- Query: contents of `supabase/migrations/20260501002_estimate_tokens.sql`

- [ ] **Step 1.2.3: Verify**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'estimate_tokens' ORDER BY ordinal_position;
```
Expected: 6 columns: token, estimate_id, client_id, expires_at, revoked, created_at.

- [ ] **Step 1.2.4: Commit**

```bash
git add supabase/migrations/20260501002_estimate_tokens.sql
git commit -m "feat(db): add estimate_tokens table"
```

---

### Task 1.3: RLS for estimates, estimate_options, estimate_line_items, estimate_tokens

**Files:**
- Create: `supabase/migrations/20260501003_estimates_rls.sql`

- [ ] **Step 1.3.1: Write the migration file**

```sql
-- 20260501003_estimates_rls.sql
-- RLS for estimate tables. Pattern matches 20260426002_pricing_catalog_rls.sql.
-- CRITICAL: always auth.email(), never auth.uid() subquery on auth.users.

-- ─── estimates ───────────────────────────────────────────────────────────────

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

-- Owner can do anything to their own estimates
CREATE POLICY "owner_manage_estimates" ON estimates
  FOR ALL
  USING   (client_id IN (SELECT id FROM clients WHERE email = auth.email()))
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE email = auth.email()));

-- Admins can read/write any client's estimates
CREATE POLICY "admin_manage_estimates" ON estimates
  FOR ALL
  USING   (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true));

-- Dispatchers can read and write estimates for their client
CREATE POLICY "dispatcher_manage_estimates" ON estimates
  FOR ALL
  USING (
    client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  );

-- Techs can read and write estimates for their client
-- (V1: tech-in-field estimate creation is required per spec)
CREATE POLICY "tech_manage_estimates" ON estimates
  FOR ALL
  USING (
    client_id IN (
      SELECT client_id FROM technicians
      WHERE email = auth.email() AND is_active = true
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT client_id FROM technicians
      WHERE email = auth.email() AND is_active = true
    )
  );

-- ─── estimate_options ────────────────────────────────────────────────────────

ALTER TABLE estimate_options ENABLE ROW LEVEL SECURITY;

-- Owner
CREATE POLICY "owner_manage_estimate_options" ON estimate_options
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (SELECT id FROM clients WHERE email = auth.email())
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (SELECT id FROM clients WHERE email = auth.email())
    )
  );

-- Admin
CREATE POLICY "admin_manage_estimate_options" ON estimate_options
  FOR ALL
  USING   (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true));

-- Dispatcher
CREATE POLICY "dispatcher_manage_estimate_options" ON estimate_options
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
      )
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
      )
    )
  );

-- Tech
CREATE POLICY "tech_manage_estimate_options" ON estimate_options
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM technicians WHERE email = auth.email() AND is_active = true
      )
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM technicians WHERE email = auth.email() AND is_active = true
      )
    )
  );

-- ─── estimate_line_items ─────────────────────────────────────────────────────

ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;

-- Owner
CREATE POLICY "owner_manage_estimate_line_items" ON estimate_line_items
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (SELECT id FROM clients WHERE email = auth.email())
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (SELECT id FROM clients WHERE email = auth.email())
    )
  );

-- Admin
CREATE POLICY "admin_manage_estimate_line_items" ON estimate_line_items
  FOR ALL
  USING   (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true));

-- Dispatcher
CREATE POLICY "dispatcher_manage_estimate_line_items" ON estimate_line_items
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
      )
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
      )
    )
  );

-- Tech
CREATE POLICY "tech_manage_estimate_line_items" ON estimate_line_items
  FOR ALL
  USING (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM technicians WHERE email = auth.email() AND is_active = true
      )
    )
  )
  WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates WHERE client_id IN (
        SELECT client_id FROM technicians WHERE email = auth.email() AND is_active = true
      )
    )
  );

-- ─── estimate_tokens ─────────────────────────────────────────────────────────
-- No anon access. Token validation happens entirely inside service-role Edge Functions.
-- Authenticated users (owner/dispatcher) need SELECT to check token status.

ALTER TABLE estimate_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read_estimate_tokens" ON estimate_tokens
  FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE email = auth.email()));

CREATE POLICY "admin_manage_estimate_tokens" ON estimate_tokens
  FOR ALL
  USING   (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true));

CREATE POLICY "dispatcher_read_estimate_tokens" ON estimate_tokens
  FOR SELECT
  USING (
    client_id IN (
      SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
    )
  );
```

- [ ] **Step 1.3.2: Apply the migration**

Use Supabase MCP `apply_migration`:
- Name: `estimates_rls`
- Query: contents of `supabase/migrations/20260501003_estimates_rls.sql`

- [ ] **Step 1.3.3: Verify RLS is enabled**

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('estimates','estimate_options','estimate_line_items','estimate_tokens');
```
Expected: all 4 rows show `rowsecurity = true`.

- [ ] **Step 1.3.4: Commit**

```bash
git add supabase/migrations/20260501003_estimates_rls.sql
git commit -m "feat(db): add RLS for estimate tables"
```

---

### Task 1.4: Client estimate settings columns

**Files:**
- Create: `supabase/migrations/20260501004_clients_estimate_settings.sql`

- [ ] **Step 1.4.1: Write the migration file**

```sql
-- 20260501004_clients_estimate_settings.sql
-- Two new columns on clients for estimate portal customization.

-- Optional legal text shown on the portal approval page.
-- NULL = use the built-in default text.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS estimate_legal_text TEXT;

COMMENT ON COLUMN clients.estimate_legal_text IS
  'Optional custom legal disclosure shown on the customer estimate portal approval step. NULL = system default text.';

-- How long estimate portal links stay valid (days). Default 30.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS estimate_validity_days INTEGER NOT NULL DEFAULT 30
    CONSTRAINT clients_estimate_validity_days_range CHECK (estimate_validity_days BETWEEN 1 AND 365);

COMMENT ON COLUMN clients.estimate_validity_days IS
  'How many days estimate portal tokens remain valid. Stored in estimate_tokens.expires_at = created_at + this interval.';
```

- [ ] **Step 1.4.2: Apply the migration**

Use Supabase MCP `apply_migration`:
- Name: `clients_estimate_settings`
- Query: contents of `supabase/migrations/20260501004_clients_estimate_settings.sql`

- [ ] **Step 1.4.3: Verify**

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'clients'
  AND column_name IN ('estimate_legal_text','estimate_validity_days')
ORDER BY column_name;
```
Expected: 2 rows.

- [ ] **Step 1.4.4: Commit**

```bash
git add supabase/migrations/20260501004_clients_estimate_settings.sql
git commit -m "feat(db): add estimate_legal_text and estimate_validity_days to clients"
```

---

## Chunk 2: Edge Functions

Four Edge Functions. Two require auth (generate-estimate-token, send-estimate). Two are
public/no-auth (get-estimate, approve-estimate) — service-role key, no JWT validation,
same pattern as `get-tracking-data`. All deployed with `--no-verify-jwt`.

Deploy command pattern (requires `SUPABASE_ACCESS_TOKEN` env var):
```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy <name> \
  --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

---

### Task 2.1: generate-estimate-token

Creates a token row and returns the portal URL. Requires JWT auth.

**Files:**
- Create: `supabase/functions/generate-estimate-token/index.ts`

- [ ] **Step 2.1.1: Write the function**

```typescript
// supabase/functions/generate-estimate-token/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const APP_URL = "https://app.reliantsupport.net";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }

  try {
    const { estimate_id } = await req.json();
    if (!estimate_id)
      return new Response(JSON.stringify({ error: "missing estimate_id" }), { status: 400, headers: cors });

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate caller is authenticated
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
    }

    // Fetch estimate to get client_id and confirm it exists
    const { data: estimate } = await sb.from("estimates")
      .select("id, client_id, status")
      .eq("id", estimate_id)
      .single();
    if (!estimate)
      return new Response(JSON.stringify({ error: "estimate not found" }), { status: 404, headers: cors });

    // Fetch client settings for validity period
    const { data: client } = await sb.from("clients")
      .select("estimate_validity_days")
      .eq("id", estimate.client_id)
      .single();
    const validityDays = client?.estimate_validity_days ?? 30;

    // Revoke any existing tokens for this estimate (one active token at a time)
    await sb.from("estimate_tokens")
      .update({ revoked: true })
      .eq("estimate_id", estimate_id)
      .eq("revoked", false);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validityDays);

    const { data: tokenRow, error: insertError } = await sb.from("estimate_tokens")
      .insert({
        estimate_id,
        client_id: estimate.client_id,
        expires_at: expiresAt.toISOString(),
      })
      .select("token")
      .single();

    if (insertError || !tokenRow) {
      console.error("❌ generate-estimate-token: insert failed:", insertError?.message);
      return new Response(JSON.stringify({ error: "Failed to create token" }), { status: 500, headers: cors });
    }

    const portalUrl = `${APP_URL}/?estimate=${tokenRow.token}`;

    return new Response(
      JSON.stringify({ ok: true, token: tokenRow.token, portal_url: portalUrl }),
      { headers: cors }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ generate-estimate-token error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
```

- [ ] **Step 2.1.2: Deploy the function**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy generate-estimate-token \
  --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

- [ ] **Step 2.1.3: Commit**

```bash
git add supabase/functions/generate-estimate-token/
git commit -m "feat(fn): add generate-estimate-token Edge Function"
```

---

### Task 2.2: get-estimate (public, no auth)

Returns full estimate payload for the customer portal. No JWT — uses service-role key to
bypass RLS. Same pattern as `get-tracking-data/index.ts`.

**Files:**
- Create: `supabase/functions/get-estimate/index.ts`

- [ ] **Step 2.2.1: Write the function**

```typescript
// supabase/functions/get-estimate/index.ts
// Public endpoint — no JWT. Called by EstimateViewerPublic.jsx.
// Uses service-role key to read past RLS; token validation is the auth mechanism.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const JSON_CORS = { ...cors, "Content-Type": "application/json" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const token = new URL(req.url).searchParams.get("token");
  if (!token || !UUID_RE.test(token))
    return new Response(JSON.stringify({ error: "invalid token" }), { status: 400, headers: JSON_CORS });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate token
    const { data: tokenRow } = await sb.from("estimate_tokens")
      .select("estimate_id, client_id, expires_at, revoked")
      .eq("token", token)
      .single();

    if (!tokenRow || tokenRow.revoked || new Date(tokenRow.expires_at) < new Date())
      return new Response(JSON.stringify({ error: "invalid or expired token" }), { status: 403, headers: JSON_CORS });

    // Fetch estimate header
    const { data: estimate } = await sb.from("estimates")
      .select("id, status, title, notes, expires_at, approved_at, accepted_option_id, created_at")
      .eq("id", tokenRow.estimate_id)
      .single();
    if (!estimate)
      return new Response(JSON.stringify({ error: "estimate not found" }), { status: 404, headers: JSON_CORS });

    // Fetch options + line items in one query
    const { data: options } = await sb.from("estimate_options")
      .select(`
        id, label, sort_order, subtotal, tax_amount, total,
        estimate_line_items (
          id, name, description, unit_type, quantity, unit_price, taxable, sort_order
        )
      `)
      .eq("estimate_id", tokenRow.estimate_id)
      .order("sort_order");

    // Fetch client name for the portal header
    const { data: client } = await sb.from("clients")
      .select("business_name, estimate_legal_text")
      .eq("id", tokenRow.client_id)
      .single();

    // Mark as 'viewed' if currently 'sent' (fire-and-forget; don't block response)
    if (estimate.status === "sent") {
      sb.from("estimates")
        .update({ status: "viewed" })
        .eq("id", tokenRow.estimate_id)
        .then(({ error }) => { if (error) console.error("❌ get-estimate: status update failed:", error.message); });
    }

    return new Response(JSON.stringify({
      estimate: {
        ...estimate,
        // Return 'viewed' immediately so the portal shows the right state
        status: estimate.status === "sent" ? "viewed" : estimate.status,
      },
      options: options ?? [],
      client: {
        business_name: client?.business_name ?? "",
        legal_text: client?.estimate_legal_text ?? null,
      },
    }), { headers: JSON_CORS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ get-estimate error:", message);
    return new Response(JSON.stringify({ error: "internal server error" }), { status: 500, headers: JSON_CORS });
  }
});
```

- [ ] **Step 2.2.2: Deploy the function**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy get-estimate \
  --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

- [ ] **Step 2.2.3: Commit**

```bash
git add supabase/functions/get-estimate/
git commit -m "feat(fn): add get-estimate public Edge Function"
```

---

### Task 2.3: approve-estimate (public, no auth)

Records customer approval: sets status, captures IP and timestamp, records chosen option.

**Files:**
- Create: `supabase/functions/approve-estimate/index.ts`

- [ ] **Step 2.3.1: Write the function**

```typescript
// supabase/functions/approve-estimate/index.ts
// Public endpoint — no JWT. Called by EstimateViewerPublic on customer approval.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { token, option_id } = await req.json();

    if (!token || !UUID_RE.test(token))
      return new Response(JSON.stringify({ error: "invalid token" }), { status: 400, headers: cors });
    if (!option_id || !UUID_RE.test(option_id))
      return new Response(JSON.stringify({ error: "invalid option_id" }), { status: 400, headers: cors });

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate token
    const { data: tokenRow } = await sb.from("estimate_tokens")
      .select("estimate_id, expires_at, revoked")
      .eq("token", token)
      .single();

    if (!tokenRow || tokenRow.revoked || new Date(tokenRow.expires_at) < new Date())
      return new Response(JSON.stringify({ error: "invalid or expired token" }), { status: 403, headers: cors });

    // Confirm option belongs to this estimate
    const { data: option } = await sb.from("estimate_options")
      .select("id, estimate_id")
      .eq("id", option_id)
      .eq("estimate_id", tokenRow.estimate_id)
      .single();
    if (!option)
      return new Response(JSON.stringify({ error: "option not found on this estimate" }), { status: 404, headers: cors });

    // Confirm estimate is still in an approvable state
    const { data: estimate } = await sb.from("estimates")
      .select("status")
      .eq("id", tokenRow.estimate_id)
      .single();
    if (!estimate)
      return new Response(JSON.stringify({ error: "estimate not found" }), { status: 404, headers: cors });
    if (!["draft","sent","viewed"].includes(estimate.status))
      return new Response(JSON.stringify({ error: `estimate cannot be approved from status '${estimate.status}'` }), { status: 409, headers: cors });

    // Capture customer IP address for legal record
    const clientIp =
      req.headers.get("cf-connecting-ip") ??      // Cloudflare (Supabase edge)
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";

    const { error: updateError } = await sb.from("estimates")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by_ip: clientIp,
        accepted_option_id: option_id,
      })
      .eq("id", tokenRow.estimate_id);

    if (updateError) {
      console.error("❌ approve-estimate: update failed:", updateError.message);
      return new Response(JSON.stringify({ error: "Failed to record approval" }), { status: 500, headers: cors });
    }

    // Revoke token — single-use approval (customer can still view via same token
    // because get-estimate checks revoked but we don't re-revoke here; the estimate
    // status 'approved' drives the portal into read-only mode instead).
    // Token is NOT revoked here so the customer can still open the link to see
    // their confirmation. It will expire naturally via expires_at.

    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ approve-estimate error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
```

- [ ] **Step 2.3.2: Deploy**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy approve-estimate \
  --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

- [ ] **Step 2.3.3: Commit**

```bash
git add supabase/functions/approve-estimate/
git commit -m "feat(fn): add approve-estimate public Edge Function"
```

---

### Task 2.4: send-estimate

Generates a token and sends the portal URL via SMS. Requires JWT auth. Reuses `send-sms`.

**Files:**
- Create: `supabase/functions/send-estimate/index.ts`

- [ ] **Step 2.4.1: Write the function**

```typescript
// supabase/functions/send-estimate/index.ts
// Authenticated. Generates a portal token and sends the URL via SMS.
// Reuses the send-sms Edge Function (same pattern as generate-tracking-token).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }

  try {
    const { estimate_id, phone, customer_name } = await req.json();
    if (!estimate_id || !phone)
      return new Response(JSON.stringify({ error: "missing estimate_id or phone" }), { status: 400, headers: cors });

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate caller
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
    }

    // Fetch estimate to get client_id
    const { data: estimate } = await sb.from("estimates")
      .select("client_id, title")
      .eq("id", estimate_id)
      .single();
    if (!estimate)
      return new Response(JSON.stringify({ error: "estimate not found" }), { status: 404, headers: cors });

    // Fetch Telnyx credentials from the client row
    const { data: client } = await sb.from("clients")
      .select("telnyx_api_key, telnyx_from_number, estimate_validity_days, business_name")
      .eq("id", estimate.client_id)
      .single();

    if (!client?.telnyx_api_key || !client?.telnyx_from_number)
      return new Response(JSON.stringify({ error: "SMS not configured for this client — set telnyx_api_key and telnyx_from_number" }), { status: 422, headers: cors });

    // Generate token via the generate-estimate-token function (reuse logic inline here
    // to avoid an extra network hop — we already have service-role access)
    const validityDays = client.estimate_validity_days ?? 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validityDays);

    // Revoke existing tokens for this estimate
    await sb.from("estimate_tokens")
      .update({ revoked: true })
      .eq("estimate_id", estimate_id)
      .eq("revoked", false);

    const { data: tokenRow, error: insertError } = await sb.from("estimate_tokens")
      .insert({ estimate_id, client_id: estimate.client_id, expires_at: expiresAt.toISOString() })
      .select("token")
      .single();

    if (insertError || !tokenRow) {
      console.error("❌ send-estimate: token insert failed:", insertError?.message);
      return new Response(JSON.stringify({ error: "Failed to create token" }), { status: 500, headers: cors });
    }

    const portalUrl = `https://app.reliantsupport.net/?estimate=${tokenRow.token}`;
    const greeting = customer_name ? `Hi ${customer_name.split(' ')[0]}, ` : '';
    const smsBody =
      `${greeting}your estimate from ${client.business_name || 'us'} is ready. ` +
      `View and approve it here: ${portalUrl}`;

    // Send SMS via send-sms function
    const smsRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: phone,
        body: smsBody,
        telnyx_api_key: client.telnyx_api_key,
        telnyx_from_number: client.telnyx_from_number,
      }),
    });

    const smsSent = smsRes.ok;
    if (!smsRes.ok) {
      const smsErr = await smsRes.json().catch(() => ({}));
      console.error("❌ send-estimate: SMS failed:", smsErr);
    }

    // Update estimate status to 'sent'
    await sb.from("estimates")
      .update({ status: "sent" })
      .eq("id", estimate_id);

    return new Response(JSON.stringify({
      ok: true,
      sms_sent: smsSent,
      token: tokenRow.token,
      portal_url: portalUrl,
    }), { headers: cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ send-estimate error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
```

- [ ] **Step 2.4.2: Deploy**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy send-estimate \
  --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

- [ ] **Step 2.4.3: Commit**

```bash
git add supabase/functions/send-estimate/
git commit -m "feat(fn): add send-estimate Edge Function"
```

---

## Chunk 3: EstimateBuilder UI

The office/tech estimate builder. Props-driven; usable from DispatcherDashboard (full width
modal) and TechDashboard (compact = true for mobile). Handles create and edit of estimates.

---

### Task 3.1: EstimateBuilder scaffold + header + option management

Start with the skeleton, get it rendering in the browser, then add features in 3.2–3.3.

**Files:**
- Create: `src/EstimateBuilder.jsx`
- Modify: `src/DispatcherDashboard.jsx` (import + Estimates tab + nav item)

- [ ] **Step 3.1.1: Create EstimateBuilder.jsx skeleton**

```jsx
// src/EstimateBuilder.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronUp, Search, Send, Save, FileText } from 'lucide-react';
import { supabase } from './supabaseClient';

const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';

const INPUT_CLS = 'w-full px-2.5 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm';
const BTN_PRIMARY = 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors';
const BTN_SECONDARY = 'px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors';
const BTN_DANGER = 'px-3 py-1.5 bg-red-900/40 hover:bg-red-900/60 text-red-400 text-xs rounded-lg transition-colors border border-red-800/40';

const STATUS_COLORS = {
  draft:     'bg-gray-700 text-gray-300',
  sent:      'bg-blue-900/50 text-blue-300',
  viewed:    'bg-yellow-900/50 text-yellow-300',
  approved:  'bg-green-900/50 text-green-400',
  declined:  'bg-red-900/50 text-red-400',
  expired:   'bg-gray-700 text-gray-500',
  converted: 'bg-purple-900/50 text-purple-300',
};

const UNIT_TYPES = ['each', 'hour', 'pound', 'foot', 'sqft', 'ton', 'trip'];

const DEFAULT_LEGAL_TEXT =
  "By approving this estimate, you authorize the work described above to proceed at the quoted price. " +
  "Final invoice may vary if additional work is required and approved on-site.";

// ─── helpers ──────────────────────────────────────────────────────────────────

const calcOptionTotals = (lines, taxRate) => {
  let subtotal = 0;
  let taxAmount = 0;
  for (const line of lines) {
    const lineTotal = Number(line.quantity) * Number(line.unit_price);
    subtotal += lineTotal;
    if (line.taxable) taxAmount += lineTotal * taxRate;
  }
  return { subtotal, tax_amount: taxAmount, total: subtotal + taxAmount };
};

const formatCurrency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);

// ─── CatalogPicker ─────────────────────────────────────────────────────────────

const CatalogPicker = ({ clientId, onSelect, onClose }) => {
  const [q, setQ] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('pricing_catalog')
      .select('id, name, description, unit_type, unit_price, taxable, category')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => { setCatalog(data ?? []); setLoading(false); });
  }, [clientId]);

  const filtered = catalog.filter(item =>
    !q || item.name.toLowerCase().includes(q.toLowerCase()) ||
    item.category?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="absolute z-50 top-full left-0 mt-1 w-96 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl">
      <div className="p-3 border-b border-gray-700">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search catalog..."
            className={`${INPUT_CLS} pl-8`}
          />
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-gray-500 text-sm">Loading catalog…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">No items found</div>
        ) : filtered.map(item => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="w-full text-left px-4 py-2.5 hover:bg-gray-750 border-b border-gray-700/50 last:border-0"
          >
            <div className="flex justify-between items-baseline">
              <span className="text-white text-sm font-medium">{item.name}</span>
              <span className="text-green-400 text-sm ml-4">{formatCurrency(item.unit_price)}/{item.unit_type}</span>
            </div>
            {item.description && (
              <div className="text-gray-500 text-xs mt-0.5 truncate">{item.description}</div>
            )}
            <div className="text-gray-600 text-xs">{item.category}{item.taxable ? ' · taxable' : ''}</div>
          </button>
        ))}
      </div>
      <div className="p-2 border-t border-gray-700">
        <button onClick={onClose} className="w-full py-1.5 text-gray-500 text-xs hover:text-gray-300">
          Close
        </button>
      </div>
    </div>
  );
};

// ─── LineItemRow ───────────────────────────────────────────────────────────────

const LineItemRow = ({ line, onChange, onDelete, compact }) => (
  <div className={`grid gap-2 items-center ${compact ? 'grid-cols-1' : 'grid-cols-12'} p-2 bg-gray-900/50 rounded-lg mb-1`}>
    {compact ? (
      // Mobile: stacked layout
      <div className="space-y-2">
        <div className="flex gap-2">
          <input value={line.name} onChange={e => onChange({ ...line, name: e.target.value })}
            placeholder="Item name" className={`${INPUT_CLS} flex-1`} />
          <button onClick={onDelete} className={BTN_DANGER}>✕</button>
        </div>
        <div className="flex gap-2">
          <input type="number" min="0.001" step="0.001" value={line.quantity}
            onChange={e => onChange({ ...line, quantity: e.target.value })}
            className={`${INPUT_CLS} w-20`} />
          <select value={line.unit_type} onChange={e => onChange({ ...line, unit_type: e.target.value })}
            className={`${INPUT_CLS} w-24`}>
            {UNIT_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <input type="number" min="0" step="0.01" value={line.unit_price}
            onChange={e => onChange({ ...line, unit_price: e.target.value })}
            placeholder="Price" className={`${INPUT_CLS} flex-1`} />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={line.taxable}
            onChange={e => onChange({ ...line, taxable: e.target.checked })}
            className="rounded border-gray-600" />
          Taxable
        </label>
      </div>
    ) : (
      // Desktop: inline grid
      <>
        <div className="col-span-4">
          <input value={line.name} onChange={e => onChange({ ...line, name: e.target.value })}
            placeholder="Item name" className={INPUT_CLS} />
        </div>
        <div className="col-span-2">
          <input value={line.description ?? ''} onChange={e => onChange({ ...line, description: e.target.value })}
            placeholder="Notes" className={INPUT_CLS} />
        </div>
        <div className="col-span-1">
          <input type="number" min="0.001" step="0.001" value={line.quantity}
            onChange={e => onChange({ ...line, quantity: e.target.value })}
            className={INPUT_CLS} />
        </div>
        <div className="col-span-1">
          <select value={line.unit_type} onChange={e => onChange({ ...line, unit_type: e.target.value })}
            className={INPUT_CLS}>
            {UNIT_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <input type="number" min="0" step="0.01" value={line.unit_price}
            onChange={e => onChange({ ...line, unit_price: e.target.value })}
            className={INPUT_CLS} />
        </div>
        <div className="col-span-1 flex justify-center">
          <input type="checkbox" checked={line.taxable}
            onChange={e => onChange({ ...line, taxable: e.target.checked })}
            className="rounded border-gray-600 mt-1.5" />
        </div>
        <div className="col-span-1 flex justify-end">
          <button onClick={onDelete} className={BTN_DANGER}>✕</button>
        </div>
      </>
    )}
  </div>
);

// ─── OptionPanel ───────────────────────────────────────────────────────────────

const OptionPanel = ({ option, lines, taxRate, clientId, onLabelChange, onLineChange, onLineAdd, onLineDelete, onDelete, compact, isOnly }) => {
  const [showPicker, setShowPicker] = useState(false);
  const totals = calcOptionTotals(lines, taxRate);

  const handleCatalogSelect = (item) => {
    onLineAdd({
      _id: crypto.randomUUID(),
      catalog_item_id: item.id,
      name: item.name,
      description: item.description ?? '',
      unit_type: item.unit_type,
      quantity: 1,
      unit_price: item.unit_price,
      taxable: item.taxable,
      sort_order: lines.length,
    });
    setShowPicker(false);
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
      {/* Option header */}
      <div className="flex items-center gap-3 mb-4">
        <input
          value={option.label}
          onChange={e => onLabelChange(e.target.value)}
          placeholder="Option label (e.g. Good, Better, Best)"
          className={`${INPUT_CLS} flex-1`}
        />
        {!isOnly && (
          <button onClick={onDelete} title="Remove this option" className={BTN_DANGER}>
            Remove option
          </button>
        )}
      </div>

      {/* Column headers (desktop only) */}
      {!compact && (
        <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 uppercase tracking-wide mb-1 px-2">
          <div className="col-span-4">Item</div>
          <div className="col-span-2">Notes</div>
          <div className="col-span-1">Qty</div>
          <div className="col-span-1">Unit</div>
          <div className="col-span-2">Unit Price</div>
          <div className="col-span-1 text-center">Tax</div>
          <div className="col-span-1" />
        </div>
      )}

      {/* Line items */}
      {lines.map(line => (
        <LineItemRow
          key={line._id ?? line.id}
          line={line}
          compact={compact}
          onChange={updated => onLineChange(line._id ?? line.id, updated)}
          onDelete={() => onLineDelete(line._id ?? line.id)}
        />
      ))}
      {lines.length === 0 && (
        <div className="text-center py-4 text-gray-600 text-sm">
          No items yet — add from catalog or create a custom line
        </div>
      )}

      {/* Add line buttons */}
      <div className="relative flex gap-2 mt-3">
        <button
          onClick={() => setShowPicker(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-750 hover:bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded-lg transition-colors"
        >
          <Search className="w-3.5 h-3.5" /> From catalog
        </button>
        <button
          onClick={() => onLineAdd({
            _id: crypto.randomUUID(),
            catalog_item_id: null,
            name: '',
            description: '',
            unit_type: 'each',
            quantity: 1,
            unit_price: 0,
            taxable: false,
            sort_order: lines.length,
          })}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-750 hover:bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Custom line
        </button>
        {showPicker && (
          <CatalogPicker
            clientId={clientId}
            onSelect={handleCatalogSelect}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>

      {/* Option totals */}
      <div className="mt-4 pt-3 border-t border-gray-700 flex flex-col items-end gap-1 text-sm">
        <div className="flex gap-8 text-gray-400">
          <span>Subtotal</span>
          <span className="text-white w-24 text-right">{formatCurrency(totals.subtotal)}</span>
        </div>
        {totals.tax_amount > 0 && (
          <div className="flex gap-8 text-gray-400">
            <span>Tax ({(taxRate * 100).toFixed(3)}%)</span>
            <span className="text-white w-24 text-right">{formatCurrency(totals.tax_amount)}</span>
          </div>
        )}
        <div className="flex gap-8 font-semibold text-white">
          <span>Total</span>
          <span className="w-24 text-right text-green-400">{formatCurrency(totals.total)}</span>
        </div>
      </div>
    </div>
  );
};

// ─── SendModal ─────────────────────────────────────────────────────────────────

const SendModal = ({ estimate, clientId, onClose, onSent }) => {
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleSend = async () => {
    if (!phone.trim()) { setError('Phone number is required'); return; }
    setSending(true); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-estimate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs',
        },
        body: JSON.stringify({
          estimate_id: estimate.id,
          phone: phone.trim(),
          customer_name: customerName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');
      setResult(data);
      onSent?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-md">
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <h3 className="text-white font-semibold">Send Estimate via SMS</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400 hover:text-white" /></button>
        </div>
        <div className="p-4 space-y-4">
          {result ? (
            <div className="text-center space-y-3">
              <div className="w-12 h-12 bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                <span className="text-green-400 text-2xl">✓</span>
              </div>
              <p className="text-green-400 font-medium">Estimate sent!</p>
              <div className="bg-gray-900 rounded-lg p-3 text-left">
                <p className="text-gray-400 text-xs mb-1">Portal link:</p>
                <p className="text-blue-400 text-sm break-all">{result.portal_url}</p>
              </div>
              <button onClick={onClose} className={BTN_PRIMARY}>Done</button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wide mb-1">Customer Name (optional)</label>
                <input value={customerName} onChange={e => setCustomerName(e.target.value)}
                  placeholder="John Smith" className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wide mb-1">Phone Number *</label>
                <input value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+15035551234" className={INPUT_CLS} />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex gap-3 justify-end">
                <button onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
                <button onClick={handleSend} disabled={sending} className={BTN_PRIMARY}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── EstimateBuilder (main export) ────────────────────────────────────────────

/**
 * Props:
 *   clientId        {number}   required — the client this estimate belongs to
 *   appointmentId   {string}   optional — link to appointment
 *   customerId      {string}   optional — link to customer
 *   estimateId      {string}   optional — if provided, loads existing estimate for edit
 *   taxRate         {number}   optional — 0..1, defaults to 0 (fetch from clients if not passed)
 *   compact         {boolean}  optional — true = tech mobile mode (stacked layout)
 *   onClose         {fn}       called when user dismisses
 *   onSaved         {fn(id)}   called after save; receives estimate id
 */
export default function EstimateBuilder({
  clientId, appointmentId, customerId, estimateId,
  taxRate: taxRateProp, compact = false, onClose, onSaved,
}) {
  const [loading, setLoading]   = useState(!!estimateId);
  const [saving, setSaving]     = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [error, setError]       = useState('');

  // Estimate header
  const [estimateDbId, setEstimateDbId] = useState(estimateId ?? null);
  const [status, setStatus]             = useState('draft');
  const [title, setTitle]               = useState('');
  const [notes, setNotes]               = useState('');
  const [expiresAt, setExpiresAt]       = useState('');
  const [taxRate, setTaxRate]           = useState(taxRateProp ?? 0);

  // Options: [{ _id, id?, label, lines: [...] }]
  const [options, setOptions] = useState([
    { _id: crypto.randomUUID(), id: null, label: 'Standard', lines: [] }
  ]);

  // Load tax rate from clients if not passed
  useEffect(() => {
    if (taxRateProp !== undefined) return;
    supabase.from('clients').select('default_tax_rate').eq('id', clientId).single()
      .then(({ data }) => { if (data) setTaxRate(Number(data.default_tax_rate) || 0); });
  }, [clientId, taxRateProp]);

  // Load existing estimate if estimateId provided
  useEffect(() => {
    if (!estimateId) return;
    setLoading(true);
    (async () => {
      const { data: est } = await supabase.from('estimates')
        .select('id, status, title, notes, expires_at')
        .eq('id', estimateId).single();
      if (!est) { setLoading(false); return; }

      setEstimateDbId(est.id);
      setStatus(est.status);
      setTitle(est.title ?? '');
      setNotes(est.notes ?? '');
      setExpiresAt(est.expires_at ? est.expires_at.substring(0, 10) : '');

      const { data: opts } = await supabase.from('estimate_options')
        .select('id, label, sort_order, estimate_line_items(id, catalog_item_id, name, description, unit_type, quantity, unit_price, taxable, sort_order)')
        .eq('estimate_id', estimateId)
        .order('sort_order');

      if (opts?.length) {
        setOptions(opts.map(opt => ({
          _id: opt.id,
          id: opt.id,
          label: opt.label,
          lines: (opt.estimate_line_items ?? []).sort((a,b) => a.sort_order - b.sort_order).map(l => ({ ...l, _id: l.id })),
        })));
      }
      setLoading(false);
    })();
  }, [estimateId]);

  // ── option mutations ──────────────────────────────────────────────────────

  const addOption = () => {
    const labels = ['Good', 'Better', 'Best', 'Premium', 'Option 5', 'Option 6'];
    const label = labels[options.length] ?? `Option ${options.length + 1}`;
    setOptions(prev => [...prev, { _id: crypto.randomUUID(), id: null, label, lines: [] }]);
  };

  const removeOption = (optId) => setOptions(prev => prev.filter(o => o._id !== optId));
  const setOptionLabel = (optId, label) =>
    setOptions(prev => prev.map(o => o._id === optId ? { ...o, label } : o));

  const addLine = (optId, line) =>
    setOptions(prev => prev.map(o => o._id === optId ? { ...o, lines: [...o.lines, line] } : o));
  const changeLine = (optId, lineId, updated) =>
    setOptions(prev => prev.map(o => o._id === optId
      ? { ...o, lines: o.lines.map(l => (l._id ?? l.id) === lineId ? updated : l) }
      : o));
  const deleteLine = (optId, lineId) =>
    setOptions(prev => prev.map(o => o._id === optId
      ? { ...o, lines: o.lines.filter(l => (l._id ?? l.id) !== lineId) }
      : o));

  // ── save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userEmail = session?.user?.email ?? '';

      // Upsert estimate header
      let estId = estimateDbId;
      if (!estId) {
        const { data: newEst, error: estErr } = await supabase.from('estimates').insert({
          client_id: clientId,
          appointment_id: appointmentId ?? null,
          customer_id: customerId ?? null,
          title: title.trim(),
          notes: notes.trim() || null,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          status: 'draft',
          created_by_email: userEmail,
        }).select('id').single();
        if (estErr) throw estErr;
        estId = newEst.id;
        setEstimateDbId(estId);
        setStatus('draft');
      } else {
        const { error: updateErr } = await supabase.from('estimates').update({
          title: title.trim(),
          notes: notes.trim() || null,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        }).eq('id', estId);
        if (updateErr) throw updateErr;
      }

      // Sync options and line items
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        let optDbId = opt.id;
        const totals = calcOptionTotals(opt.lines, taxRate);

        if (!optDbId) {
          const { data: newOpt, error: optErr } = await supabase.from('estimate_options').insert({
            estimate_id: estId,
            label: opt.label,
            sort_order: i,
            ...totals,
          }).select('id').single();
          if (optErr) throw optErr;
          optDbId = newOpt.id;
          setOptions(prev => prev.map(o => o._id === opt._id ? { ...o, id: optDbId } : o));
        } else {
          await supabase.from('estimate_options').update({ label: opt.label, sort_order: i, ...totals }).eq('id', optDbId);
        }

        // Delete existing line items for this option and re-insert (simpler than diffing)
        await supabase.from('estimate_line_items').delete().eq('option_id', optDbId);
        if (opt.lines.length > 0) {
          const lineRows = opt.lines.map((l, li) => ({
            estimate_id: estId,
            option_id: optDbId,
            catalog_item_id: l.catalog_item_id ?? null,
            name: l.name,
            description: l.description ?? null,
            unit_type: l.unit_type,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
            taxable: l.taxable,
            sort_order: li,
          }));
          const { error: lineErr } = await supabase.from('estimate_line_items').insert(lineRows);
          if (lineErr) throw lineErr;
        }
      }

      // Delete options removed during editing
      const currentOptIds = options.filter(o => o.id).map(o => o.id);
      if (currentOptIds.length > 0 && estimateDbId) {
        await supabase.from('estimate_options')
          .delete()
          .eq('estimate_id', estId)
          .not('id', 'in', `(${currentOptIds.join(',')})`);
      }

      onSaved?.(estId);
    } catch (err) {
      setError(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  const isReadOnly = ['approved','converted'].includes(status);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${compact ? 'max-w-full' : ''}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-blue-400" />
          <h2 className="text-white font-semibold text-lg">
            {estimateDbId ? 'Edit Estimate' : 'New Estimate'}
          </h2>
          {estimateDbId && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-gray-700 text-gray-300'}`}>
              {status.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isReadOnly && (
            <>
              <button onClick={handleSave} disabled={saving} className={BTN_SECONDARY}>
                <Save className="w-4 h-4 inline mr-1.5" />{saving ? 'Saving…' : 'Save Draft'}
              </button>
              {estimateDbId && (
                <button
                  onClick={() => { handleSave().then(() => setShowSend(true)); }}
                  disabled={saving}
                  className={BTN_PRIMARY}
                >
                  <Send className="w-4 h-4 inline mr-1.5" />Send via SMS
                </button>
              )}
            </>
          )}
          <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg">
            <X className="w-5 h-5 text-gray-400 hover:text-white" />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5">
        {error && (
          <div className="bg-red-900/30 border border-red-800/50 text-red-300 text-sm rounded-lg p-3 mb-4">
            {error}
          </div>
        )}

        {/* Estimate header fields */}
        <div className={`grid gap-4 mb-6 ${compact ? 'grid-cols-1' : 'grid-cols-3'}`}>
          <div className="col-span-1 md:col-span-2">
            <label className="block text-gray-400 text-xs uppercase tracking-wide mb-1">Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              disabled={isReadOnly}
              placeholder="e.g. AC System Replacement Estimate"
              className={INPUT_CLS} />
          </div>
          <div>
            <label className="block text-gray-400 text-xs uppercase tracking-wide mb-1">Valid Until</label>
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
              disabled={isReadOnly} className={INPUT_CLS} />
          </div>
          <div className={`${compact ? '' : 'col-span-3'}`}>
            <label className="block text-gray-400 text-xs uppercase tracking-wide mb-1">Notes (internal)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              disabled={isReadOnly}
              rows={2}
              placeholder="Internal notes — not shown to customer"
              className={`${INPUT_CLS} resize-none`} />
          </div>
        </div>

        {/* Options */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-medium">
              Options
              <span className="ml-2 text-gray-500 text-sm font-normal">
                ({options.length === 1 ? 'single option' : `${options.length} options — customer chooses one`})
              </span>
            </h3>
            {!isReadOnly && options.length < 3 && (
              <button onClick={addOption} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-sm">
                <Plus className="w-4 h-4" /> Add option
              </button>
            )}
          </div>

          {options.map(opt => (
            <OptionPanel
              key={opt._id}
              option={opt}
              lines={opt.lines}
              taxRate={taxRate}
              clientId={clientId}
              compact={compact}
              isOnly={options.length === 1}
              onLabelChange={label => setOptionLabel(opt._id, label)}
              onLineChange={(lineId, updated) => changeLine(opt._id, lineId, updated)}
              onLineAdd={line => addLine(opt._id, line)}
              onLineDelete={lineId => deleteLine(opt._id, lineId)}
              onDelete={() => removeOption(opt._id)}
            />
          ))}
        </div>
      </div>

      {/* Send modal */}
      {showSend && estimateDbId && (
        <SendModal
          estimate={{ id: estimateDbId }}
          clientId={clientId}
          onClose={() => setShowSend(false)}
          onSent={() => { setStatus('sent'); setShowSend(false); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3.1.2: Add Estimates tab to DispatcherDashboard**

Open `src/DispatcherDashboard.jsx`. Make these three edits:

**Edit A — Add FileText to lucide-react imports:**
```
// Find the existing lucide-react import line. It currently has: Tag (added in Phase 1).
// Add FileText to the imports list.
import { ..., Tag, FileText } from 'lucide-react';
```

**Edit B — Add import for EstimateBuilder and EstimatesList (inline):**
```jsx
import PricingCatalog from './PricingCatalog';
import EstimateBuilder from './EstimateBuilder';
```

**Edit C — Add estimates to ownerNavItems:**
Find the `ownerNavItems` array. After the `pricing` entry, add:
```jsx
{ id: 'estimates', label: 'Estimates', icon: FileText },
```
The grid will go from 8 to 9 columns. Change `grid-cols-8` → `grid-cols-9` in the owner nav grid.

**Edit D — Add estimates render block:**
Find the pricing tab render block (the one that checks `activeTab === 'pricing'`). After it, add:
```jsx
{activeTab === 'estimates' && role !== 'dispatcher' && (
  <EstimatesTab clientId={clientId} role={role} taxRate={effectiveClientData?.default_tax_rate ?? 0} />
)}
{activeTab === 'estimates' && role === 'dispatcher' && (
  <EstimatesTab clientId={clientId} role={role} taxRate={effectiveClientData?.default_tax_rate ?? 0} />
)}
```
Actually, dispatchers CAN create estimates per the spec — simplify to:
```jsx
{activeTab === 'estimates' && (
  <EstimatesTab clientId={clientId} role={role} taxRate={effectiveClientData?.default_tax_rate ?? 0} />
)}
```

- [ ] **Step 3.1.3: Create EstimatesTab inline component (add to DispatcherDashboard.jsx)**

Add this component definition near the top of `DispatcherDashboard.jsx` (after imports, before
the main export), OR create a separate `src/EstimatesTab.jsx`. The inline approach is consistent
with how PricingCatalog was integrated — separate file is cleaner. Use a separate file:

```jsx
// src/EstimatesTab.jsx
import React, { useState, useEffect } from 'react';
import { Plus, ChevronRight } from 'lucide-react';
import { supabase } from './supabaseClient';
import EstimateBuilder from './EstimateBuilder';

const STATUS_COLORS = {
  draft:     'bg-gray-700 text-gray-400',
  sent:      'bg-blue-900/50 text-blue-300',
  viewed:    'bg-yellow-900/50 text-yellow-300',
  approved:  'bg-green-900/50 text-green-400',
  declined:  'bg-red-900/50 text-red-400',
  expired:   'bg-gray-700 text-gray-500',
  converted: 'bg-purple-900/50 text-purple-300',
};

const formatCurrency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);

export default function EstimatesTab({ clientId, role, taxRate }) {
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const loadEstimates = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('estimates')
      .select(`
        id, status, title, created_at, approved_at,
        estimate_options (total)
      `)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(100);
    setEstimates(data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadEstimates(); }, [clientId]);

  // Sum all option totals for display (pre-approval, show range; post-approval, show accepted)
  const estimateTotal = (est) => {
    const totals = (est.estimate_options ?? []).map(o => o.total);
    if (!totals.length) return '—';
    if (totals.length === 1) return formatCurrency(totals[0]);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    return min === max ? formatCurrency(min) : `${formatCurrency(min)} – ${formatCurrency(max)}`;
  };

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-white text-xl font-semibold">Estimates</h2>
        <button
          onClick={() => { setEditingId(null); setShowBuilder(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> New Estimate
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : estimates.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No estimates yet</p>
          <p className="text-sm">Create your first estimate to get started</p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left px-4 py-3 text-gray-400 font-medium uppercase tracking-wide text-xs">Title</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium uppercase tracking-wide text-xs">Status</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium uppercase tracking-wide text-xs">Total</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium uppercase tracking-wide text-xs">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {estimates.map(est => (
                <tr
                  key={est.id}
                  className="border-b border-gray-700/50 last:border-0 hover:bg-gray-750 cursor-pointer"
                  onClick={() => { setEditingId(est.id); setShowBuilder(true); }}
                >
                  <td className="px-4 py-3 text-white">{est.title || '(untitled)'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[est.status] ?? 'bg-gray-700 text-gray-400'}`}>
                      {est.status?.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-green-400">{estimateTotal(est)}</td>
                  <td className="px-4 py-3 text-gray-400">{new Date(est.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-gray-600"><ChevronRight className="w-4 h-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showBuilder && (
        <div className="fixed inset-0 z-40 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-lg border border-gray-700 w-full max-w-5xl h-[90vh] overflow-hidden flex flex-col">
            <EstimateBuilder
              clientId={clientId}
              estimateId={editingId}
              taxRate={taxRate}
              onClose={() => { setShowBuilder(false); loadEstimates(); }}
              onSaved={(id) => { setEditingId(id); loadEstimates(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3.1.4: Update DispatcherDashboard.jsx import**

Add to the import block at the top of `src/DispatcherDashboard.jsx`:
```jsx
import EstimatesTab from './EstimatesTab';
```

- [ ] **Step 3.1.5: Start dev server and verify the Estimates tab renders**

```bash
npm run dev
```

Navigate to the dashboard. Owner nav should now show an Estimates tab (FileText icon). Click it — should show the EstimatesTab with "No estimates yet" state and a "New Estimate" button.

Click "New Estimate" — EstimateBuilder modal should open with a single "Standard" option panel.

- [ ] **Step 3.1.6: Commit**

```bash
git add src/EstimateBuilder.jsx src/EstimatesTab.jsx src/DispatcherDashboard.jsx
git commit -m "feat(ui): add EstimateBuilder and EstimatesTab to DispatcherDashboard"
```

---

### Task 3.2: EstimateBuilder — end-to-end save + send test

Test the full flow: create estimate → add items → save → send via SMS (if Telnyx configured).

- [ ] **Step 3.2.1: Open the browser (dev server should still be running)**

In EstimatesTab, click "New Estimate".

- [ ] **Step 3.2.2: Fill in estimate header**

Title: `Test AC Replacement`
Notes: `Internal test`
Valid Until: `<30 days from today>`

- [ ] **Step 3.2.3: Add a line item from catalog**

Click "From catalog". If Phase 1 has been applied and the catalog has items, search for one
(e.g. "Diagnostic"). Click it — it should appear as a line in the option with quantity=1 and
the catalog price.

If catalog is empty: click "Custom line", fill in name="Test Item", unit_price=500.

- [ ] **Step 3.2.4: Add a second option (optional)**

Click "Add option". A "Good" or second option panel should appear.

- [ ] **Step 3.2.5: Verify totals**

Totals should update live as you change quantities and prices.
Tax line should appear if `default_tax_rate > 0` for the client.

- [ ] **Step 3.2.6: Save draft**

Click "Save Draft". Should not error. After save:
- The "Send via SMS" button should appear (was hidden until estimate has an ID)
- Status badge should show DRAFT

- [ ] **Step 3.2.7: Verify row appears in Estimates list**

Close the builder. The EstimatesTab list should show the new draft estimate row.

- [ ] **Step 3.2.8: Commit (no code changes — this is verification only)**

If any bugs were found and fixed during verification, commit the fixes:
```bash
git add -p
git commit -m "fix(ui): [describe what was fixed]"
```

---

## Chunk 4: Customer Portal + App.jsx wiring + TechDashboard

---

### Task 4.1: EstimateViewerPublic.jsx

The customer-facing portal. No auth. Loaded via `?estimate={token}`.

**Files:**
- Create: `src/pages/EstimateViewerPublic.jsx`

- [ ] **Step 4.1.1: Create the component**

```jsx
// src/pages/EstimateViewerPublic.jsx
// Public customer portal. No auth required.
// Loaded when App.jsx detects ?estimate= URL param.
import React, { useState, useEffect } from 'react';
import { CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';

const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';

const DEFAULT_LEGAL_TEXT =
  "By approving this estimate, you authorize the work described above to proceed at the quoted price. " +
  "Final invoice may vary if additional work is required and approved on-site.";

const formatCurrency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);

const OptionCard = ({ option, isSelected, onSelect, disabled }) => {
  const [expanded, setExpanded] = useState(true);
  return (
    <div
      className={`rounded-xl border-2 transition-all ${
        isSelected
          ? 'border-green-500 bg-green-950/30'
          : 'border-gray-700 bg-gray-800'
      }`}
    >
      <div className="p-5">
        <div className="flex justify-between items-start mb-3">
          <h3 className="text-white font-semibold text-lg">{option.label}</h3>
          <div className="text-right">
            <div className="text-green-400 font-bold text-xl">{formatCurrency(option.total)}</div>
            {option.tax_amount > 0 && (
              <div className="text-gray-500 text-xs">incl. {formatCurrency(option.tax_amount)} tax</div>
            )}
          </div>
        </div>

        {/* Line items toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-gray-400 hover:text-gray-200 text-sm mb-3"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {expanded ? 'Hide' : 'Show'} details
        </button>

        {expanded && option.estimate_line_items?.length > 0 && (
          <div className="space-y-1 mb-4">
            {option.estimate_line_items
              .sort((a, b) => a.sort_order - b.sort_order)
              .map(line => (
                <div key={line.id} className="flex justify-between text-sm py-1.5 border-b border-gray-700/50 last:border-0">
                  <div>
                    <span className="text-white">{line.name}</span>
                    {line.description && (
                      <span className="text-gray-500 ml-2 text-xs">{line.description}</span>
                    )}
                  </div>
                  <div className="text-gray-300 text-right ml-4 whitespace-nowrap">
                    {line.quantity !== 1
                      ? `${line.quantity} × ${formatCurrency(line.unit_price)}`
                      : formatCurrency(line.unit_price)}
                  </div>
                </div>
              ))}
          </div>
        )}

        {!disabled && (
          <button
            onClick={onSelect}
            className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
              isSelected
                ? 'bg-green-600 text-white cursor-default'
                : 'bg-gray-700 hover:bg-blue-600 text-white'
            }`}
            disabled={isSelected}
          >
            {isSelected ? '✓ Selected' : 'Select this option'}
          </button>
        )}
      </div>
    </div>
  );
};

export default function EstimateViewerPublic({ token }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [estimate, setEstimate] = useState(null);
  const [options, setOptions]   = useState([]);
  const [client, setClient]     = useState(null);

  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [approving, setApproving]               = useState(false);
  const [approved, setApproved]                 = useState(false);
  const [approvalError, setApprovalError]       = useState('');
  const [agreedToTerms, setAgreedToTerms]       = useState(false);

  useEffect(() => {
    fetch(`${SUPABASE_FUNCTIONS_URL}/get-estimate?token=${encodeURIComponent(token)}`, {
      headers: { apikey: ANON_KEY },
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setEstimate(data.estimate);
        setOptions(data.options ?? []);
        setClient(data.client ?? {});
        // Pre-select the accepted option if already approved
        if (data.estimate?.accepted_option_id) {
          setSelectedOptionId(data.estimate.accepted_option_id);
          setApproved(data.estimate.status === 'approved');
        }
      })
      .catch(() => setError('Failed to load estimate'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleApprove = async () => {
    if (!selectedOptionId) { setApprovalError('Please select an option first.'); return; }
    if (!agreedToTerms) { setApprovalError('Please agree to the terms to continue.'); return; }
    setApproving(true); setApprovalError('');
    try {
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/approve-estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ token, option_id: selectedOptionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approval failed');
      setApproved(true);
      setEstimate(prev => ({ ...prev, status: 'approved' }));
    } catch (err) {
      setApprovalError(err.message);
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="text-gray-400 text-lg mb-2">Estimate unavailable</div>
          <div className="text-gray-600 text-sm">{error}</div>
        </div>
      </div>
    );
  }

  const isReadOnly = ['approved','declined','expired','converted'].includes(estimate?.status);
  const legalText = client?.legal_text ?? DEFAULT_LEGAL_TEXT;
  const expiresStr = estimate?.expires_at
    ? new Date(estimate.expires_at).toLocaleDateString()
    : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-sm text-gray-500 mb-1">{client?.business_name}</div>
          <h1 className="text-xl font-semibold">{estimate?.title}</h1>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            {expiresStr && <span>Valid until {expiresStr}</span>}
            {estimate?.status === 'approved' && (
              <span className="text-green-400 font-medium">✓ Approved</span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4">
        {/* Approved confirmation banner */}
        {(approved || estimate?.status === 'approved') && (
          <div className="bg-green-950/50 border border-green-800 rounded-xl p-5 mb-6 flex items-start gap-4">
            <CheckCircle className="w-8 h-8 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="text-green-300 font-semibold text-lg mb-1">Estimate Approved</h2>
              <p className="text-gray-300 text-sm">
                Thank you! We'll be in touch to schedule the work. If you have questions,
                contact {client?.business_name || 'us'} directly.
              </p>
            </div>
          </div>
        )}

        {/* Options grid */}
        <div className={`grid gap-4 mb-6 ${options.length === 1 ? 'grid-cols-1' : options.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'}`}>
          {options
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(opt => (
              <OptionCard
                key={opt.id}
                option={opt}
                isSelected={selectedOptionId === opt.id}
                disabled={isReadOnly}
                onSelect={() => { if (!isReadOnly) setSelectedOptionId(opt.id); }}
              />
            ))}
        </div>

        {/* Approval section — only when a selection is made and not yet approved */}
        {selectedOptionId && !isReadOnly && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
            <h3 className="text-white font-semibold mb-3">Approve Estimate</h3>
            <p className="text-gray-400 text-sm mb-4">{legalText}</p>
            <label className="flex items-start gap-3 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={e => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 rounded border-gray-600"
              />
              <span className="text-gray-300 text-sm">
                I have read and agree to the above terms and authorize this work to proceed.
              </span>
            </label>
            {approvalError && (
              <p className="text-red-400 text-sm mb-3">{approvalError}</p>
            )}
            <button
              onClick={handleApprove}
              disabled={approving || !agreedToTerms}
              className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-lg"
            >
              {approving ? 'Approving…' : 'Approve Estimate'}
            </button>
          </div>
        )}

        {/* Notes (if present) */}
        {estimate?.notes && (
          <div className="mt-4 bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Notes</p>
            <p className="text-gray-300 text-sm">{estimate.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4.1.2: Commit**

```bash
git add src/pages/EstimateViewerPublic.jsx
git commit -m "feat(ui): add EstimateViewerPublic customer portal"
```

---

### Task 4.2: App.jsx routing — ?estimate= URL param

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 4.2.1: Add import**

Find the TrackingPage import line (line 13). Add:
```jsx
import EstimateViewerPublic from './pages/EstimateViewerPublic.jsx';
```

- [ ] **Step 4.2.2: Add ?estimate= short-circuit in getSession() callback**

Find the block starting at line 59 that checks for `?track` param:
```js
if (new URLSearchParams(window.location.search).get('track')) {
  setAuthLoading(false);
  return;
}
```
After it, add:
```js
if (new URLSearchParams(window.location.search).get('estimate')) {
  setAuthLoading(false);
  return;
}
```

- [ ] **Step 4.2.3: Add render short-circuit**

Find the render lines for tracking (App.jsx ~line 241):
```jsx
const trackToken = new URLSearchParams(window.location.search).get('track');
if (trackToken) return <TrackingPage token={trackToken} />;
```
After them, add:
```jsx
const estimateToken = new URLSearchParams(window.location.search).get('estimate');
if (estimateToken) return <EstimateViewerPublic token={estimateToken} />;
```

- [ ] **Step 4.2.4: Verify the portal route works**

1. Create a test estimate in the dashboard (or use the one created in Task 3.2)
2. Open the estimate in EstimateBuilder
3. Click "Send via SMS" — enter any phone number and click Send
4. In the response, copy the `portal_url`
5. Open it in the browser (or paste `?estimate=<token>` after the app URL)
6. Portal should load without prompting for login
7. Select an option → approval checkbox → "Approve Estimate" → green confirmation screen

- [ ] **Step 4.2.5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(routing): add ?estimate= URL param to App.jsx for customer portal"
```

---

### Task 4.3: TechDashboard estimate creation

Techs can create estimates from their job cards. Uses EstimateBuilder in `compact=true` mode.

**Files:**
- Modify: `src/TechDashboard.jsx`

- [ ] **Step 4.3.1: Add import**

At the top of `src/TechDashboard.jsx`, add:
```jsx
import { MapPin, CheckCircle, Navigation, RefreshCw, LogOut, ChevronLeft, ChevronRight, X, FileText } from 'lucide-react';
import EstimateBuilder from './EstimateBuilder';
```
(Add `FileText` to the existing lucide-react import; add the EstimateBuilder import on a new line.)

- [ ] **Step 4.3.2: Add estimate state to TechDashboard**

Find the component's state declarations (near the top of the main TechDashboard function). Add:
```jsx
const [showEstimateBuilder, setShowEstimateBuilder] = useState(false);
const [estimateJobId, setEstimateJobId] = useState(null);
const [estimateClientId, setEstimateClientId] = useState(null);
```

- [ ] **Step 4.3.3: Add "Create Estimate" button on job detail card**

Find the section in TechDashboard that renders job action buttons (e.g. the navigation/GPS
button, the status update button). Add a "Create Estimate" button alongside them:
```jsx
<button
  onClick={() => {
    setEstimateJobId(apt.id);
    setEstimateClientId(apt.client_id);
    setShowEstimateBuilder(true);
  }}
  className="flex items-center gap-2 w-full py-2.5 bg-gray-750 hover:bg-gray-700 border border-gray-600 text-gray-300 text-sm font-medium rounded-lg transition-colors"
>
  <FileText className="w-4 h-4 text-blue-400" />
  Create Estimate
</button>
```

- [ ] **Step 4.3.4: Add EstimateBuilder overlay**

At the end of the TechDashboard return (before the closing `</div>`), add:
```jsx
{showEstimateBuilder && estimateClientId && (
  <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
    <EstimateBuilder
      clientId={estimateClientId}
      appointmentId={estimateJobId}
      compact={true}
      taxRate={0}  {/* TechDashboard doesn't load client data — tax rate from DB via useEffect inside EstimateBuilder */}
      onClose={() => { setShowEstimateBuilder(false); setEstimateJobId(null); }}
      onSaved={(id) => { /* estimate saved — could show a success toast */ }}
    />
  </div>
)}
```

- [ ] **Step 4.3.5: Verify on mobile viewport**

In the browser dev tools, toggle to a mobile viewport (375px wide).
Navigate to TechDashboard (requires a tech account or test by inspecting TechDashboard directly).
Find a job card — "Create Estimate" button should appear.
Tap it — EstimateBuilder opens in compact (stacked) layout filling the screen.
Add a line item, save draft — should work without errors.

- [ ] **Step 4.3.6: Commit**

```bash
git add src/TechDashboard.jsx
git commit -m "feat(tech): add Create Estimate flow to TechDashboard"
```

---

## Chunk 5: Settings wiring + final verification

---

### Task 5.1: Expose estimate_legal_text in Settings

Owners can customize the legal text shown on the customer portal approval page.

**Files:**
- Modify: `src/DispatcherDashboard.jsx`

- [ ] **Step 5.1.1: Add legal text state**

In `DispatcherDashboard.jsx`, find the tax rate state declarations (added in Phase 1). Add:
```jsx
const [legalText, setLegalText]           = useState('');
const [savingLegalText, setSavingLegalText] = useState(false);
```

- [ ] **Step 5.1.2: Seed from clientData**

Find the `useEffect` that seeds `taxRateDisplay` from `effectiveClientData?.default_tax_rate`.
Add alongside it:
```jsx
setLegalText(effectiveClientData?.estimate_legal_text ?? '');
```

- [ ] **Step 5.1.3: Add save handler**

Near the `handleSaveTaxRate` function, add:
```jsx
const handleSaveLegalText = async () => {
  setSavingLegalText(true);
  const { error } = await supabase
    .from('clients')
    .update({ estimate_legal_text: legalText.trim() || null })
    .eq('id', clientId);
  setSavingLegalText(false);
  if (error) console.error('Failed to save legal text:', error.message);
};
```

- [ ] **Step 5.1.4: Add UI block in renderSettings()**

Find the "Invoicing & Tax" section added in Phase 1. After the tax rate input row, add:
```jsx
<div className="mt-4">
  <label className="block text-gray-400 text-xs uppercase tracking-wide mb-1">
    Estimate Approval Legal Text
  </label>
  <p className="text-gray-600 text-xs mb-2">
    Shown to customers on the estimate portal before they approve. Leave blank to use the
    system default.
  </p>
  <textarea
    value={legalText}
    onChange={e => setLegalText(e.target.value)}
    rows={4}
    placeholder="Leave blank for default legal text…"
    className="w-full px-2.5 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm resize-none"
  />
  <button
    onClick={handleSaveLegalText}
    disabled={savingLegalText}
    className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
  >
    {savingLegalText ? 'Saving…' : 'Save Legal Text'}
  </button>
</div>
```

- [ ] **Step 5.1.5: Commit**

```bash
git add src/DispatcherDashboard.jsx
git commit -m "feat(settings): add estimate legal text editor to Settings"
```

---

### Task 5.2: End-to-end verification

Full workflow test. No code changes — this is a verification milestone.

- [ ] **Step 5.2.1: Smoke test the full estimate flow**

1. Log in as owner
2. Go to Settings → verify "Estimate Approval Legal Text" input is present
3. Go to Estimates tab → click "New Estimate"
4. Title: `Phase 2 Smoke Test`
5. Add option "Good" with 2 line items from catalog (or manual)
6. Add option "Better" with 3 line items
7. Verify totals calculate correctly on both options
8. Save draft → estimate appears in list
9. Reopen estimate → click "Send via SMS" → enter a test phone → send
10. Copy the `portal_url` from the response
11. Open portal URL in a new tab (no auth required)
12. Portal shows both options — select "Better"
13. Check the approval checkbox
14. Click "Approve Estimate"
15. Green confirmation screen appears
16. Back in dashboard, refresh the Estimates list
17. Estimate status should show APPROVED

- [ ] **Step 5.2.2: Verify status transitions in DB**

```sql
SELECT id, status, approved_at, approved_by_ip, accepted_option_id
FROM estimates
WHERE client_id = 1   -- replace with actual client_id
ORDER BY created_at DESC
LIMIT 5;
```
Expected: smoke test estimate shows `status = 'approved'`, `approved_at` set, `approved_by_ip` set.

- [ ] **Step 5.2.3: Final commit and push**

```bash
git add -A
git commit -m "chore: Phase 2 verified end-to-end"
git push origin claude/dreamy-mcnulty
```

Then open a PR against `main` (same process as Phase 1).

---

## Summary

After all chunks complete, the following will be live:

**DB:**
- `estimates` — lifecycle-tracked, appointment+customer linked, IP-captured approval
- `estimate_options` — good/better/best grouping with denormalized totals
- `estimate_line_items` — catalog-linked or ad-hoc, quantity × unit_price × taxable
- `estimate_tokens` — 30-day validity, single-use revocation model
- `clients.estimate_legal_text`, `clients.estimate_validity_days`

**Edge Functions:**
- `generate-estimate-token` — creates token, returns portal URL (auth required)
- `get-estimate` — returns full estimate payload, marks viewed (public)
- `approve-estimate` — records approval with IP + timestamp (public)
- `send-estimate` — generates token + sends SMS via Telnyx (auth required)

**UI:**
- `EstimateBuilder.jsx` — full desktop + mobile compact estimate editor
- `EstimatesTab.jsx` — list + new/edit in DispatcherDashboard
- `EstimateViewerPublic.jsx` — customer portal (no auth, `?estimate=` param)
- `App.jsx` — `?estimate=` URL param routing
- `TechDashboard.jsx` — "Create Estimate" action on job cards
- Settings — estimate legal text editor

**Phase 3 (Invoices + AR) can begin** once this is verified end-to-end by Greg and merged
to main. The accepted_option_id and invoice_id columns on `estimates` are already in place
as hooks for Phase 3.
