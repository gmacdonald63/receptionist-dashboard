# Onboarding Flow Redesign — Design Spec
**Date:** 2026-03-25
**Status:** Draft (rev 3)

---

## Overview

This spec covers three areas of work:

1. **Minor copy & UI fixes** — button text, email copy, reply-to address, and a bug fix that makes the existing onboarding link work
2. **Onboarding flow resequencing** — payment first ($395 setup fee), then business info form, then thank you screen
3. **Setup complete invite (Activation Flow)** — new Link 2 Greg sends after completing client setup; client pays subscription + sets password in a single session

Forwarding phone number in the client dashboard is explicitly out of scope — deferred to a future session.

---

## Section 1: Minor Copy & UI Changes

### 1.1 SalesRepDashboard.jsx

**File:** `src/pages/SalesRepDashboard.jsx`

- Button label: `"Generate Onboarding Link"` → `"Send Onboarding Link"`
- Button loading state: `"Generating..."` → `"Sending..."`
- Remove the green success heading text "Onboarding Link ready — copy and send to client" (or equivalent shown after the link is generated)
- Keep the onboarding URL display and the Copy button — useful fallback if email bounces

### 1.2 send-notification Edge Function — onboarding_link_client template

**File:** `supabase/functions/send-notification/index.ts`

- CTA button text: `"Complete Your Setup"` → `"Begin Your Setup"`
- Footer copy: `"If you have any questions, reply to this email or contact your sales representative."` → `"If you have any questions, contact us at support@reliantsupport.net"`

### 1.3 Bug Fix — Onboarding Link Goes to Login Screen

**File:** `src/App.jsx`

`App.jsx` has a render-time URL param check (before the `authLoading` spinner) that renders public pages directly — e.g., `params.has('token')` → `<OnboardingPage />`. This check is currently broken or missing, causing the onboarding link to fall through to the Login screen.

**Fix:** In the render-time URL param block (same location as the existing `?token=` check, NOT in the `getSession` block where `?track` lives), ensure:
- `params.has('token')` → renders `<OnboardingPage />` without requiring login
- `params.has('activate')` → renders `<ActivationPage />` without requiring login (Section 3)

Both checks must be placed **before** the `authLoading` spinner so they render immediately on page load.

Additionally, in `getSession().then()`, add an early-exit for `params.has('activate')` (same pattern as `?track`) to prevent `resolveRole()` from running for the activation URL.

**`onAuthStateChange` SIGNED_IN guard:** The existing interceptor that checks for `invited_at` and shows `ResetPassword` will not fire for activation flow clients since they have no auth session at the point of activation. No change needed here.

---

## Section 2: Onboarding Flow Resequencing

**File:** `src/pages/OnboardingPage.jsx`

### Current Flow
`Form (business info) → Stripe $395 checkout → Success screen`

### New Flow
`Step 1: Pay setup fee → Step 2: Business info form → Step 3: Thank you screen`

### Step 1 — Pay Setup Fee
Rendered when the page loads with a valid `?token=` and no `?success=true`.

Content:
- Page heading: "Complete Your Account Setup"
- Brief intro: "To get started, a one-time setup fee of $395 is required. This covers your AI receptionist configuration."
- Company name pre-filled from deal data (read-only, for reassurance)
- CTA button: **"Pay Setup Fee — $395"**

Clicking the button calls `create-onboarding-checkout` Edge Function with only `{ token }` (no form data) and redirects to Stripe.

**Success URL:** `https://app.reliantsupport.net/onboard?token={token}&success=true`
**Cancel URL:** `https://app.reliantsupport.net/onboard?token={token}` (back to Step 1)

### Step 2 — Business Info Form
Rendered when `?success=true` is present in the URL.

Fields (unchanged from current implementation):
- Business Name (required, pre-filled from deal)
- Street Address (required)
- City (required)
- Province / State (required)
- Postal / ZIP Code (optional)
- Services Offered (required, textarea)
- Special Instructions for AI Receptionist (optional, textarea)
- Hours of Operation — 7-day schedule, open/close times, open/closed toggle per day

Submit button: **"Send My Setup Information"**

On submit:
- Validates required fields (existing `validateOnboardingForm()` logic)
- Calls new `save-onboarding-data` Edge Function with `{ token, onboarding_data }`
- On success → renders Step 3

### Step 3 — Thank You Screen
Rendered after successful form submission.

Content:
- Heading: **"Thank You — Your Setup is Now in Progress!"**
- Body: "We've received your setup information. You'll receive an email from us once your account is ready to activate."
- No further actions — just confirmation

### Edge Function Changes

#### `create-onboarding-checkout` — simplified (Step 1 only)

