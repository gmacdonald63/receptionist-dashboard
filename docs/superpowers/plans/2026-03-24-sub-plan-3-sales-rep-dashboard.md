I now have all the context I need. Here is the complete Sub-Plan 3 implementation plan:

---

# Sub-Plan 3: Sales Rep Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sales reps get a purpose-built dashboard to create deals, view their deal pipeline, track commission records, and launch the demo view. Authentication routing in `App.jsx` detects `is_sales_rep = true` and redirects to the rep dashboard instead of the main client dashboard. Supabase RLS policies ensure reps can only read their own deals and commissions. Admin.jsx gains `commission_option` and `is_sales_rep` fields in the rep creation form.

**Architecture:** A new `SalesRepDashboard.jsx` component is the rep's entire experience. It fetches deals and commissions directly from Supabase using the current session (RLS enforces row isolation). Deal creation calls the existing `create-deal` edge function (from Sub-Plan 2) with the user's JWT. The "Show Demo" button replicates the existing demo token flow that sales reps previously used automatically. App.jsx inserts a single routing check after `clientData` loads.

**Tech Stack:** React 18 + Tailwind CSS dark theme, Lucide icons, Supabase JS client, vanilla `useState`/`useEffect` (no form libraries, no router). RLS migration in a new SQL file.

**Spec reference:** `docs/superpowers/plans/2026-03-24-sales-rep-commission-system-spec.md` — Sections 4 (commission structure), 5 (Phase 2), 6.2–6.3 (schema), 8.2 (rep dashboard), 11 (Sub-Plan 3 scope)

---

## Prerequisites

Before starting, confirm:
- [ ] Sub-Plan 1 is complete (`deals` + `commissions` tables exist, RLS is enabled on both, `src/utils/commissions.js` exists)
- [ ] Sub-Plan 2 is complete (`create-deal` edge function is deployed and returns `{ deal_id, onboarding_url }`)
- [ ] At least one test sales rep account exists in `clients` with `is_sales_rep = true` and `commission_option` set (create via Supabase dashboard or Admin panel after Task 6)
- [ ] Dev server is running: `npm run dev` from the worktree root

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260324_sales_rep_rls_policies.sql` | RLS policies for deals + commissions. Reps read own rows; admins read/update all. |
| Create | `src/pages/SalesRepDashboard.jsx` | The complete rep dashboard — new deal form, deals pipeline, commissions section, Show Demo button. |
| Create | `src/utils/repDashboard.js` | Pure helpers: format currency, format deal status label + color, calculate commission totals. |
| Create | `src/utils/repDashboard.test.js` | Vitest unit tests for all pure helpers. |
| Modify | `src/App.jsx` | Add sales rep routing block after the `showAdmin` check. Remove old `clientData.role === 'sales_rep'` auto-demo logic. |
| Modify | `src/Admin.jsx` | Add `is_sales_rep = true` and `commission_option` (1 or 2) to the rep insert in `handleSaveRep`. Add commission option selector to the rep add/edit modal. |

---

## Chunk 1: Database — RLS Policies

### Task 1: RLS migration for deals and commissions

**Files:**
- Create: `supabase/migrations/20260324_sales_rep_rls_policies.sql`

The `deals` and `commissions` tables have RLS enabled (done in Sub-Plan 1) but no policies yet — meaning no authenticated user can currently read them. This migration adds:

1. A rep-scoped SELECT policy on `deals` — reps can see their own rows
2. A rep-scoped SELECT policy on `commissions` — reps can see their own rows
3. An admin SELECT policy on both tables — admins can see everything
4. An admin UPDATE policy on `commissions` — Greg can mark commissions as paid

The critical constraint: `clients.id` is BIGINT, `auth.uid()` is UUID. They cannot be compared directly. The policy must join through `clients.email` — the authenticated user's email is available via `auth.jwt() ->> 'email'` (Supabase populates the JWT with email when using Supabase Auth).

- [ ] **Step 1: Write and apply the migration**

```sql
-- supabase/migrations/20260324_sales_rep_rls_policies.sql
-- ============================================================
-- Sub-Plan 3: RLS policies for deals and commissions
--
-- RLS is already ENABLED on both tables (done in Sub-Plan 1).
-- Edge functions use service role and bypass RLS automatically.
--
-- Key constraint: clients.id is BIGINT; auth.uid() is UUID.
-- We join via email: auth.jwt() ->> 'email' matches clients.email.
-- ============================================================


-- ── Helper: get the clients.id of the authenticated user ──────
-- Used in multiple policies. Inline subquery approach for clarity.


-- ── DEALS: rep can SELECT their own deals ─────────────────────
DROP POLICY IF EXISTS "Reps can view their own deals" ON deals;
CREATE POLICY "Reps can view their own deals"
  ON deals
  FOR SELECT
  TO authenticated
  USING (
    rep_id = (
      SELECT id FROM clients
      WHERE email = auth.jwt() ->> 'email'
      LIMIT 1
    )
  );


-- ── DEALS: admin can SELECT all deals ─────────────────────────
DROP POLICY IF EXISTS "Admins can view all deals" ON deals;
CREATE POLICY "Admins can view all deals"
  ON deals
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE email = auth.jwt() ->> 'email'
        AND is_admin = true
    )
  );


-- ── COMMISSIONS: rep can SELECT their own commissions ──────────
DROP POLICY IF EXISTS "Reps can view their own commissions" ON commissions;
CREATE POLICY "Reps can view their own commissions"
  ON commissions
  FOR SELECT
  TO authenticated
  USING (
    rep_id = (
      SELECT id FROM clients
      WHERE email = auth.jwt() ->> 'email'
      LIMIT 1
    )
  );


-- ── COMMISSIONS: admin can SELECT all commissions ─────────────
DROP POLICY IF EXISTS "Admins can view all commissions" ON commissions;
CREATE POLICY "Admins can view all commissions"
  ON commissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE email = auth.jwt() ->> 'email'
        AND is_admin = true
    )
  );


