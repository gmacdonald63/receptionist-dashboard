# Sub-Plan 2: Client Onboarding Flow — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A prospective client can receive a link, fill out a business info form, pay the $395 setup fee via Stripe, and trigger automated email notifications to Greg and the sales rep — all without logging in.

**Architecture:** A sales rep calls a `create-deal` edge function (authenticated) to create the deal record and receive a shareable onboarding URL. The client opens that URL in any browser — no login required — fills in their business details, and is redirected to Stripe for a one-time $395 payment. The existing `stripe-webhook` is extended to detect setup fee payments (via Stripe metadata), update deal status, and fire a `send-notification` function (Resend email) and a `hubspot-sync` function (HubSpot CRM update).

**Tech Stack:** Deno/TypeScript (edge functions), React 18 + Tailwind CSS (frontend), Stripe Checkout (payments), Resend (email), HubSpot CRM API, Supabase service role (DB writes), Vitest (unit tests for pure logic)

**Spec reference:** `docs/superpowers/plans/2026-03-24-sales-rep-commission-system-spec.md` — Sections 5 (Phases 2–4), 7 (Edge Functions), 8.1 (Onboarding Page), 9 (Notifications)

---

## Prerequisites

Before starting, confirm:
- [ ] Sub-Plan 1 is complete (`deals` + `commissions` tables exist in Supabase, `src/utils/commissions.js` exists, all 19 tests pass)
- [ ] `STRIPE_SECRET_KEY` is set as a Supabase secret (check: `npx supabase secrets list --project-ref zmppdmfdhknnwzwdfhwf`)
- [ ] `STRIPE_WEBHOOK_SECRET` is set (if not, the webhook will parse raw JSON — fine for testing, required for production)

**External services to configure before Task 6 (notifications) and Task 7 (HubSpot):**
- **Resend:** Sign up at resend.com, verify domain `reliantsupport.net`, get API key, add as Supabase secret: `RESEND_API_KEY`
- **HubSpot:** Get Private App access token from HubSpot account, add as Supabase secret: `HUBSPOT_API_KEY`. Also need: `HUBSPOT_PIPELINE_ID`, `HUBSPOT_STAGE_ONBOARDING_SENT`, `HUBSPOT_STAGE_SETUP_IN_PROGRESS`, `HUBSPOT_STAGE_CLOSED_WON`, `HUBSPOT_STAGE_CLOSED_LOST`