**Current signature:** `{ token, onboarding_data }` — saves form data + creates Stripe session
**New signature:** `{ token }` only

Precise changes:
- `const { token, onboarding_data } = await req.json()` → `const { token } = await req.json()`
- Remove `!onboarding_data` from the validation guard (only `!token` check remains)
- Remove the `supabase.from('deals').update({ onboarding_data })` block entirely

The Stripe metadata (`type: 'setup_fee'`) and webhook handler remain unchanged.

#### Stripe webhook — `checkout.session.completed` + `setup_fee` branch

**Two removals required:**

1. **Remove** `deal.status = 'setup_in_progress'` update — `save-onboarding-data` owns this
2. **Remove** the `send-notification` calls for `setup_fee_paid_greg` and `setup_fee_paid_rep` — `save-onboarding-data` owns these (must fire AFTER form data is saved)

The Stripe webhook still captures `stripe_customer_id` and `stripe_setup_payment_id` on the deal — those stay.

#### New Edge Function: `save-onboarding-data`

Called from OnboardingPage Step 2 submit.

Steps (in order):
1. Validate `token` → fetch deal; return error if deal not found
2. **Status guard:** If `deal.status !== 'onboarding_sent'`, return `{ error: 'already_submitted' }` with HTTP 409 (idempotency guard against double submission)
3. Save `onboarding_data` JSONB to deal record
4. Update `deal.status = 'setup_in_progress'`
5. Dispatch `setup_fee_paid_greg` notification (non-blocking) — fires after form save so Greg's email contains full setup details
6. Dispatch `setup_fee_paid_rep` notification (non-blocking)
7. Return `{ saved: true }`

**Note:** No `stripe_customer_id` copy at this step — the `clients` row does not exist yet when the client submits the form. The copy happens in `send-activation-invite` once Greg has created the client account (see Section 3.2).

---

## Section 3: Setup Complete Invite — Activation Flow (Option B)

This is a new end-to-end flow triggered by Greg after he has finished setting up a client's account.

### Overview

Greg manually creates the `clients` row for the new client (as today), then clicks "Send Activation Invite" in the Admin panel → client receives a "Congratulations" email with a "Proceed" button → client lands on `ActivationPage` → pays for subscription via Stripe → sets password → lands on dashboard.

---

### 3.1 Database Changes

**Migration:** `supabase/migrations/20260325007_clients_activation_columns.sql`

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS activation_token UUID,
  ADD COLUMN IF NOT EXISTS invite_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN DEFAULT FALSE;
```

- `activation_token` — UUID generated at invite time. URL param: `/?activate=<uuid>`. Cleared after activation completes.
- `invite_token_hash` — Hashed token from Supabase `generateLink`. Stored server-side for `verify-activation`. Cleared after activation completes.
- `setup_complete` — Set to `TRUE` by `send-activation-invite`. Used in Admin.jsx to show/hide the button without a join to `deals`.

---

### 3.2 New Edge Function: `send-activation-invite`

**Trigger:** Greg clicks "Send Activation Invite" in Admin panel

**Authentication pattern (same as `invite-user`):**
1. Extract JWT from `Authorization: Bearer <jwt>` header
2. Call `supabase.auth.getUser(jwt)` using service-role client
3. Verify `user.email` exists in `clients` table with `is_admin = true` (or owner role)
4. If not authorized, return 403

**Steps:**
1. Authenticate caller (above pattern)
2. Fetch the target `clients` row by `client_id`; fail fast if not found
3. Find associated deal via `deals.client_email = clients.email`; fail fast if not found
4. **Validate:** If `deals.stripe_customer_id` is null, return `{ error: 'setup_fee_not_paid' }` — data integrity guard
5. **Copy:** Set `clients.stripe_customer_id = deals.stripe_customer_id` so subscription checkout can use it
6. **Set join FK:** Set `deals.supabase_client_id = clients.id` (ensures unambiguous join for downstream functions)
7. Call `supabase.auth.admin.generateLink({ type: 'invite', email: clients.email, options: { redirectTo: 'https://app.reliantsupport.net' } })` — no Supabase email sent. Extract `data.properties.hashed_token`.
8. Generate `activation_token = crypto.randomUUID()`
9. Update `clients` row: `{ invite_token_hash, activation_token, setup_complete: true }`
10. Call `send-notification` with `activation_invite` template data directly (see Section 3.3 for interface)
11. Return `{ sent: true }`

**Token expiry:** Supabase invite tokens expire per the project's OTP expiry setting. Set to 7 days — see Required Config Changes section.

---

### 3.3 Email: `activation_invite` template

Since this template requires data from `clients` (not `deals`), `send-activation-invite` calls `send-notification` with a direct payload rather than a `deal_id`. The `send-notification` function needs a new interface branch:

**New call signature for client-targeted templates:**
```typescript
{
  template: 'activation_invite',
  to: string,           // client email
  client_name: string,
  company_name: string,
  activation_token: string
}
```

The `send-notification` function's TypeScript `Template` union type must be updated to include `'activation_invite'`, and the handler must support the direct-payload path alongside the existing `deal_id`-based path.

**Email content:**
```
Subject: You're all set — activate your Reliant Support account