-- ── COMMISSIONS: admin can UPDATE all commissions ─────────────
-- Used by Sub-Plan 4 "Mark as Paid" action.
DROP POLICY IF EXISTS "Admins can update all commissions" ON commissions;
CREATE POLICY "Admins can update all commissions"
  ON commissions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE email = auth.jwt() ->> 'email'
        AND is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients
      WHERE email = auth.jwt() ->> 'email'
        AND is_admin = true
    )
  );
```

- [ ] **Step 2: Apply the migration via Supabase CLI**

```bash
cd /c/Users/Greg/receptionist-dashboard/.claude/worktrees/sales-commission-system

SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
npx supabase db push --project-ref zmppdmfdhknnwzwdfhwf
```

Expected: migration applied with no errors.

- [ ] **Step 3: Verify policies exist**

```bash
curl -s \
  "https://zmppdmfdhknnwzwdfhwf.supabase.co/rest/v1/rpc/pg_policies" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs" | head -5
```

Or check in Supabase dashboard: Authentication > Policies > `deals` and `commissions` should each show 2 SELECT policies.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260324_sales_rep_rls_policies.sql
git commit -m "feat: add RLS policies for deals and commissions (rep + admin scopes)"
```

---

## Chunk 2: Pure Logic Helpers + Tests

### Task 2: Pure helper functions

**Files:**
- Create: `src/utils/repDashboard.js`
- Create: `src/utils/repDashboard.test.js`

These functions have no side effects — pure inputs to outputs. Write tests first.

- [ ] **Step 1: Write the failing tests**

```javascript
// src/utils/repDashboard.test.js
import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  getDealStatusConfig,
  getCommissionStatusConfig,
  calcCommissionTotals,
  formatPlanLabel,
} from './repDashboard.js';

describe('formatCurrency', () => {
  it('formats a whole dollar amount', () => {
    expect(formatCurrency(495)).toBe('$495.00');
  });

  it('formats cents correctly', () => {
    expect(formatCurrency(247.5)).toBe('$247.50');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats a string-numeric value', () => {
    expect(formatCurrency('69.50')).toBe('$69.50');
  });
});

describe('getDealStatusConfig', () => {
  it('returns yellow config for onboarding_sent', () => {
    const cfg = getDealStatusConfig('onboarding_sent');
    expect(cfg.label).toBe('Onboarding Sent');
    expect(cfg.badgeClass).toContain('yellow');
  });

  it('returns blue config for setup_in_progress', () => {
    const cfg = getDealStatusConfig('setup_in_progress');
    expect(cfg.label).toBe('Setup in Progress');
    expect(cfg.badgeClass).toContain('blue');
  });

  it('returns green config for active', () => {
    const cfg = getDealStatusConfig('active');
    expect(cfg.label).toBe('Active');
    expect(cfg.badgeClass).toContain('green');
  });

  it('returns red config for cancelled', () => {
    const cfg = getDealStatusConfig('cancelled');
    expect(cfg.label).toBe('Cancelled');
    expect(cfg.badgeClass).toContain('red');
  });

  it('returns gray config for unknown status', () => {
    const cfg = getDealStatusConfig('unknown_status');
    expect(cfg.label).toBe('Unknown');
    expect(cfg.badgeClass).toContain('gray');
  });
});

describe('getCommissionStatusConfig', () => {
  it('returns gray config for pending', () => {
    const cfg = getCommissionStatusConfig('pending');
    expect(cfg.label).toBe('Pending');
    expect(cfg.badgeClass).toContain('gray');
  });

  it('returns yellow config for due', () => {
    const cfg = getCommissionStatusConfig('due');
    expect(cfg.label).toBe('Due');
    expect(cfg.badgeClass).toContain('yellow');
  });

  it('returns green config for paid', () => {
    const cfg = getCommissionStatusConfig('paid');
    expect(cfg.label).toBe('Paid');
    expect(cfg.badgeClass).toContain('green');
  });

  it('returns red config for voided', () => {
    const cfg = getCommissionStatusConfig('voided');
    expect(cfg.label).toBe('Voided');
    expect(cfg.badgeClass).toContain('red');
  });
});

describe('calcCommissionTotals', () => {
  const commissions = [
    { amount: '495.00', status: 'paid' },
    { amount: '247.50', status: 'due' },
    { amount: '49.50', status: 'pending' },
    { amount: '49.50', status: 'voided' },
  ];

  it('sums paid commissions as totalEarned', () => {
    const { totalEarned } = calcCommissionTotals(commissions);
    expect(totalEarned).toBe(495.00);
  });

  it('sums due commissions as totalDue', () => {
    const { totalDue } = calcCommissionTotals(commissions);
    expect(totalDue).toBe(247.50);
  });

  it('sums pending commissions as totalPending', () => {
    const { totalPending } = calcCommissionTotals(commissions);
    expect(totalPending).toBe(49.50);
  });

  it('excludes voided commissions from all totals', () => {
    const { totalEarned, totalDue, totalPending } = calcCommissionTotals(commissions);
    expect(totalEarned + totalDue + totalPending).toBe(792.00);
  });

  it('returns zeros for an empty array', () => {
    const { totalEarned, totalDue, totalPending } = calcCommissionTotals([]);
    expect(totalEarned).toBe(0);
    expect(totalDue).toBe(0);
    expect(totalPending).toBe(0);
  });
});

describe('formatPlanLabel', () => {
  it('formats standard monthly', () => {
    expect(formatPlanLabel('standard', 'monthly')).toBe('Standard / Monthly');
  });

  it('formats pro annual', () => {
    expect(formatPlanLabel('pro', 'annual')).toBe('Pro / Annual');
  });

  it('capitalizes the plan name', () => {
    expect(formatPlanLabel('standard', 'annual')).toBe('Standard / Annual');
  });
});
```

- [ ] **Step 2: Run tests — confirm they all fail (red)**

```bash
cd /c/Users/Greg/receptionist-dashboard/.claude/worktrees/sales-commission-system
npx vitest run src/utils/repDashboard.test.js 2>&1 | tail -20
```

Expected: all tests fail with "Cannot find module './repDashboard.js'".

- [ ] **Step 3: Write the implementation**

