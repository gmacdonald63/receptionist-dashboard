# Onboarding Flow Redesign — Design Spec
**Date:** 2026-03-25
**Status:** Draft (rev 2)

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

`App.jsx` has a render-time URL param check (around line 1691) that renders `OnboardingPage` when `?token=` is present, bypassing auth. This check is currently broken or missing, causing the app to fall through to the Login screen.

**Fix:** In the render-time URL param block (same location as the existing `?token=` check, NOT in the `getSession` block where `?track` lives), confirm that:
- `params.has('token')` → renders `<OnboardingPage />` without requiring login
- Add `params.has('activate')` → renders `<ActivationPage />` without requiring login (see Section 3)

Both checks must be placed **before** the `authLoading` spinner check so they render immediately on page load regardless of session state.

Additionally, in `getSession().then()`, add an early-exit for `?activate=` (same pattern as `?track`) to prevent `resolveRole()` from running for the activation URL.

**`onAuthStateChange` SIGNED_IN guard:** The existing interceptor at line ~141 that checks for `invited_at` and shows `ResetPassword` will not fire for activation flow clients since they have no auth session at the point of activation. No change needed here.

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
- Change `const { token, onboarding_data } = await req.json()` → `const { token } = await req.json()`
- Remove `!onboarding_data` from the validation guard (only `!token` check remains)
- Remove the `supabase.from('deals').update({ onboarding_data })` block entirely — that responsibility moves to `save-onboarding-data`

The Stripe metadata (`type: 'setup_fee'`) and webhook handler remain unchanged.

#### Stripe webhook — `checkout.session.completed` + `setup_fee` branch

**Two removals required** (both currently fire at payment time but must move to after form submission):

