# Sub-Plan 1: Foundation — DB Schema + Commission Logic

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply all database migrations for the sales rep commission system and implement fully-tested commission calculation logic as pure functions.

**Architecture:** A single SQL migration adds two columns to `clients` and creates the `deals` and `commissions` tables. A pure JavaScript module in `src/utils/commissions.js` calculates commission records from a deal — no Supabase calls, fully unit-testable. Vitest is added as the test framework (natural fit for this Vite project).

**Tech Stack:** Supabase PostgreSQL (migrations), Vitest (testing), JavaScript ES modules

**Worktree:** `C:\Users\Greg\receptionist-dashboard\.claude\worktrees\sales-commission-system`
**Branch:** `feature/sales-rep-commission-system`
**Spec:** `docs/superpowers/plans/2026-03-24-sales-rep-commission-system-spec.md`

---

## Codebase Context

- `clients.id` is **BIGINT** (not UUID) — confirmed by demo client id=9999
- No test framework exists yet — Vitest must be added
- Migration naming: `YYYYMMDD_descriptive_name.sql` in `supabase/migrations/`
- Migrations use `IF NOT EXISTS` for idempotency
- Edge functions use Deno + service role key — they bypass RLS
- All utility functions live in `src/utils/`
- No router library — navigation is state-driven in `App.jsx`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `package.json` | Add vitest + @vitest/ui dev dependencies, add test script |
| Modify | `vite.config.js` | Add vitest test configuration block |
| Create | `src/utils/commissions.js` | Pure commission calculation functions |
| Create | `src/utils/commissions.test.js` | Vitest unit tests — all 4 commission scenarios |
| Create | `supabase/migrations/20260324_add_sales_rep_commission_tables.sql` | Full DB migration |

---

## Chunk 1: Test Framework + Commission Logic

### Task 1: Add Vitest

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`

- [ ] **Step 1: Install Vitest**

Run from the worktree root (`C:\Users\Greg\receptionist-dashboard\.claude\worktrees\sales-commission-system`):

```bash
npm install --save-dev vitest @vitest/ui
```

Expected: vitest and @vitest/ui added to devDependencies in package.json

- [ ] **Step 2: Add test script to package.json**

In `package.json`, update the `"scripts"` section:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui"
}
```

- [ ] **Step 3: Add test config to vite.config.js**

Current `vite.config.js` content (read it first to preserve existing config). Add a `test` block:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ],
  server: {
    host: true,
    port: 3000
  },
  test: {
    environment: 'node',
    globals: false,
  }
})
```

> Note: Read the actual vite.config.js first and preserve its existing content — only add the `test` block.

- [ ] **Step 4: Verify Vitest runs**

```bash
npm test
```

Expected output:
```
No test files found, exiting with code 1
```
(This is correct — no tests exist yet. Vitest is working.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.js
git commit -m "chore: add Vitest test framework"
```

---

### Task 2: Write Failing Commission Tests

**Files:**
- Create: `src/utils/commissions.test.js`

- [ ] **Step 1: Create the test file**

Create `src/utils/commissions.test.js` with this full content:

```javascript
import { describe, it, expect } from 'vitest';
import { calculateCommissions } from './commissions.js';

// Fixed base date for deterministic due_date assertions
const BASE_DATE = new Date('2026-03-24');

const mockDeal = (plan, billing_cycle) => ({
  id: 'deal-uuid-123',
  rep_id: 42,
  plan,
  billing_cycle,
});

describe('calculateCommissions', () => {

  // ── Option 1: Full Upfront ────────────────────────────────────────────────

  describe('Option 1 — Full Upfront', () => {

    it('Standard monthly: returns 1 record', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 1, BASE_DATE);
      expect(records).toHaveLength(1);
    });

    it('Standard monthly: $495 upfront, status due', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 1, BASE_DATE);
      expect(records[0]).toMatchObject({
        deal_id: 'deal-uuid-123',
        rep_id: 42,
        type: 'upfront',
        month_number: null,
        amount: 495,
        status: 'due',
        due_date: '2026-03-24',
      });
    });

    it('Pro monthly: $695 upfront', () => {
      const records = calculateCommissions(mockDeal('pro', 'monthly'), 1, BASE_DATE);
      expect(records[0].amount).toBe(695);
    });

    it('Standard annual: $495 + $200 bonus = $695 upfront', () => {
      const records = calculateCommissions(mockDeal('standard', 'annual'), 1, BASE_DATE);
      expect(records).toHaveLength(1);
      expect(records[0].amount).toBe(695);
    });

    it('Pro annual: $695 + $200 bonus = $895 upfront', () => {
      const records = calculateCommissions(mockDeal('pro', 'annual'), 1, BASE_DATE);
      expect(records).toHaveLength(1);
      expect(records[0].amount).toBe(895);
    });

  });

  // ── Option 2: Split + Residual ────────────────────────────────────────────

  describe('Option 2 — Split + Residual', () => {

    it('Standard monthly: returns 13 records (1 upfront + 12 residuals)', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      expect(records).toHaveLength(13);
    });

    it('Standard monthly upfront: 50% of $495 = $247.50, status due', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const upfront = records.find(r => r.type === 'upfront');
      expect(upfront).toMatchObject({
        type: 'upfront',
        amount: 247.50,
        status: 'due',
        month_number: null,
        due_date: '2026-03-24',
      });
    });

    it('Pro monthly upfront: 50% of $695 = $347.50', () => {
      const records = calculateCommissions(mockDeal('pro', 'monthly'), 2, BASE_DATE);
      const upfront = records.find(r => r.type === 'upfront');
      expect(upfront.amount).toBe(347.50);
    });

    it('Standard monthly: 12 residual records', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const residuals = records.filter(r => r.type === 'residual');
      expect(residuals).toHaveLength(12);
    });

    it('Standard monthly residuals: 10% of $495 = $49.50 each', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const residuals = records.filter(r => r.type === 'residual');
      residuals.forEach(r => expect(r.amount).toBe(49.50));
    });

    it('Pro monthly residuals: 10% of $695 = $69.50 each', () => {
      const records = calculateCommissions(mockDeal('pro', 'monthly'), 2, BASE_DATE);
      const residuals = records.filter(r => r.type === 'residual');
      residuals.forEach(r => expect(r.amount).toBe(69.50));
    });

    it('Standard annual upfront: 50% of $495 + $200 bonus = $447.50', () => {
      const records = calculateCommissions(mockDeal('standard', 'annual'), 2, BASE_DATE);
      const upfront = records.find(r => r.type === 'upfront');
      expect(upfront.amount).toBe(447.50);
    });

    it('Pro annual upfront: 50% of $695 + $200 bonus = $547.50', () => {
      const records = calculateCommissions(mockDeal('pro', 'annual'), 2, BASE_DATE);
      const upfront = records.find(r => r.type === 'upfront');
      expect(upfront.amount).toBe(547.50);
    });

    it('month 1 residual is due same date as upfront', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const upfront = records.find(r => r.type === 'upfront');
      const month1 = records.find(r => r.type === 'residual' && r.month_number === 1);
      expect(month1.due_date).toBe(upfront.due_date);
      expect(month1.status).toBe('due');
    });

    it('month 2 residual is due 1 month after baseDate', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const month2 = records.find(r => r.type === 'residual' && r.month_number === 2);
      expect(month2.due_date).toBe('2026-04-24');
      expect(month2.status).toBe('pending');
    });

    it('month 12 residual is due 11 months after baseDate', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const month12 = records.find(r => r.type === 'residual' && r.month_number === 12);
      expect(month12.due_date).toBe('2027-02-24');
      expect(month12.status).toBe('pending');
    });

    it('residuals months 2–12 have status pending', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const laterResiduals = records.filter(r => r.type === 'residual' && r.month_number > 1);
      expect(laterResiduals).toHaveLength(11);
      laterResiduals.forEach(r => expect(r.status).toBe('pending'));
    });

    it('residuals are numbered 1 through 12', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const residuals = records.filter(r => r.type === 'residual');
      const monthNumbers = residuals.map(r => r.month_number).sort((a, b) => a - b);
      expect(monthNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });

    it('all records have correct deal_id and rep_id', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      records.forEach(r => {
        expect(r.deal_id).toBe('deal-uuid-123');
        expect(r.rep_id).toBe(42);
      });
    });

  });

});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
npm test
```

Expected: All 20 tests FAIL with `Cannot find module './commissions.js'`

> This confirms the test file is wired up correctly before any implementation exists.

- [ ] **Step 3: Commit failing tests**

```bash
git add src/utils/commissions.test.js
git commit -m "test: add failing commission calculation tests"
```

---

### Task 3: Implement Commission Calculation

**Files:**
- Create: `src/utils/commissions.js`

- [ ] **Step 1: Create the commissions utility**