```javascript
// src/utils/repDashboard.js

/**
 * Format a numeric (or string-numeric) value as a USD currency string.
 * @param {number|string} amount
 * @returns {string} e.g. "$247.50"
 */
export function formatCurrency(amount) {
  return '$' + parseFloat(amount).toFixed(2);
}

/**
 * Get display config for a deal status value.
 * @param {string} status - 'onboarding_sent' | 'setup_in_progress' | 'active' | 'cancelled'
 * @returns {{ label: string, badgeClass: string }}
 */
export function getDealStatusConfig(status) {
  switch (status) {
    case 'onboarding_sent':
      return { label: 'Onboarding Sent', badgeClass: 'bg-yellow-900 text-yellow-300' };
    case 'setup_in_progress':
      return { label: 'Setup in Progress', badgeClass: 'bg-blue-900 text-blue-300' };
    case 'active':
      return { label: 'Active', badgeClass: 'bg-green-900 text-green-300' };
    case 'cancelled':
      return { label: 'Cancelled', badgeClass: 'bg-red-900 text-red-300' };
    default:
      return { label: 'Unknown', badgeClass: 'bg-gray-700 text-gray-300' };
  }
}

/**
 * Get display config for a commission status value.
 * @param {string} status - 'pending' | 'due' | 'paid' | 'voided'
 * @returns {{ label: string, badgeClass: string }}
 */
export function getCommissionStatusConfig(status) {
  switch (status) {
    case 'pending':
      return { label: 'Pending', badgeClass: 'bg-gray-700 text-gray-300' };
    case 'due':
      return { label: 'Due', badgeClass: 'bg-yellow-900 text-yellow-300' };
    case 'paid':
      return { label: 'Paid', badgeClass: 'bg-green-900 text-green-300' };
    case 'voided':
      return { label: 'Voided', badgeClass: 'bg-red-900 text-red-300' };
    default:
      return { label: 'Unknown', badgeClass: 'bg-gray-700 text-gray-300' };
  }
}

/**
 * Calculate running totals across an array of commission records.
 * Voided commissions are excluded from all totals.
 * @param {Array<{ amount: number|string, status: string }>} commissions
 * @returns {{ totalEarned: number, totalDue: number, totalPending: number }}
 */
export function calcCommissionTotals(commissions) {
  let totalEarned = 0;
  let totalDue = 0;
  let totalPending = 0;

  for (const c of commissions) {
    const amount = parseFloat(c.amount);
    if (c.status === 'paid') totalEarned += amount;
    else if (c.status === 'due') totalDue += amount;
    else if (c.status === 'pending') totalPending += amount;
    // voided: excluded from all totals
  }

  return { totalEarned, totalDue, totalPending };
}

/**
 * Format a plan + billing cycle as a human-readable label.
 * @param {string} plan - 'standard' | 'pro'
 * @param {string} billingCycle - 'monthly' | 'annual'
 * @returns {string} e.g. "Standard / Monthly"
 */
export function formatPlanLabel(plan, billingCycle) {
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const cycleLabel = billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1);
  return `${planLabel} / ${cycleLabel}`;
}
```

- [ ] **Step 4: Run tests — confirm they all pass (green)**

```bash
npx vitest run src/utils/repDashboard.test.js 2>&1 | tail -15
```

Expected: `Tests 20 passed (20)` (or similar — count may vary by exact test case count).

- [ ] **Step 5: Commit**

```bash
git add src/utils/repDashboard.js src/utils/repDashboard.test.js
git commit -m "feat: add rep dashboard pure helpers with tests (formatCurrency, status configs, commission totals)"
```

---

## Chunk 3: SalesRepDashboard Component

### Task 3: SalesRepDashboard.jsx — Complete component

**Files:**
- Create: `src/pages/SalesRepDashboard.jsx`

This is the full rep experience. Three sections stacked vertically on mobile, with the logo header and a sign-out button. The Show Demo button triggers the same demo flow the previous `sales_rep` auto-demo used — but now it's manual/on-demand.

- [ ] **Step 1: Create the component**