Hi {client_name},

Great news — your AI receptionist account for {company_name} is fully configured and ready to go.

Follow the link below to set up your subscription and create your password to access your dashboard:

[Proceed → https://app.reliantsupport.net/?activate={activation_token}]

— The Reliant Support Team

If you have any questions, contact us at support@reliantsupport.net
```

---

### 3.4 New Component: `ActivationPage.jsx`

**File:** `src/pages/ActivationPage.jsx`

**Rendered when:** `App.jsx` detects `params.has('activate')` in the render-time URL check (Section 1.3)

**Two steps rendered in sequence:**

#### Step 1 — Set Up Subscription

On mount, calls `get-activation-data` with `{ activation_token }`.

**Error state:** If `get-activation-data` returns 404 or any error, show:
> "This activation link is invalid or has already been used. If you need help, contact support@reliantsupport.net"

On success, displays:
- Heading: "Welcome, {company_name}!"
- Plan name, monthly cost, billing cycle
- Brief: "Set up your subscription to activate your account."
- CTA button: **"Set Up Subscription"**

Clicking calls `create-subscription-checkout` → on success, redirects to Stripe checkout URL.

Stripe redirects back to `/?activate=<token>&paid=true` on success, or `/?activate=<token>` on cancel.

#### Step 2 — Set Password
Rendered when URL contains both `?activate=<token>` and `?paid=true`.

Displays:
- Heading: "Subscription active — set your password"
- Brief: "One last step. Create a password to access your dashboard."
- Email field (pre-filled from `get-activation-data`, read-only)
- Password field (min 8 characters, frontend validation)
- Confirm password field
- CTA button: **"Access My Dashboard"**

On submit:
1. Validates passwords match and both ≥ 8 characters
2. Calls `verify-activation` with `{ activation_token, password }`
3. On `{ error: 'token_expired' }`: show "This activation link has expired. Contact support@reliantsupport.net to resend your activation."
4. On `{ access_token, refresh_token }`: call `supabase.auth.setSession({ access_token, refresh_token })` → `onAuthStateChange` fires → `useEffect([user])` resolveRole() → client lands on dashboard

---

### 3.5 New Edge Function: `get-activation-data`

- Validates `activation_token` exists in `clients` table — return 404 if not found
- Joins to `deals` via `deals.supabase_client_id = clients.id` (set by `send-activation-invite` — unambiguous, no multi-row risk)
- Returns: `{ company_name, email, plan_name, monthly_price, billing_cycle }`
  - `plan_name` and `monthly_price` derived from `deal.plan`: `'standard'` → "Standard Plan", $495/mo; `'pro'` → "Pro Plan", $695/mo
- No authentication required — `activation_token` is the access control

---

### 3.6 New Edge Function: `create-subscription-checkout`

- Validates `activation_token` → fetches `clients` row
- Reads `clients.stripe_customer_id` (set by `send-activation-invite`) — fail fast if null
- Joins to `deals` via `deals.supabase_client_id = clients.id` to get `plan` and `billing_cycle`
- Maps plan + billing_cycle to Stripe Price ID:
  - Monthly Price IDs (reuse from existing `create-checkout-session`):
    - `'standard'` monthly → `price_1T7BFxJVgG4IIGoFcnMC98UN`
    - `'pro'` monthly → `price_1T7BLkJVgG4IIGoFRdPuSpS9`
  - Annual Price IDs: **must be created in Stripe dashboard before implementation**. Add as env vars `STRIPE_PRICE_STANDARD_ANNUAL` and `STRIPE_PRICE_PRO_ANNUAL` in the Edge Function. Document placeholder until IDs are confirmed.
- Creates Stripe `checkout.session` with:
  - `mode: 'subscription'`
  - `customer: clients.stripe_customer_id` — **must use same Stripe customer as setup fee to ensure `invoice.paid` finds the deal for commission calculation**
  - `metadata: { client_id: clients.id, type: 'subscription' }` — required for the existing `checkout.session.completed → subscription` webhook branch to correctly update `clients` subscription fields
  - `success_url: https://app.reliantsupport.net/?activate={activation_token}&paid=true`
  - `cancel_url: https://app.reliantsupport.net/?activate={activation_token}`
- Returns `{ url: stripeCheckoutUrl }`

**Stripe webhook compatibility:** The existing `checkout.session.completed` handler for `mode === 'subscription'` reads `session.metadata.client_id` to update subscription fields on `clients`. Including `client_id` in the metadata ensures this handler fires correctly for the new flow at no extra code cost.

---

### 3.7 New Edge Function: `verify-activation`

- Validates `activation_token` → fetches `clients` row; return 404 if not found
- Retrieves `invite_token_hash` from `clients` row
- Calls `supabase.auth.admin.verifyOtp({ token_hash: invite_token_hash, type: 'invite' })`
  - On error (expired/invalid token): return HTTP 200 `{ error: 'token_expired' }` — not 500, so frontend can show friendly message
  - On success: `response.data` contains both `{ user, session }` as sibling properties:
    - `response.data.user.id` → used for `updateUserById`
    - `response.data.session.access_token` + `response.data.session.refresh_token` → returned to frontend
- Calls `supabase.auth.admin.updateUserById(response.data.user.id, { password })`
- Clears one-time fields: `UPDATE clients SET activation_token = NULL, invite_token_hash = NULL WHERE id = client.id`
- Returns `{ access_token: response.data.session.access_token, refresh_token: response.data.session.refresh_token }`

**Deal activation chain:** After the client pays their subscription, Stripe fires `invoice.paid`. The webhook finds the deal via `deals.stripe_customer_id` (which matches `clients.stripe_customer_id` since they're the same Stripe customer). Deal transitions to `'active'` and commissions are calculated. No changes needed to this flow.

---

### 3.8 Admin Panel Changes

**File:** `src/Admin.jsx`

Add a **"Send Activation Invite"** button to each client row.

- Button visibility: shown when `client.setup_complete = FALSE` (or NULL). Uses the `setup_complete` boolean on `clients` — no join to `deals` needed.
- After invite is sent, `setup_complete = TRUE` → button changes to "Resend Activation" (for expired token recovery)
- Shows "Sending..." during request
- On success: brief "Invite sent!" confirmation
- On error (e.g., `setup_fee_not_paid`): show error inline

---

## Required Config Changes (one-time, before implementation)

1. **Supabase Auth → Settings → OTP Expiry:** Set to `604800` (7 days). Gives clients a 7-day window to complete activation after receiving the invite.

2. **Supabase Auth → Settings → Password → Minimum password length:** Set to `8`. Aligns server-side enforcement with the frontend's 8-character validation in `ActivationPage`. Without this, a 6-or-7-character password would pass server validation even though the frontend rejects it.

3. **Stripe dashboard:** Create annual Price IDs for Standard and Pro plans before implementation begins. Add as `STRIPE_PRICE_STANDARD_ANNUAL` and `STRIPE_PRICE_PRO_ANNUAL` Supabase Edge Function secrets.

---

## Out of Scope

- Forwarding phone number in client dashboard — deferred
- Any changes to technician/dispatcher invite flow (TeamTab, invite-user Edge Function)
- Sales rep commission calculations or HubSpot sync changes

---

## Files Affected

| File | Change |
|---|---|
| `src/pages/SalesRepDashboard.jsx` | Button text, remove redundant success text |
| `src/App.jsx` | Add `?activate=` render-time bypass + `getSession` early-exit |
| `src/pages/OnboardingPage.jsx` | Resequence: payment step → form step → thank you step |
| `src/pages/ActivationPage.jsx` | **NEW** — 2-step activation (subscription + password) |
| `src/Admin.jsx` | Add "Send Activation Invite" button, uses `setup_complete` flag |
| `supabase/functions/send-notification/index.ts` | Update `onboarding_link_client` template; add `activation_invite` template + direct-payload interface |
| `supabase/functions/create-onboarding-checkout/index.ts` | Remove `onboarding_data` param and save block; accept `{ token }` only |
| `supabase/functions/stripe-webhook/index.ts` | Remove `status='setup_in_progress'` update + Greg/rep notification dispatch from setup_fee branch |
| `supabase/functions/save-onboarding-data/index.ts` | **NEW** — saves form data, updates status, triggers notifications |
| `supabase/functions/send-activation-invite/index.ts` | **NEW** — copies stripe_customer_id, sets supabase_client_id FK, generates invite token, sends email |
| `supabase/functions/get-activation-data/index.ts` | **NEW** — returns client plan/name for activation page |
| `supabase/functions/create-subscription-checkout/index.ts` | **NEW** — creates Stripe subscription checkout session |
| `supabase/functions/verify-activation/index.ts` | **NEW** — verifies invite token, sets password, returns session |
| `supabase/migrations/20260325007_clients_activation_columns.sql` | **NEW** — adds `activation_token`, `invite_token_hash`, `setup_complete` to `clients` |