Create `src/utils/commissions.js` with this full content:

```javascript
/**
 * Commission calculation utilities for the sales rep commission system.
 *
 * These are pure functions — no Supabase calls, no side effects.
 * All commission records returned are ready to insert into the commissions table.
 *
 * Commission Options:
 *   Option 1 — Full Upfront: one-time payment equal to the monthly plan price
 *              (+ $200 bonus if the client is on an annual plan)
 *   Option 2 — Split + Residual: 50% upfront + 10%/month for 12 months
 *              Month 1 residual is due the same day as the upfront payment.
 *              (+ $200 bonus added to upfront if annual)
 */

/** Monthly subscription prices by plan */
const PLAN_PRICES = {
  standard: 495,
  pro: 695,
};

/** Bonus added to upfront commission when client pays annually */
const ANNUAL_BONUS = 200;

/**
 * Calculate all commission records for a newly activated deal.
 *
 * @param {Object} deal
 * @param {string}        deal.id           - Deal UUID
 * @param {number}        deal.rep_id       - Rep's BIGINT client ID
 * @param {'standard'|'pro'} deal.plan      - Subscription plan
 * @param {'monthly'|'annual'} deal.billing_cycle - Billing cycle
 * @param {1|2} commissionOption            - Rep's commission option (from clients.commission_option)
 * @param {Date} [baseDate=new Date()]      - Base date for due_date calculation (injectable for tests)
 * @returns {Array<CommissionRecord>}        - Records ready to insert into commissions table
 */
export function calculateCommissions(deal, commissionOption, baseDate = new Date()) {
  const monthlyPrice = PLAN_PRICES[deal.plan];
  if (!monthlyPrice) {
    throw new Error(`Unknown plan: ${deal.plan}. Must be 'standard' or 'pro'.`);
  }

  const isAnnual = deal.billing_cycle === 'annual';

  if (commissionOption === 1) {
    return _calculateOption1(deal, monthlyPrice, isAnnual, baseDate);
  }
  if (commissionOption === 2) {
    return _calculateOption2(deal, monthlyPrice, isAnnual, baseDate);
  }
  throw new Error(`Unknown commission option: ${commissionOption}. Must be 1 or 2.`);
}

/**
 * Option 1: Single upfront payment equal to monthly plan price (+ $200 if annual).
 * @private
 */
function _calculateOption1(deal, monthlyPrice, isAnnual, baseDate) {
  return [
    {
      deal_id: deal.id,
      rep_id: deal.rep_id,
      type: 'upfront',
      month_number: null,
      amount: monthlyPrice + (isAnnual ? ANNUAL_BONUS : 0),
      status: 'due',
      due_date: _formatDate(baseDate),
    },
  ];
}

/**
 * Option 2: 50% upfront (+ $200 if annual) + 10%/month × 12 months.
 * Month 1 residual is due the same day as the upfront.
 * Months 2–12 are scheduled monthly and start as 'pending'.
 * @private
 */
function _calculateOption2(deal, monthlyPrice, isAnnual, baseDate) {
  const upfrontAmount = (monthlyPrice * 0.5) + (isAnnual ? ANNUAL_BONUS : 0);
  const residualAmount = monthlyPrice * 0.1;

  const records = [
    {
      deal_id: deal.id,
      rep_id: deal.rep_id,
      type: 'upfront',
      month_number: null,
      amount: upfrontAmount,
      status: 'due',
      due_date: _formatDate(baseDate),
    },
  ];

  // 12 monthly residuals — month 1 due same day as upfront
  for (let month = 1; month <= 12; month++) {
    records.push({
      deal_id: deal.id,
      rep_id: deal.rep_id,
      type: 'residual',
      month_number: month,
      amount: residualAmount,
      status: month === 1 ? 'due' : 'pending',
      due_date: _formatDate(_addMonths(baseDate, month - 1)),
    });
  }

  return records;
}

/**
 * Format a Date as an ISO date string (YYYY-MM-DD).
 * @param {Date} date
 * @returns {string}
 */
function _formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Return a new Date with N months added.
 * Uses day-of-month clamping (e.g., Jan 31 + 1 month = Feb 28).
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
function _addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}
```

- [ ] **Step 2: Run tests — all should pass**

```bash
npm test
```

Expected output:
```
✓ src/utils/commissions.test.js (20 tests) Xms

Test Files  1 passed (1)
Tests       20 passed (20)
```