```jsx
// src/pages/SalesRepDashboard.jsx
import React, { useState, useEffect } from 'react';
import {
  Plus, Copy, Check, RefreshCw, LogOut, ChevronDown, ChevronUp,
  DollarSign, Link, Briefcase, TrendingUp, Play
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import {
  formatCurrency,
  getDealStatusConfig,
  getCommissionStatusConfig,
  calcCommissionTotals,
  formatPlanLabel,
} from '../utils/repDashboard';

const SUPABASE_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';

// ── Section toggle component ────────────────────────────────────
const Section = ({ title, icon: Icon, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-750"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-gray-400" />}
          <span className="font-semibold text-white">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="p-4 pt-0 border-t border-gray-700">{children}</div>}
    </div>
  );
};

// ── Status badge ────────────────────────────────────────────────
const Badge = ({ config }) => (
  <span className={`px-2 py-1 rounded text-xs font-medium ${config.badgeClass}`}>
    {config.label}
  </span>
);

// ── Commission option label helper ──────────────────────────────
const commissionOptionLabel = (option) => {
  if (option === 1) return 'Option 1 — Full Upfront';
  if (option === 2) return 'Option 2 — Split + Residual';
  return 'Not set';
};

// ── Main component ──────────────────────────────────────────────
const SalesRepDashboard = ({ clientData, onLogout, onShowDemo }) => {
  // ── Form state ──────────────────────────────────────────────
  const [form, setForm] = useState({
    client_name: '',
    client_email: '',
    client_phone: '',
    company_name: '',
    plan: 'standard',
    billing_cycle: 'monthly',
  });
  const [formError, setFormError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState(null);
  const [copied, setCopied] = useState(false);

  // ── Data state ──────────────────────────────────────────────
  const [deals, setDeals] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);

  // ── Expanded deal in commissions section ────────────────────
  const [expandedDealId, setExpandedDealId] = useState(null);

  // ── Load deals and commissions on mount ─────────────────────
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [dealsResult, commissionsResult] = await Promise.all([
        supabase
          .from('deals')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('commissions')
          .select('*')
          .order('month_number', { ascending: true }),
      ]);

      if (dealsResult.error) throw dealsResult.error;
      if (commissionsResult.error) throw commissionsResult.error;

      setDeals(dealsResult.data || []);
      setCommissions(commissionsResult.data || []);
    } catch (err) {
      console.error('Failed to fetch rep data:', err);
      setDataError('Failed to load your data. Please refresh.');
    } finally {
      setDataLoading(false);
    }
  };

  // ── Form field update ────────────────────────────────────────
  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  // ── Validate form before submit ──────────────────────────────
  const validateForm = () => {
    if (!form.client_name.trim()) return 'Client name is required.';
    if (!form.client_email.trim()) return 'Client email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.client_email.trim())) return 'Enter a valid email address.';
    if (!form.company_name.trim()) return 'Company name is required.';
    return null;
  };

  // ── Generate onboarding link ─────────────────────────────────
  const handleGenerateLink = async () => {
    const validationError = validateForm();
    if (validationError) { setFormError(validationError); return; }

    setFormError(null);
    setGenerating(true);
    setGeneratedLink(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-deal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          client_name: form.client_name.trim(),
          client_email: form.client_email.trim().toLowerCase(),
          client_phone: form.client_phone.trim() || undefined,
          company_name: form.company_name.trim(),
          plan: form.plan,
          billing_cycle: form.billing_cycle,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create deal');

      setGeneratedLink(data.onboarding_url);
      // Reset form
      setForm({ client_name: '', client_email: '', client_phone: '', company_name: '', plan: 'standard', billing_cycle: 'monthly' });
      // Refresh deals list
      fetchData();
    } catch (err) {
      console.error('Generate link error:', err);
      setFormError(err.message || 'Failed to generate link. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  // ── Copy link to clipboard ───────────────────────────────────
  const handleCopy = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for browsers without clipboard API
      const el = document.createElement('textarea');
      el.value = generatedLink;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  // ── Commissions grouped by deal ──────────────────────────────
  const commissionsByDeal = deals.reduce((acc, deal) => {
    acc[deal.id] = commissions.filter(c => c.deal_id === deal.id);
    return acc;
  }, {});

  const dealsWithCommissions = deals.filter(d => (commissionsByDeal[d.id] || []).length > 0);

  // ── Running totals across ALL commissions ────────────────────
  const { totalEarned, totalDue, totalPending } = calcCommissionTotals(commissions);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 pb-12">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-white font-semibold text-sm">
              {clientData?.company_name || 'Sales Rep Dashboard'}
            </p>
            <p className="text-gray-500 text-xs">{clientData?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Show Demo button */}
            <button
              onClick={onShowDemo}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-700 text-white rounded-lg hover:bg-purple-600 text-sm font-medium"
              title="Preview the client dashboard demo"
            >
              <Play className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Show Demo</span>
            </button>
            <button
              onClick={onLogout}
              className="p-2 hover:bg-gray-800 rounded-lg"
              title="Sign out"
            >
              <LogOut className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">

        {/* ── Section A: New Deal Form ──────────────────────── */}
        <Section title="New Deal" icon={Plus} defaultOpen={true}>
          <div className="space-y-4 pt-4">
            {/* Commission option shown read-only */}
            <div className="p-3 bg-gray-750 rounded-lg border border-gray-600">
              <p className="text-xs text-gray-400 mb-0.5">Your commission</p>
              <p className="text-white text-sm font-medium">
                {commissionOptionLabel(clientData?.commission_option)}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">Client Name *</label>
                <input
                  type="text"
                  value={form.client_name}
                  onChange={e => setField('client_name', e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Client Email *</label>
                <input
                  type="email"
                  value={form.client_email}
                  onChange={e => setField('client_email', e.target.value)}
                  placeholder="jane@acmehvac.com"
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Client Phone</label>
                <input
                  type="tel"
                  value={form.client_phone}
                  onChange={e => setField('client_phone', e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Company Name *</label>
                <input
                  type="text"
                  value={form.company_name}
                  onChange={e => setField('company_name', e.target.value)}
                  placeholder="Acme HVAC"
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            {/* Plan selector */}
            <div>
              <label className="block text-gray-400 text-sm mb-1">Plan *</label>
              <select
                value={form.plan}
                onChange={e => setField('plan', e.target.value)}
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
              >
                <option value="standard">Standard — $495/mo</option>
                <option value="pro">Pro — $695/mo</option>
              </select>
            </div>

            {/* Billing cycle radio */}
            <div>
              <label className="block text-gray-400 text-sm mb-2">Billing Cycle *</label>
              <div className="flex gap-3">
                {['monthly', 'annual'].map(cycle => (
                  <label key={cycle} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="billing_cycle"
                      value={cycle}
                      checked={form.billing_cycle === cycle}
                      onChange={() => setField('billing_cycle', cycle)}
                      className="accent-blue-500"
                    />
                    <span className="text-white text-sm capitalize">
                      {cycle}
                      {cycle === 'annual' && (
                        <span className="ml-1 text-xs text-green-400">+$200 bonus</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {formError && (
              <p className="text-red-400 text-sm">{formError}</p>
            )}

            <button
              onClick={handleGenerateLink}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {generating
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating...</>
                : <><Link className="w-4 h-4" /> Generate Onboarding Link</>
              }
            </button>

            {/* Generated link output */}
            {generatedLink && (
              <div className="mt-3 p-4 bg-green-900/30 border border-green-700 rounded-lg space-y-3">
                <p className="text-green-300 text-sm font-medium">Onboarding link ready — copy and send to the client:</p>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    readOnly
                    value={generatedLink}
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm font-mono truncate"
                    onClick={e => e.target.select()}
                  />
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm whitespace-nowrap"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* ── Section B: My Deals Pipeline ─────────────────────── */}
        <Section title="My Deals" icon={Briefcase} defaultOpen={true}>
          {dataLoading ? (
            <div className="py-6 text-center">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">Loading deals...</p>
            </div>
          ) : dataError ? (
            <div className="py-6 text-center">
              <p className="text-red-400 text-sm">{dataError}</p>
              <button onClick={fetchData} className="mt-2 text-blue-400 text-sm underline">Try again</button>
            </div>
          ) : deals.length === 0 ? (
            <div className="py-8 text-center">
              <Briefcase className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No deals yet.</p>
              <p className="text-gray-500 text-xs mt-1">Use the New Deal form above to create your first deal.</p>
            </div>
          ) : (
            <div className="pt-4 space-y-2">
              {/* Column headers — desktop only */}
              <div className="hidden sm:grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-3 px-1 pb-1 border-b border-gray-700">
                <p className="text-gray-500 text-xs uppercase tracking-wide">Client</p>
                <p className="text-gray-500 text-xs uppercase tracking-wide">Company</p>
                <p className="text-gray-500 text-xs uppercase tracking-wide">Plan</p>
                <p className="text-gray-500 text-xs uppercase tracking-wide">Status</p>
                <p className="text-gray-500 text-xs uppercase tracking-wide">Created</p>
              </div>

              {deals.map(deal => {
                const statusCfg = getDealStatusConfig(deal.status);
                const createdDate = new Date(deal.created_at).toLocaleDateString('en-CA');
                return (
                  <div key={deal.id} className="bg-gray-750 rounded-lg p-3 border border-gray-600">
                    {/* Mobile layout: stacked */}
                    <div className="sm:hidden space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-white font-medium text-sm">{deal.client_name}</p>
                        <Badge config={statusCfg} />
                      </div>
                      <p className="text-gray-400 text-xs">{deal.company_name}</p>
                      <div className="flex items-center justify-between">
                        <p className="text-gray-300 text-xs">{formatPlanLabel(deal.plan, deal.billing_cycle)}</p>
                        <p className="text-gray-500 text-xs">{createdDate}</p>
                      </div>
                    </div>

                    {/* Desktop layout: grid */}
                    <div className="hidden sm:grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-3 items-center">
                      <p className="text-white text-sm font-medium truncate">{deal.client_name}</p>
                      <p className="text-gray-300 text-sm truncate">{deal.company_name}</p>
                      <p className="text-gray-300 text-sm">{formatPlanLabel(deal.plan, deal.billing_cycle)}</p>
                      <Badge config={statusCfg} />
                      <p className="text-gray-500 text-xs">{createdDate}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* ── Section C: My Commissions ─────────────────────────── */}
        <Section title="My Commissions" icon={DollarSign} defaultOpen={true}>
          {/* Running totals */}
          <div className="grid grid-cols-3 gap-3 pt-4 mb-4">
            <div className="bg-green-900/30 border border-green-800 rounded-lg p-3 text-center">
              <p className="text-green-300 text-xs mb-1">Total Earned</p>
              <p className="text-white font-bold text-lg">{formatCurrency(totalEarned)}</p>
            </div>
            <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-3 text-center">
              <p className="text-yellow-300 text-xs mb-1">Total Due</p>
              <p className="text-white font-bold text-lg">{formatCurrency(totalDue)}</p>
            </div>
            <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-3 text-center">
              <p className="text-gray-400 text-xs mb-1">Pending</p>
              <p className="text-white font-bold text-lg">{formatCurrency(totalPending)}</p>
            </div>
          </div>

          {dataLoading ? (
            <div className="py-4 text-center">
              <RefreshCw className="w-5 h-5 animate-spin text-blue-500 mx-auto" />
            </div>
          ) : dealsWithCommissions.length === 0 ? (
            <div className="py-6 text-center">
              <TrendingUp className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No commissions yet.</p>
              <p className="text-gray-500 text-xs mt-1">Commissions are recorded when a client goes live.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dealsWithCommissions.map(deal => {
                const dealCommissions = commissionsByDeal[deal.id] || [];
                const upfront = dealCommissions.find(c => c.type === 'upfront');
                const residuals = dealCommissions
                  .filter(c => c.type === 'residual')
                  .sort((a, b) => (a.month_number || 0) - (b.month_number || 0));
                const isExpanded = expandedDealId === deal.id;

                return (
                  <div key={deal.id} className="bg-gray-750 rounded-lg border border-gray-600 overflow-hidden">
                    {/* Deal header row */}
                    <button
                      className="w-full flex items-center justify-between p-3 hover:bg-gray-700 text-left"
                      onClick={() => setExpandedDealId(isExpanded ? null : deal.id)}
                    >
                      <div>
                        <p className="text-white font-medium text-sm">{deal.client_name}</p>
                        <p className="text-gray-400 text-xs">{deal.company_name} — {formatPlanLabel(deal.plan, deal.billing_cycle)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {upfront && (
                          <div className="text-right">
                            <p className="text-white text-sm font-medium">{formatCurrency(upfront.amount)}</p>
                            <p className="text-gray-500 text-xs">upfront</p>
                          </div>
                        )}
                        {isExpanded
                          ? <ChevronUp className="w-4 h-4 text-gray-400" />
                          : <ChevronDown className="w-4 h-4 text-gray-400" />
                        }
                      </div>
                    </button>

                    {/* Expanded commission details */}
                    {isExpanded && (
                      <div className="border-t border-gray-600 p-3 space-y-3">
                        {/* Upfront commission */}
                        {upfront && (
                          <div className="flex items-center justify-between py-2 border-b border-gray-700">
                            <div>
                              <p className="text-gray-300 text-sm">Upfront Commission</p>
                              {upfront.due_date && (
                                <p className="text-gray-500 text-xs">Due: {upfront.due_date}</p>
                              )}
                              {upfront.paid_at && (
                                <p className="text-gray-500 text-xs">
                                  Paid: {new Date(upfront.paid_at).toLocaleDateString('en-CA')}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <p className="text-white font-medium">{formatCurrency(upfront.amount)}</p>
                              <Badge config={getCommissionStatusConfig(upfront.status)} />
                            </div>
                          </div>
                        )}

                        {/* Residual schedule (Option 2 only) */}
                        {residuals.length > 0 && (
                          <div>
                            <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Residual Schedule</p>
                            <div className="space-y-1.5">
                              {/* Column headers */}
                              <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-2 px-1">
                                <p className="text-gray-600 text-xs w-12">Month</p>
                                <p className="text-gray-600 text-xs">Amount</p>
                                <p className="text-gray-600 text-xs">Due Date</p>
                                <p className="text-gray-600 text-xs">Status</p>
                              </div>
                              {residuals.map(r => (
                                <div
                                  key={r.id}
                                  className={`grid grid-cols-[auto_1fr_1fr_1fr] gap-2 px-1 py-1 rounded ${
                                    r.status === 'paid' ? 'opacity-60' : ''
                                  }`}
                                >
                                  <p className="text-gray-400 text-xs w-12">Month {r.month_number}</p>
                                  <p className="text-white text-xs">{formatCurrency(r.amount)}</p>
                                  <p className="text-gray-400 text-xs">{r.due_date || '—'}</p>
                                  <Badge config={getCommissionStatusConfig(r.status)} />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

      </main>
    </div>
  );
};

export default SalesRepDashboard;
```

