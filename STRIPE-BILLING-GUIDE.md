# Stripe Billing & Subscription System — Complete Implementation Guide

**Project:** AI Receptionist Dashboard
**Stack:** React 18 + Vite (frontend) | Supabase (auth + database) | Stripe (payments) | Vercel (hosting)
**Last Updated:** March 2026

---

## Table of Contents

1. [Overview — What This System Does](#1-overview)
2. [The Complete Client Lifecycle](#2-the-complete-client-lifecycle)
3. [Stripe Configuration](#3-stripe-configuration)
4. [Database Schema — Billing Columns](#4-database-schema)
5. [Supabase Edge Functions (Server-Side)](#5-supabase-edge-functions)
6. [Frontend Implementation (Client-Side)](#6-frontend-implementation)
7. [Subscription Gating — Access Control](#7-subscription-gating)
8. [Webhook Event Handling](#8-webhook-event-handling)
9. [Billing Portal — Self-Service Management](#9-billing-portal)
10. [Key Files Reference](#10-key-files-reference)
11. [Setup Checklist — Reproducing This From Scratch](#11-setup-checklist)

---

## 1. Overview

This system handles the full billing lifecycle for the AI Receptionist service:

- **Admin creates a new client** in the Admin panel (company name, email, Retell agent ID)
- **Admin sends an email invitation** — client receives a password reset link
- **Client sets their password** and logs in for the first time
- **Client is blocked from the dashboard** — they can only see the Billing tab with a "Subscribe Now" button
- **Client clicks "Subscribe Now"** — redirected to a Stripe Checkout page to enter payment info
- **Stripe processes the payment** — sends a webhook back to our server
- **Webhook updates the database** — `subscription_status` changes from `inactive` to `active`
- **Dashboard unlocks** — client now has full access to appointments, customers, calls, and billing
- **Monthly billing auto-renews** via Stripe — if payment fails, access is restricted again
- **Client can self-manage** their subscription through the Stripe Billing Portal (update card, view invoices, cancel)

### What the admin sees vs. what the client sees

| Admin | Client (no subscription) | Client (active subscription) |
|-------|--------------------------|------------------------------|
| Full dashboard + Admin panel | Only the Billing tab with "Subscribe Now" | Full dashboard (appointments, customers, calls, billing) |
| Can manage all clients | Cannot see any data | Full access to their own data |
| Bypasses subscription check | Blocked until payment | Active until subscription lapses |

---

## 2. The Complete Client Lifecycle

Here is the step-by-step journey from "new client" to "paying subscriber":

### Step 1: Admin Creates the Client Record

In the **Admin panel** (`src/Admin.jsx`), the admin fills out a form with:
- Company name
- Email address
- Retell Agent ID (the AI voice agent assigned to this client)

This creates a row in the `clients` table with `subscription_status = 'inactive'`.

### Step 2: Admin Sends the Invitation

The admin clicks "Send Invite" on the client row. This does two things:

1. **Creates a Supabase auth user** with a random temporary password (the client never sees this password):
   ```js
   const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';
   await supabase.auth.signUp({ email: client.email, password: tempPassword });
   ```

2. **Sends a password reset email** so the client can set their own password:
   ```js
   await supabase.auth.resetPasswordForEmail(client.email, {
     redirectTo: `${window.location.origin}/reset-password`
   });
   ```

The client record is updated with `invite_sent = true` and `invite_sent_at = timestamp`.

### Step 3: Client Sets Their Password

The client clicks the link in the email, which opens the `/reset-password` page (`src/ResetPassword.jsx`). They enter a new password (minimum 6 characters). On success, they're redirected to the main app.

### Step 4: Client Logs In and Hits the Subscription Gate

When the client logs in, the app:
1. Authenticates via Supabase Auth
2. Fetches the client's row from the `clients` table by email
3. Checks `subscription_status` — if it's `inactive`, the subscription gate activates
4. The client sees ONLY the Billing tab with a welcome message and "Subscribe Now" button

### Step 5: Client Subscribes via Stripe Checkout

When the client clicks "Subscribe Now":
1. Frontend calls the `create-checkout-session` Edge Function
2. Edge Function creates (or retrieves) a Stripe Customer for this client
3. Edge Function creates a Stripe Checkout Session for the $499/month subscription
4. Frontend redirects the browser to the Stripe-hosted checkout page
5. Client enters their credit card details on Stripe's secure page
6. On success, Stripe redirects back to the app with `?billing=success` in the URL

### Step 6: Webhook Activates the Subscription

After Stripe processes the payment:
1. Stripe sends a `checkout.session.completed` webhook to our `stripe-webhook` Edge Function
2. The webhook handler updates the `clients` table:
   - `stripe_customer_id` = the Stripe customer ID
   - `stripe_subscription_id` = the Stripe subscription ID
   - `subscription_status` = `active`
   - `current_period_end` = the end date of the billing period

### Step 7: Frontend Detects Activation

Meanwhile, the frontend is polling:
1. After the Stripe redirect, the app polls the `clients` table every 2 seconds (up to 6 attempts)
2. When it detects `subscription_status = 'active'`, it stops the spinner
3. The subscription gate lifts and the full dashboard is now accessible

### Step 8: Ongoing Billing

- Stripe automatically charges the client monthly
- If payment succeeds: `invoice.paid` webhook fires (logged)
- If payment fails: `invoice.payment_failed` webhook fires, status set to `past_due`
- If `past_due`: client sees a "Payment Required" alert and can only access billing to update their card
- If the client cancels: `customer.subscription.deleted` webhook fires, gate re-engages

---

## 3. Stripe Configuration

### Stripe Product & Price

| Field | Value |
|-------|-------|
| Product Name | AI Receptionist Service |
| Price | $499.00/month (USD, recurring) |
| Price ID | `price_1T6jSqJVgG4IIGoFgZE6uXyf` |
| Billing cycle | Monthly |

This Price ID is hardcoded in the `create-checkout-session` Edge Function.

### Stripe Webhook Endpoint

| Field | Value |
|-------|-------|
| URL | `https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1/stripe-webhook` |
| Events | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` |

This must be configured in the Stripe Dashboard under **Developers > Webhooks**.

### Stripe Secrets (stored in Supabase)

These are set as Supabase Edge Function secrets (not in code):

| Secret | Purpose |
|--------|---------|
| `STRIPE_SECRET_KEY` | Server-side Stripe API key for creating sessions, retrieving subscriptions |
| `STRIPE_WEBHOOK_SECRET` | Verifies that webhook requests actually came from Stripe (optional in test mode) |

To set these:
```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_live_... --project-ref zmppdmfdhknnwzwdfhwf
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref zmppdmfdhknnwzwdfhwf
```

### Stripe Billing Portal

The Stripe Billing Portal must be configured in the Stripe Dashboard under **Settings > Billing > Customer Portal**. Enable:
- Update payment methods
- View invoice history
- Cancel subscriptions

No code changes needed — Stripe hosts the portal UI.

---

## 4. Database Schema

Four columns were added to the existing `clients` table via migration:

**File:** `supabase/migrations/20260303_add_stripe_columns.sql`

```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
```

### Column Details

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `stripe_customer_id` | TEXT | NULL | Stripe's customer ID (e.g., `cus_abc123`). Created when the client first subscribes. |
| `stripe_subscription_id` | TEXT | NULL | Stripe's subscription ID (e.g., `sub_xyz789`). Set when checkout completes. |
| `subscription_status` | TEXT | `'inactive'` | Current status. Synced from Stripe via webhooks. |
| `current_period_end` | TIMESTAMPTZ | NULL | When the current billing period ends. Used to show "Next billing date" in the UI. |

### Subscription Status Values

| Status | Meaning | Dashboard Access? |
|--------|---------|-------------------|
| `inactive` | Never subscribed (default) | NO — sees "Subscribe Now" |
| `active` | Subscription is current and paid | YES — full access |
| `trialing` | In a free trial period (if configured) | YES — full access |
| `past_due` | Payment failed, awaiting retry/update | NO — sees "Payment Required" + billing portal |
| `canceled` | Subscription was cancelled | NO — sees "Subscribe Now" |
| `unpaid` | Invoice went unpaid past retry attempts | NO — sees "Subscribe Now" |

---

## 5. Supabase Edge Functions

Three Edge Functions handle all server-side Stripe interactions. All are deployed to Supabase and run as Deno serverless functions.

### 5a. `create-checkout-session`

**File:** `supabase/functions/create-checkout-session/index.ts`
**Purpose:** Creates a Stripe Checkout session and returns the URL to redirect the client to.

**Flow:**
1. Receives the client's Supabase auth token in the `Authorization` header
2. Validates the token and looks up the client in the `clients` table
3. Creates a Stripe Customer if one doesn't exist yet (stores `stripe_customer_id` in the DB)
4. Creates a Stripe Checkout Session in `subscription` mode for the $499/month price
5. Returns the checkout URL — frontend redirects the browser there

**Key details:**
- Uses the authenticated user's Supabase session (not anon access)
- Uses the Supabase service role key to write `stripe_customer_id` back to the DB
- Success URL: `{origin}?billing=success` — triggers the frontend polling
- Cancel URL: `{origin}?billing=cancelled` — returns to dashboard with no changes

### 5b. `create-billing-portal`

**File:** `supabase/functions/create-billing-portal/index.ts`
**Purpose:** Opens the Stripe Customer Portal for an existing subscriber.

**Flow:**
1. Validates the auth token
2. Looks up the client and ensures they have a `stripe_customer_id`
3. Creates a Stripe Billing Portal session
4. Returns the portal URL — frontend redirects the browser there

**Key details:**
- Only works for clients who have already subscribed (need a `stripe_customer_id`)
- Returns 400 error with "No billing account found" if the client hasn't subscribed yet
- The portal is hosted by Stripe — handles payment updates, invoice viewing, and cancellation

### 5c. `stripe-webhook`

**File:** `supabase/functions/stripe-webhook/index.ts`
**Purpose:** Receives webhook events from Stripe and syncs subscription state to the database.

**Events handled:**

| Event | What it does |
|-------|--------------|
| `checkout.session.completed` | Retrieves the full subscription object from Stripe. Updates the client's `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, and `current_period_end`. This is what activates the subscription after checkout. |
| `customer.subscription.updated` | Finds the client by `stripe_customer_id` and updates subscription fields. Handles upgrades, downgrades, renewals, and status changes. |
| `customer.subscription.deleted` | Same as updated — marks the subscription with whatever status Stripe reports (usually `canceled`). |
| `invoice.paid` | Logged only. Could be extended to record payment history. |
| `invoice.payment_failed` | Finds the client and sets `subscription_status = 'past_due'`. This triggers the payment gate in the frontend. |

**Key details:**
- Uses the Supabase **service role key** (not anon) because this is a server-to-server call with no user session
- Verifies the Stripe webhook signature if `STRIPE_WEBHOOK_SECRET` is configured
- Falls back to raw JSON parsing if the secret isn't set (useful during development)

### Deploying Edge Functions

```bash
# Set your Supabase personal access token
export SUPABASE_ACCESS_TOKEN=sbp_your_token_here

# Deploy each function
npx supabase functions deploy create-checkout-session --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
npx supabase functions deploy create-billing-portal --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
npx supabase functions deploy stripe-webhook --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

The `--no-verify-jwt` flag is required because:
- `create-checkout-session` and `create-billing-portal` handle their own auth verification internally
- `stripe-webhook` receives calls from Stripe (no Supabase JWT involved)

---

## 6. Frontend Implementation

All billing frontend code lives in **`src/App.jsx`**.

### State Variables

```js
const [billingLoading, setBillingLoading] = useState(false);
const [billingAction, setBillingAction] = useState(null);    // 'checkout' | 'portal'
const [awaitingSubscription, setAwaitingSubscription] = useState(false);
const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';
```

### `handleStripeCheckout()` — Subscribe Now Button

Located at **App.jsx line 937**.

1. Gets the current Supabase session's access token
2. Calls the `create-checkout-session` Edge Function with the token
3. Redirects the browser to the Stripe Checkout URL
4. Button shows "Redirecting to Stripe..." while processing

### `handleBillingPortal()` — Manage Subscription Button

Located at **App.jsx line 964**.

1. Gets the current Supabase session's access token
2. Calls the `create-billing-portal` Edge Function with the token
3. Redirects the browser to the Stripe Billing Portal
4. Button shows "Opening..." while processing

### Post-Checkout Polling

Located at **App.jsx line 135**.

When the client returns from Stripe checkout with `?billing=success`:
1. Sets `awaitingSubscription = true` (shows a spinner)
2. Clears the URL query parameter
3. Polls the `clients` table every 2 seconds
4. Checks if `subscription_status` is `active` or `trialing`
5. Stops polling after status changes or after 6 attempts (12 seconds max)
6. Once active, the spinner disappears and the full dashboard is revealed

### Billing Tab UI (`renderBilling()`)

Located at **App.jsx line 991**.

The billing tab shows different content based on subscription status:

**Not subscribed (`inactive` / `canceled`):**
- Price card: "$499.00/mo — AI Receptionist Service"
- Status badge: "No Subscription" (yellow)
- Big blue "Subscribe Now" button

**Active subscriber (`active` / `trialing`):**
- Price card with "Active" badge (green)
- Next billing date
- "Manage Subscription" button
- Usage stats (calls and minutes this month)
- "Payment & Invoices" section with "Open Billing Portal" button

**Past due (`past_due`):**
- Price card with "Past Due" badge (red)
- Red alert: "Your payment failed. Please update your payment method..."
- "Manage Subscription" button (opens portal to update card)
- Usage stats still visible
- "Open Billing Portal" button

---

## 7. Subscription Gating — Access Control

This is the core access control mechanism. Located at **App.jsx line 1165**.

### How the Gate Works

```js
const isSubscriptionActive = clientData?.is_admin ||
  ['active', 'trialing'].includes(clientData?.subscription_status);

if (!isSubscriptionActive && clientData) {
  // Show ONLY the billing tab — no appointments, customers, or calls
  return (/* gated billing-only view */);
}
```

### What gets blocked

When the gate is active (no subscription):
- **Appointments tab** — blocked
- **Customers tab** — blocked
- **Calls tab** — blocked
- **Data fetching** — the `fetchData()` function that pulls from Retell API and Supabase appointments is NOT called at all (saves API calls)
- **Bottom navigation** — hidden (no tabs to switch between)

### What's still accessible

- **Billing tab** — always accessible (this is how they subscribe)
- **Sign out** — always accessible
- **Header with logo** — always visible

### Who bypasses the gate

- **Admin users** (`is_admin = true` in the `clients` table) bypass the subscription check entirely. Admins always have full access regardless of subscription status.

### Data Fetching Gate

There's a separate gate on the data fetching side too (App.jsx line 167):

```js
useEffect(() => {
  if (user && clientData) {
    const hasAccess = clientData.is_admin ||
      ['active', 'trialing'].includes(clientData.subscription_status);
    if (hasAccess) {
      fetchData();  // Only fetch Retell + appointment data if subscribed
    }
  }
}, [user, clientData]);
```

This means we don't waste API calls fetching data for users who can't see it.

### No-Account Gate

There's also a separate check for users who have valid Supabase auth credentials but no `clients` table record (App.jsx line 1140). They see:

> "No Account Found — Your login credentials are valid, but no client account is set up yet. Please contact your administrator for an invitation."

This prevents someone from signing up directly through Supabase Auth without being invited.

---

## 8. Webhook Event Handling

### Event Flow Diagram

```
Stripe Event                    Webhook Handler              Database Update           Frontend Effect
─────────────                   ───────────────              ───────────────           ───────────────
checkout.session.completed  →   Retrieve subscription    →   status='active'       →   Gate lifts, full access
                                                             period_end set

customer.subscription.updated → Find client by cust ID  →   status/period updated →   UI reflects new status

customer.subscription.deleted → Find client by cust ID  →   status='canceled'     →   Gate re-engages

invoice.paid                →   Log only (no DB write)   →   (none)                →   (none)

invoice.payment_failed      →   Find client by cust ID  →   status='past_due'     →   "Payment Required" alert
```

### How Stripe → Supabase Authentication Works

The webhook function uses the **Supabase service role key** (not the anon key) because:
- Stripe calls this endpoint directly — there's no user session/JWT
- The service role key has full database write access
- The `STRIPE_WEBHOOK_SECRET` provides authentication from the Stripe side

### Webhook Signature Verification

If `STRIPE_WEBHOOK_SECRET` is configured:
```js
event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
```

If not configured (test/development mode):
```js
event = JSON.parse(body);  // Parse raw — no verification
```

For production, you should always configure the webhook secret.

---

## 9. Billing Portal — Self-Service Management

The Stripe Billing Portal lets subscribers manage their own billing without needing admin help.

### What clients can do in the portal

- **Update payment method** — change credit card
- **View invoices** — see all past invoices and download PDFs
- **Cancel subscription** — triggers `customer.subscription.deleted` webhook
- **View upcoming invoice** — see what they'll be charged next

### How it's accessed

Two places in the Billing tab:
1. **"Manage Subscription" button** — shown in the subscription card for active/past-due users
2. **"Open Billing Portal" button** — shown in the "Payment & Invoices" section

Both call the same `handleBillingPortal()` function which hits the `create-billing-portal` Edge Function.

### Portal configuration

The portal's features and appearance are configured in the **Stripe Dashboard** under Settings > Billing > Customer Portal. No code changes needed.

---

## 10. Key Files Reference

| File | What it does |
|------|-------------|
| `src/App.jsx` | Main app. Contains billing state, checkout/portal handlers, billing UI, subscription gate, and post-checkout polling |
| `src/Admin.jsx` | Admin panel. Client creation and invitation sending |
| `src/ResetPassword.jsx` | Password reset form shown when client clicks the invite email link |
| `src/Login.jsx` | Login form with email/password |
| `src/supabaseClient.js` | Supabase client initialization |
| `supabase/functions/create-checkout-session/index.ts` | Edge Function: creates Stripe Checkout session |
| `supabase/functions/create-billing-portal/index.ts` | Edge Function: creates Stripe Billing Portal session |
| `supabase/functions/stripe-webhook/index.ts` | Edge Function: handles all Stripe webhook events |
| `supabase/migrations/20260303_add_stripe_columns.sql` | Migration: adds Stripe columns to `clients` table |

---

## 11. Setup Checklist — Reproducing This From Scratch

If you're setting this up for a new project, here's the order of operations:

### Stripe Setup

- [ ] Create a Stripe account at stripe.com
- [ ] Create a Product (e.g., "AI Receptionist Service")
- [ ] Create a recurring Price on that product (e.g., $499/month) — note the Price ID
- [ ] Update `PRICE_ID` in `create-checkout-session/index.ts` with your price ID
- [ ] Configure the Customer Portal in Stripe Dashboard (Settings > Billing > Customer Portal)
- [ ] Create a webhook endpoint pointing to your `stripe-webhook` Edge Function URL
- [ ] Select the events to listen for: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
- [ ] Note the webhook signing secret (`whsec_...`)

### Supabase Setup

- [ ] Run the migration to add billing columns to `clients`:
  ```sql
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
  ```
- [ ] Set Supabase secrets:
  ```bash
  npx supabase secrets set STRIPE_SECRET_KEY=sk_live_your_key --project-ref YOUR_PROJECT_REF
  npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_secret --project-ref YOUR_PROJECT_REF
  ```
- [ ] Deploy the three Edge Functions:
  ```bash
  npx supabase functions deploy create-checkout-session --project-ref YOUR_PROJECT_REF --no-verify-jwt
  npx supabase functions deploy create-billing-portal --project-ref YOUR_PROJECT_REF --no-verify-jwt
  npx supabase functions deploy stripe-webhook --project-ref YOUR_PROJECT_REF --no-verify-jwt
  ```

### Frontend Setup

- [ ] Add the billing state variables to your main app component
- [ ] Add `handleStripeCheckout()` and `handleBillingPortal()` functions
- [ ] Add the post-checkout polling `useEffect` that watches for `?billing=success`
- [ ] Add the `renderBilling()` component with status-aware UI
- [ ] Add the subscription gate check before rendering the main dashboard
- [ ] Add the data-fetching gate so you don't fetch data for non-subscribers
- [ ] Update `SUPABASE_FUNCTIONS_URL` to point to your Supabase project

### Testing

- [ ] Use Stripe test mode (`sk_test_...` key) during development
- [ ] Use Stripe's test card number `4242 4242 4242 4242` for successful payments
- [ ] Use `4000 0000 0000 0341` for declined payment testing
- [ ] Test the full flow: invite → password set → login → subscribe → dashboard access
- [ ] Test payment failure: verify `past_due` status gates the dashboard correctly
- [ ] Test cancellation: verify the gate re-engages after cancelling via portal
- [ ] Verify the webhook is receiving events in the Stripe Dashboard (Developers > Webhooks > select endpoint > Recent events)

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + Vite)                  │
│                                                                  │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────────┐  │
│  │  Login /     │    │ Subscription │    │   Full Dashboard    │  │
│  │  Reset Pass  │───▶│    Gate      │───▶│ (appointments,      │  │
│  │              │    │ (billing     │    │  customers, calls,  │  │
│  │              │    │  tab only)   │    │  billing)           │  │
│  └─────────────┘    └──────┬───────┘    └─────────────────────┘  │
│                            │                                      │
│                   "Subscribe Now"                                 │
│                            │                                      │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────┐
              │    SUPABASE EDGE         │
              │    FUNCTIONS             │
              │                          │
              │  create-checkout-session  │◄──── Frontend calls this
              │  create-billing-portal   │◄──── Frontend calls this
              │  stripe-webhook          │◄──── Stripe calls this
              └──────────┬───────────────┘
                         │
                         ▼
    ┌────────────────────────────────────────┐
    │            STRIPE                       │
    │                                         │
    │  Checkout Page ──▶ Process Payment      │
    │  Billing Portal ──▶ Manage Subscription │
    │  Webhooks ──▶ Notify our server         │
    └────────────────────┬────────────────────┘
                         │
                    (webhooks)
                         │
                         ▼
    ┌────────────────────────────────────────┐
    │         SUPABASE DATABASE               │
    │                                         │
    │  clients table:                         │
    │    stripe_customer_id                   │
    │    stripe_subscription_id               │
    │    subscription_status ──▶ 'active'     │
    │    current_period_end                   │
    └─────────────────────────────────────────┘
```

---

*This document covers the complete Stripe billing implementation as of March 2026. All code references point to actual files in the repository.*
