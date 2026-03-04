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

This system handles the full billing lifecycle for the AI Receptionist service. Two subscription plans are offered:

| Plan | Price | Key |
|------|-------|-----|
| **Standard Plan** | $495/month | `standard` |
| **Pro Plan** | $695/month | `pro` |

There is also a one-time **Setup Fee** of **$395** that is collected before any dashboard access:

| Fee / Plan | Price | Type |
|------------|-------|------|
| **Setup Fee** | $395 (one-time) | Stripe Payment Link |
| **Standard Plan** | $495/month | Recurring subscription |
| **Pro Plan** | $695/month | Recurring subscription |

The high-level flow:

- **Sales person sends a Stripe Payment Link** for the $395 setup fee to the new client
- **Client pays the setup fee** — Stripe notifies the sales person and the admin
- **Admin completes the setup** — configures the Retell AI agent, business hours, etc.
- **Admin creates the client record** in the Admin panel (company name, email, Retell agent ID)
- **Admin sends an email invitation** — client receives a password reset link
- **Client sets their password** and logs in for the first time
- **Client is blocked from the dashboard** — they can only see the Billing tab with plan options
- **Client chooses a plan** (Standard or Pro) — redirected to a Stripe Checkout page to enter payment info
- **Stripe processes the payment** — sends a webhook back to our server
- **Webhook updates the database** — `subscription_status` changes from `inactive` to `active`, `stripe_price_id` records which plan was selected
- **Dashboard unlocks** — client now has full access to appointments, customers, calls, and billing
- **Monthly billing auto-renews** via Stripe — if payment fails, access is restricted again
- **Client can self-manage** their subscription through the Stripe Billing Portal (update card, view invoices, cancel, or change plan)

### What the admin sees vs. what the client sees

| Admin | Client (no subscription) | Client (active subscription) |
|-------|--------------------------|------------------------------|
| Full dashboard + Admin panel | Only the Billing tab with plan selection (Standard & Pro) | Full dashboard (appointments, customers, calls, billing) |
| Can manage all clients | Cannot see any data | Full access to their own data |
| Bypasses subscription check | Blocked until payment | Active until subscription lapses |

---

## 2. The Complete Client Lifecycle

Here is the step-by-step journey from "new prospect" to "paying subscriber":

### Step 1: Sales Person Sends the Setup Fee Payment Link

A sales person sends the new client a **Stripe Payment Link** for the one-time **$395 setup fee**. This Payment Link is created in the Stripe Dashboard (Products > Payment Links) — it is not part of the dashboard codebase.

### Step 2: Client Pays the Setup Fee