- [ ] **Step 2: Verify the component renders without crashing**

```bash
# With dev server running at http://localhost:3000:
# Log in as a sales rep account. Confirm SalesRepDashboard renders
# (requires Task 4 — App.jsx routing — to be done first).
# For now, just confirm no import errors:
npm run build 2>&1 | grep -E "error|Error" | head -10
```

Expected: no build errors related to SalesRepDashboard.jsx or repDashboard.js.

- [ ] **Step 3: Commit**

```bash
git add src/pages/SalesRepDashboard.jsx
git commit -m "feat: add SalesRepDashboard component (new deal form, pipeline, commissions, show demo)"
```

---

## Chunk 4: App.jsx Routing Changes

### Task 4: Route sales reps to SalesRepDashboard

**Files:**
- Modify: `src/App.jsx`

**Current behavior:** When `clientData.role === 'sales_rep'`, App.jsx auto-enters demo mode (lines 201–219) and then shows the main dashboard with a demo overlay. Sales reps fall into the `isSubscriptionActive` bypass (line 1819) and see the full client dashboard.

**New behavior:** After `clientData` loads, if `clientData.is_sales_rep === true`, render `<SalesRepDashboard>` instead of the main dashboard. The existing auto-demo `useEffect` for `sales_rep` role is removed. The Show Demo button in SalesRepDashboard triggers demo mode on-demand via a callback.