1. **Remove** `deal.status = 'setup_in_progress'` update from this branch — `save-onboarding-data` owns this now
2. **Remove** the `send-notification` calls for `setup_fee_paid_greg` and `setup_fee_paid_rep` from this branch — `save-onboarding-data` owns these too (and must fire them AFTER form data is saved so Greg's email contains the full setup details)

The Stripe webhook still captures `stripe_customer_id` and `stripe_setup_payment_id` on the deal — that stays.

#### New Edge Function: `save-onboarding-data`

Called from OnboardingPage Step 2 submit.

Steps (in order):
1. Validate `token` → fetch deal (error if not found or status already past `setup_in_progress`)
2. Save `onboarding_data` JSONB to deal record
3. Update `deal.status = 'setup_in_progress'`
4. **Copy `deals.stripe_customer_id` → `clients.stripe_customer_id`** where `clients.email = deal.client_email` (this ensures the client record has the Stripe customer ID needed for subscription checkout — see Section 3 note)
5. Dispatch `setup_fee_paid_greg` notification (non-blocking) — now includes full onboarding data since it fires after form save
6. Dispatch `setup_fee_paid_rep` notification (non-blocking)
7. Return `{ saved: true }`

**Important:** Notifications must only be dispatched here (step 5–6), never from the Stripe webhook `checkout.session.completed` branch. The Stripe webhook now fires them at the wrong time (before form data exists). See stripe-webhook removals above.

---

## Section 3: Setup Complete Invite — Activation Flow (Option B)

This is a new end-to-end flow triggered by Greg after he has finished setting up a client's account.

### Overview

Greg clicks "Send Activation Invite" in the Admin panel → client receives a "Congratulations" email with a "Proceed" button → client lands on a new `ActivationPage` → pays for their subscription via Stripe → sets their password → lands on their dashboard.

---

### 3.1 Database Changes

**Migration:** `supabase/migrations/20260325007_clients_activation_columns.sql`

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS activation_token UUID,
  ADD COLUMN IF NOT EXISTS invite_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN DEFAULT FALSE;
```

- `activation_token` — UUID Greg's system generates when sending the activation invite. URL param: `/?activate=<uuid>`. Cleared after activation completes.
- `invite_token_hash` — Hashed token from Supabase `auth.admin.generateLink`. Stored server-side for use in `verify-activation`. Cleared after activation completes.
- `setup_complete` — Boolean flag set to `TRUE` by `send-activation-invite`. Used by Admin.jsx to show/hide the "Send Activation Invite" button without requiring a join to `deals`.

---

### 3.2 New Edge Function: `send-activation-invite`

**Trigger:** Greg clicks "Send Activation Invite" in Admin panel

**Steps:**
1. Authenticate caller — verify they are an owner/admin (`clients` table lookup by `auth.uid()` email)
2. Fetch the target `clients` row by `client_id`
3. Call `supabase.auth.admin.generateLink({ type: 'invite', email: client.email, options: { redirectTo: 'https://app.reliantsupport.net' } })` — generates Supabase invite token WITHOUT sending Supabase's own email. Extract `data.properties.hashed_token`.
4. Generate `activation_token = crypto.randomUUID()`
5. Update `clients` row: set `invite_token_hash`, `activation_token`, `setup_complete = TRUE`
6. Dispatch `activation_invite` email template via `send-notification` (non-blocking)
7. Return `{ sent: true }`

**Token expiry note:** Supabase invite tokens from `generateLink` expire after the project's configured OTP expiry period. The Supabase Auth setting "OTP Expiry" must be increased to **604800 seconds (7 days)** in the Supabase Auth dashboard to give clients a reasonable activation window. This is a one-time config change, not a code change.

---

### 3.3 New Email Template: `activation_invite`

**File:** `supabase/functions/send-notification/index.ts`

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

**Rendered when:** `App.jsx` detects `params.has('activate')` in the URL (see Section 1.3 for placement)

**Two steps rendered in sequence:**

#### Step 1 — Set Up Subscription

On mount, calls `get-activation-data` Edge Function with `{ activation_token }`. Displays:
- Heading: "Welcome, {company_name}!"
- Plan details: plan name, monthly cost, billing cycle
- Brief note: "Set up your subscription to activate your account."
- CTA button: **"Set Up Subscription"**

Clicking calls `create-subscription-checkout` Edge Function. On success, redirects to Stripe checkout URL.

Stripe redirects back to `/?activate=<token>&paid=true` on success, or `/?activate=<token>` on cancel.

#### Step 2 — Set Password
Rendered when URL contains both `?activate=<token>` and `?paid=true`.

Displays:
- Heading: "Subscription active — set your password"
- Brief: "One last step. Create a password to access your dashboard."
- Email field (pre-filled from `get-activation-data`, read-only)
- Password field (min 8 characters)
- Confirm password field
- CTA button: **"Access My Dashboard"**

On submit:
1. Validates passwords match and meet minimum length
2. Calls `verify-activation` Edge Function with `{ activation_token, password }`
3. On success: receives `{ access_token, refresh_token }`
4. Calls `supabase.auth.setSession({ access_token, refresh_token })`
5. `onAuthStateChange` fires → `useEffect([user])` resolveRole() runs → client lands on dashboard

**Error handling — expired token:**
If `verify-activation` returns `{ error: 'token_expired' }`, display:
> "This activation link has expired. Please contact us at support@reliantsupport.net to resend your activation."

No retry button — requires Greg to resend from Admin panel.

---

### 3.5 New Edge Function: `get-activation-data`

- Validates `activation_token` exists in `clients` table — returns 404 if not found
- Joins to `deals` via `deals.client_email = clients.email` (or `deals.supabase_client_id = clients.id` if that FK exists) to retrieve `plan`, `billing_cycle`
- Derives plan display name and monthly price from `deal.plan` key:
  - `'standard'` → "Standard Plan", $495/mo
  - `'pro'` → "Pro Plan", $695/mo
- Returns: `{ company_name, email, plan_name, monthly_price, billing_cycle }`
- No authentication required — `activation_token` is the access control

---

### 3.6 New Edge Function: `create-subscription-checkout`

- Validates `activation_token` → fetches `clients` row
- Fetches `clients.stripe_customer_id` (populated by `save-onboarding-data` — see Section 2)
- Joins to `deals` to get `plan` and `billing_cycle` (same join as `get-activation-data`)
- Creates Stripe `checkout.session` with `mode: 'subscription'`:
  - `customer: clients.stripe_customer_id` — **must use the same Stripe customer as the setup fee to ensure `invoice.paid` webhook can locate the deal and calculate commissions**
  - Price ID mapped from `deal.plan` + `deal.billing_cycle`
  - `success_url: https://app.reliantsupport.net/?activate={activation_token}&paid=true`
  - `cancel_url: https://app.reliantsupport.net/?activate={activation_token}`
- Returns `{ url: stripeCheckoutUrl }`

---

### 3.7 New Edge Function: `verify-activation`

- Validates `activation_token` → fetches `clients` row
- Retrieves `invite_token_hash` from clients row
- Calls `supabase.auth.admin.verifyOtp({ token_hash: invite_token_hash, type: 'invite' })`
  - On error (expired/invalid): return `{ error: 'token_expired' }` with HTTP 200 (not 500) so frontend can show the friendly expiry message
  - On success: extract `data.session.access_token` and `data.session.refresh_token`
- Calls `supabase.auth.admin.updateUserById(data.user.id, { password })`
- Clears one-time fields: set `clients.activation_token = NULL`, `clients.invite_token_hash = NULL`
- Returns `{ access_token, refresh_token }`

**Deal activation:** After the client pays their subscription, Stripe fires `invoice.paid` which transitions `deal.status → 'active'` and calculates commissions. This webhook finds the deal via `stripe_customer_id`. Since `create-subscription-checkout` uses `clients.stripe_customer_id` (which was copied from `deals.stripe_customer_id` by `save-onboarding-data`), the same Stripe customer is used and the webhook correctly locates the deal.

---

### 3.8 Admin Panel Changes

**File:** `src/Admin.jsx`

Add a **"Send Activation Invite"** button to each client row.

- Button visibility: shown when `client.setup_complete = FALSE` (or NULL) — meaning Greg hasn't sent the invite yet. Uses the new `setup_complete` boolean on `clients` — no join to `deals` needed.
- After invite is sent, `setup_complete` is set to `TRUE` by `send-activation-invite`, so the button is hidden (or replaced with "Resend Activation Invite" for the expired token case)
- Shows "Sending..." during the request
- On success: brief confirmation ("Invite sent!")
- On error: show error message inline

---

## Required Config Change (one-time)

**Supabase Auth → Settings → OTP Expiry:** Set to `604800` (7 days).

This applies to all OTP/magic link emails in the project. It ensures clients have a 7-day window to complete activation after receiving the invite email.

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
| `supabase/functions/send-notification/index.ts` | Update `onboarding_link_client` template; add `activation_invite` template |
| `supabase/functions/create-onboarding-checkout/index.ts` | Remove `onboarding_data` param and save block; accept `{ token }` only |
| `supabase/functions/stripe-webhook/index.ts` | Remove `status='setup_in_progress'` update + Greg/rep notification dispatch from `checkout.session.completed` setup_fee branch |
| `supabase/functions/save-onboarding-data/index.ts` | **NEW** — saves form data, copies stripe_customer_id to clients, triggers notifications |
| `supabase/functions/send-activation-invite/index.ts` | **NEW** — generates Supabase invite token, stores it, sends activation email |
| `supabase/functions/get-activation-data/index.ts` | **NEW** — returns client plan/name for activation page |
| `supabase/functions/create-subscription-checkout/index.ts` | **NEW** — creates Stripe subscription checkout session |
| `supabase/functions/verify-activation/index.ts` | **NEW** — verifies invite token, sets password, returns session |
| `supabase/migrations/20260325007_clients_activation_columns.sql` | **NEW** — adds `activation_token`, `invite_token_hash`, `setup_complete` to `clients` |