If any test fails, fix the implementation before proceeding. Do not move on with failing tests.

- [ ] **Step 3: Commit**

```bash
git add src/utils/commissions.js
git commit -m "feat: add commission calculation utility with full test coverage"
```

---

## Chunk 2: Database Migration

### Task 4: Write and Apply the Migration

**Files:**
- Create: `supabase/migrations/20260324_add_sales_rep_commission_tables.sql`

> **Important:** The `clients.id` column is BIGINT (not UUID). All foreign keys referencing `clients.id` must use BIGINT.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260324_add_sales_rep_commission_tables.sql`:

> **Note on BIGINT vs UUID:** The spec document describes `rep_id` and `supabase_client_id` in `deals`, and `rep_id` in `commissions` as UUID foreign keys. This is incorrect — `clients.id` is a BIGINT (confirmed: demo client id=9999). The migration below correctly uses BIGINT for all foreign keys referencing `clients.id`. The spec will be updated separately.

```sql
-- ============================================================
-- Sub-Plan 1: Sales Rep Commission System — Foundation
-- Adds is_sales_rep + commission_option to clients.
-- Creates deals and commissions tables.
-- Note: clients.id is BIGINT (not UUID), so all FKs to
-- clients.id use BIGINT regardless of what the spec states.
-- ============================================================


-- ── 1. Modify clients table ──────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_sales_rep    BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_option INTEGER DEFAULT NULL;

COMMENT ON COLUMN clients.is_sales_rep      IS 'True for sales rep accounts (role=sales_rep)';
COMMENT ON COLUMN clients.commission_option IS '1 = full upfront, 2 = split+residual. NULL for non-rep accounts.';


-- ── 2. Create deals table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS deals (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id                  BIGINT      NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  client_name             TEXT        NOT NULL,
  client_email            TEXT        NOT NULL,
  client_phone            TEXT,
  company_name            TEXT        NOT NULL,
  plan                    TEXT        NOT NULL CHECK (plan IN ('standard', 'pro')),
  billing_cycle           TEXT        NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  status                  TEXT        NOT NULL DEFAULT 'onboarding_sent'
                            CHECK (status IN ('onboarding_sent', 'setup_in_progress', 'active', 'cancelled')),
  onboarding_token        UUID        UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  onboarding_data         JSONB,
  stripe_setup_payment_id TEXT,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  hubspot_deal_id         TEXT,
  supabase_client_id      BIGINT      REFERENCES clients(id) ON DELETE SET NULL,
  clawback_safe           BOOLEAN     NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  deals                        IS 'One row per sales deal from creation through active subscription.';
COMMENT ON COLUMN deals.rep_id                 IS 'FK to clients — the sales rep who created this deal.';
COMMENT ON COLUMN deals.onboarding_token       IS 'UUID used in the public onboarding URL: /onboard?token=<uuid>';
COMMENT ON COLUMN deals.onboarding_data        IS 'JSON blob of all form fields submitted by the client.';
COMMENT ON COLUMN deals.supabase_client_id     IS 'FK to clients — set by Greg when he creates the client account.';
COMMENT ON COLUMN deals.clawback_safe          IS 'False until 2nd subscription payment clears (or annual payment clears immediately).';


-- ── 3. updated_at auto-trigger for deals ────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deals_updated_at ON deals;
CREATE TRIGGER deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ── 4. Indexes for deals ─────────────────────────────────────

CREATE INDEX        IF NOT EXISTS deals_rep_id_idx         ON deals (rep_id);
CREATE UNIQUE INDEX IF NOT EXISTS deals_onboarding_token_idx ON deals (onboarding_token);
CREATE INDEX        IF NOT EXISTS deals_status_idx          ON deals (status);


-- ── 5. Create commissions table ──────────────────────────────

CREATE TABLE IF NOT EXISTS commissions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      UUID         NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  rep_id       BIGINT       NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  type         TEXT         NOT NULL CHECK (type IN ('upfront', 'residual')),
  month_number INTEGER      CHECK (month_number BETWEEN 1 AND 12),
  amount       NUMERIC(10,2) NOT NULL,
  status       TEXT         NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'due', 'paid', 'voided')),
  due_date     DATE,
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  commissions              IS 'One row per commission payment — upfront and residual installments.';
COMMENT ON COLUMN commissions.type        IS 'upfront = one-time or 50% payment; residual = monthly 10% payment.';
COMMENT ON COLUMN commissions.month_number IS '1–12 for residuals; NULL for upfront records. Month 1 is due same day as upfront.';
COMMENT ON COLUMN commissions.status      IS 'pending=scheduled not yet due; due=ready to pay; paid=Greg marked paid; voided=clawback.';