There are three changes to make to `src/App.jsx`:

**Change 1: Add the import** (after the existing `OnboardingPage` import, around line 14):

```jsx
// Find this line (around line 14):
import OnboardingPage from './pages/OnboardingPage.jsx';

// Add immediately after:
import SalesRepDashboard from './pages/SalesRepDashboard.jsx';
```

**Change 2: Remove the auto-demo useEffect for sales_rep** (lines 200–219 approximately):

```jsx
// REMOVE this entire useEffect block:
// Sales rep auto-enters demo mode
useEffect(() => {
  if (clientData?.role === 'sales_rep' && clientData?.demo_client_id) {
    const fetchDemoClient = async () => {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientData.demo_client_id)
        .single();
      if (data) {
        setDemoClientData(data);
        // Sales reps get a 1-hour session from now
        setDemoExpiresAt(new Date(Date.now() + 60 * 60 * 1000).toISOString());
        setDemoMode(true);
        setIsPublicDemo(false);
      }
    };
    fetchDemoClient();
  }
}, [clientData]);
```

**Change 3: Add the sales rep routing block** — insert BEFORE the `showAdmin` check (around line 1812). Find the comment `// Show admin dashboard if admin and showAdmin is true` and insert this block immediately before it:

```jsx
// ── Sales Rep Dashboard ─────────────────────────────────────────
// If the logged-in user is a sales rep, render the rep dashboard.
// In demo mode (triggered by Show Demo button), fall through to the
// main demo view below by skipping this block.
if (clientData?.is_sales_rep && !demoMode) {
  const handleShowDemo = async () => {
    // Fetch the demo client (client_id 9 — the HVAC demo account)
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientData.demo_client_id || 9)
      .single();
    if (data) {
      setDemoClientData(data);
      setDemoExpiresAt(new Date(Date.now() + 60 * 60 * 1000).toISOString());
      setDemoMode(true);
      setIsPublicDemo(false);
    }
  };

  return (
    <SalesRepDashboard
      clientData={clientData}
      onLogout={handleLogout}
      onShowDemo={handleShowDemo}
    />
  );
}
// ── End Sales Rep Dashboard ─────────────────────────────────────
```

**Change 4: Handle "exit demo" for sales reps correctly.** The existing `handleExitDemo` (lines 294–306) already handles `clientData.role === 'sales_rep'` by signing out. This is no longer correct — reps should return to their dashboard, not be signed out. Update the condition:

```jsx
// Find handleExitDemo (around line 294):
const handleExitDemo = async () => {
  setDemoMode(false);
  setDemoClientData(null);
  setDemoExpiresAt(null);
  setDemoToken(null);
  setIsPublicDemo(false);
  // Sales reps have nothing outside demo — log them out   <-- REMOVE THIS COMMENT AND THE BLOCK BELOW
  if (clientData?.role === 'sales_rep') {
    await supabase.auth.signOut();
    setUser(null);
    setClientData(null);
  }
};

// Replace with:
const handleExitDemo = async () => {
  setDemoMode(false);
  setDemoClientData(null);
  setDemoExpiresAt(null);
  setDemoToken(null);
  setIsPublicDemo(false);
  // If a sales rep triggered demo, exiting returns them to SalesRepDashboard.
  // Public demo viewers are just unauthenticated — no action needed.
};
```

- [ ] **Step 1: Apply Change 1 (import)**
- [ ] **Step 2: Apply Change 2 (remove auto-demo useEffect)**
- [ ] **Step 3: Apply Change 3 (add routing block before showAdmin check)**
- [ ] **Step 4: Apply Change 4 (fix handleExitDemo)**
- [ ] **Step 5: Verify routing manually**

