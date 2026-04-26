# Invoicing Phase 1 — Pricing Catalog Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the per-client Pricing Catalog — a fully editable list of priceable items
(services, equipment, parts, materials, labor rates) with per-line tax, unit-of-measure,
optional linkage to existing `service_types`, and CSV import/export. This is the
foundation under all later invoicing/estimating work.

**Architecture:** New Postgres table `pricing_catalog` with strict client_id-keyed RLS
using the `auth.email()` pattern. New top-level "Pricing" tab in the dashboard, visible
only to owner/admin roles, rendered by a new `PricingCatalog.jsx` component (read +
write + import/export in one focused file). Tax config (per-client default rate) added
as a column on `clients` and edited in the existing Settings view.

**Tech Stack:** Postgres (Supabase), React 18, Vite, Tailwind CSS 3, supabase-js v2,
PapaParse (new dep) for CSV. No new Edge Functions in Phase 1 — all CRUD goes through
Supabase REST + RLS.

---

## How to use this plan

1. Work top-to-bottom. Don't skip ahead.
2. Each chunk ends with a verification step and a commit. Don't merge a chunk's work
   into the next until its verification passes.
3. If you hit a blocker (schema doesn't match, RLS rejects a query, etc.), STOP and
   diagnose root cause — do not patch around it. The skill `superpowers:systematic-debugging`
   applies.
4. The codebase has **no test runner configured** (CLAUDE.md). Verification is via:
   - SQL: `mcp__308cb25c-...__execute_sql` (Supabase MCP) for schema inspection
   - UI: `mcp__Claude_Preview__*` tools for browser verification
   - Don't add a test runner in this phase. Match the existing pattern.
5. Reference files cited in this plan use real line ranges as of `main` at commit
   `19e13d4`. If lines have drifted, search by symbol.
6. **CRITICAL:** All RLS policies use `auth.email()`. Never `(SELECT email FROM auth.users WHERE id = auth.uid())`.
   See `supabase/migrations/20260325005_fix_rls_use_auth_email.sql` for the canonical pattern.

---

## Reference: existing patterns this plan reuses

| Pattern | File | Lines |
|---|---|---|
| RLS via `auth.email()` (canonical) | `supabase/migrations/20260325005_fix_rls_use_auth_email.sql` | 10-33, 81-88 |
| Service types schema (link target) | `supabase/migrations/20260314_replace_service_types_with_156.sql` | 1-191 |
| Service types per-client + RLS | `supabase/migrations/20260314_add_client_id_to_service_types.sql` | full file |
| Tailwind input class string | `src/AppointmentSidePanel.jsx` | 35-37 |
| Modal overlay structure | `src/Admin.jsx` | 491-550 |
| Tab routing in App.jsx | `src/App.jsx` | inline `activeTab` switch in render functions |
| Auth → clientId resolution | `src/App.jsx` | 17-115 (useEffect on user) |
| Settings field editing (clients table) | `src/App.jsx` | `renderSettings()` |

---

## Chunk 1: Foundation — schema, RLS, tax config

This chunk creates the database objects and verifies them. No frontend work yet. After
this chunk, `pricing_catalog` exists, RLS is enforced, and `clients.default_tax_rate`
is queryable.

### Task 1.1: Create the pricing_catalog migration

**Files:**
- Create: `supabase/migrations/20260426001_create_pricing_catalog.sql`

- [ ] **Step 1.1.1: Write the migration file**

```sql
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
```

- [ ] **Step 1.1.2: Apply the migration**

Use the Supabase MCP `apply_migration` tool (preferred over `execute_sql` for DDL). Pass:
- `project_id`: `zmppdmfdhknnwzwdfhwf`
- `name`: `20260426001_create_pricing_catalog`
- `query`: contents of the migration file

Expected: success response. If anything fails, STOP and diagnose root cause — do not
retry blindly. Common failure: `update_updated_at_column()` not found (the migration
that defined it was rolled back) — solution is to inspect `pg_proc` for it and
re-create only if missing, not to redefine.

- [ ] **Step 1.1.3: Verify the table exists with the expected schema**

Run via MCP `execute_sql`:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'pricing_catalog'
ORDER BY ordinal_position;
```

Expected: 15 columns present. Verify by **set membership** (not order — `ALTER TABLE
ADD COLUMN` later will append, breaking ordinal assertions). The required column set is:
`id`, `client_id`, `name`, `description`, `category`, `unit_type`, `unit_price`,
`taxable`, `tier`, `tier_group`, `service_type_id`, `is_active`, `sort_order`,
`created_at`, `updated_at`. Spot-check types: `unit_price` should be `numeric` (precision
10, scale 2); `client_id` should be `integer`; `taxable`/`is_active` should be `boolean`.

- [ ] **Step 1.1.4: Verify the constraints and indexes**

Run via MCP `execute_sql`:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'pricing_catalog'::regclass;
```

Expected: PK, FK to clients, FK to service_types, 3 CHECK constraints (`unit_price`,
`unit_type`, `name`).

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'pricing_catalog';
```

Expected: 4 indexes — `pricing_catalog_pkey`, `idx_pricing_catalog_client`,
`idx_pricing_catalog_client_category`, `idx_pricing_catalog_client_tier_group`.

- [ ] **Step 1.1.5: Commit**

```bash
cd C:/Users/Greg/receptionist-dashboard/.claude/worktrees/invoicing-v1
git add supabase/migrations/20260426001_create_pricing_catalog.sql
git commit -m "feat(invoicing): add pricing_catalog table with constraints + indexes

Phase 1 of invoicing build. Per-client priceable items with tax flag,
unit-of-measure, optional service_types linkage, and forward-compat
tier fields for Phase 2 good/better/best."
```

---

### Task 1.2: Add RLS policies to pricing_catalog

**Files:**
- Create: `supabase/migrations/20260426002_pricing_catalog_rls.sql`

- [ ] **Step 1.2.1: Write the RLS migration**

```sql
-- 20260426002_pricing_catalog_rls.sql
-- RLS for pricing_catalog. Pattern matches 20260325005_fix_rls_use_auth_email.sql:
-- always use auth.email(), never (SELECT email FROM auth.users WHERE id = auth.uid()).

ALTER TABLE pricing_catalog ENABLE ROW LEVEL SECURITY;

-- Owner (clients row keyed by email) can do anything to their own catalog.
-- Using IN (...) instead of = (...) defensively: if a future schema change ever lets
-- one email own multiple clients (unlikely but cheap insurance), = would throw
-- "more than one row returned by a subquery".
CREATE POLICY "owner_manage_pricing_catalog" ON pricing_catalog
  FOR ALL
  USING (
    client_id IN (SELECT id FROM clients WHERE email = auth.email())
  )
  WITH CHECK (
    client_id IN (SELECT id FROM clients WHERE email = auth.email())
  );

-- Admins (clients.is_admin = true) can read/write any client's catalog (for support).
CREATE POLICY "admin_manage_pricing_catalog" ON pricing_catalog
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE email = auth.email() AND is_admin = true)
  );

-- Dispatchers can READ (needed for Phase 2 estimate building).
CREATE POLICY "dispatcher_read_pricing_catalog" ON pricing_catalog
  FOR SELECT
  USING (
    client_id IN (
      SELECT client_id FROM client_staff
      WHERE email = auth.email() AND is_active = true
    )
  );