Both services degrade gracefully — the flow works end-to-end even without them configured.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/functions/create-deal/index.ts` | Authenticated. Creates deal record, returns onboarding URL. Called by rep dashboard. |
| Create | `supabase/functions/create-onboarding-checkout/index.ts` | Public. Validates token, saves form data, creates Stripe $395 checkout session. |
| Create | `supabase/functions/send-notification/index.ts` | Internal. Sends transactional email via Resend. Called by stripe-webhook. |
| Create | `supabase/functions/hubspot-sync/index.ts` | Internal. Creates/updates HubSpot deal. Called by stripe-webhook. |
| Modify | `supabase/functions/stripe-webhook/index.ts` | Add setup fee handler for `checkout.session.completed` with `metadata.type === 'setup_fee'`. |
| Create | `src/pages/OnboardingPage.jsx` | Public React component. Business info form + Stripe redirect + success screen. |
| Modify | `src/App.jsx` | Add early `?token=` URL param check to render `<OnboardingPage>` before auth gates. |
| Create | `src/utils/onboarding.js` | Pure helpers: parse token from URL, validate form fields. |
| Create | `src/utils/onboarding.test.js` | Vitest tests for pure helpers. |

---

## Chunk 1: Deal Creation

### Task 1: create-deal edge function

**Files:**
- Create: `supabase/functions/create-deal/index.ts`

This function is called by the sales rep dashboard (authenticated). It creates a deal record and returns the shareable onboarding URL.

**Input (POST body):**
```json
{
  "client_name": "Jane Smith",
  "client_email": "jane@acmehvac.com",
  "client_phone": "555-123-4567",
  "company_name": "Acme HVAC",
  "plan": "standard",
  "billing_cycle": "monthly"
}
```

**Output:**
```json
{
  "deal_id": "<uuid>",
  "onboarding_url": "https://app.reliantsupport.net/onboard?token=<uuid>"
}
```

- [ ] **Step 1: Create the function file**

```typescript
// supabase/functions/create-deal/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_URL = "https://app.reliantsupport.net";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Authenticate: require a valid JWT ──────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jwt = authHeader.replace("Bearer ", "");

    // Use service role for DB writes; verify JWT via auth API
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify JWT and get the authenticated user's ID
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Verify the user is a sales rep ────────────────────────
    const { data: rep, error: repError } = await supabase
      .from("clients")
      .select("id, is_sales_rep, commission_option")
      .eq("email", user.email)
      .single();

    if (repError || !rep) {
      return new Response(JSON.stringify({ error: "Client record not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!rep.is_sales_rep) {
      return new Response(JSON.stringify({ error: "Account is not a sales rep" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse and validate request body ───────────────────────
    const body = await req.json();
    const { client_name, client_email, client_phone, company_name, plan, billing_cycle } = body;

    if (!client_name || !client_email || !company_name || !plan || !billing_cycle) {
      return new Response(JSON.stringify({ error: "Missing required fields: client_name, client_email, company_name, plan, billing_cycle" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["standard", "pro"].includes(plan)) {
      return new Response(JSON.stringify({ error: "plan must be 'standard' or 'pro'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["monthly", "annual"].includes(billing_cycle)) {
      return new Response(JSON.stringify({ error: "billing_cycle must be 'monthly' or 'annual'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Create the deal record ─────────────────────────────────
    const { data: deal, error: insertError } = await supabase
      .from("deals")
      .insert({
        rep_id: rep.id,
        client_name,
        client_email,
        client_phone: client_phone || null,
        company_name,
        plan,
        billing_cycle,
        status: "onboarding_sent",
      })
      .select("id, onboarding_token")
      .single();

    if (insertError) {
      console.error("Deal insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create deal" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const onboardingUrl = `${APP_URL}/onboard?token=${deal.onboarding_token}`;

    console.log(`Deal created: ${deal.id} by rep ${rep.id}, token: ${deal.onboarding_token}`);

    return new Response(
      JSON.stringify({
        deal_id: deal.id,
        onboarding_url: onboardingUrl,
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("create-deal error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Deploy the function**

```bash
cd /c/Users/Greg/receptionist-dashboard/.claude/worktrees/sales-commission-system

SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
  npx supabase functions deploy create-deal \
  --project-ref zmppdmfdhknnwzwdfhwf \
  --no-verify-jwt
```

Expected: `Deployed Function create-deal`

- [ ] **Step 3: Smoke test — missing auth header returns 401**

```bash
curl -s -X POST \
  https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1/create-deal \
  -H "Content-Type: application/json" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs" \
  -d '{"client_name":"Test","client_email":"test@test.com","company_name":"Test Co","plan":"standard","billing_cycle":"monthly"}'
```

Expected: `{"error":"Missing Authorization header"}` with HTTP 401

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-deal/index.ts
git commit -m "feat: add create-deal edge function"
```

---

## Chunk 2: Onboarding Frontend

### Task 2: Pure URL + form validation helpers

**Files:**
- Create: `src/utils/onboarding.js`
- Create: `src/utils/onboarding.test.js`

These are pure functions — easy to test with Vitest.

- [ ] **Step 1: Write the failing tests**

```javascript
// src/utils/onboarding.test.js
import { describe, it, expect } from 'vitest';
import { parseOnboardingToken, validateOnboardingForm } from './onboarding.js';

describe('parseOnboardingToken', () => {
  it('returns token from URL with ?token= param', () => {
    expect(parseOnboardingToken('https://app.reliantsupport.net/onboard?token=abc-123')).toBe('abc-123');
  });

  it('returns token from bare query string', () => {
    expect(parseOnboardingToken('?token=xyz-789')).toBe('xyz-789');
  });

  it('returns null when no token param', () => {
    expect(parseOnboardingToken('https://app.reliantsupport.net/onboard')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOnboardingToken('')).toBeNull();
  });
});

describe('validateOnboardingForm', () => {
  const validForm = {
    business_name: 'Acme HVAC',
    address: '123 Main St',
    city: 'Calgary',
    province: 'AB',
    postal_code: 'T2P 1J9',
    services: 'HVAC installation and maintenance',
    special_instructions: '',
    hours: {
      monday: { is_open: true, open_time: '08:00', close_time: '17:00' },
    },
  };

  it('returns no errors for a valid form', () => {
    expect(validateOnboardingForm(validForm)).toEqual({});
  });

  it('returns error when business_name is empty', () => {
    const errors = validateOnboardingForm({ ...validForm, business_name: '' });
    expect(errors.business_name).toBeDefined();
  });

  it('returns error when address is empty', () => {
    const errors = validateOnboardingForm({ ...validForm, address: '' });
    expect(errors.address).toBeDefined();
  });

  it('returns error when services is empty', () => {
    const errors = validateOnboardingForm({ ...validForm, services: '' });
    expect(errors.services).toBeDefined();
  });

  it('returns error when city is empty', () => {
    const errors = validateOnboardingForm({ ...validForm, city: '' });
    expect(errors.city).toBeDefined();
  });

  it('returns multiple errors at once', () => {
    const errors = validateOnboardingForm({ ...validForm, business_name: '', address: '' });
    expect(Object.keys(errors).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /c/Users/Greg/receptionist-dashboard/.claude/worktrees/sales-commission-system
npm test -- src/utils/onboarding.test.js
```

Expected: FAIL — `Cannot find module './onboarding.js'`

- [ ] **Step 3: Write the implementation**

```javascript
// src/utils/onboarding.js

/**
 * Extract the onboarding token from a URL or query string.
 * @param {string} urlOrSearch - Full URL or search string (e.g., '?token=abc')
 * @returns {string|null}
 */
export function parseOnboardingToken(urlOrSearch) {
  try {
    const search = urlOrSearch.includes('?') ? urlOrSearch.slice(urlOrSearch.indexOf('?')) : urlOrSearch;
    const params = new URLSearchParams(search);
    return params.get('token');
  } catch {
    return null;
  }
}

/**
 * Validate the onboarding form fields.
 * @param {Object} form
 * @returns {Object} errors — keys are field names, values are error strings. Empty if valid.
 */
export function validateOnboardingForm(form) {
  const errors = {};
  if (!form.business_name?.trim()) errors.business_name = 'Business name is required';
  if (!form.address?.trim())       errors.address       = 'Street address is required';
  if (!form.city?.trim())          errors.city          = 'City is required';
  if (!form.province?.trim())      errors.province      = 'Province / State is required';
  if (!form.services?.trim())      errors.services      = 'Please describe your services';
  return errors;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm test -- src/utils/onboarding.test.js
```

Expected: 9 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboarding.js src/utils/onboarding.test.js
git commit -m "feat: add onboarding URL parser and form validation helpers"
```

---

### Task 3: OnboardingPage React component

**Files:**
- Create: `src/pages/OnboardingPage.jsx`

This is a public-facing page. No auth. Reads `?token=` and `?success=true` from the URL.

Three states:
1. **Loading** — fetching deal details by token
2. **Form** — collecting business info
3. **Success** — post-Stripe-payment confirmation (shown when `?success=true` is in URL)
4. **Error** — invalid/used token

- [ ] **Step 1: Create the component**

```jsx
// src/pages/OnboardingPage.jsx
import { useState, useEffect } from 'react';
import { validateOnboardingForm } from '../utils/onboarding.js';

const SUPABASE_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_LABELS = { monday:'Mon', tuesday:'Tue', wednesday:'Wed', thursday:'Thu', friday:'Fri', saturday:'Sat', sunday:'Sun' };

function defaultHours() {
  const h = {};
  DAYS.forEach(d => {
    h[d] = { is_open: ['monday','tuesday','wednesday','thursday','friday'].includes(d), open_time: '08:00', close_time: '17:00' };
  });
  return h;
}

export default function OnboardingPage({ token }) {
  const params = new URLSearchParams(window.location.search);
  const isSuccess = params.get('success') === 'true';

  const [phase, setPhase] = useState(isSuccess ? 'success' : 'loading');
  const [deal, setDeal] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const [form, setForm] = useState({
    business_name: '',
    address: '',
    city: '',
    province: '',
    postal_code: '',
    services: '',
    special_instructions: '',
    hours: defaultHours(),
  });

  // Load deal details on mount
  useEffect(() => {
    if (isSuccess || !token) return;

    async function loadDeal() {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-onboarding-deal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': ANON_KEY,
          },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Invalid onboarding link.');
          setPhase('error');
          return;
        }
        setDeal(data);
        setForm(f => ({ ...f, business_name: data.company_name || '' }));
        setPhase('form');
      } catch (e) {
        setError('Could not load onboarding details. Please try again.');
        setPhase('error');
      }
    }
    loadDeal();
  }, [token]);

  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    if (formErrors[field]) setFormErrors(e => ({ ...e, [field]: undefined }));
  }

  function setHours(day, field, value) {
    setForm(f => ({
      ...f,
      hours: { ...f.hours, [day]: { ...f.hours[day], [field]: value } },
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errors = validateOnboardingForm(form);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-onboarding-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ token, onboarding_data: form }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not start payment. Please try again.');
        setSubmitting(false);
        return;
      }
      // Redirect to Stripe
      window.location.href = data.url;
    } catch (e) {
      setError('Could not connect to payment service. Please try again.');
      setSubmitting(false);
    }
  }

  // ── Success screen ──────────────────────────────────────────
  if (phase === 'success') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Setup Request Received</h1>
          <p className="text-gray-300">
            Your setup request has been received. Greg will be in touch shortly with your account access link.
          </p>
        </div>
      </div>
    );
  }

  // ── Error screen ────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-red-700 p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-red-400 mb-3">Link Unavailable</h1>
          <p className="text-gray-400">{error || 'This onboarding link is invalid or has already been used.'}</p>
        </div>
      </div>
    );
  }

  // ── Loading screen ──────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-lg">Loading your setup form…</div>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Reliant Support</h1>
          <p className="text-gray-400">Complete your AI receptionist setup for <strong className="text-white">{deal?.company_name}</strong></p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Business Info */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Business Information</h2>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Business Name *</label>
              <input
                type="text"
                value={form.business_name}
                onChange={e => setField('business_name', e.target.value)}
                className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.business_name ? 'border-red-500' : 'border-gray-600'}`}
                placeholder="Acme HVAC Services"
              />
              {formErrors.business_name && <p className="text-red-400 text-xs mt-1">{formErrors.business_name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Street Address *</label>
              <input
                type="text"
                value={form.address}
                onChange={e => setField('address', e.target.value)}
                className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.address ? 'border-red-500' : 'border-gray-600'}`}
                placeholder="123 Main Street"
              />
              {formErrors.address && <p className="text-red-400 text-xs mt-1">{formErrors.address}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">City *</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={e => setField('city', e.target.value)}
                  className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.city ? 'border-red-500' : 'border-gray-600'}`}
                />
                {formErrors.city && <p className="text-red-400 text-xs mt-1">{formErrors.city}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Province / State *</label>
                <input
                  type="text"
                  value={form.province}
                  onChange={e => setField('province', e.target.value)}
                  className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.province ? 'border-red-500' : 'border-gray-600'}`}
                  placeholder="AB"
                />
                {formErrors.province && <p className="text-red-400 text-xs mt-1">{formErrors.province}</p>}
              </div>
            </div>

            <div className="w-1/2">
              <label className="block text-sm font-medium text-gray-300 mb-1">Postal / ZIP Code</label>
              <input
                type="text"
                value={form.postal_code}
                onChange={e => setField('postal_code', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="T2P 1J9"
              />
            </div>
          </div>

          {/* Services */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Services & Instructions</h2>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Services Offered *</label>
              <textarea
                value={form.services}
                onChange={e => setField('services', e.target.value)}
                rows={3}
                className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.services ? 'border-red-500' : 'border-gray-600'}`}
                placeholder="e.g. HVAC installation, furnace repair, AC maintenance, emergency service"
              />
              {formErrors.services && <p className="text-red-400 text-xs mt-1">{formErrors.services}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Special Instructions for AI Receptionist</label>
              <textarea
                value={form.special_instructions}
                onChange={e => setField('special_instructions', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Always ask for the customer's address and best contact number. Do not book same-day appointments."
              />
            </div>
          </div>

          {/* Hours of Operation */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Hours of Operation</h2>
            <div className="space-y-3">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-3">
                  <div className="w-10 text-sm text-gray-400">{DAY_LABELS[day]}</div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.hours[day].is_open}
                      onChange={e => setHours(day, 'is_open', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-300">Open</span>
                  </label>
                  {form.hours[day].is_open && (
                    <div className="flex items-center gap-2 ml-2">
                      <input
                        type="time"
                        value={form.hours[day].open_time}
                        onChange={e => setHours(day, 'open_time', e.target.value)}
                        className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                      />
                      <span className="text-gray-500">–</span>
                      <input
                        type="time"
                        value={form.hours[day].close_time}
                        onChange={e => setHours(day, 'close_time', e.target.value)}
                        className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                      />
                    </div>
                  )}
                  {!form.hours[day].is_open && (
                    <span className="text-sm text-gray-500 ml-2">Closed</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Setup Fee Notice */}
          <div className="bg-blue-900/30 rounded-xl border border-blue-700 p-4">
            <p className="text-blue-300 text-sm">
              <strong>Next step:</strong> After submitting this form, you'll be taken to a secure payment page to complete your <strong>$395 setup fee</strong>. Your AI receptionist will be configured within 1–2 business days.
            </p>
          </div>

          {error && (
            <div className="bg-red-900/30 rounded border border-red-700 p-3">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
          >
            {submitting ? 'Redirecting to payment…' : 'Continue to Payment →'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/OnboardingPage.jsx
git commit -m "feat: add public OnboardingPage component"
```

---

### Task 4: Wire OnboardingPage into App.jsx routing

**Files:**
- Modify: `src/App.jsx`

The App reads URL params early (around line 93–109). We add a check for `?token=` before any auth gates.

- [ ] **Step 1: Find the existing URL param block in App.jsx**

Open `src/App.jsx`. Find the block near the top where URL params are read (search for `URLSearchParams`). It looks like:

```javascript
const params = new URLSearchParams(window.location.search);
```

- [ ] **Step 2: Add the OnboardingPage import at the top of the file**

Add after the existing imports (find the last `import` line):

```javascript
import OnboardingPage from './pages/OnboardingPage.jsx';
```

- [ ] **Step 3: Add the onboarding token check before the return block**

In the main `App` function, find the earliest return statement (usually the loading spinner or the unauthenticated check). Add this BEFORE it:

```javascript
// ── Public onboarding route (no auth required) ──────────────
const _onboardParams = new URLSearchParams(window.location.search);
const _onboardToken = _onboardParams.get('token');
if (_onboardToken) {
  return <OnboardingPage token={_onboardToken} />;
}
```

**Important:** This must come before any auth check so the page is publicly accessible.

- [ ] **Step 4: Start dev server and verify the onboarding page loads**

```bash
cd /c/Users/Greg/receptionist-dashboard/.claude/worktrees/sales-commission-system
npm run dev
```

Open in browser: `http://localhost:3000/onboard?token=test-token-123`

Expected: Loading spinner appears (the function call will fail since token doesn't exist, then shows the error screen: "Invalid onboarding link")

- [ ] **Step 5: Verify success screen**

Open: `http://localhost:3000/onboard?token=test&success=true`

Expected: Green checkmark + "Setup Request Received" success screen.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add public /onboard route to App.jsx"
```

---

## Chunk 3: Checkout + Notifications

### Task 5: get-onboarding-deal edge function

**Files:**
- Create: `supabase/functions/get-onboarding-deal/index.ts`

This is called by the frontend `OnboardingPage` on load to fetch deal details by token. Public — no auth.

- [ ] **Step 1: Create the function**

```typescript
// supabase/functions/get-onboarding-deal/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: deal, error } = await supabase
      .from("deals")
      .select("id, company_name, client_name, plan, billing_cycle, status")
      .eq("onboarding_token", token)
      .single();

    if (error || !deal) {
      return new Response(JSON.stringify({ error: "Invalid or expired onboarding link." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (deal.status !== "onboarding_sent") {
      return new Response(JSON.stringify({ error: "This onboarding link has already been completed." }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      company_name: deal.company_name,
      client_name: deal.client_name,
      plan: deal.plan,
      billing_cycle: deal.billing_cycle,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Deploy**

```bash
SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
  npx supabase functions deploy get-onboarding-deal \
  --project-ref zmppdmfdhknnwzwdfhwf \
  --no-verify-jwt
```

- [ ] **Step 3: Smoke test with a bad token**

```bash
curl -s -X POST \
  https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1/get-onboarding-deal \
  -H "Content-Type: application/json" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs" \
  -d '{"token":"00000000-0000-0000-0000-000000000000"}'
```

Expected: `{"error":"Invalid or expired onboarding link."}`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/get-onboarding-deal/index.ts
git commit -m "feat: add get-onboarding-deal edge function"
```

---

### Task 6: create-onboarding-checkout edge function

**Files:**
- Create: `supabase/functions/create-onboarding-checkout/index.ts`

Saves onboarding form data to the deal, creates Stripe Checkout session for $395.

- [ ] **Step 1: Create the function**

```typescript
// supabase/functions/create-onboarding-checkout/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_URL = "https://app.reliantsupport.net";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token, onboarding_data } = await req.json();

    if (!token || !onboarding_data) {
      return new Response(JSON.stringify({ error: "Missing token or onboarding_data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Look up deal by token ────────────────────────────────
    const { data: deal, error } = await supabase
      .from("deals")
      .select("id, client_email, company_name, onboarding_token, status")
      .eq("onboarding_token", token)
      .single();

    if (error || !deal) {
      return new Response(JSON.stringify({ error: "Invalid onboarding link." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (deal.status !== "onboarding_sent") {
      return new Response(JSON.stringify({ error: "This onboarding has already been completed." }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Save onboarding form data ────────────────────────────
    const { error: updateError } = await supabase
      .from("deals")
      .update({ onboarding_data })
      .eq("id", deal.id);

    if (updateError) {
      console.error("Failed to save onboarding data:", updateError);
      // Non-fatal — continue to checkout anyway
    }

    // ── Create Stripe Checkout session ($395 one-time) ───────
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: "Reliant Support — AI Receptionist Setup Fee",
            description: `Account setup for ${deal.company_name}`,
          },
          unit_amount: 39500, // $395.00
        },
        quantity: 1,
      }],
      metadata: {
        deal_id: deal.id,
        type: "setup_fee",
      },
      customer_email: deal.client_email,
      success_url: `${APP_URL}/onboard?token=${deal.onboarding_token}&success=true`,
      cancel_url: `${APP_URL}/onboard?token=${deal.onboarding_token}`,
    });

    console.log(`Checkout session created for deal ${deal.id}: ${session.id}`);

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-onboarding-checkout error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Deploy**

```bash
SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
  npx supabase functions deploy create-onboarding-checkout \
  --project-ref zmppdmfdhknnwzwdfhwf \
  --no-verify-jwt
```

- [ ] **Step 3: Smoke test with missing token**

```bash
curl -s -X POST \
  https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1/create-onboarding-checkout \
  -H "Content-Type: application/json" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs" \
  -d '{}'
```

Expected: `{"error":"Missing token or onboarding_data"}`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-onboarding-checkout/index.ts
git commit -m "feat: add create-onboarding-checkout edge function"
```

---

### Task 7: send-notification edge function

**Files:**
- Create: `supabase/functions/send-notification/index.ts`

Sends transactional email via Resend. Called internally by the webhook — not directly by the frontend. Gracefully skips if `RESEND_API_KEY` is not configured.

**Prerequisites:** Set up Resend account + verify domain, then:
```bash
SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
  npx supabase secrets set RESEND_API_KEY=<your-key> \
  --project-ref zmppdmfdhknnwzwdfhwf
```

Also set the notification recipient:
```bash
SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
  npx supabase secrets set OWNER_EMAIL=gmacdonald63@gmail.com \
  --project-ref zmppdmfdhknnwzwdfhwf
```

- [ ] **Step 1: Create the function**

```typescript
// supabase/functions/send-notification/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Template =
  | "setup_fee_paid_greg"
  | "setup_fee_paid_rep"
  | "client_active_greg"
  | "client_active_rep"
  | "residual_due_greg"
  | "commission_paid_rep";

interface NotificationRequest {
  template: Template;
  deal_id: string;
}

async function sendEmail(apiKey: string, to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Reliant Support <noreply@reliantsupport.net>",
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error: ${err}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.warn("RESEND_API_KEY not configured — skipping notification");
      return new Response(JSON.stringify({ skipped: true, reason: "RESEND_API_KEY not set" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerEmail = Deno.env.get("OWNER_EMAIL") || "gmacdonald63@gmail.com";

    const { template, deal_id }: NotificationRequest = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load deal + rep data
    const { data: deal, error } = await supabase
      .from("deals")
      .select(`
        id, client_name, client_email, company_name, plan, billing_cycle, status,
        rep:rep_id ( id, email, first_name, last_name )
      `)
      .eq("id", deal_id)
      .single();

    if (error || !deal) {
      throw new Error(`Deal not found: ${deal_id}`);
    }

    const repName = [deal.rep?.first_name, deal.rep?.last_name].filter(Boolean).join(" ") || deal.rep?.email || "Sales Rep";
    const planLabel = deal.plan === "pro" ? "Pro" : "Standard";
    const cycleLabel = deal.billing_cycle === "annual" ? "Annual" : "Monthly";

    switch (template) {
      case "setup_fee_paid_greg": {
        const od = deal.onboarding_data || {};
        await sendEmail(
          resendKey,
          ownerEmail,
          `New client setup: ${deal.client_name}`,
          `<h2>New Client Setup Request</h2>
           <p><strong>Client:</strong> ${deal.client_name} (${deal.client_email})</p>
           <p><strong>Company:</strong> ${deal.company_name}</p>
           <p><strong>Plan:</strong> ${planLabel} / ${cycleLabel}</p>
           <p><strong>Sales Rep:</strong> ${repName}</p>
           <hr/>
           <h3>Onboarding Details</h3>
           <p><strong>Address:</strong> ${od.address || "—"}, ${od.city || "—"}, ${od.province || "—"} ${od.postal_code || ""}</p>
           <p><strong>Services:</strong> ${od.services || "—"}</p>
           <p><strong>Special Instructions:</strong> ${od.special_instructions || "None"}</p>
           <p><strong>Hours:</strong></p>
           <pre>${JSON.stringify(od.hours || {}, null, 2)}</pre>`
        );
        break;
      }

      case "setup_fee_paid_rep": {
        await sendEmail(
          resendKey,
          deal.rep?.email,
          `Setup fee received for ${deal.client_name}`,
          `<h2>Setup Fee Received</h2>
           <p>${deal.client_name} at ${deal.company_name} has paid the $395 setup fee.</p>
           <p>Greg is now configuring their AI receptionist. You'll be notified when they go live.</p>`
        );
        break;
      }

      case "client_active_greg": {
        await sendEmail(
          resendKey,
          ownerEmail,
          `Client live + commission due: ${deal.client_name}`,
          `<h2>Client Is Live</h2>
           <p><strong>${deal.client_name}</strong> at ${deal.company_name} is now active on the ${planLabel} plan.</p>
           <p>Commission is due to <strong>${repName}</strong>. Log in to the admin panel to mark it paid.</p>`
        );
        break;
      }

      case "client_active_rep": {
        await sendEmail(
          resendKey,
          deal.rep?.email,
          `Your client ${deal.client_name} is live!`,
          `<h2>Great news!</h2>
           <p>${deal.client_name} at ${deal.company_name} is now active on Reliant Support (${planLabel} / ${cycleLabel}).</p>
           <p>Your commission has been recorded and will be paid shortly.</p>`
        );
        break;
      }

      case "residual_due_greg": {
        await sendEmail(
          resendKey,
          ownerEmail,
          `Monthly commission due: ${repName} for ${deal.client_name}`,
          `<h2>Monthly Residual Commission Due</h2>
           <p>A monthly residual commission is due to <strong>${repName}</strong> for client <strong>${deal.client_name}</strong>.</p>
           <p>Log in to the admin panel to review and mark it paid.</p>`
        );
        break;
      }

      case "commission_paid_rep": {
        await sendEmail(
          resendKey,
          deal.rep?.email,
          `Commission paid`,
          `<h2>Commission Paid</h2>
           <p>A commission for client <strong>${deal.client_name}</strong> has been marked as paid.</p>
           <p>Check your bank account for the transfer.</p>`
        );
        break;
      }

      default:
        throw new Error(`Unknown template: ${template}`);
    }

    return new Response(JSON.stringify({ sent: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-notification error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Deploy**

```bash
SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
  npx supabase functions deploy send-notification \
  --project-ref zmppdmfdhknnwzwdfhwf \
  --no-verify-jwt
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-notification/index.ts
git commit -m "feat: add send-notification edge function (Resend email)"
```

---

### Task 8: hubspot-sync edge function

**Files:**
- Create: `supabase/functions/hubspot-sync/index.ts`

Creates or updates a HubSpot deal to mirror Supabase deal status. Called internally by `stripe-webhook`. Gracefully skips if `HUBSPOT_API_KEY` is not set.

**Prerequisites — HubSpot secrets to set:**
```bash
SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
  npx supabase secrets set \
    HUBSPOT_API_KEY=<private-app-token> \
    HUBSPOT_PIPELINE_ID=<pipeline-id> \
    HUBSPOT_STAGE_ONBOARDING_SENT=<stage-id> \
    HUBSPOT_STAGE_SETUP_IN_PROGRESS=<stage-id> \
    HUBSPOT_STAGE_CLOSED_WON=<stage-id> \
    HUBSPOT_STAGE_CLOSED_LOST=<stage-id> \
  --project-ref zmppdmfdhknnwzwdfhwf
```

- [ ] **Step 1: Create the function**

```typescript
// supabase/functions/hubspot-sync/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STATUS_TO_STAGE: Record<string, string> = {
  onboarding_sent:    "HUBSPOT_STAGE_ONBOARDING_SENT",
  setup_in_progress:  "HUBSPOT_STAGE_SETUP_IN_PROGRESS",
  active:             "HUBSPOT_STAGE_CLOSED_WON",
  cancelled:          "HUBSPOT_STAGE_CLOSED_LOST",
};

async function hubspotRequest(apiKey: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot API error (${res.status}): ${err}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const hubspotKey = Deno.env.get("HUBSPOT_API_KEY");
    if (!hubspotKey) {
      console.warn("HUBSPOT_API_KEY not configured — skipping HubSpot sync");
      return new Response(JSON.stringify({ skipped: true, reason: "HUBSPOT_API_KEY not set" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pipelineId = Deno.env.get("HUBSPOT_PIPELINE_ID");
    const { deal_id, action }: { deal_id: string; action: "create" | "update" } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load deal + rep
    const { data: deal, error } = await supabase
      .from("deals")
      .select("id, client_name, client_email, client_phone, company_name, plan, billing_cycle, status, hubspot_deal_id, rep:rep_id(email, first_name, last_name)")
      .eq("id", deal_id)
      .single();

    if (error || !deal) throw new Error(`Deal not found: ${deal_id}`);

    const stageEnvKey = STATUS_TO_STAGE[deal.status];
    const stageId = stageEnvKey ? Deno.env.get(stageEnvKey) : undefined;

    const dealName = `${deal.company_name} — ${deal.plan === "pro" ? "Pro" : "Standard"} (${deal.billing_cycle === "annual" ? "Annual" : "Monthly"})`;
    const repName = [deal.rep?.first_name, deal.rep?.last_name].filter(Boolean).join(" ") || deal.rep?.email || "";

    const dealProperties: Record<string, string> = {
      dealname: dealName,
      ...(pipelineId ? { pipeline: pipelineId } : {}),
      ...(stageId ? { dealstage: stageId } : {}),
    };

    if (action === "create") {
      // Create contact first, then deal
      let contactId: string | undefined;
      try {
        const contactRes = await hubspotRequest(hubspotKey, "POST", "/crm/v3/objects/contacts", {
          properties: {
            email: deal.client_email,
            firstname: deal.client_name.split(" ")[0] || deal.client_name,
            lastname: deal.client_name.split(" ").slice(1).join(" ") || "",
            phone: deal.client_phone || "",
            company: deal.company_name,
          },
        });
        contactId = contactRes.id;
      } catch {
        // Contact may already exist — that's fine
        console.warn("Could not create HubSpot contact (may already exist)");
      }

      const hubspotDeal = await hubspotRequest(hubspotKey, "POST", "/crm/v3/objects/deals", {
        properties: dealProperties,
        associations: contactId ? [{
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
        }] : [],
      });

      // Save hubspot_deal_id back to Supabase
      await supabase
        .from("deals")
        .update({ hubspot_deal_id: hubspotDeal.id })
        .eq("id", deal.id);

      console.log(`HubSpot deal created: ${hubspotDeal.id} for deal ${deal.id}`);

    } else if (action === "update") {
      if (!deal.hubspot_deal_id) {
        console.warn(`No hubspot_deal_id on deal ${deal.id} — skipping update`);
        return new Response(JSON.stringify({ skipped: true, reason: "No hubspot_deal_id" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await hubspotRequest(
        hubspotKey,
        "PATCH",
        `/crm/v3/objects/deals/${deal.hubspot_deal_id}`,
        { properties: dealProperties }
      );

      console.log(`HubSpot deal updated: ${deal.hubspot_deal_id} → ${deal.status}`);
    }

    return new Response(JSON.stringify({ synced: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("hubspot-sync error:", err);
    // Non-fatal: log but return 200 so caller doesn't treat this as a hard failure
    return new Response(JSON.stringify({ error: err.message, synced: false }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Deploy**

```bash
SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
  npx supabase functions deploy hubspot-sync \
  --project-ref zmppdmfdhknnwzwdfhwf \
  --no-verify-jwt
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/hubspot-sync/index.ts
git commit -m "feat: add hubspot-sync edge function"
```

---

## Chunk 4: Webhook Extension + Integration Test

### Task 9: Extend stripe-webhook for setup fee events

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`

The existing webhook handles subscription events. We add a branch inside `checkout.session.completed` to detect setup fee payments (via `metadata.type === 'setup_fee'`).

- [ ] **Step 1: Update the checkout.session.completed case**

Open `supabase/functions/stripe-webhook/index.ts`. Find the `checkout.session.completed` case (around line 49). Replace it with:

```typescript
case "checkout.session.completed": {
  const session = event.data.object as Stripe.Checkout.Session;

  // ── Setup fee payment (one-time, from onboarding form) ────
  if (session.mode === "payment" && session.metadata?.type === "setup_fee") {
    const dealId = session.metadata?.deal_id;
    if (!dealId) {
      console.warn("setup_fee checkout completed but no deal_id in metadata");
      break;
    }

    // Update deal status → setup_in_progress
    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .update({
        status: "setup_in_progress",
        stripe_setup_payment_id: session.payment_intent as string,
        stripe_customer_id: session.customer as string,
      })
      .eq("id", dealId)
      .select("id, rep_id")
      .single();

    if (dealError) {
      console.error(`Failed to update deal ${dealId}:`, dealError);
      break;
    }

    console.log(`Setup fee paid for deal ${dealId} — status → setup_in_progress`);

    // Fire HubSpot sync
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    await fetch(`${supabaseUrl}/functions/v1/hubspot-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deal_id: dealId, action: "update" }),
    }).catch(e => console.error("hubspot-sync call failed:", e));

    // Fire notifications (Greg + rep)
    await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "setup_fee_paid_greg", deal_id: dealId }),
    }).catch(e => console.error("send-notification (greg) failed:", e));

    await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "setup_fee_paid_rep", deal_id: dealId }),
    }).catch(e => console.error("send-notification (rep) failed:", e));

    break;
  }

  // ── Subscription checkout (existing behavior) ─────────────
  if (session.mode === "subscription" && session.subscription) {
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription as string
    );
    const clientId = session.metadata?.client_id;
    const priceId = subscription.items?.data?.[0]?.price?.id || null;
    if (clientId) {
      await supabase
        .from("clients")
        .update({
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscription.id,
          subscription_status: subscription.status,
          stripe_price_id: priceId,
          current_period_end: new Date(
            subscription.current_period_end * 1000
          ).toISOString(),
        })
        .eq("id", parseInt(clientId));
      console.log(`Client ${clientId} subscription activated: ${subscription.id} (price: ${priceId})`);
    }
  }
  break;
}
```

- [ ] **Step 2: Deploy the updated webhook**

```bash
SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
  npx supabase functions deploy stripe-webhook \
  --project-ref zmppdmfdhknnwzwdfhwf \
  --no-verify-jwt
```

- [ ] **Step 3: Run full tests to confirm nothing regressed**

```bash
npm test
```

Expected: 19/19 passing (commission tests unchanged)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat: extend stripe-webhook to handle setup fee payments and trigger notifications"
```

---

### Task 10: End-to-end integration test

This task validates the complete onboarding flow works in the deployed environment. You'll need a sales rep account in the system.

**Setup — create a test sales rep account:**

```bash
# Insert a test sales rep into clients table (replace with a real email you can log in with)
curl -s -X POST \
  https://zmppdmfdhknnwzwdfhwf.supabase.co/rest/v1/rpc/some-function \
  ...
```

Actually — use the Supabase MCP tool or admin panel to:
1. Create a client account with `is_sales_rep = true` and `commission_option = 1`
2. Note the email + password
3. Get the JWT by signing in via Supabase auth

**Test 1 — create a deal (authenticated):**

```bash
# Sign in and get JWT (replace with actual credentials)
JWT=$(curl -s -X POST \
  https://zmppdmfdhknnwzwdfhwf.supabase.co/auth/v1/token?grant_type=password \
  -H "Content-Type: application/json" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs" \
  -d '{"email":"rep@example.com","password":"yourpassword"}' | jq -r '.access_token')

curl -s -X POST \
  https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1/create-deal \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs" \
  -d '{"client_name":"Test Client","client_email":"client@testco.com","company_name":"Test HVAC","plan":"standard","billing_cycle":"monthly"}'
```

Expected response:
```json
{
  "deal_id": "<uuid>",
  "onboarding_url": "https://app.reliantsupport.net/onboard?token=<uuid>"
}
```

**Test 2 — load onboarding form in browser:**

Copy the `onboarding_url` from the response above. Open it in a browser on the preview URL:
`http://localhost:3000/onboard?token=<uuid-from-above>`

Expected: Form loads with business name pre-filled as "Test HVAC"

**Test 3 — verify Stripe redirect (using Stripe test mode):**

Fill out the form and click "Continue to Payment". You should be redirected to a Stripe Checkout page showing "$395 — Reliant Support AI Receptionist Setup Fee".

Use Stripe test card: `4242 4242 4242 4242` with any future expiry and any 3-digit CVC.

Expected after payment: redirected to `https://app.reliantsupport.net/onboard?token=<uuid>&success=true` — shows the success screen.

**Test 4 — verify deal status updated:**

Check the deal status in Supabase:
```bash
# Via MCP tool or direct REST
curl -s "https://zmppdmfdhknnwzwdfhwf.supabase.co/rest/v1/deals?select=id,status,stripe_setup_payment_id" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs" \
  -H "Authorization: Bearer <service-role-key>"
```

Expected: Deal status = `setup_in_progress`, `stripe_setup_payment_id` is populated.

- [ ] **Step 5: Final commit for Sub-Plan 2**

```bash
git add -A
git commit -m "chore: sub-plan 2 complete — client onboarding flow end-to-end"
```

---

## Sub-Plan 2 Completion Checklist

- [ ] `create-deal` function deployed + returns onboarding URL
- [ ] `get-onboarding-deal` function deployed + returns deal details by token
- [ ] `OnboardingPage.jsx` renders at `/onboard?token=<uuid>`
- [ ] Success screen renders at `/onboard?token=<uuid>&success=true`
- [ ] `create-onboarding-checkout` deployed + creates Stripe checkout
- [ ] `send-notification` deployed + gracefully skips without RESEND_API_KEY
- [ ] `hubspot-sync` deployed + gracefully skips without HUBSPOT_API_KEY
- [ ] `stripe-webhook` extended — setup fee events update deal status
- [ ] All 19 unit tests still passing
- [ ] End-to-end test: deal created → form loads → Stripe paid → status = setup_in_progress