```bash
# Start dev server if not running
npm run dev

# Steps to verify:
# 1. Log in as a sales rep account (is_sales_rep = true)
# 2. Confirm SalesRepDashboard renders — NOT the client dashboard
# 3. Click "Show Demo" — confirm the demo dashboard opens
# 4. Click "Exit Demo" — confirm you return to SalesRepDashboard, not sign-out
# 5. Log out — confirm redirects to login
# 6. Log in as a regular client — confirm they see the client dashboard as before
# 7. Log in as admin — confirm they see the client dashboard + admin button as before
```

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat: route is_sales_rep users to SalesRepDashboard; remove auto-demo for reps"
```

---

## Chunk 5: Admin.jsx Changes — Rep Commission Option

### Task 5: Add commission_option to the rep add/edit form

**Files:**
- Modify: `src/Admin.jsx`

Currently the rep form has name, email, phone. It does not capture `commission_option` or set `is_sales_rep = true` explicitly. With the new schema, every rep account must have `is_sales_rep = true` and a `commission_option` of 1 or 2.

There are three changes to `src/Admin.jsx`:

**Change 1: Add `commission_option` to initial repForm state** (line 26–28):

```jsx
// Find:
const [repForm, setRepForm] = useState({
  company_name: '', email: '', phone: ''
});

// Replace with:
const [repForm, setRepForm] = useState({
  company_name: '', email: '', phone: '', commission_option: 1
});
```

**Change 2: Populate `commission_option` in handleEditRep** (lines 139–147):

```jsx
// Find:
const handleEditRep = (rep) => {
  setRepForm({
    company_name: rep.company_name || '',
    email: rep.email || '',
    phone: rep.phone || '',
  });
  setEditingRep(rep);
  setShowRepForm(true);
};

// Replace with:
const handleEditRep = (rep) => {
  setRepForm({
    company_name: rep.company_name || '',
    email: rep.email || '',
    phone: rep.phone || '',
    commission_option: rep.commission_option || 1,
  });
  setEditingRep(rep);
  setShowRepForm(true);
};
```

**Change 3: Save `commission_option` and `is_sales_rep` in handleSaveRep** (lines 149–191):

In the `editingRep` branch (the UPDATE path), add `commission_option` to the update:

```jsx
// Find in the editingRep UPDATE branch:
const { error } = await supabase
  .from('clients')
  .update({
    company_name: repForm.company_name,
    phone: repForm.phone,
  })
  .eq('id', editingRep.id);

// Replace with:
const { error } = await supabase
  .from('clients')
  .update({
    company_name: repForm.company_name,
    phone: repForm.phone,
    commission_option: repForm.commission_option,
  })
  .eq('id', editingRep.id);
```

In the `INSERT` branch, add `is_sales_rep` and `commission_option`:

```jsx
// Find the INSERT in the else branch:
const { error } = await supabase
  .from('clients')
  .insert([{
    email: repForm.email.trim().toLowerCase(),
    company_name: repForm.company_name,
    phone: repForm.phone,
    role: 'sales_rep',
    is_admin: false,
    invite_sent: false,
    demo_client_id: 9999,
  }]);

// Replace with:
const { error } = await supabase
  .from('clients')
  .insert([{
    email: repForm.email.trim().toLowerCase(),
    company_name: repForm.company_name,
    phone: repForm.phone,
    role: 'sales_rep',
    is_sales_rep: true,
    commission_option: repForm.commission_option,
    is_admin: false,
    invite_sent: false,
  }]);
```

Note: `demo_client_id: 9999` is removed — reps no longer need a `demo_client_id` since `SalesRepDashboard` fetches demo client by a configurable ID (defaulting to 9 — the test HVAC account).

**Change 4: Add the commission_option field to the rep modal UI** — in the `{/* ==================== REP ADD/EDIT MODAL ==================== */}` section, add the dropdown after the phone field:

```jsx
// After the phone number <div> and before the {error && ...} line:
<div>
  <label className="block text-gray-400 text-sm mb-1">Commission Option *</label>
  <select
    value={repForm.commission_option}
    onChange={(e) => setRepForm({ ...repForm, commission_option: parseInt(e.target.value) })}
    className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
  >
    <option value={1}>Option 1 — Full Upfront</option>
    <option value={2}>Option 2 — Split + Residual</option>
  </select>
  <p className="text-xs text-gray-500 mt-1">
    Option 1: rep receives full monthly plan price as a one-time payment.
    Option 2: 50% upfront + 10% residual for 12 months.
  </p>
</div>
```

Also update the "Save" button's disabled condition to prevent saving without a commission option:

```jsx
// Find:
disabled={saving || !repForm.email || !repForm.company_name}

// Replace with:
disabled={saving || !repForm.email || !repForm.company_name || !repForm.commission_option}
```

- [ ] **Step 1: Apply Change 1 (repForm state)**
- [ ] **Step 2: Apply Change 2 (handleEditRep)**
- [ ] **Step 3: Apply Change 3 (handleSaveRep — both UPDATE and INSERT branches)**
- [ ] **Step 4: Apply Change 4 (modal UI — commission_option dropdown)**
- [ ] **Step 5: Manual verification**

```bash
# In dev server:
# 1. Log in as admin
# 2. Go to Admin > Reps tab
# 3. Click "Add Rep"
# 4. Verify commission option dropdown appears with "Option 1" and "Option 2"
# 5. Fill in form, select Option 2, click Save
# 6. Verify the rep row appears in the Reps list
# 7. Click Edit on that rep — verify commission option field is pre-populated correctly
```

- [ ] **Step 6: Commit**

```bash
git add src/Admin.jsx
git commit -m "feat: add commission_option field to rep add/edit form in Admin; set is_sales_rep on insert"
```

---

## Chunk 6: End-to-End Verification

### Task 6: Full flow smoke test

This task exercises the complete rep experience end-to-end in the dev environment.

- [ ] **Step 1: Create a test rep account via Admin panel**

```
1. Log in as admin (gmacdonald63@gmail.com)
2. Admin > Reps > Add Rep
3. Fill in: Name: "Test Rep", Email: "testrep@example.com", Commission: Option 2
4. Save → Send Invite
5. Log out
```

- [ ] **Step 2: Set the rep's password and log in**

```
1. Check test email inbox for the Supabase invite
2. Click invite link → set password
3. Log in with the new rep credentials
4. Confirm SalesRepDashboard renders (not the client dashboard)
5. Confirm commission info shows "Option 2 — Split + Residual"
```

- [ ] **Step 3: Create a test deal**

```
1. Fill in the New Deal form:
   - Client Name: "Jane Smith"
   - Client Email: "jane@testclient.com"
   - Company Name: "Test HVAC Co"
   - Plan: Pro
   - Billing Cycle: Annual
