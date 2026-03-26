# Onboarding Flow Redesign — Design Spec
**Date:** 2026-03-25
**Status:** Draft

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
- Remove the green success heading: `"Onboarding Link ready — copy and send to client"` (or equivalent text shown after the link is generated)
- Keep the onboarding URL display and the Copy button — useful fallback if the email bounces

### 1.2 send-notification Edge Function — onboarding_link_client template

**File:** `supabase/functions/send-notification/index.ts`

- CTA button text: `"Complete Your Setup"` → `"Begin Your Setup"`
- Footer copy: `"If you have any questions, reply to this email or contact your sales representative."` → `"If you have any questions, contact us at support@reliantsupport.net"`

### 1.3 Bug Fix — Onboarding Link Goes to Login Screen

**File:** `src/App.jsx`

`App.jsx` currently checks for `?track` in the URL to bypass authentication and render the tracking page. The same check is missing for `?token=`, which causes the onboarding link to fall through to the Login screen instead of rendering `OnboardingPage`.

**Fix:** In the URL param check near the top of `App.jsx`, add `|| params.has('token')` alongside the existing `?track` check. When `?token=` is present and the user is unauthenticated, render `<OnboardingPage />` directly without requiring login.

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
- Page heading: e.g. "Complete Your Account Setup"
- Brief intro: "To get started, a one-time setup fee of $395 is required. This covers your AI receptionist configuration."
- Company name pre-filled from deal data (read-only, for reassurance)
- CTA button: **"Pay Setup Fee — $395"**
- Clicking the button calls `create-onboarding-checkout` Edge Function and redirects to Stripe

The `create-onboarding-checkout` function already saves form data to `deal.onboarding_data`. Since the form now comes *after* payment, the checkout call at this step does NOT include form data — it only needs `deal_id` / `token` to create the Stripe session.

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
- Calls a new lightweight Edge Function (or updates `create-onboarding-checkout`) to save `onboarding_data` to the deal record
- On success → renders Step 3

### Step 3 — Thank You Screen
Rendered after successful form submission.

Content:
- Heading: **"Thank You — Your Setup is Now in Progress!"**
- Body: "We've received your setup information. You'll receive an email from us once your account is ready to activate."
- No further actions — just confirmation

### Edge Function Changes

`create-onboarding-checkout` currently saves form data + creates the Stripe session in one call. With the resequencing:

- **Stripe checkout creation** (Step 1): called with only `token` / `deal_id`. No form data.
- **Form data save** (Step 2 submit): a new call is needed to save `onboarding_data` and trigger the Greg/rep notification emails.

Options:
- A) Add a new `save-onboarding-data` Edge Function for Step 2 submit
- B) Repurpose the existing `create-onboarding-checkout` function — on call without Stripe fields, just save data and trigger notifications

**Recommendation: Option A** — clean separation of concerns. `create-onboarding-checkout` stays focused on Stripe. `save-onboarding-data` handles form persistence and notification dispatch.

The `save-onboarding-data` function:
1. Validates token → fetches deal
2. Saves `onboarding_data` JSONB to deal record
3. Updates `deal.status` to `'setup_in_progress'` (currently done by Stripe webhook — move this trigger here since payment already happened)
4. Dispatches `setup_fee_paid_greg` and `setup_fee_paid_rep` notification emails (non-blocking)

---

## Section 3: Setup Complete Invite — Activation Flow (Option B)

This is a new end-to-end flow triggered by Greg after he has finished setting up a client's account.

### Overview

Greg clicks "Send Activation Invite" in the Admin panel → client receives a "Congratulations" email with a "Proceed" button → client lands on a new `ActivationPage` → pays for their subscription via Stripe → sets their password → lands on their dashboard.

---

### 3.1 Database Changes

**Migration:** Add `activation_token UUID` and `invite_token_hash TEXT` columns to the `clients` table.

- `activation_token` — UUID Greg's system generates when sending the activation invite. Used as the URL parameter: `/?activate=<uuid>`. Cleared after the client completes activation.
- `invite_token_hash` — The hashed token from Supabase `auth.admin.generateLink({ type: 'invite', email })`. Stored server-side; used during password setup to exchange for a session without requiring Supabase to send its own email.

---

### 3.2 New Edge Function: `send-activation-invite`

**Trigger:** Greg clicks "Send Activation Invite" in Admin panel

**Steps:**
1. Authenticate caller — verify they are an owner/admin (`clients` table lookup by `auth.uid()` email)
2. Fetch the client record by `client_id`
3. Call `supabase.auth.admin.generateLink({ type: 'invite', email: client.email, options: { redirectTo: 'https://app.reliantsupport.net' } })` — generates Supabase invite token WITHOUT sending Supabase's own email
4. Extract `hashed_token` from the response; store it in `clients.invite_token_hash`
5. Generate a UUID `activation_token`; store it in `clients.activation_token`
6. Dispatch `activation_invite` email template via `send-notification` (non-blocking)
7. Return `{ sent: true }`

---

### 3.3 New Email Template: `activation_invite`

**File:** `supabase/functions/send-notification/index.ts`