-- ── 6. Indexes for commissions ───────────────────────────────

CREATE INDEX IF NOT EXISTS commissions_deal_id_idx  ON commissions (deal_id);
CREATE INDEX IF NOT EXISTS commissions_rep_id_idx   ON commissions (rep_id);
CREATE INDEX IF NOT EXISTS commissions_status_idx   ON commissions (status);
CREATE INDEX IF NOT EXISTS commissions_due_date_idx ON commissions (due_date);


-- ── 7. Row Level Security ────────────────────────────────────
-- RLS is enabled now; full policies are added in Sub-Plan 3
-- (rep dashboard) when frontend access patterns are defined.
-- Edge functions use the service role key and bypass RLS.

ALTER TABLE deals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply the migration**

**Primary method — Supabase CLI** (most reliable):

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --project-ref zmppdmfdhknnwzwdfhwf
```

Run from `C:\Users\Greg\receptionist-dashboard\.claude\worktrees\sales-commission-system`. Ask the user for their Supabase personal access token if not available in the session.

Expected output: `Applying migration 20260324_add_sales_rep_commission_tables.sql... done`

**Alternative — Supabase MCP tool** (if CLI unavailable):

Use `mcp__308cb25c-0e49-4cf3-9e1e-1dc768d6ee47__apply_migration` with:
- `project_ref`: `zmppdmfdhknnwzwdfhwf`
- `name`: `add_sales_rep_commission_tables`
- `query`: *(paste the full SQL from Step 1)*

> **Warning:** The MCP tool ID (`308cb25c-...`) is session-specific and may differ. If the tool is not found, fall back to the CLI method above.

- [ ] **Step 3: Verify tables exist**

Run via Supabase MCP `execute_sql` or the Supabase SQL editor:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('deals', 'commissions')
ORDER BY table_name;
```

Expected: Two rows — `commissions` and `deals`.

- [ ] **Step 4: Verify clients columns were added**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'clients'
  AND column_name IN ('is_sales_rep', 'commission_option')
ORDER BY column_name;
```

Expected: Two rows — `commission_option` (integer, nullable) and `is_sales_rep` (boolean, not null, default false).

- [ ] **Step 5: Verify indexes, trigger, and RLS**

```sql
-- Indexes on deals
SELECT indexname FROM pg_indexes
WHERE tablename = 'deals'
  AND indexname IN ('deals_rep_id_idx', 'deals_onboarding_token_idx', 'deals_status_idx');

-- Indexes on commissions
SELECT indexname FROM pg_indexes
WHERE tablename = 'commissions'
  AND indexname IN ('commissions_deal_id_idx', 'commissions_rep_id_idx',
                    'commissions_status_idx', 'commissions_due_date_idx');

-- updated_at trigger on deals
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table = 'deals'
  AND trigger_name = 'deals_updated_at';

-- RLS enabled on both tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('deals', 'commissions');
```

Expected:
- 3 rows for deals indexes
- 4 rows for commissions indexes
- 1 row for the trigger
- 2 rows with `rowsecurity = true`

- [ ] **Step 6: Commit the migration file**

```bash
git add supabase/migrations/20260324_add_sales_rep_commission_tables.sql
git commit -m "feat: add deals and commissions tables, extend clients for sales reps"
```

---

## Completion Checklist

Before marking Sub-Plan 1 complete:

- [ ] `npm test` passes — 20 tests, 0 failures
- [ ] `deals` table exists in Supabase with all columns, constraints, and indexes
- [ ] `commissions` table exists in Supabase with all columns, constraints, and indexes
- [ ] `clients` table has `is_sales_rep` and `commission_option` columns
- [ ] `updated_at` trigger fires on deals UPDATE
- [ ] RLS is enabled on both new tables
- [ ] All 4 commission scenarios covered: Option 1 monthly, Option 1 annual, Option 2 monthly, Option 2 annual
- [ ] All commits are clean and on `feature/sales-rep-commission-system` branch

---

## What's Next

Sub-Plan 2 — Client Onboarding Flow:
- `create-onboarding-checkout` Edge Function
- `stripe-webhook` updates for setup fee payment event
- `send-notification` Edge Function
- Public `/onboard` page (form + Stripe redirect + confirmation)