2. Click "Generate Onboarding Link"
3. Confirm the link appears: https://app.reliantsupport.net/onboard?token=<uuid>
4. Click "Copy" — confirm clipboard contains the URL
5. Confirm the new deal appears in "My Deals" with status "Onboarding Sent" (yellow)
```

- [ ] **Step 4: Verify Supabase isolation**

```bash
# Confirm the deal exists in Supabase with correct rep_id
curl -s \
  "https://zmppdmfdhknnwzwdfhwf.supabase.co/rest/v1/deals?select=id,client_name,status,rep_id" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs" \
  -H "Authorization: Bearer <test-rep-jwt>" | python3 -m json.tool
```

Expected: only the test rep's deals are returned (RLS enforcement).

- [ ] **Step 5: Test "Show Demo" button**

```
1. In SalesRepDashboard, click "Show Demo"
2. Confirm the HVAC demo dashboard loads (same experience as before)
3. Click "Exit Demo" (the exit button inside the demo view)
4. Confirm you return to SalesRepDashboard — NOT signed out
```

- [ ] **Step 6: Verify My Commissions empty state**

```
The commissions section should show:
- Total Earned: $0.00
- Total Due: $0.00
- Pending: $0.00
- "No commissions yet" message
This is expected — commissions are created by the stripe-webhook when a client goes active.
```

- [ ] **Step 7: Final commit**

```bash
# (Only if there are any minor fixes from manual testing)
git add -p  # stage only what changed
git commit -m "fix: sales rep dashboard smoke test corrections"
```

---

## Completion Checklist

Before declaring Sub-Plan 3 done:

- [ ] RLS migration applied — `deals` and `commissions` have rep SELECT policies and admin SELECT/UPDATE policies
- [ ] `src/utils/repDashboard.js` exists with all 5 exported functions
- [ ] All Vitest tests in `src/utils/repDashboard.test.js` pass (run: `npx vitest run src/utils/repDashboard.test.js`)
- [ ] `src/pages/SalesRepDashboard.jsx` exists and renders without build errors
- [ ] `App.jsx` routes `is_sales_rep = true` users to `SalesRepDashboard`
- [ ] `App.jsx` no longer auto-enters demo mode for `sales_rep` role on login
- [ ] `handleExitDemo` in `App.jsx` no longer signs out sales reps on exit
- [ ] `Admin.jsx` rep form includes `commission_option` dropdown (Option 1 / Option 2)
- [ ] `Admin.jsx` insert sets `is_sales_rep: true` and `commission_option` from form
- [ ] `Admin.jsx` update includes `commission_option` in the UPDATE payload
- [ ] Manual smoke test passes: rep logs in → sees dashboard → creates deal → link generated → deal appears in pipeline
- [ ] "Show Demo" button works — opens demo, exit returns to rep dashboard
- [ ] Regular client login unaffected — still sees client dashboard
- [ ] Admin login unaffected — still sees client dashboard + admin button
- [ ] No TypeScript/build errors (`npm run build` passes clean)

---

## Known Edge Cases and Mitigations

**`clients.id` is BIGINT, not UUID.** The `rep_id` column in `deals` is BIGINT (FK to `clients.id`). The Supabase JS client returns it as a number. The `create-deal` function looks up the rep by email and uses `rep.id` (BIGINT) for the insert — this is correct. The RLS policies use the email join pattern — this is correct. No UUID comparison is attempted anywhere.

**Rep with no `commission_option` set (legacy records).** Existing rep records created before this sub-plan have `commission_option = null`. The dashboard displays "Not set" via `commissionOptionLabel`. The `create-deal` function reads `commission_option` from the DB when creating commissions — a null value will cause commission creation to fail. Greg must edit any legacy rep records via Admin to set their commission option before they create deals.

**`demo_client_id` field removed from rep insert.** The `SalesRepDashboard` "Show Demo" handler defaults to `clientData.demo_client_id || 9`. If a rep's record has no `demo_client_id`, it falls back to client ID 9 (the HVAC demo account). This matches the previous behavior. If client ID 9 does not exist in the environment, the Show Demo button will silently fail to load the demo (the `if (data)` guard prevents a crash).

**RLS and the Supabase anon key.** The `SalesRepDashboard` makes queries using the Supabase client initialized with the anon key. The session JWT is automatically included by the client. RLS policies use `auth.jwt() ->> 'email'` — this works because Supabase includes the user's email in the JWT payload when using Supabase Auth. No additional configuration is needed.

**Copying to clipboard on HTTP (non-HTTPS localhost).** The `navigator.clipboard.writeText` API requires a secure context (HTTPS). The fallback `document.execCommand('copy')` is included for HTTP localhost dev. In production (`app.reliantsupport.net` over HTTPS) the primary clipboard API will work.

---

### Critical Files for Implementation

- `C:/Users/Greg/receptionist-dashboard/.claude/worktrees/sales-commission-system/src/App.jsx` - Core routing logic to modify; contains the `is_sales_rep` useEffect to remove and the routing insertion point before the `showAdmin` check
- `C:/Users/Greg/receptionist-dashboard/.claude/worktrees/sales-commission-system/src/Admin.jsx` - Rep creation form to extend with `commission_option` dropdown and `is_sales_rep` flag on insert
- `C:/Users/Greg/receptionist-dashboard/.claude/worktrees/sales-commission-system/supabase/migrations/20260324_add_sales_rep_commission_tables.sql` - Confirms that RLS is already enabled on `deals` and `commissions`, and that `clients.id` is BIGINT (critical for RLS policy design)
- `C:/Users/Greg/receptionist-dashboard/.claude/worktrees/sales-commission-system/docs/superpowers/plans/2026-03-24-sub-plan-2-client-onboarding-flow.md` - Format reference and confirms `create-deal` function output shape (`{ deal_id, onboarding_url }`) that `SalesRepDashboard` depends on