```
Subject: You're all set — activate your Reliant Support account

Hi {client_name},

Great news — your AI receptionist account for {company_name} is fully configured and ready to go.

Follow the link below to set up your subscription and create your password:

[Proceed button → https://app.reliantsupport.net/?activate={activation_token}]

— The Reliant Support Team

If you have any questions, contact us at support@reliantsupport.net
```

---

### 3.4 New Component: `ActivationPage.jsx`

**File:** `src/pages/ActivationPage.jsx`

**Rendered when:** `App.jsx` detects `?activate=<token>` in the URL (unauthenticated bypass, same pattern as `?token=` for OnboardingPage)

**Two steps rendered in sequence:**

#### Step 1 — Set Up Subscription

Loads client data from a new `get-activation-data` Edge Function (validates `activation_token`, returns `company_name`, `plan`, `monthly_price`, `client_email`).

Displays:
- Heading: "Welcome, {company_name}!"
- Plan details: plan name, monthly cost, billing cycle
- Brief note: "Set up your subscription to activate your account."
- CTA button: **"Set Up Subscription"**

Clicking the button calls a new `create-subscription-checkout` Edge Function which:
1. Validates `activation_token` → fetches client record
2. Creates a Stripe subscription checkout session (`mode: 'subscription'`) with:
   - The client's plan price (from deal record)
   - `customer: client.stripe_customer_id` (set during setup fee payment)
   - `success_url: https://app.reliantsupport.net/?activate={activation_token}&paid=true`
   - `cancel_url: https://app.reliantsupport.net/?activate={activation_token}`
3. Returns Stripe checkout URL → frontend redirects

#### Step 2 — Set Password
Rendered when URL contains `?activate=<token>&paid=true`.

Displays:
- Heading: "Subscription active — set your password"
- Brief: "One last step. Create a password to access your dashboard."
- Email field (pre-filled from `get-activation-data`, read-only)
- Password field
- Confirm password field
- CTA button: **"Access My Dashboard"**

On submit:
1. Calls `verify-activation` Edge Function with `{ activation_token, password }`
2. Edge Function:
   a. Fetches `clients` row by `activation_token`
   b. Calls `supabase.auth.admin.verifyOtp({ token_hash: invite_token_hash, type: 'invite' })` — exchanges the stored invite token for a valid session
   c. Calls `supabase.auth.admin.updateUserById(user.id, { password })` — sets their password
   d. Returns `{ access_token, refresh_token }` from the session
3. Frontend calls `supabase.auth.setSession({ access_token, refresh_token })`
4. User is now logged in → `onAuthStateChange` fires → role resolver runs → client lands on their dashboard

---

### 3.5 New Edge Function: `get-activation-data`

- Validates `activation_token` exists in `clients` table
- Returns: `company_name`, `plan_name`, `monthly_price`, `billing_cycle`, `email`
- Does NOT require authentication (public endpoint, token is the access control)

---

### 3.6 New Edge Function: `create-subscription-checkout`

- Validates `activation_token`
- Fetches client's plan details from associated deal record
- Creates Stripe `checkout.session` with `mode: 'subscription'`
- Uses existing `stripe_customer_id` from the setup fee payment step
- Returns Stripe checkout URL

---

### 3.7 New Edge Function: `verify-activation`

- Validates `activation_token`
- Calls `supabase.auth.admin.verifyOtp` with stored `invite_token_hash`
- Sets password via `supabase.auth.admin.updateUserById`
- Clears `activation_token` and `invite_token_hash` from `clients` row (one-time use)
- Returns session tokens

---

### 3.8 Admin Panel Changes

**File:** `src/Admin.jsx`

Add a **"Send Activation Invite"** button to each client row in the clients list. Button:
- Only visible for clients whose setup is complete (status: `setup_in_progress` or similar)
- Shows "Sending..." during the request
- On success: shows a brief confirmation ("Invite sent!")
- On error: shows error message

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
| `src/App.jsx` | Add `?activate=` and `?token=` URL bypass checks |
| `src/pages/OnboardingPage.jsx` | Resequence: payment step → form step → thank you step |
| `src/pages/ActivationPage.jsx` | **NEW** — 2-step activation (subscription + password) |
| `src/Admin.jsx` | Add "Send Activation Invite" button per client row |
| `supabase/functions/send-notification/index.ts` | Update `onboarding_link_client` template; add `activation_invite` template |
| `supabase/functions/create-onboarding-checkout/index.ts` | Remove form data from checkout call (Step 1 only needs token) |
| `supabase/functions/save-onboarding-data/index.ts` | **NEW** — saves form data, triggers notifications |
| `supabase/functions/send-activation-invite/index.ts` | **NEW** — generates Supabase invite token, stores it, sends email |
| `supabase/functions/get-activation-data/index.ts` | **NEW** — returns client plan/name for activation page |
| `supabase/functions/create-subscription-checkout/index.ts` | **NEW** — creates Stripe subscription checkout session |
| `supabase/functions/verify-activation/index.ts` | **NEW** — verifies invite token, sets password, returns session |
| `supabase/migrations/20260325007_clients_activation_columns.sql` | **NEW** — adds `activation_token`, `invite_token_hash` to `clients` |