The client clicks the payment link and pays $395 via Stripe's hosted checkout. On successful payment:
- **Stripe notifies the sales person** who sent the link (via Stripe's built-in payment confirmation email or a configured notification)
- **Stripe notifies the admin** (you) so you know to begin the setup process

This notification can be configured via:
- Stripe Dashboard email receipts and notifications
- A Stripe webhook (e.g., `checkout.session.completed` for the setup fee product) that triggers an email/Slack/SMS notification
- Or simply by monitoring the Stripe Dashboard for incoming payments

### Step 3: Admin Completes the Setup

After receiving the setup fee notification, the admin:
- Configures the client's Retell AI voice agent
- Sets up business hours, appointment durations, and other settings
- Prepares everything the client needs before they can access the dashboard

This step happens entirely outside the dashboard — it's manual admin work.

### Step 4: Admin Creates the Client Record

Once setup is complete, the admin goes to the **Admin panel** (`src/Admin.jsx`) and fills out a form with:
- Company name
- Email address
- Retell Agent ID (the AI voice agent assigned to this client)

This creates a row in the `clients` table with `subscription_status = 'inactive'`.

### Step 5: Admin Sends the Invitation

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

### Step 6: Client Sets Their Password

The client clicks the link in the email, which opens the `/reset-password` page (`src/ResetPassword.jsx`). They enter a new password (minimum 6 characters). On success, they're redirected to the main app.

### Step 7: Client Logs In and Hits the Subscription Gate

When the client logs in, the app:
1. Authenticates via Supabase Auth
2. Fetches the client's row from the `clients` table by email
3. Checks `subscription_status` — if it's `inactive`, the subscription gate activates
4. The client sees ONLY the Billing tab with two plan options: **Standard ($495/mo)** and **Pro ($695/mo)**

### Step 8: Client Chooses a Plan via Stripe Checkout

When the client clicks "Subscribe" on either plan:
1. Frontend calls the `create-checkout-session` Edge Function with the selected `plan` key (`"standard"` or `"pro"`)
2. Edge Function validates the plan key and looks up the corresponding Stripe Price ID
3. Edge Function creates (or retrieves) a Stripe Customer for this client
4. Edge Function creates a Stripe Checkout Session in `subscription` mode for the selected plan's price
5. Frontend redirects the browser to the Stripe-hosted checkout page
6. Client enters their credit card details on Stripe's secure page
7. On success, Stripe redirects back to the app with `?billing=success` in the URL

### Step 9: Webhook Activates the Subscription

After Stripe processes the payment:
1. Stripe sends a `checkout.session.completed` webhook to our `stripe-webhook` Edge Function
2. The webhook handler retrieves the full subscription object from Stripe
3. It extracts the `price.id` from the subscription's first line item
4. It updates the `clients` table:
   - `stripe_customer_id` = the Stripe customer ID
   - `stripe_subscription_id` = the Stripe subscription ID
   - `subscription_status` = `active`
   - `stripe_price_id` = the Stripe price ID (identifies which plan: Standard or Pro)
   - `current_period_end` = the end date of the billing period

### Step 10: Frontend Detects Activation

Meanwhile, the frontend is polling:
1. After the Stripe redirect, the app polls the `clients` table every 2 seconds (up to 6 attempts)
2. When it detects `subscription_status = 'active'`, it stops the spinner
3. The subscription gate lifts and the full dashboard is now accessible

### Step 11: Ongoing Billing

- Stripe automatically charges the client monthly
- If payment succeeds: `invoice.paid` webhook fires (logged)
- If payment fails: `invoice.payment_failed` webhook fires, status set to `past_due`
- If `past_due`: client sees a "Payment Required" alert and can only access billing to update their card
- If the client cancels: `customer.subscription.deleted` webhook fires, gate re-engages
- Plan changes (upgrade/downgrade) via the Stripe Billing Portal trigger `customer.subscription.updated`, which updates `stripe_price_id` in the database

---

## 3. Stripe Configuration

### Stripe Products & Prices

There are three products in Stripe — one for the setup fee and two for the recurring subscription plans:

#### Setup Fee (one-time, collected before dashboard access)

| Field | Value |
|-------|-------|
| Product Name | AI Receptionist — Setup Fee |
| Price | $395.00 (USD, one-time) |
| Delivery | Via **Stripe Payment Link** — sales person sends the link directly to the prospect |
| Notifications | Configure Stripe email receipts and/or webhook notifications to alert the sales person and admin when payment succeeds |

The setup fee is handled entirely through Stripe Payment Links and the Stripe Dashboard — it has **no connection to the dashboard codebase**. It is a prerequisite that must be paid before the admin begins setup and sends the dashboard invitation.

#### Subscription Plans (recurring, collected via dashboard)

| Field | Standard Plan | Pro Plan |
|-------|---------------|----------|
| Product Name | AI Receptionist — Standard | AI Receptionist — Pro |
| Price | $495.00/month (USD, recurring) | $695.00/month (USD, recurring) |
| Price ID | `price_STANDARD_PLAN_ID_HERE` | `price_PRO_PLAN_ID_HERE` |
| Billing cycle | Monthly | Monthly |

These Price IDs are configured in two places:
1. **`create-checkout-session/index.ts`** — the `PLANS` map validates incoming plan requests and maps to Price IDs
2. **`src/App.jsx`** — the `PLANS` object maps price IDs back to plan names for display

**After creating the products in Stripe Dashboard**, update the placeholder Price IDs in both files.

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
- Switch between plans (if you want clients to self-service upgrade/downgrade)

No code changes needed — Stripe hosts the portal UI.

---

## 4. Database Schema

Five columns exist on the `clients` table for billing:

**Migration 1:** `supabase/migrations/20260303_add_stripe_columns.sql`
```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
```

**Migration 2:** `supabase/migrations/20260304_add_stripe_price_id.sql`
```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
```

### Column Details

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `stripe_customer_id` | TEXT | NULL | Stripe's customer ID (e.g., `cus_abc123`). Created when the client first subscribes. |
| `stripe_subscription_id` | TEXT | NULL | Stripe's subscription ID (e.g., `sub_xyz789`). Set when checkout completes. |
| `subscription_status` | TEXT | `'inactive'` | Current status. Synced from Stripe via webhooks. |
| `stripe_price_id` | TEXT | NULL | The Stripe Price ID of the client's current plan. Used to determine if they're on Standard or Pro. |
| `current_period_end` | TIMESTAMPTZ | NULL | When the current billing period ends. Used to show "Next billing date" in the UI. |

### Subscription Status Values

| Status | Meaning | Dashboard Access? |
|--------|---------|-------------------|
| `inactive` | Never subscribed (default) | NO — sees plan selection |
| `active` | Subscription is current and paid | YES — full access |
| `trialing` | In a free trial period (if configured) | YES — full access |
| `past_due` | Payment failed, awaiting retry/update | NO — sees "Payment Required" + billing portal |
| `canceled` | Subscription was cancelled | NO — sees plan selection |
| `unpaid` | Invoice went unpaid past retry attempts | NO — sees plan selection |

### How Plan Identity Works

The `stripe_price_id` column stores the Stripe Price ID from the subscription. The frontend maps this back to a plan name:

| `stripe_price_id` value | Plan |
|--------------------------|------|
| `price_STANDARD_PLAN_ID_HERE` | Standard ($495/mo) |
| `price_PRO_PLAN_ID_HERE` | Pro ($695/mo) |
| Any other / NULL | Legacy or unknown (fallback UI shown) |

This mapping exists in:
- **Frontend:** `PLANS` object and `getPlanFromPriceId()` in `App.jsx`
- **Backend:** `PLANS` map in `create-checkout-session/index.ts`

---

## 5. Supabase Edge Functions

Three Edge Functions handle all server-side Stripe interactions. All are deployed to Supabase and run as Deno serverless functions.

### 5a. `create-checkout-session`

**File:** `supabase/functions/create-checkout-session/index.ts`
**Purpose:** Creates a Stripe Checkout session for the selected plan and returns the URL to redirect the client to.

**Flow:**
1. Receives the client's Supabase auth token in the `Authorization` header
2. Validates the token and looks up the client in the `clients` table
3. Creates a Stripe Customer if one doesn't exist yet (stores `stripe_customer_id` in the DB)
4. Reads the `plan` field from the request body (`"standard"` or `"pro"`)
5. Validates the plan key against the `PLANS` map — rejects invalid plan values with a 400 error
6. Creates a Stripe Checkout Session in `subscription` mode for the selected plan's Price ID
7. Returns the checkout URL — frontend redirects the browser there

**Key details:**
- Uses the authenticated user's Supabase session (not anon access)
- Uses the Supabase service role key to write `stripe_customer_id` back to the DB
- The `PLANS` map at the top of the file defines valid plan keys and their Stripe Price IDs
- `plan` key and `client_id` are stored in the session's `metadata` for traceability
- Success URL: `{origin}?billing=success` — triggers the frontend polling
- Cancel URL: `{origin}?billing=cancelled` — returns to dashboard with no changes
- Defaults to `"standard"` if no plan is provided (backward compatibility)

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
- The portal is hosted by Stripe — handles payment updates, invoice viewing, cancellation, and plan changes

### 5c. `stripe-webhook`

**File:** `supabase/functions/stripe-webhook/index.ts`
**Purpose:** Receives webhook events from Stripe and syncs subscription state to the database.

**Events handled:**

| Event | What it does |
|-------|--------------|
| `checkout.session.completed` | Retrieves the full subscription object from Stripe. Extracts the `price.id` from the first subscription item. Updates the client's `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `stripe_price_id`, and `current_period_end`. This is what activates the subscription after checkout. |
| `customer.subscription.updated` | Finds the client by `stripe_customer_id` and updates all subscription fields including `stripe_price_id`. Handles upgrades, downgrades, renewals, and status changes. |
| `customer.subscription.deleted` | Same as updated — marks the subscription with whatever status Stripe reports (usually `canceled`), and updates `stripe_price_id`. |
| `invoice.paid` | Logged only. Could be extended to record payment history. |
| `invoice.payment_failed` | Finds the client and sets `subscription_status = 'past_due'`. This triggers the payment gate in the frontend. |

**Key details:**
- Uses the Supabase **service role key** (not anon) because this is a server-to-server call with no user session
- Verifies the Stripe webhook signature if `STRIPE_WEBHOOK_SECRET` is configured
- Falls back to raw JSON parsing if the secret isn't set (useful during development)
- Extracts `stripe_price_id` via `subscription.items.data[0].price.id` on every subscription-related event

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

### Plan Definitions

```js
const PLANS = {
  standard: { name: 'Standard Plan', price: 495, priceId: 'price_STANDARD_PLAN_ID_HERE' },
  pro: { name: 'Pro Plan', price: 695, priceId: 'price_PRO_PLAN_ID_HERE' },
};

const getPlanFromPriceId = (priceId) => {
  if (priceId === PLANS.standard.priceId) return 'standard';
  if (priceId === PLANS.pro.priceId) return 'pro';
  return null;
};
```

These are used to:
- Render plan cards with correct names and prices
- Map the `stripe_price_id` from the database back to a plan name for display
- Pass the selected plan key to the checkout Edge Function

### State Variables

```js
const [billingLoading, setBillingLoading] = useState(false);
const [billingAction, setBillingAction] = useState(null);    // 'standard' | 'pro' | 'portal'
const [awaitingSubscription, setAwaitingSubscription] = useState(false);
const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';
```

Note: `billingAction` now stores the plan key (`'standard'` or `'pro'`) instead of `'checkout'`, so each plan button can show its own loading state independently.

### `handleStripeCheckout(plan)` — Plan Subscribe Button

1. Accepts a `plan` parameter (`'standard'` or `'pro'`)
2. Sets `billingAction` to the plan key (shows loading on the clicked button only)
3. Gets the current Supabase session's access token
4. Calls the `create-checkout-session` Edge Function with the token and `{ plan }`
5. Redirects the browser to the Stripe Checkout URL
6. Button shows "Redirecting to Stripe..." while processing

### `handleBillingPortal()` — Manage Subscription Button

1. Gets the current Supabase session's access token
2. Calls the `create-billing-portal` Edge Function with the token
3. Redirects the browser to the Stripe Billing Portal
4. Button shows "Opening..." while processing

### Post-Checkout Polling

When the client returns from Stripe checkout with `?billing=success`:
1. Sets `awaitingSubscription = true` (shows a spinner)
2. Clears the URL query parameter
3. Polls the `clients` table every 2 seconds
4. Checks if `subscription_status` is `active` or `trialing`
5. Stops polling after status changes or after 6 attempts (12 seconds max)
6. Once active, the spinner disappears and the full dashboard is revealed

### Billing Tab UI (`renderBilling()`)

The billing tab shows different content based on subscription status:

**Not subscribed (`inactive` / `canceled`):**
- "Choose Your Plan" heading
- Two plan cards side-by-side:
  - **Standard Plan** — $495.00/mo with gray "Subscribe — $495/mo" button
  - **Pro Plan** — $695.00/mo with blue "Subscribe — $695/mo" button
- Each card has its own independent loading state

**Active subscriber (`active` / `trialing`):**
- "Your Plan" heading
- Single plan card showing the client's current plan name and price
- Blue border highlight
- "Active" badge (green)
- Next billing date
- "Manage Subscription" button
- Usage stats (calls and minutes this month)
- "Payment & Invoices" section with "Open Billing Portal" button

**Past due (`past_due`):**
- Current plan card with "Past Due" badge (red)
- Red alert: "Your payment failed. Please update your payment method..."
- "Manage Subscription" button (opens portal to update card)
- Usage stats still visible
- "Open Billing Portal" button

**Legacy subscriber (active but unknown price ID):**
- Fallback card with "AI Receptionist Service" label (no plan name)
- Full functionality: status badge, billing date, manage button

---

## 7. Subscription Gating — Access Control

This is the core access control mechanism.

### How the Gate Works

```js
const isSubscriptionActive = clientData?.is_admin ||
  ['active', 'trialing'].includes(clientData?.subscription_status);

if (!isSubscriptionActive && clientData) {
  // Show ONLY the billing tab — plan selection for new users, payment update for past_due
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

- **Billing tab** — always accessible (this is how they subscribe / choose a plan)
- **Sign out** — always accessible
- **Header with logo** — always visible

### Who bypasses the gate

- **Admin users** (`is_admin = true` in the `clients` table) bypass the subscription check entirely. Admins always have full access regardless of subscription status.

### Data Fetching Gate

There's a separate gate on the data fetching side too:

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

There's also a separate check for users who have valid Supabase auth credentials but no `clients` table record. They see:

> "No Account Found — Your login credentials are valid, but no client account is set up yet. Please contact your administrator for an invitation."

This prevents someone from signing up directly through Supabase Auth without being invited.

---

## 8. Webhook Event Handling

### Event Flow Diagram

```
Stripe Event                    Webhook Handler              Database Update                   Frontend Effect
─────────────                   ───────────────              ───────────────                   ───────────────
checkout.session.completed  →   Retrieve subscription    →   status='active'               →   Gate lifts, full access
                                Extract price ID             stripe_price_id set
                                                             period_end set

customer.subscription.updated → Find client by cust ID  →   status/period/price updated   →   UI reflects new status + plan

customer.subscription.deleted → Find client by cust ID  →   status='canceled'             →   Gate re-engages
                                                             stripe_price_id updated

invoice.paid                →   Log only (no DB write)   →   (none)                        →   (none)

invoice.payment_failed      →   Find client by cust ID  →   status='past_due'             →   "Payment Required" alert
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
- **Change plan** — switch between Standard and Pro (if configured in the portal settings)

### How it's accessed

Two places in the Billing tab:
1. **"Manage Subscription" button** — shown in the subscription card for active/past-due users
2. **"Open Billing Portal" button** — shown in the "Payment & Invoices" section

Both call the same `handleBillingPortal()` function which hits the `create-billing-portal` Edge Function.

### Portal configuration

The portal's features and appearance are configured in the **Stripe Dashboard** under Settings > Billing > Customer Portal. To enable plan switching, add both Standard and Pro prices as available products in the portal configuration. No code changes needed — Stripe hosts the portal UI.

---

## 10. Key Files Reference

| File | What it does |
|------|-------------|
| `src/App.jsx` | Main app. Contains `PLANS` definition, plan-aware checkout/portal handlers, two-plan billing UI, subscription gate, and post-checkout polling |
| `src/Admin.jsx` | Admin panel. Client creation and invitation sending |
| `src/ResetPassword.jsx` | Password reset form shown when client clicks the invite email link |
| `src/Login.jsx` | Login form with email/password |
| `src/supabaseClient.js` | Supabase client initialization |
| `supabase/functions/create-checkout-session/index.ts` | Edge Function: validates plan selection and creates Stripe Checkout session for the chosen plan |
| `supabase/functions/create-billing-portal/index.ts` | Edge Function: creates Stripe Billing Portal session |
| `supabase/functions/stripe-webhook/index.ts` | Edge Function: handles all Stripe webhook events, stores `stripe_price_id` |
| `supabase/migrations/20260303_add_stripe_columns.sql` | Migration: adds core Stripe columns to `clients` table |
| `supabase/migrations/20260304_add_stripe_price_id.sql` | Migration: adds `stripe_price_id` column for plan tracking |

---

## 11. Setup Checklist — Reproducing This From Scratch

If you're setting this up for a new project, here's the order of operations:

### Stripe Setup

**Setup Fee (one-time):**
- [ ] Create a Stripe account at stripe.com
- [ ] Create a Product: "AI Receptionist — Setup Fee" with a $395 one-time price
- [ ] Create a **Payment Link** for the setup fee product (Products > Payment Links)
- [ ] Share the Payment Link URL with your sales team — they send it directly to prospects
- [ ] Configure notifications so the sales person and admin are alerted on successful payment (Stripe email receipts, webhook, or manual Dashboard monitoring)

**Subscription Plans (recurring):**
- [ ] Create two Products:
  - "AI Receptionist — Standard"
  - "AI Receptionist — Pro"
- [ ] Create a recurring Price on each product:
  - Standard: $495/month — note the Price ID
  - Pro: $695/month — note the Price ID
- [ ] Update the `PLANS` map in `create-checkout-session/index.ts` with the real Price IDs
- [ ] Update the `PLANS` object in `src/App.jsx` with the matching Price IDs
- [ ] Configure the Customer Portal in Stripe Dashboard (Settings > Billing > Customer Portal)
  - Add both products/prices if you want clients to self-service plan changes
- [ ] Create a webhook endpoint pointing to your `stripe-webhook` Edge Function URL
- [ ] Select the events to listen for: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
- [ ] Note the webhook signing secret (`whsec_...`)

### Supabase Setup

- [ ] Run the migrations to add billing columns to `clients`:
  ```sql
  -- Migration 1
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

  -- Migration 2
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
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

- [ ] Add the `PLANS` object and `getPlanFromPriceId()` function to your main app component
- [ ] Add `handleStripeCheckout(plan)` and `handleBillingPortal()` functions
- [ ] Add the post-checkout polling `useEffect` that watches for `?billing=success`
- [ ] Add the `renderBilling()` component with plan-selection UI for non-subscribers and plan-display UI for active subscribers
- [ ] Add the subscription gate check before rendering the main dashboard
- [ ] Add the data-fetching gate so you don't fetch data for non-subscribers
- [ ] Update `SUPABASE_FUNCTIONS_URL` to point to your Supabase project

### Testing

- [ ] Use Stripe test mode (`sk_test_...` key) during development
- [ ] Use Stripe's test card number `4242 4242 4242 4242` for successful payments
- [ ] Use `4000 0000 0000 0341` for declined payment testing
- [ ] Test subscribing to Standard plan: verify correct price on checkout page, verify `stripe_price_id` stored correctly
- [ ] Test subscribing to Pro plan: verify correct price on checkout page, verify `stripe_price_id` stored correctly
- [ ] Test the full flow: invite → password set → login → choose plan → subscribe → dashboard access
- [ ] Test payment failure: verify `past_due` status gates the dashboard correctly
- [ ] Test cancellation: verify the gate re-engages and shows plan selection again
- [ ] Test plan switching via Billing Portal (if enabled): verify `stripe_price_id` updates in the database
- [ ] Verify the webhook is receiving events in the Stripe Dashboard (Developers > Webhooks > select endpoint > Recent events)

### Price ID Locations (both must match)

After creating prices in Stripe, update these two files:

1. **`supabase/functions/create-checkout-session/index.ts`** — the `PLANS` map:
   ```ts
   const PLANS: Record<string, string> = {
     standard: "price_YOUR_STANDARD_ID",  // Standard Plan — $495/month
     pro: "price_YOUR_PRO_ID",            // Pro Plan — $695/month
   };
   ```

2. **`src/App.jsx`** — the `PLANS` object:
   ```js
   const PLANS = {
     standard: { name: 'Standard Plan', price: 495, priceId: 'price_YOUR_STANDARD_ID' },
     pro: { name: 'Pro Plan', price: 695, priceId: 'price_YOUR_PRO_ID' },
   };
   ```

---

## Architecture Diagram

```
PRE-DASHBOARD (Sales → Setup → Invite)
════════════════════════════════════════

  Sales Person                     Prospect
       │                              │
       │  sends Stripe Payment Link   │
       │  ($395 setup fee)            │
       │─────────────────────────────▶│
       │                              │── pays via Stripe ──▶ STRIPE
       │                              │                         │
       │◄─── notification ────────────┼─────────────────────────┘
       │                              │
  Admin notified                      │
       │                              │
       ▼                              │
  Admin completes setup               │
  (Retell agent, business hours)      │
       │                              │
       ▼                              │
  Admin creates client record         │
  Admin sends invite email ──────────▶│
                                      │
                                      ▼
                               Client sets password


DASHBOARD (Login → Subscribe → Use)
════════════════════════════════════

┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + Vite)                  │
│                                                                  │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────────┐  │
│  │  Login /     │    │ Subscription │    │   Full Dashboard    │  │
│  │  Reset Pass  │───▶│    Gate      │───▶│ (appointments,      │  │
│  │              │    │ (plan select:│    │  customers, calls,  │  │
│  │              │    │  Standard or │    │  billing)           │  │
│  │              │    │  Pro)        │    │                     │  │
│  └─────────────┘    └──────┬───────┘    └─────────────────────┘  │
│                            │                                      │
│               "Subscribe — $495/mo"                               │
│                      or                                           │
│               "Subscribe — $695/mo"                               │
│                            │                                      │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────┐
              │    SUPABASE EDGE         │
              │    FUNCTIONS             │
              │                          │
              │  create-checkout-session  │◄──── Frontend calls with { plan }
              │  create-billing-portal   │◄──── Frontend calls this
              │  stripe-webhook          │◄──── Stripe calls this
              └──────────┬───────────────┘
                         │
                         ▼
    ┌────────────────────────────────────────┐
    │            STRIPE                       │
    │                                         │
    │  Standard: $495/mo  |  Pro: $695/mo     │
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
    │    stripe_price_id ──▶ identifies plan  │
    │    current_period_end                   │
    └─────────────────────────────────────────┘
```

---

*This document covers the complete Stripe billing implementation as of March 2026. All code references point to actual files in the repository.*