-- Techs can READ (needed for Phase 2 tech-in-field estimates).
CREATE POLICY "tech_read_pricing_catalog" ON pricing_catalog
  FOR SELECT
  USING (
    client_id IN (
      SELECT client_id FROM technicians
      WHERE email = auth.email() AND is_active = true
    )
  );

-- Note on column name: the codebase's client_staff uses `is_active` (CLAUDE.md §Schema).
-- A previous migration (20260325006) renamed it from `active`. If you see column-not-found
-- errors during testing, check the live schema with information_schema before assuming
-- this plan is wrong.
```

- [ ] **Step 1.2.2: Apply the migration**

Use MCP `apply_migration` with name `20260426002_pricing_catalog_rls`.

- [ ] **Step 1.2.3: Verify RLS is enabled and policies exist**

```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'pricing_catalog';
-- Expected: relrowsecurity = true

SELECT polname, polcmd FROM pg_policy
WHERE polrelid = 'pricing_catalog'::regclass
ORDER BY polname;
-- Expected 4 rows: admin_manage_pricing_catalog (ALL), dispatcher_read_pricing_catalog (SELECT),
-- owner_manage_pricing_catalog (ALL), tech_read_pricing_catalog (SELECT).
```

- [ ] **Step 1.2.4: Smoke-test the RLS policies with a real session**

**Where to run:** Start the dev server (`npm run dev` in this worktree), open
`http://localhost:3000` in a browser, log in as a known owner (e.g.
`gmacdonald63@gmail.com` → client_id 1, confirm the id by `SELECT id FROM clients
WHERE email = 'gmacdonald63@gmail.com'`). Open DevTools → Console.

The Supabase client is exported from `src/supabaseClient.js` but is not exposed on
`window` by default. Two options:

**Option A — Temporary expose (recommended for this one-off check):** In the console,
paste:

```javascript
// One-time: import the supabase client and expose it on window for this test only.
import('/src/supabaseClient.js').then(m => { window.__sb = m.supabase; console.log('ready'); });
```

Wait for `ready`, then:

```javascript
// Should succeed (owner can insert into own client's catalog):
const a = await window.__sb.from('pricing_catalog').insert({
  client_id: 1, name: 'RLS Test Diagnostic', unit_type: 'each', unit_price: 89.00
}).select();
console.log('A:', a);  // Expected: { data: [{...}], error: null }

// Should fail (owner cannot insert for a different client):
const b = await window.__sb.from('pricing_catalog').insert({
  client_id: 9, name: 'RLS Hostile insert', unit_type: 'each', unit_price: 1
}).select();
console.log('B:', b);  // Expected: { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }

// Cleanup:
await window.__sb.from('pricing_catalog').delete().eq('name', 'RLS Test Diagnostic');
```

**Option B — Skip and rely on direct SQL only:** RLS policies can be tested at the SQL
level by setting `request.jwt.claim.email` and running the same INSERT as the
authenticated role. Use this only if Option A's import fails.

**Pass criteria (be strict — both must hold):**
1. A's `data` is a non-empty array, A's `error` is `null`.
2. B's `data` is `null` AND B's `error` is non-null with code `42501` (or message
   containing "row-level security policy"). An empty array with no error is NOT a
   pass — that would mean the policy silently filtered the INSERT, which means
   the RLS isn't actually blocking writes the way you think.

If B succeeds (returns a row) or returns an empty array without an error, STOP and
fix the policy before proceeding.

- [ ] **Step 1.2.5: Commit**

```bash
git add supabase/migrations/20260426002_pricing_catalog_rls.sql
git commit -m "feat(invoicing): RLS for pricing_catalog using auth.email() pattern

Owner full access, admin override, dispatcher+tech read-only for Phase 2.
Smoke-tested with owner JWT — cross-client write blocked as expected."
```

---

### Task 1.3: Add default_tax_rate to clients

**Files:**
- Create: `supabase/migrations/20260426003_clients_default_tax_rate.sql`

- [ ] **Step 1.3.1: Write the migration**

```sql
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
```

- [ ] **Step 1.3.2: Apply the migration**

Use MCP `apply_migration` with name `20260426003_clients_default_tax_rate`.

- [ ] **Step 1.3.3: Verify**

```sql
SELECT column_name, data_type, numeric_precision, numeric_scale, column_default
FROM information_schema.columns
WHERE table_name = 'clients' AND column_name = 'default_tax_rate';
-- Expected: NUMERIC(6,5), default 0
```

- [ ] **Step 1.3.4: Commit**

```bash
git add supabase/migrations/20260426003_clients_default_tax_rate.sql
git commit -m "feat(invoicing): add clients.default_tax_rate (Fork 6)

Per-client default sales tax rate; pairs with per-line taxable flag
on pricing_catalog. NUMERIC(6,5) so 7.375%-style fractional rates are
representable. CHECK constraint enforces 0 <= rate < 1."
```

---

### Chunk 1 verification

- [ ] **Run end-to-end query as a sanity check**

```sql
-- Insert a starter row, query it back, delete it.
INSERT INTO pricing_catalog (client_id, name, category, unit_type, unit_price, taxable)
VALUES (1, 'PHASE 1 SANITY ROW', 'Test', 'each', 99.99, true)
RETURNING id, created_at, updated_at;

SELECT id, name, unit_price, taxable, created_at, updated_at
FROM pricing_catalog WHERE name = 'PHASE 1 SANITY ROW';

DELETE FROM pricing_catalog WHERE name = 'PHASE 1 SANITY ROW';
```

Expected: insert returns one row with `created_at` and `updated_at` populated, select
shows the row, delete returns success.

Chunk 1 ships when: schema present, RLS enforced, tax column present, sanity insert/
select/delete all succeed.

---

## Chunk 2: Pricing Catalog UI — read side

This chunk creates the new `PricingCatalog.jsx` component, wires it into `App.jsx` as a
new tab visible only to owner/admin roles, and renders the list with search/filter/sort.
No write operations yet (Add/Edit/Delete come in Chunk 3).

### Task 2.1: Scaffold PricingCatalog.jsx

**Files:**
- Create: `src/PricingCatalog.jsx`

- [ ] **Step 2.1.1: Write the initial component shell**

Create `src/PricingCatalog.jsx`:

```jsx
import { useState, useEffect, useMemo } from 'react'
import { Search, Plus, Download, Upload, Edit2, Trash2 } from 'lucide-react'
import { supabase } from './supabaseClient'

// Tailwind class strings reused across inputs (matches AppointmentSidePanel.jsx:35-37 pattern)
const INPUT_CLS = 'w-full px-2.5 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm'

export default function PricingCatalog({ clientId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filter / search state
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activeOnly, setActiveOnly] = useState(true)

  // Load catalog on mount + when clientId changes
  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase
      .from('pricing_catalog')
      .select('id, name, description, category, unit_type, unit_price, taxable, tier, tier_group, service_type_id, is_active, sort_order, created_at, updated_at')
      .eq('client_id', clientId)
      .order('category', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setError(error.message)
          setItems([])
        } else {
          setItems(data || [])
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [clientId])

  // Derived: distinct category list (for the filter dropdown)
  const categories = useMemo(() => {
    const seen = new Set()
    items.forEach(it => { if (it.category) seen.add(it.category) })
    return Array.from(seen).sort()
  }, [items])

  // Derived: filtered list
  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return items.filter(it => {
      if (activeOnly && !it.is_active) return false
      if (categoryFilter !== 'all' && it.category !== categoryFilter) return false
      if (q) {
        const hay = `${it.name} ${it.description || ''} ${it.category || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, searchQuery, categoryFilter, activeOnly])

  if (loading) {
    return <div className="p-6 text-gray-400">Loading pricing catalog…</div>
  }
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-4">
          Failed to load catalog: {error}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Pricing Catalog</h2>
          <p className="text-sm text-gray-400 mt-1">
            {items.length} {items.length === 1 ? 'item' : 'items'}
            {visibleItems.length !== items.length && ` (${visibleItems.length} shown)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Buttons (handlers added in Chunk 3 / 4) */}
          <button
            disabled
            title="Coming in Chunk 4"
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg opacity-60 cursor-not-allowed"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            disabled
            title="Coming in Chunk 4"
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg opacity-60 cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> Export
          </button>
          <button
            disabled
            title="Coming in Chunk 3"
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg opacity-60 cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by name, description, category…"
            className={`${INPUT_CLS} pl-9`}
          />
        </div>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className={`${INPUT_CLS} w-auto`}
        >
          <option value="all">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-300 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={e => setActiveOnly(e.target.checked)}
            className="rounded"
          />
          Active only
        </label>
      </div>

      {/* List */}
      {visibleItems.length === 0 ? (
        <EmptyState hasItems={items.length > 0} onClearFilters={() => {
          setSearchQuery(''); setCategoryFilter('all'); setActiveOnly(true)
        }} />
      ) : (
        <CatalogTable items={visibleItems} />
      )}
    </div>
  )
}

function EmptyState({ hasItems, onClearFilters }) {
  if (hasItems) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="mb-2">No items match the current filters.</p>
        <button onClick={onClearFilters} className="text-blue-400 hover:text-blue-300 underline text-sm">
          Clear filters
        </button>
      </div>
    )
  }
  return (
    <div className="text-center py-16 text-gray-400">
      <p className="mb-2">Your pricing catalog is empty.</p>
      <p className="text-sm">Add items individually or import a CSV to get started.</p>
    </div>
  )
}

function CatalogTable({ items }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-800 text-gray-300 uppercase text-xs">
          <tr>
            <th className="px-4 py-3 text-left">Name</th>
            <th className="px-4 py-3 text-left">Category</th>
            <th className="px-4 py-3 text-left">Unit</th>
            <th className="px-4 py-3 text-right">Price</th>
            <th className="px-4 py-3 text-center">Tax</th>
            <th className="px-4 py-3 text-center">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700 bg-gray-900">
          {items.map(it => (
            <tr key={it.id} className="hover:bg-gray-800">
              <td className="px-4 py-3 text-white">
                <div className="font-medium">{it.name}</div>
                {it.description && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-md">{it.description}</div>}
              </td>
              <td className="px-4 py-3 text-gray-300">{it.category || <span className="text-gray-500">—</span>}</td>
              <td className="px-4 py-3 text-gray-300">{it.unit_type}</td>
              <td className="px-4 py-3 text-right text-white tabular-nums">
                ${Number(it.unit_price).toFixed(2)}
              </td>
              <td className="px-4 py-3 text-center">
                {it.taxable
                  ? <span className="text-green-400" title="Taxable">●</span>
                  : <span className="text-gray-500" title="Not taxable">○</span>}
              </td>
              <td className="px-4 py-3 text-center">
                {it.is_active
                  ? <span className="text-xs px-2 py-0.5 rounded bg-green-900/50 text-green-300 border border-green-800">Active</span>
                  : <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-400 border border-gray-600">Hidden</span>}
              </td>
              <td className="px-4 py-3 text-right">
                <button disabled title="Coming in Chunk 3" className="p-1.5 text-gray-500 cursor-not-allowed">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button disabled title="Coming in Chunk 3" className="p-1.5 text-gray-500 cursor-not-allowed">
                  <Trash2 className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2.1.2: Verify the file exists and parses**

Run:

```bash
cd C:/Users/Greg/receptionist-dashboard/.claude/worktrees/invoicing-v1
npx vite build 2>&1 | tail -20
```

Expected: build succeeds (or fails only on App.jsx not yet importing this file — that's fine, we wire it next). If there's a syntax error in PricingCatalog.jsx, fix it before proceeding.

- [ ] **Step 2.1.3: Commit**

```bash
git add src/PricingCatalog.jsx
git commit -m "feat(invoicing): scaffold PricingCatalog.jsx with read-only list view

Loads catalog for the current client, supports search/category-filter/
active-only toggle. Add/Edit/Delete/Import/Export buttons present but
disabled — wired in Chunk 3 and 4. No new deps."
```

---

### Task 2.2: Wire PricingCatalog into DispatcherDashboard.jsx

> **Heads-up — `CLAUDE.md` is stale on this point.** It says App.jsx is ~1230 lines and
> owns the tab bar. As of this branch, `src/App.jsx` is ~389 lines and is just a thin
> auth router that delegates the authenticated experience to `src/DispatcherDashboard.jsx`
> (~1875 lines). The bottom tab bar, `activeTab` state, and per-tab content rendering all
> live in `DispatcherDashboard.jsx`. **Do all of Task 2.2's edits in that file.**

**Files:**
- Modify: `src/DispatcherDashboard.jsx` (multiple small edits)

- [ ] **Step 2.2.1: Re-read the current DispatcherDashboard.jsx structure to ground your edits**

Open `src/DispatcherDashboard.jsx` and confirm the following before editing — line numbers
may have drifted since this plan was written, so locate by content, not by line:

1. **`activeTab` state** — search for `useState('appointments')`. As of plan-time it's around line 117.
2. **Lucide icon imports** — top of file, single line starting with `import { ... } from 'lucide-react';`.
   Confirm `DollarSign` is already there (used by Billing tab) so we know to pick a different icon.
3. **Three tab arrays** — search for `navItems = [`. You'll find:
   - `navItems` — public-demo tabs (5 entries)
   - `ownerNavItems` — owner/admin tabs (7 entries: appointments, customers, calls, team, map, billing, settings)
   - `dispatcherNavItems` — dispatcher tabs (5 entries: appointments, customers, calls, team, map)
4. **Two tab-content render blocks** — search for `activeTab === 'billing'`. There are two
   matches:
   - First (~line 1473) inside the **public-demo render branch** (`if (isPublicDemo && demoMode && demoClientData)`).
     **Do NOT add Pricing here** — demo doesn't include pricing.
   - Second (~line 1789, gated by `role !== 'dispatcher'`) inside the main authenticated
     render. **This is where Pricing's content render goes.**
5. **`clientData` prop** — confirmed received in the component signature; pass `clientData?.id`
   exactly as `<Customers />` does on the same page.

If any of those have moved or been refactored, prefer the existing patterns — adapt the edits
below to match the current structure.

- [ ] **Step 2.2.2: Add the import**

Near the top of `DispatcherDashboard.jsx`, alongside existing local-component imports
(e.g. `import AppointmentCalendar from './AppointmentCalendar';`), add:

```jsx
import PricingCatalog from './PricingCatalog';
```

- [ ] **Step 2.2.3: Add the icon import**

Find the lucide-react import line (single line near the top). It currently looks like:

```jsx
import { Phone, Calendar, FileText, Clock, DollarSign, Download, Play, Pause, Search, RefreshCw, ChevronRight, LogOut, Settings, Plus, X, Users, MapPin } from 'lucide-react';
```

Add `Tag` to that list (it's not in use yet and visually fits a "pricing/catalog" tab). After:

```jsx
import { Phone, Calendar, FileText, Clock, DollarSign, Download, Play, Pause, Search, RefreshCw, ChevronRight, LogOut, Settings, Plus, X, Users, MapPin, Tag } from 'lucide-react';
```

> Why not `DollarSign`? It's already used for Billing — visual collision in the bottom bar.
> If a reviewer prefers a different icon (`BookOpen`, `ListChecks`, `Package`), pick one — but
> it must not duplicate any existing tab's icon.

- [ ] **Step 2.2.4: Add the Pricing entry to `ownerNavItems`**

Find the `ownerNavItems` array (currently ~lines 1412-1420). Insert a new entry **between
`map` and `billing`** so the visual order reads: appointments · customers · calls · team ·
map · pricing · billing · settings. After:

```jsx
const ownerNavItems = [
  { id: 'appointments', label: 'Appointments', icon: Calendar },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'calls', label: 'Calls', icon: Phone },
  teamTab,
  { id: 'map', label: 'Map', icon: MapPin },
  { id: 'pricing', label: 'Pricing', icon: Tag },
  { id: 'billing', label: 'Billing', icon: DollarSign },
  { id: 'settings', label: 'Settings', icon: Settings },
];
```

> **Do NOT add Pricing to `dispatcherNavItems` or `navItems` (demo).** Owner/admin only —
> per the locked decision in the spec.

- [ ] **Step 2.2.5: Render PricingCatalog when activeTab === 'pricing' (authenticated branch only)**

Find the second `activeTab === 'billing'` block (~line 1789, gated by `role !== 'dispatcher'`).
Insert a new sibling block immediately **before** the billing block, matching the same shape
(header with logo + admin/logout buttons, then the content). After:

```jsx
{activeTab === 'pricing' && role !== 'dispatcher' && (
  <>
    <div className="flex items-center justify-between mb-3">
      <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
      <div className="flex items-center gap-1">
        {clientData?.is_admin && (
          <button onClick={onShowAdmin} className="p-2 hover:bg-gray-700 rounded-lg" title="Admin Dashboard">
            <Settings className="w-5 h-5 text-gray-400" />
          </button>
        )}
        <button onClick={onLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
          <LogOut className="w-5 h-5 text-gray-400" />
        </button>
      </div>
    </div>
    <PricingCatalog clientId={clientData?.id} />
  </>
)}
{activeTab === 'billing' && role !== 'dispatcher' && (
  // ... existing billing block, unchanged ...
)}
```

The `role !== 'dispatcher'` guard is the same gate Billing/Settings use — it's the project's
established way of saying "owner or admin." `clientData?.is_admin` admin shortcut is preserved
to match sibling tabs.

> **Do NOT** add a `pricing` block inside the `if (isPublicDemo && ...)` branch (~line 1447).
> Public demo doesn't surface pricing — it would just confuse demo viewers.

- [ ] **Step 2.2.6: Test the dev server in browser**

```bash
cd "C:/Users/Greg/receptionist-dashboard/.claude/worktrees/invoicing-v1"
```

Then via Claude Preview: `preview_start` (runs `npm run dev` on port 3000).

Verify in browser:
1. Log in as an owner account (e.g. `gmacdonald63@gmail.com`)
2. The bottom tab bar shows a new "Pricing" tab with a Tag icon, sitting between Map and Billing
3. Tapping it shows "Your pricing catalog is empty." (no rows seeded yet)
4. Log out, log in as a dispatcher account → "Pricing" tab is NOT visible
5. Visit a public demo URL (`?demo=<token>`) → "Pricing" tab is NOT visible (demo nav)
6. Tech accounts route to `<TechDashboard />` (different file entirely) — no pricing tab there to verify
7. Open `preview_console_logs` after each role check — no React/import errors

- [ ] **Step 2.2.7: Insert a few seed rows and verify the read view**

Via MCP `execute_sql` (replace `1` with the actual owner's client_id if different — confirm
with `SELECT id, email FROM clients WHERE email = 'gmacdonald63@gmail.com';`):

```sql
INSERT INTO pricing_catalog (client_id, name, category, unit_type, unit_price, taxable, description) VALUES
  (1, 'Diagnostic Service Call', 'Diagnostics', 'each', 89.00, true, 'Standard diagnostic visit, first hour'),
  (1, 'HVAC Tune-Up', 'Maintenance', 'each', 129.00, true, 'Annual maintenance, single system'),
  (1, 'Refrigerant R-410A', 'Materials', 'pound', 95.00, true, 'Per pound, market price'),
  (1, 'Capacitor (45/5 MFD)', 'Parts', 'each', 35.00, true, 'Standard run/start capacitor'),
  (1, 'Labor — Standard', 'Labor', 'hour', 115.00, false, 'Standard hourly labor (non-emergency)');
```

Reload the page. Verify:
1. All 5 rows appear in the table
2. Search "Capacitor" filters to 1 row
3. Search "tune" filters to 1 row (case-insensitive)
4. Category dropdown lists: Diagnostics, Labor, Maintenance, Materials, Parts
5. Selecting "Labor" shows only the Labor row
6. Mark one row inactive via SQL: `UPDATE pricing_catalog SET is_active = false WHERE name = 'Capacitor (45/5 MFD)';` — verify the "Active only" checkbox toggles its visibility correctly
7. Take a screenshot via `preview_screenshot` and save to a Windows-friendly path
   (e.g. `./.claude/worktrees/invoicing-v1/.tmp/phase1-chunk2-readview.png` — create the
   `.tmp/` dir first if needed; it should already be `.gitignore`d by `.tmp` rules, but
   double-check before committing).

If anything's off, fix it before committing. Don't proceed to Chunk 3 with broken read.

- [ ] **Step 2.2.8: Commit**

```bash
git add src/DispatcherDashboard.jsx
git commit -m "feat(invoicing): wire Pricing tab into DispatcherDashboard for owner/admin

New bottom-tab entry (Tag icon) inserted between Map and Billing in the
ownerNavItems array. Content render guarded by role !== 'dispatcher' to
match sibling tabs. Verified read view with 5 seed rows: list, search,
category filter, and active-only toggle all working. Dispatcher and demo
nav arrays unchanged — Pricing is owner/admin only."
```

---

### Chunk 2 verification

- [ ] **End-to-end manual check**

With dev server running:
1. Owner role: Pricing tab visible, list renders, all filters work, empty-state shows
   when filtered to zero
2. Admin role (`is_admin = true` on clients row): Pricing tab visible
3. Dispatcher role: Pricing tab NOT visible
4. Tech role: Pricing tab NOT visible
5. No console errors at any point
6. Build succeeds: `npx vite build 2>&1 | tail -5` shows clean exit

Chunk 2 ships when all checks pass. Tear down seed data only if you want — leaving it
in helps Chunk 3 testing.

---

## Chunk 3: Pricing Catalog UI — write side

This chunk adds Add/Edit/Delete with form validation and an inline modal. After this
chunk, an owner can fully manage their catalog by hand. CSV comes in Chunk 4.

### Task 3.1: Add the Item form modal

**Files:**
- Modify: `src/PricingCatalog.jsx` (add form + write handlers)

- [ ] **Step 3.1.1: Add form state and modal scaffold to PricingCatalog**

In `PricingCatalog.jsx`, expand the component. Add these state hooks near the existing ones:

```jsx
const [showForm, setShowForm] = useState(false)
const [editingItem, setEditingItem] = useState(null)  // null = create, object = edit
const [formError, setFormError] = useState(null)
const [saving, setSaving] = useState(false)

// Service types (for the optional link dropdown). Loaded once.
const [serviceTypes, setServiceTypes] = useState([])
useEffect(() => {
  if (!clientId) return
  supabase
    .from('service_types')
    .select('id, name, category')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .order('category').order('name')
    .then(({ data }) => setServiceTypes(data || []))
}, [clientId])
```

Replace the disabled "Add Item" button with:

```jsx
<button
  onClick={() => { setEditingItem(null); setFormError(null); setShowForm(true) }}
  className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
>
  <Plus className="w-4 h-4" /> Add Item
</button>
```

Replace the disabled Edit/Delete buttons in `CatalogTable` with real handlers. Lift the
table props so it can call back into the parent for edit/delete:

```jsx
<CatalogTable
  items={visibleItems}
  onEdit={(item) => { setEditingItem(item); setFormError(null); setShowForm(true) }}
  onDelete={handleDelete}
/>
```

Extend `CatalogTable`'s existing signature by adding `onEdit` and `onDelete` — do NOT
replace the whole signature wholesale in case other props were added. After:
`function CatalogTable({ items, onEdit, onDelete })`.
Replace the disabled action buttons with:

```jsx
<button onClick={() => onEdit(it)} className="p-1.5 text-gray-300 hover:text-blue-400" title="Edit">
  <Edit2 className="w-4 h-4" />
</button>
<button onClick={() => onDelete(it)} className="p-1.5 text-gray-300 hover:text-red-400" title="Delete">
  <Trash2 className="w-4 h-4" />
</button>
```

- [ ] **Step 3.1.2: Add the handleDelete handler in PricingCatalog**

Add this function inside `PricingCatalog` (above the return):

```jsx
async function handleDelete(item) {
  if (!confirm(`Delete "${item.name}"? This cannot be undone.\n\nIf this item is referenced by future estimates or invoices, consider marking it Hidden instead.`)) {
    return
  }
  const { error } = await supabase.from('pricing_catalog').delete().eq('id', item.id)
  if (error) {
    // Postgres FK violation (23503) = item referenced by another table
    if (error.code === '23503') {
      alert(`"${item.name}" is referenced by existing estimates or invoices and cannot be deleted.\n\nMark it Hidden via Edit instead to remove it from future selections.`)
    } else {
      alert(`Delete failed: ${error.message}`)
    }
    return
  }
  setItems(prev => prev.filter(it => it.id !== item.id))
}
```

- [ ] **Step 3.1.3: Add the form modal component below `CatalogTable`**

```jsx
function CatalogItemForm({ item, serviceTypes, clientId, onSaved, onCancel, error, setError, saving, setSaving }) {
  // Initialize from item-being-edited or sensible defaults
  const [form, setForm] = useState(() => ({
    name: item?.name || '',
    description: item?.description || '',
    category: item?.category || '',
    unit_type: item?.unit_type || 'each',
    unit_price: item?.unit_price != null ? String(item.unit_price) : '',
    taxable: item?.taxable ?? true,
    tier: item?.tier || '',
    tier_group: item?.tier_group || '',
    service_type_id: item?.service_type_id || '',
    is_active: item?.is_active ?? true,
    sort_order: item?.sort_order ?? 0,
  }))

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function validate() {
    if (!form.name.trim()) return 'Name is required.'
    if (!form.unit_type.trim()) return 'Unit type is required.'
    const price = Number(form.unit_price)
    if (Number.isNaN(price) || price < 0) return 'Unit price must be a non-negative number.'
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const v = validate()
    if (v) { setError(v); return }

    setSaving(true)
    setError(null)

    const payload = {
      client_id: clientId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      unit_type: form.unit_type.trim(),
      unit_price: Number(form.unit_price),
      taxable: !!form.taxable,
      tier: form.tier.trim() || null,
      tier_group: form.tier_group.trim() || null,
      service_type_id: form.service_type_id ? Number(form.service_type_id) : null,
      is_active: !!form.is_active,
      sort_order: Number(form.sort_order) || 0,
    }

    let result
    if (item) {
      result = await supabase.from('pricing_catalog').update(payload).eq('id', item.id).select().single()
    } else {
      result = await supabase.from('pricing_catalog').insert(payload).select().single()
    }

    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    onSaved(result.data, !!item)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold text-white mb-4">
          {item ? 'Edit pricing item' : 'Add pricing item'}
        </h3>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 text-red-300 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name + Category row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name" required>
              <input type="text" value={form.name} onChange={e => update('name', e.target.value)} className={INPUT_CLS} autoFocus />
            </Field>
            <Field label="Category">
              <input type="text" value={form.category} onChange={e => update('category', e.target.value)} className={INPUT_CLS} placeholder="e.g. Diagnostics, Parts, Labor" />
            </Field>
          </div>

          <Field label="Description">
            <textarea value={form.description} onChange={e => update('description', e.target.value)} className={`${INPUT_CLS} min-h-[60px]`} rows={2} />
          </Field>

          {/* Pricing row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Unit type" required>
              <select value={form.unit_type} onChange={e => update('unit_type', e.target.value)} className={INPUT_CLS}>
                <option value="each">each</option>
                <option value="hour">hour (T&amp;M / labor)</option>
                <option value="pound">pound</option>
                <option value="foot">foot</option>
                <option value="gallon">gallon</option>
                <option value="unit">unit</option>
              </select>
            </Field>
            <Field label="Unit price ($)" required>
              <input type="number" min="0" step="0.01" value={form.unit_price} onChange={e => update('unit_price', e.target.value)} className={INPUT_CLS} />
            </Field>
            <Field label="Taxable">
              <label className="flex items-center gap-2 mt-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" checked={form.taxable} onChange={e => update('taxable', e.target.checked)} />
                Apply default tax rate
              </label>
            </Field>
          </div>

          {/* Tier row (forward-compat for Phase 2) */}
          <details className="rounded border border-gray-700 p-3 bg-gray-900/40">
            <summary className="cursor-pointer text-sm text-gray-300">Advanced — tier, link to service, sort order</summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Tier (Phase 2 good/better/best)">
                <input type="text" value={form.tier} onChange={e => update('tier', e.target.value)} className={INPUT_CLS} placeholder="good | better | best | (blank)" />
              </Field>
              <Field label="Tier group">
                <input type="text" value={form.tier_group} onChange={e => update('tier_group', e.target.value)} className={INPUT_CLS} placeholder="Groups multi-tier rows together" />
              </Field>
              <Field label="Linked service type (optional)">
                <select value={form.service_type_id} onChange={e => update('service_type_id', e.target.value)} className={INPUT_CLS}>
                  <option value="">— none —</option>
                  {serviceTypes.map(s => (
                    <option key={s.id} value={s.id}>{s.category} — {s.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sort order">
                <input type="number" value={form.sort_order} onChange={e => update('sort_order', e.target.value)} className={INPUT_CLS} />
              </Field>
            </div>
          </details>

          <Field label="Status">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={e => update('is_active', e.target.checked)} />
              Active (visible in estimate/invoice builders)
            </label>
          </Field>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-700">
            <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2 text-gray-300 hover:text-white">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Saving…' : (item ? 'Save changes' : 'Add item')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-sm text-gray-300 mb-1 block">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      {children}
    </label>
  )
}
```

Then render the modal at the end of `PricingCatalog`'s JSX, just before the closing `</div>`:

```jsx
{showForm && (
  <CatalogItemForm
    item={editingItem}
    serviceTypes={serviceTypes}
    clientId={clientId}
    error={formError}
    setError={setFormError}
    saving={saving}
    setSaving={setSaving}
    onCancel={() => { setShowForm(false); setEditingItem(null); setFormError(null) }}
    onSaved={(saved, wasEdit) => {
      setShowForm(false); setEditingItem(null); setFormError(null)
      // Re-sort after every save so a changed sort_order or a new insert
      // lands in the right position rather than always appending at the end.
      setItems(prev => {
        const updated = wasEdit
          ? prev.map(it => it.id === saved.id ? saved : it)
          : [...prev, saved]
        return [...updated].sort((a, b) =>
          (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)
        )
      })
    }}
  />
)}
```

- [ ] **Step 3.1.4: Verify build succeeds**

```bash
npx vite build 2>&1 | tail -10
```

Expected: clean build. If JSX errors, fix.

- [ ] **Step 3.1.5: Manual verification — happy path Add**

With dev server running, logged in as owner:
1. Click "Add Item"
2. Modal opens, focuses Name field
3. Fill: Name="Test Furnace Filter", Category="Parts", Unit type="each", Unit price=24.50, Taxable=on, Active=on
4. Click "Add item"
5. Modal closes, new row appears in table immediately
6. Reload page — row persists
7. `preview_screenshot` — save to a Windows-friendly path such as
   `C:/Users/Greg/receptionist-dashboard/.claude/worktrees/invoicing-v1/.tmp/phase1-chunk3-add.png`
   (create `.tmp/` if needed; it is git-ignored)

- [ ] **Step 3.1.6: Manual verification — Edit + Delete**

1. Click Edit (pencil icon) on the new row
2. Modal opens with existing values populated
3. Change price to 27.95, click Save changes
4. Row updates in place with new price
5. Click Delete (trash icon)
6. Confirm dialog appears
7. Confirm — row disappears
8. Reload — row is gone

- [ ] **Step 3.1.7: Manual verification — Validation**

1. Click Add Item
2. Click "Add item" with empty name → error "Name is required"
3. Set name, set price to "-5" → error "Unit price must be a non-negative number"
4. Set price to "abc" → same validation error
5. Set valid values → save succeeds

- [ ] **Step 3.1.8: Commit**

```bash
git add src/PricingCatalog.jsx
git commit -m "feat(invoicing): add/edit/delete pricing catalog items via modal form

Inline form modal with field validation, optional link to service_types,
forward-compat tier/tier_group fields (Phase 2). Edit pre-fills from row;
delete confirms before destruction; FK violation (23503) shows user-friendly
message instead of raw Postgres error. Save re-sorts list by (sort_order,
name) so new and edited rows land in the right position immediately.
Manually verified happy path, edit, delete, FK-guarded delete, and validation."
```

---

### Chunk 3 verification

- [ ] **Run a full smoke test**

1. Add 3 items (one per category)
2. Edit one — change price + toggle taxable
3. Mark one inactive via Edit (uncheck Active)
4. Confirm Active-only filter hides it
5. Search by partial name — filters correctly
6. Delete one — confirm dialog, then row gone
7. Build: `npx vite build 2>&1 | tail -5` clean

Chunk 3 ships when all 7 steps pass.

---

## Chunk 4: CSV import / export + tax rate Settings

This chunk adds bulk operations and the Settings field for `default_tax_rate`. After
this chunk, Phase 1 is feature-complete.

### Task 4.1: Add PapaParse dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 4.1.1: Install PapaParse**

```bash
cd C:/Users/Greg/receptionist-dashboard/.claude/worktrees/invoicing-v1
npm install papaparse@5.4.1
```

Expected: `papaparse` added to `dependencies`. Lockfile updated.

- [ ] **Step 4.1.2: Verify install**

```bash
node -e "console.log(require('papaparse').parse('a,b\n1,2', {header:true}).data)"
```

Expected: `[ { a: '1', b: '2' } ]`

- [ ] **Step 4.1.3: Commit the dep**

```bash
git add package.json package-lock.json
git commit -m "chore(invoicing): add papaparse dep for catalog CSV import/export"
```

---

### Task 4.2: Implement CSV export

**Files:**
- Modify: `src/PricingCatalog.jsx`

- [ ] **Step 4.2.1: Add the export handler**

Inside `PricingCatalog`, above the return:

```jsx
async function handleExport() {
  const Papa = (await import('papaparse')).default
  // Export ALL items (filtered or not) — let user decide via the Active-only checkbox
  // by exporting the currently visible set:
  const rows = visibleItems.map(it => ({
    name: it.name,
    description: it.description || '',
    category: it.category || '',
    unit_type: it.unit_type,
    unit_price: it.unit_price,
    taxable: it.taxable ? 'true' : 'false',
    tier: it.tier || '',
    tier_group: it.tier_group || '',
    is_active: it.is_active ? 'true' : 'false',
    sort_order: it.sort_order,
  }))
  const csv = Papa.unparse(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const today = new Date().toISOString().slice(0, 10)
  a.download = `pricing-catalog-${today}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
```

Replace the disabled "Export" button:

```jsx
<button
  onClick={handleExport}
  disabled={visibleItems.length === 0}
  className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
>
  <Download className="w-4 h-4" /> Export
</button>
```

- [ ] **Step 4.2.2: Manual verification**

1. With 3+ items in catalog, click Export
2. Browser downloads `pricing-catalog-YYYY-MM-DD.csv`
3. Open the file — header row + one row per item, columns in expected order
4. Empty catalog → button disabled

- [ ] **Step 4.2.3: Commit**

```bash
git add src/PricingCatalog.jsx
git commit -m "feat(invoicing): catalog CSV export

Exports currently-visible items (respects active-only + filters). Uses
PapaParse.unparse for proper CSV escaping. Filename includes today's date."
```

---

### Task 4.3: Implement CSV import with preview

**Files:**
- Modify: `src/PricingCatalog.jsx`

- [ ] **Step 4.3.1: Add import state**

Inside `PricingCatalog`:

```jsx
const [importPreview, setImportPreview] = useState(null)
// importPreview shape:
// {
//   rows: Array<{ raw: object, parsed: object | null, errors: string[] }>,
//   validCount: number,
//   invalidCount: number,
// }
const [importing, setImporting] = useState(false)
```

- [ ] **Step 4.3.2: Add the file-pick handler**

```jsx
async function handleImportFile(file) {
  if (!file) return
  const Papa = (await import('papaparse')).default
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
    complete: ({ data }) => {
      const rows = data.map(raw => parseCsvRow(raw))
      const validCount = rows.filter(r => r.errors.length === 0).length
      setImportPreview({ rows, validCount, invalidCount: rows.length - validCount })
    },
    error: (err) => alert(`Failed to parse CSV: ${err.message}`),
  })
}

function parseCsvRow(raw) {
  const errors = []
  const name = String(raw.name || '').trim()
  if (!name) errors.push('name required')
  const unit_type = String(raw.unit_type || 'each').trim() || 'each'
  const priceStr = String(raw.unit_price || '0').trim()
  const unit_price = Number(priceStr)
  if (Number.isNaN(unit_price) || unit_price < 0) errors.push('unit_price invalid')
  const taxable = parseBool(raw.taxable, true)
  const is_active = parseBool(raw.is_active, true)
  const sort_order = Number(raw.sort_order) || 0

  if (errors.length) return { raw, parsed: null, errors }
  return {
    raw,
    parsed: {
      name,
      description: String(raw.description || '').trim() || null,
      category: String(raw.category || '').trim() || null,
      unit_type,
      unit_price,
      taxable,
      tier: String(raw.tier || '').trim() || null,
      tier_group: String(raw.tier_group || '').trim() || null,
      is_active,
      sort_order,
    },
    errors: [],
  }
}

function parseBool(value, defaultVal) {
  if (value === undefined || value === null || value === '') return defaultVal
  const s = String(value).trim().toLowerCase()
  if (['true', 't', 'yes', 'y', '1'].includes(s)) return true
  if (['false', 'f', 'no', 'n', '0'].includes(s)) return false
  return defaultVal
}

async function commitImport() {
  if (!importPreview) return
  const validRows = importPreview.rows.filter(r => r.errors.length === 0).map(r => ({ ...r.parsed, client_id: clientId }))
  if (validRows.length === 0) { alert('No valid rows to import.'); return }
  setImporting(true)
  const { data, error } = await supabase.from('pricing_catalog').insert(validRows).select()
  setImporting(false)
  if (error) {
    alert(`Import failed: ${error.message}`)
    return
  }
  setItems(prev => [...prev, ...(data || [])])
  setImportPreview(null)
}
```

- [ ] **Step 4.3.3: Replace the disabled Import CSV button with a real file input**

```jsx
<label className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 cursor-pointer">
  <Upload className="w-4 h-4" /> Import CSV
  <input
    type="file"
    accept=".csv,text/csv"
    onChange={e => { handleImportFile(e.target.files[0]); e.target.value = '' }}
    className="hidden"
  />
</label>
```

- [ ] **Step 4.3.4: Add the preview modal**

Render below the existing form modal:

```jsx
{importPreview && (
  <ImportPreviewModal
    preview={importPreview}
    importing={importing}
    onCommit={commitImport}
    onCancel={() => setImportPreview(null)}
  />
)}
```

Add the component at file bottom:

```jsx
function ImportPreviewModal({ preview, importing, onCommit, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold text-white mb-2">Import preview</h3>
        <p className="text-sm text-gray-400 mb-4">
          {preview.validCount} valid {preview.validCount === 1 ? 'row' : 'rows'},{' '}
          <span className={preview.invalidCount > 0 ? 'text-red-400' : 'text-gray-500'}>
            {preview.invalidCount} invalid
          </span>
          . Only valid rows will be imported.
        </p>

        <div className="overflow-x-auto rounded border border-gray-700 mb-4 max-h-[50vh]">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-900 text-gray-300 uppercase sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-left">Category</th>
                <th className="px-2 py-2 text-left">Unit</th>
                <th className="px-2 py-2 text-right">Price</th>
                <th className="px-2 py-2 text-left">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700 bg-gray-900/40">
              {preview.rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">
                    {r.errors.length === 0
                      ? <span className="text-green-400">✓</span>
                      : <span className="text-red-400">✗</span>}
                  </td>
                  <td className="px-2 py-1.5 text-gray-200">{r.raw.name || <span className="text-red-400 italic">(missing)</span>}</td>
                  <td className="px-2 py-1.5 text-gray-300">{r.raw.category || ''}</td>
                  <td className="px-2 py-1.5 text-gray-300">{r.raw.unit_type || ''}</td>
                  <td className="px-2 py-1.5 text-right text-gray-300 tabular-nums">{r.raw.unit_price || ''}</td>
                  <td className="px-2 py-1.5 text-red-400">{r.errors.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-700">
          <button onClick={onCancel} disabled={importing} className="px-4 py-2 text-gray-300 hover:text-white">
            Cancel
          </button>
          <button
            onClick={onCommit}
            disabled={importing || preview.validCount === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            {importing ? 'Importing…' : `Import ${preview.validCount} ${preview.validCount === 1 ? 'row' : 'rows'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4.3.5: Manual verification with a real CSV**

Create the test file at a Windows-friendly path — e.g.
`C:/Users/Greg/receptionist-dashboard/.claude/worktrees/invoicing-v1/.tmp/test-import.csv`
(create the `.tmp/` directory first if needed):


```
name,description,category,unit_type,unit_price,taxable,is_active,sort_order
"Compressor Replacement","Full compressor R&R","Equipment",each,1850.00,true,true,10
"Coolant Recharge","R-410A 5lb",Materials,pound,95.00,true,true,20
"Bad Row Missing Name","",Parts,each,50.00,true,true,30
"Bad Row Negative","",Parts,each,-10.00,true,true,40
```

In browser:
1. Click Import CSV → pick the file
2. Preview modal opens — 4 rows total, 2 valid (✓), 2 invalid (✗)
3. Issues column shows: row 3 "name required", row 4 "unit_price invalid"
4. Click "Import 2 rows" → modal closes, 2 new rows appear in table
5. Reload — rows persist
6. Check that the 2 invalid rows are NOT in the database via SQL

- [ ] **Step 4.3.6: Edge case — empty CSV**

Create `.tmp/empty.csv` (same directory as test-import.csv) with only the header row
and no data rows. Import → preview shows 0 rows, Import button disabled.

- [ ] **Step 4.3.7: Edge case — malformed CSV**

Create `.tmp/garbage.csv` with contents `not,a,valid,csv` followed by `"unclosed quote`.
Import → either parse succeeds with weird data (which validation rejects) or alert shows
parse error. Either is acceptable — what's not acceptable is an uncaught exception.

- [ ] **Step 4.3.8: Commit**

```bash
git add src/PricingCatalog.jsx
git commit -m "feat(invoicing): catalog CSV import with validation preview

User picks a file, sees per-row preview with validation status, then
clicks to commit only valid rows. Bad rows (missing name, negative price)
flagged but never sent to server. PapaParse handles parsing; client_id
attached at insert time so RLS can't be bypassed."
```

---

### Task 4.4: Add default_tax_rate to Settings

> **File correction:** CLAUDE.md is stale on this point. Settings rendering is in
> `src/DispatcherDashboard.jsx` via a `renderSettings()` function defined there, called at
> `{activeTab === 'settings' && role !== 'dispatcher' && ... {renderSettings()} }`.
> **Do NOT edit `src/App.jsx` for this task.**

**Files:**
- Modify: `src/DispatcherDashboard.jsx` (the `renderSettings` function + its local state)

- [ ] **Step 4.4.1: Locate the Settings form in DispatcherDashboard.jsx**

Open `src/DispatcherDashboard.jsx` and search for `appointment_duration` — this string
appears in the Settings form's field list and its surrounding state. Confirm:

1. **State variable** — where `appointment_duration` is stored locally (likely a `useState`
   hook or a `settings` object). Note the exact state variable name and setter.
2. **Load** — where `clientData` values are spread into that state (e.g. on component mount
   or when `clientData` prop changes). This is where you'll add `default_tax_rate`.
3. **Save** — where the settings object is written back to Supabase (`.update({...})`).
   This is where you'll add `default_tax_rate` to the payload.
4. **Form JSX** — the `renderSettings()` function body. This is where you'll add the field UI.

Don't proceed to Step 4.4.2 until you've confirmed all four locations.

- [ ] **Step 4.4.2: Include default_tax_rate in state initialization and save payload**

In the **load** location (where `clientData` values seed local state), add:

```js
default_tax_rate: clientData?.default_tax_rate ?? 0,
```

In the **save** location (the `.update()` payload), add:

```js
default_tax_rate: settings.default_tax_rate,
```

(Replace `settings.default_tax_rate` with whatever the actual state path is — adapt to
match the existing pattern.)

- [ ] **Step 4.4.3: Add a tax rate field to the form UI**

In `renderSettings()`'s JSX, insert the field near other money/numeric fields
(`appointment_duration`, `buffer_time`, etc.). UI:

```jsx
<div className="space-y-1">
  <label className="text-sm text-gray-300">Default sales tax rate</label>
  <div className="flex items-center gap-2">
    <input
      type="number"
      min="0"
      max="20"
      step="0.001"
      value={(Number(settings.default_tax_rate || 0) * 100).toFixed(3)}
      onChange={e => {
        const pct = Number(e.target.value)
        // store as decimal (0.0875 = 8.75%)
        setSettings(prev => ({ ...prev, default_tax_rate: Number((pct / 100).toFixed(5)) }))
      }}
      className="w-24 px-2.5 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
    />
    <span className="text-gray-400 text-sm">%</span>
  </div>
  <p className="text-xs text-gray-500">
    Applied to taxable line items on estimates and invoices.
    Per-line taxable flag on each catalog item determines what gets taxed.
  </p>
</div>
```

(The exact local state variable names — `settings`, `setSettings` — must match what's
already in the file. Adapt.)

- [ ] **Step 4.4.4: Verify save persists**

In browser, as owner:
1. Open Settings tab
2. Set tax rate to 8.75%
3. Save (whatever existing save button)
4. Reload page → tax rate still shows 8.75%
5. Verify via SQL: `SELECT default_tax_rate FROM clients WHERE id = 1;` returns `0.08750`
6. Set to 0% → saves as `0`
7. Set to 100 (out of range) → either UI clamps to 20 (max attribute) or DB CHECK rejects with helpful error

- [ ] **Step 4.4.5: Commit**

```bash
git add src/DispatcherDashboard.jsx
git commit -m "feat(invoicing): add default_tax_rate field to Settings

Stored as decimal (0.0875), edited as percent (8.75%). UI conversion
in onChange handler. Field documented inline so user understands
relationship to per-line taxable flag in catalog."
```

---

### Chunk 4 verification

- [ ] **End-to-end Phase 1 acceptance test**

Owner end-to-end flow:
1. Log in as owner
2. Settings → set tax rate to 8.75% → save → reload → still 8.75
3. Pricing tab → empty catalog (or whatever's there)
4. Add 3 items via the form — different categories, different unit types, mix of taxable/non-taxable
5. Search filter narrows to 1 item
6. Category filter narrows to 1 item
7. Edit one item — change name + price + taxable flag → row updates in place
8. Mark one item Hidden via Edit → with Active-only checked, it disappears; uncheck → it returns marked Hidden
9. Export CSV → file downloads, contents match what's in the table
10. Modify the exported CSV (add 2 new rows, mess up one with negative price), re-import
11. Preview shows correct valid/invalid split, only valid rows commit
12. Delete one item → confirm, gone, reload confirms

Build clean: `npx vite build 2>&1 | tail -5` shows success.
No console errors at any point.

If all 12 steps pass, Phase 1 is complete.

---

## Phase 1 done — what to do next

- [ ] **Push the branch and open a PR**

```bash
# Confirm you're on the right branch before pushing
git branch --show-current    # expected: claude/invoicing-v1
git log --oneline -5         # sanity-check commits look right

git push -u origin claude/invoicing-v1
gh pr create --base main --title "Invoicing Phase 1 — Pricing Catalog" --body "$(cat <<'EOF'
## Summary
- New `pricing_catalog` table with per-client RLS, tax flag, unit-of-measure, optional service_types linkage, and forward-compat tier fields for Phase 2 good/better/best.
- `clients.default_tax_rate` column for shop-level default sales tax rate.
- New "Pricing" tab visible to owner/admin roles only — list / search / filter / add / edit / delete / CSV import / CSV export.
- No new Edge Functions; all CRUD via Supabase REST + RLS.
- One new dep: `papaparse@5.4.1` (catalog import/export).

Detailed plan: `docs/superpowers/plans/2026-04-26-invoicing-phase-1-catalog.md`
Roadmap (all 4 phases): `docs/superpowers/plans/2026-04-26-invoicing-estimates-roadmap.md`
Spec: `docs/superpowers/specs/2026-04-26-invoicing-estimates-spec.md`

## Test plan
- [ ] Owner can add/edit/delete catalog items
- [ ] Search and category filters work
- [ ] CSV export round-trips through CSV import
- [ ] Invalid rows (missing name, negative price) rejected at preview
- [ ] Tax rate persists through Settings save + page reload
- [ ] Tech and dispatcher roles do NOT see the Pricing tab
- [ ] RLS blocks cross-client writes (verified via direct API call)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Update the roadmap with what shipped + any deviations from plan**

If anything in the implementation diverged from this plan, write a 1-paragraph "actual
implementation notes" section at the bottom of the roadmap doc. The Phase 2 planner will
read it.

- [ ] **Hand off to user for acceptance test before merging.**

The user should run through the 12-step Phase 1 acceptance test in their own browser
before this PR merges. Don't merge unilaterally.

---

## Open follow-ups for Phase 2 (do not implement now)

These came up while planning Phase 1 and should be considered when writing the Phase 2 plan:

1. **Should `tier_group` reference an explicit `pricing_groups` table instead of being a free-text key?** Pros: integrity, easier rename. Cons: more migrations, more joins. Phase 2 estimate UI might inform this.

2. **CSV import currently has no "update existing row" mode.** Today, importing a row with the same name as an existing one creates a duplicate. Phase 2 may want an upsert mode keyed on (name, category) — but this adds complexity. Wait until a user asks.

3. **Multi-tenant `service_types` linkage.** Catalog items can link to `service_types(id)` but RLS doesn't currently restrict the dropdown — the linked service_type happens to be loaded only for the current client (because we filter by `client_id` in the loader), but the FK itself doesn't enforce same-client. Consider adding a CHECK or DB-level cross-table constraint if this becomes a problem in Phase 2.

4. **`default_tax_rate` is a single rate per client.** Some shops operate in multiple jurisdictions (e.g., service multiple cities with different rates). If a shop hits this, Phase 2 might add per-customer or per-zip tax overrides. Don't preempt.

5. **No audit trail.** Edits to pricing aren't logged. If shops want change history, that's a separate cross-cutting feature — flag it but don't build it in Phase 2 unless explicitly requested.
