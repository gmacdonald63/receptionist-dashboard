# Plan: Sales Rep Commission System
**Date:** 2026-03-24
**Status:** Spec — Ready for Implementation Planning
**Author:** Greg MacDonald (owner) via planning session

---

## Table of Contents

1. [Overview](#1-overview)
2. [Business Context](#2-business-context)
3. [Subscription Plans](#3-subscription-plans)
4. [Commission Structure](#4-commission-structure)
5. [Complete Process Flow](#5-complete-process-flow)
6. [Database Schema Changes](#6-database-schema-changes)
7. [New Edge Functions](#7-new-edge-functions)
8. [Frontend Pages and Components](#8-frontend-pages-and-components)
9. [Notification Emails](#9-notification-emails)
10. [HubSpot Integration](#10-hubspot-integration)
11. [Implementation Plan (5 Sub-Plans)](#11-implementation-plan-5-sub-plans)
12. [Open Items and Future Considerations](#12-open-items-and-future-considerations)

---

## 1. Overview

This system adds a sales rep commission and client onboarding layer to the existing Reliant Support dashboard. It enables sales reps to sign up new clients, collect a one-time $395 setup fee via Stripe, and earn commissions tied to the client's recurring subscription plan. Greg (the owner) is notified at each critical step so he can configure the Retell AI agent for each new client before they go live.

The system must:
- Give sales reps a purpose-built dashboard to create deals and track commissions
- Give clients a frictionless, no-login onboarding form and payment flow
- Automate commission calculations and scheduling based on the rep's commission option
- Give Greg full visibility into all deals and commissions with a simple "Mark as Paid" workflow
- Mirror all deal status changes into HubSpot automatically

---

## 2. Business Context

**Product:** Reliant Support — an AI voice receptionist service powered by Retell AI.

**Tech Stack:**
- React 18 + Vite (frontend)
- Supabase (PostgreSQL + Edge Functions + Auth)
- Retell AI (voice call handling)
- Stripe (payments)
- Tailwind CSS with dark theme
- Deployed on Vercel
- Supabase project ref: `zmppdmfdhknnwzwdfhwf`

**Who are the actors?**
- **Greg** — Owner. Creates rep accounts, configures AI agents, manages commission payouts manually via Mercury bank.
- **Sales reps** — Create deals, send onboarding links to prospective clients, track their commissions.
- **Clients** — End customers who receive an onboarding link, fill out a form, pay the setup fee, and then receive their subscription link.

---

## 3. Subscription Plans

| Plan | Monthly Price | Annual Price |
|------|--------------|--------------|
| Standard | $495/month | $5,940/year |
| Pro | $695/month | $8,340/year |

**Annual bonus:** When a client pays the full year upfront, a $200 bonus is added to the rep's commission on top of the base commission amount.

---

## 4. Commission Structure

Each sales rep is assigned a commission option at account creation by Greg. The option is stored on the rep's profile and applied automatically to every deal they create — reps do not choose per deal.

### Option 1 — Full Upfront

The rep receives the full monthly plan price as a single one-time payment when the client's first subscription payment clears.

| Plan | Monthly Deal | Annual Deal |
|------|-------------|-------------|
| Standard | $495 | $495 + $200 bonus = **$695** |
| Pro | $695 | $695 + $200 bonus = **$895** |

### Option 2 — Split + Residual

The rep receives 50% upfront when the client's first subscription payment clears, plus 10% of the monthly plan price each month for 12 months. Month 1 residual is paid at the same time as the upfront payment. The $200 annual bonus (if applicable) is added to the upfront amount.

| Plan | Upfront (Monthly) | Monthly Residual | Upfront (Annual) |
|------|------------------|-----------------|-----------------|
| Standard | $247.50 | $49.50 × 12 months | $447.50 (incl. $200 bonus) |
| Pro | $347.50 | $69.50 × 12 months | $547.50 (incl. $200 bonus) |

**Annual plan + Option 2 — important behavior:** Even though an annual client pays one lump sum, residual commissions are still disbursed monthly over 12 months. When the annual subscription payment event fires, the system pre-schedules 12 monthly commission records (month 1 through month 12) at that moment. Greg sees and pays them one per month.

### 4.3 Clawback Policy

Applies equally to both commission options. A clawback is triggered when a client cancels for any reason — including voluntary cancellation, payment failure, or chargeback — before enough subscription payments have been made to justify the commission already paid.

**The 2-Payment Rule:**

- If the client's **2nd subscription payment has not yet cleared** at the time of cancellation → the full upfront commission is clawed back for both options
- If the client's **2nd subscription payment has cleared** → the upfront commission is permanently safe

| Scenario | Option 1 | Option 2 |
|---|---|---|
| Client cancels before 2nd payment | Full upfront commission clawed back | Full upfront (50%) clawed back |
| Client makes 2nd payment | Commission permanently safe | Commission permanently safe |
| Client cancels after 2nd payment | N/A — one-time payment, already safe | Residuals simply stop. No clawback on the upfront |

**Annual subscriptions:** If the annual payment cleared successfully, the commission is safe immediately — the full year's revenue is already in hand. A clawback is only triggered if Stripe reverses the annual payment (chargeback or refund).

**System implementation:**

- A `clawback_safe` boolean column is added to the `deals` table (default `false`)
- When the 2nd subscription payment webhook fires → `clawback_safe` set to `true`
- For annual subscriptions → `clawback_safe` set to `true` immediately when the annual payment clears
- If a cancellation or chargeback event fires on a deal where `clawback_safe = false`:
  - Deal status → `cancelled`
  - All unpaid commission records → `voided`
  - Greg is notified: "Clawback triggered — [Client Name] cancelled. [Rep Name]'s commission of $X should be recovered."
  - Greg handles recovery with the rep manually outside the system

---

## 5. Complete Process Flow

### Phase 1 — Rep Account Setup (Greg, one time per rep)

1. Greg logs into the Admin panel and creates a sales rep account: name, email, commission option (1 or 2), role: `sales_rep`.
2. System sends an invite email to the rep.
3. Rep clicks the invite link, creates a password, and logs in.
4. Rep lands on the Sales Rep Dashboard (purpose-built — not the client dashboard).

### Phase 2 — Rep Creates a Deal

5. Rep clicks "New Deal" in their dashboard.
6. Rep fills in: client name, email, phone, company name, plan (Standard or Pro), billing cycle (monthly or annual).
7. Commission option is auto-applied from the rep's profile — no selection required.
8. System creates a `deals` record with a unique ID and status `onboarding_sent`.
9. System creates a matching deal in HubSpot via API at stage "Onboarding Sent."
10. System generates a unique onboarding link: `app.reliantsupport.net/onboard?token=<uuid>`
11. Rep copies the link and sends it to the client by their preferred method (email, text, HubSpot — rep's choice). The system does not send the link automatically.

### Phase 3 — Client Fills Out the Onboarding Form

12. Client clicks the link. No login required — the page is publicly accessible.
13. The page reads the deal record from the token and pre-fills the client's name and company.
14. Client fills out the form:
    - Business name (pre-filled, editable)
    - Business address
    - Hours of operation per day of week
    - Services offered
    - Special instructions for the AI receptionist
15. Client clicks "Continue to Payment."
16. Client is redirected to a Stripe Checkout session for the $395 setup fee. The deal token is passed as metadata in the Stripe session.

### Phase 4 — Setup Fee Payment Triggers Automation

17. Stripe webhook fires on successful payment.
18. Deal status → `setup_in_progress`.
19. HubSpot deal stage → "Setup in Progress."
20. Greg receives an email notification containing: client info, plan, billing cycle, rep name, and all onboarding form data.
21. Rep receives a notification: "Your client [name] has paid the setup fee — Greg is setting them up."

### Phase 5 — Greg Sets Up the Client

22. Greg reviews the onboarding data email and configures the Retell AI agent for this client in the Retell dashboard.
23. Greg creates the client account in the Admin panel (the standard client account creation flow).
24. Greg sends the client one link: the dashboard invite link (standard Supabase invite email).
25. Client clicks the link, creates a password.
26. The system reads the client's deal record and automatically redirects them to a pre-configured Stripe Checkout for their exact plan (Standard or Pro, monthly or annual). No plan selection is shown to the client — the plan is already determined from the deal record.

### Phase 6 — Client Goes Live

27. Client completes the subscription payment. Stripe webhook fires.
28. Deal status → `active`.
29. HubSpot deal → "Closed Won."
30. Commission records are created automatically (see commission logic in Section 4).
31. Greg is notified: "Client [name] is live. Commission due to [Rep]: $X."
32. Rep is notified: "Your client [name] is now active!"
33. Rep dashboard shows the deal as Active with commission amounts and statuses.

### Phase 7 — Commission Payment (Manual by Greg)

34. Greg sees commission records in the Admin panel with status `due`.
35. Greg pays the rep via Mercury bank (manually, outside the system).
36. Greg clicks "Mark as Paid" in the Admin panel.
37. Commission record status → `paid`, with timestamp recorded.
38. Rep receives notification: "Commission of $X has been paid."

### Phase 7B — Monthly Residuals (Option 2 Reps Only)

39. For **monthly subscriptions:** each Stripe renewal webhook creates or marks the next month's residual commission as `due`.
40. For **annual subscriptions:** 12 commission records are pre-scheduled at the time of the first subscription payment (one per month, months 1–12).
41. Greg receives a monthly notification: "Monthly commission due to [Rep]: $X for client [Name] — month N of 12."
42. Greg pays → marks paid → rep is notified.

---

## 6. Database Schema Changes

### 6.1 Modify Existing `clients` Table

Add two columns to the existing `clients` table:

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `is_sales_rep` | boolean | `false` | True for rep accounts |
| `commission_option` | integer | null | 1 or 2. Null for non-rep accounts |

### 6.2 New Table: `deals`

Tracks every sales deal from creation through to active subscription.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `rep_id` | uuid | FK → `clients.id`, NOT NULL | The sales rep who created this deal |
| `client_name` | text | NOT NULL | Prospective client's full name |
| `client_email` | text | NOT NULL | |
| `client_phone` | text | | |
| `company_name` | text | NOT NULL | |
| `plan` | text | NOT NULL | `'standard'` or `'pro'` |
| `billing_cycle` | text | NOT NULL | `'monthly'` or `'annual'` |
| `status` | text | NOT NULL, default `'onboarding_sent'` | `'onboarding_sent'`, `'setup_in_progress'`, `'active'`, `'cancelled'` |
| `onboarding_token` | uuid | UNIQUE, NOT NULL, default `gen_random_uuid()` | Used in the public onboarding URL |
| `onboarding_data` | jsonb | | All form responses submitted by the client |
| `stripe_setup_payment_id` | text | | Stripe payment intent or session ID for the $395 fee |
| `stripe_customer_id` | text | | Set after the client's subscription is created |
| `stripe_subscription_id` | text | | Set after the client's subscription is created |
| `hubspot_deal_id` | text | | HubSpot CRM deal ID |
| `supabase_client_id` | uuid | FK → `clients.id`, nullable | Set by Greg when he creates the client account |
| `clawback_safe` | boolean | NOT NULL, default `false` | Set to true when 2nd subscription payment clears (or immediately for annual) |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | Auto-update via trigger |

**Indexes:**
- `deals_rep_id_idx` on `rep_id`
- `deals_onboarding_token_idx` on `onboarding_token` (unique)
- `deals_status_idx` on `status`

### 6.3 New Table: `commissions`

One record per commission payment — both upfront and residual installments.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `deal_id` | uuid | FK → `deals.id`, NOT NULL | |
| `rep_id` | uuid | FK → `clients.id`, NOT NULL | Denormalized for fast querying |
| `type` | text | NOT NULL | `'upfront'` or `'residual'` |
| `month_number` | integer | | 1–12 for residuals. 1 = paid same time as upfront. Null for upfront records |
| `amount` | numeric(10,2) | NOT NULL | Calculated at commission creation time |
| `status` | text | NOT NULL, default `'pending'` | `'pending'` → `'due'` → `'paid'` |
| `due_date` | date | | When this payment becomes due |
| `paid_at` | timestamptz | | Timestamp when Greg marks it paid |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**Status lifecycle:**
- `pending` — Scheduled but not yet due (used for pre-scheduled annual residuals in months 2–12)
- `due` — Ready for Greg to pay (upfront commissions and month 1 become `due` immediately at deal activation)
- `paid` — Greg has marked it paid
- `voided` — Cancelled due to a clawback before the commission was paid

**Indexes:**
- `commissions_deal_id_idx` on `deal_id`
- `commissions_rep_id_idx` on `rep_id`
- `commissions_status_idx` on `status`
- `commissions_due_date_idx` on `due_date`

---

## 7. New Edge Functions

All existing Edge Functions are deployed with `--no-verify-jwt`. New functions follow the same pattern.

### 7.1 `create-onboarding-checkout`

**Trigger:** Called by the frontend after the client submits the onboarding form.

**Purpose:** Creates a Stripe Checkout session for the $395 setup fee. Saves the onboarding form data to the deal record before redirecting.

**Input:**
```json
{
  "token": "<onboarding_token uuid>",
  "onboarding_data": {
    "business_name": "...",
    "address": "...",
    "hours": { ... },
    "services": "...",
    "special_instructions": "..."
  }
}
```

**Behavior:**
1. Look up the deal by `onboarding_token`. Return 404 if not found or already in `setup_in_progress`/`active`.
2. Save `onboarding_data` to the deal record.
3. Create a Stripe Checkout session:
   - Line item: $395 setup fee (one-time payment)
   - `metadata.deal_id` — the deal's UUID
   - `success_url` — onboarding confirmation page
   - `cancel_url` — back to the onboarding form
4. Return the Stripe Checkout session URL.

### 7.2 `stripe-webhook` (update existing or create new)

**Trigger:** Stripe POST on payment events.

**Purpose:** Handles two distinct Stripe events:

**Event 1: `checkout.session.completed` (setup fee paid)**
1. Extract `deal_id` from `metadata`.
2. Update deal status → `setup_in_progress`.
3. Save `stripe_setup_payment_id` and `stripe_customer_id` to the deal record.
4. Call `hubspot-sync` to update deal stage.
5. Call `send-notification` for Greg (full onboarding data) and the rep (setup fee received).

**Event 2: `customer.subscription.created` or `invoice.payment_succeeded` (first subscription payment)**
1. Look up the deal by `stripe_customer_id` or `stripe_subscription_id`.
2. Update deal status → `active`.
3. Save `stripe_subscription_id` to the deal.
4. Call `hubspot-sync` to mark deal Closed Won.
5. Calculate and create commission records (see commission logic in Section 4).
6. Call `send-notification` for Greg (deal active + commission due) and the rep (client live).

**Event 3: `invoice.payment_succeeded` (renewal — for monthly subscriptions with Option 2 reps)**
1. Identify if this is a renewal (not the first payment).
2. Look up the deal and the rep's commission option.
3. If Option 2 and monthly billing: find the next residual commission record for this deal and set its status to `due`.
4. Call `send-notification` for Greg (monthly residual due).

### 7.3 `hubspot-sync`

**Trigger:** Called internally by other Edge Functions (not directly by the frontend or Stripe).

**Purpose:** Creates or updates a HubSpot deal to mirror the Supabase deal status.

**Input:**
```json
{
  "deal_id": "<uuid>",
  "action": "create" | "update"
}
```

**Behavior:**
- On `create`: POST to HubSpot Deals API. Store the returned `hubspot_deal_id` on the deal record.
- On `update`: PATCH the HubSpot deal using the stored `hubspot_deal_id`. Map Supabase status to HubSpot stage (see Section 10).
- HubSpot API key is stored in Supabase secrets.

### 7.4 `send-notification`

**Trigger:** Called internally by other Edge Functions.

**Purpose:** Sends transactional email notifications via Resend (or equivalent) to Greg or a rep.

**Input:**
```json
{
  "template": "setup_fee_paid_greg" | "setup_fee_paid_rep" | "client_active_greg" | "client_active_rep" | "residual_due_greg" | "commission_paid_rep",
  "deal_id": "<uuid>",
  "extra": { }
}
```

The function looks up all needed data from the deal record and associated rep/client records, then renders and sends the appropriate email.

---

## 8. Frontend Pages and Components

### 8.1 Public Onboarding Page (`/onboard?token=<uuid>`)

**Authentication:** None required. Publicly accessible.

**Page behavior:**
1. On load, fetch the deal record using the token. If the token is invalid or the deal is already past `onboarding_sent`, show an appropriate error message.
2. Pre-fill "Business Name" from the deal's `company_name`.
3. Display the form:
   - **Business Name** (pre-filled, editable)
   - **Business Address** (street, city, province/state, postal code)
   - **Hours of Operation** — per day of week, with open/close times and a "Closed" toggle per day
   - **Services Offered** — free-text or multi-select (e.g., HVAC installation, maintenance, emergency repairs)
   - **Special Instructions for AI Receptionist** — free-text, multi-line
4. "Continue to Payment" button calls `create-onboarding-checkout` with the form data.
5. On success, redirect to Stripe Checkout URL returned by the function.

**Post-payment confirmation screen** (Stripe success redirect):
> "Your setup request has been received. Greg will be in touch shortly with your account access link."

No further action required from the client at this point.

**Error states:**
- Invalid or expired token: "This onboarding link is invalid or has already been used."
- Already completed: "This setup has already been completed."
- Payment failed: "Payment was not completed. Please try again or contact your representative."

### 8.2 Sales Rep Dashboard

Shown when the authenticated user has `is_sales_rep = true`. Replaces the current demo-based rep view entirely.

The dashboard has three main sections:

#### Section A — New Deal Form

Fields:
- Client Name (text, required)
- Client Email (email, required)
- Client Phone (tel, optional)
- Company Name (text, required)
- Plan (dropdown: Standard / Pro, required)
- Billing Cycle (radio: Monthly / Annual, required)

The rep's commission option is shown as read-only context below the form (e.g., "Commission: Option 2 — Split + Residual").

"Generate Onboarding Link" button:
- Calls the backend to create the deal record.
- Displays the generated link in a read-only input with a "Copy Link" button.
- Link format: `https://app.reliantsupport.net/onboard?token=<uuid>`

#### Section B — My Deals Pipeline

A list of all deals created by this rep, sorted by `created_at` descending.

Columns per deal:
- Client Name
- Company Name
- Plan + Billing Cycle (e.g., "Pro / Annual")
- Status badge (color-coded): Onboarding Sent (yellow) → Setup in Progress (blue) → Active (green) → Cancelled (red)
- Date Created

#### Section C — My Commissions

Per deal where commissions exist:
- Deal/client name
- Upfront commission: amount + status badge (Pending / Due / Paid)
- Residual schedule (Option 2 only): a table showing months 1–12, amount per month, status per row, due date

Running totals at the top of the section:
- Total Earned (all paid commissions)
- Total Due (status = due)
- Total Pending (status = pending)

#### "Show Demo" Button

A persistent button in the Sales Rep Dashboard that launches the existing demo dashboard in a modal or separate tab. This preserves the current demo flow without change.

### 8.3 Admin Panel — New "Sales" Tab

Added to the existing Admin panel (`Admin.jsx`), visible only to Greg.

#### Sub-section: All Deals

A filterable table of all deals across all reps.

Filters:
- Rep (dropdown of all sales reps)
- Status (dropdown: all / onboarding_sent / setup_in_progress / active / cancelled)
- Date range (created_at)

Columns:
- Rep Name
- Client Name + Company
- Plan + Billing Cycle
- Status badge
- Setup Fee Paid (date, or "—")
- Date Created

#### Sub-section: Commissions

A table of all commission records, filterable by rep and status.

Columns:
- Rep Name
- Client Name
- Commission Type (Upfront / Residual Month N)
- Amount
- Status badge (Pending / Due / Paid)
- Due Date
- Paid Date (or "—")
- Action: "Mark as Paid" button (only shown when status = `due`)

Clicking "Mark as Paid":
1. Sets the commission record's status to `paid` and records `paid_at` timestamp.
2. Calls `send-notification` to notify the rep.
3. Updates the button state to show "Paid" with the timestamp.

#### Per-Rep Summary

Below the tables, a summary card per rep:
- Rep name and commission option
- Total paid to date
- Total currently due
- Total pending (future residuals)

---

## 9. Notification Emails

All emails are sent via Resend (or equivalent transactional email provider). The sender address should be from the Reliant Support domain.

| Trigger | Recipient | Subject | Content |
|---------|-----------|---------|---------|
| Setup fee paid | Greg | "New client setup: [Client Name]" | Client info (name, email, phone, company), plan, billing cycle, rep name, full onboarding form data formatted for readability |
| Setup fee paid | Rep | "Setup fee received for [Client Name]" | "[Client name] at [Company] has paid the setup fee. Greg is now configuring their AI receptionist." |
| Client goes active | Greg | "Client live + commission due: [Client Name]" | "Client [name] is now live on the [Plan] plan. Commission of $X is due to [Rep Name]." |
| Client goes active | Rep | "Your client [Client Name] is live!" | "Great news — [Client name] at [Company] is now active on Reliant Support. Your commission of $X has been recorded." |
| Monthly residual due | Greg | "Monthly commission due: [Rep Name] for [Client Name]" | "Monthly residual commission of $X is due to [Rep Name] for client [Client Name] — month N of 12." |
| Commission marked paid | Rep | "Commission paid: $X" | "Your commission of $X for client [Client Name] has been paid. Check your bank account for the transfer." |

---

## 10. HubSpot Integration

HubSpot deals are created and updated automatically to mirror the state of each deal in Supabase. This keeps Greg's CRM current without any manual entry.

### Status Mapping

| Supabase `deals.status` | HubSpot Deal Stage |
|-------------------------|-------------------|
| `onboarding_sent` | Onboarding Sent |
| `setup_in_progress` | Setup in Progress |
| `active` | Closed Won |
| `cancelled` | Closed Lost |

### Deal Fields Synced to HubSpot

When creating a HubSpot deal:
- Deal name: "[Company Name] — [Plan] ([Billing Cycle])"
- Associated contact: client email, name, phone
- Deal stage: per mapping above
- Deal owner: Greg's HubSpot user ID (configured in Supabase secrets)
- Custom properties (if configured in HubSpot):
  - Rep name
  - Commission option
  - Plan
  - Billing cycle

### Configuration

The HubSpot API key is stored in Supabase secrets under the key `HUBSPOT_API_KEY`. Greg's HubSpot account is the target. The HubSpot pipeline and stage IDs must be configured in Supabase secrets or as constants in the `hubspot-sync` function.

---

## 11. Implementation Plan (5 Sub-Plans)

This feature is large enough to require phased delivery. Each sub-plan produces working, testable software that can be reviewed independently. The dependency graph is defined below.

### Sub-Plan 1 — Foundation (DB Schema + Commission Logic)

**Goal:** All database migrations are applied and commission calculation logic is implemented as pure, fully-tested functions.

**Scope:**
- Migration: add `is_sales_rep` and `commission_option` columns to `clients`
- Migration: create `deals` table with all columns, constraints, and indexes
- Migration: create `commissions` table with all columns, constraints, and indexes
- Migration: add `updated_at` auto-update trigger to `deals`
- Pure TypeScript/JavaScript commission calculation functions:
  - `calculateCommissions(deal, repCommissionOption)` → returns array of commission records to insert
  - Handles all four cases: Option 1 monthly, Option 1 annual, Option 2 monthly, Option 2 annual
  - Returns correct upfront + residual amounts, month numbers, and due dates
- Unit tests for all commission calculation cases

**Dependency:** None. Must complete before Sub-Plans 2, 3, and 4.

---

### Sub-Plan 2 — Client Onboarding Flow

**Goal:** A prospective client can receive an onboarding link, fill out the form, pay the $395 setup fee, and trigger automated notifications to Greg and the rep.

**Scope:**
- `create-onboarding-checkout` Edge Function
- `stripe-webhook` Edge Function (setup fee payment event only)
- `hubspot-sync` Edge Function (create + update to "Setup in Progress")
- `send-notification` Edge Function (setup fee paid templates for Greg and rep)
- Public `/onboard` frontend page (form + Stripe redirect + confirmation screen)
- Deal record creation via the New Deal form in the rep dashboard (even if the full rep dashboard is not yet built, a minimal version of the "generate link" flow must exist)

**Dependency:** Sub-Plan 1 must be complete.

---

### Sub-Plan 3 — Sales Rep Dashboard

**Goal:** Sales reps have a purpose-built dashboard to create deals, track pipeline status, and view their commission records.

**Scope:**
- Auth routing: detect `is_sales_rep = true` on login and redirect to the rep dashboard
- New Deal form with link generation
- My Deals pipeline list
- My Commissions section with full residual schedule visibility
- "Show Demo" button that preserves the existing demo flow
- Rep-specific Supabase RLS policies: reps can only read their own deals and commissions

**Dependency:** Sub-Plans 1 and 2 must be complete (link generation requires deal creation from Sub-Plan 2).

---

### Sub-Plan 4 — Admin Sales Panel

**Goal:** Greg has full visibility into all deals and commissions and can mark commissions as paid.

**Scope:**
- New "Sales" tab in `Admin.jsx`
- All Deals table with filters
- All Commissions table with "Mark as Paid" action
- Per-rep summary cards
- `send-notification` call on "Mark as Paid" (commission paid template for rep)
- Admin-specific Supabase RLS policies: admins can read and update all deals and commissions

**Dependency:** Sub-Plan 1 must be complete. Can run in parallel with Sub-Plans 3 and 5.

---

### Sub-Plan 5 — HubSpot Sync (Full)

**Goal:** All deal status changes automatically update the corresponding HubSpot deal in real time.

**Scope:**
- `hubspot-sync` Edge Function — full implementation covering all four status transitions
- Supabase secret: `HUBSPOT_API_KEY`
- Supabase secret: `HUBSPOT_PIPELINE_ID`, `HUBSPOT_STAGE_IDS` (or equivalent constants)
- Integration test: verify each status change triggers the correct HubSpot API call
- Error handling: if HubSpot sync fails, log the error but do not block the primary deal update

**Dependency:** Sub-Plan 1 must be complete. Can run in parallel with Sub-Plans 3 and 4.

---

### Dependency Summary

```
Sub-Plan 1 (Foundation)
        │
        ├─── Sub-Plan 2 (Onboarding Flow)
        │            │
        │            └─── Sub-Plan 3 (Rep Dashboard)
        │
        ├─── Sub-Plan 4 (Admin Sales Panel)   ← parallel with 3 and 5
        │
        └─── Sub-Plan 5 (HubSpot Sync)        ← parallel with 3 and 4
```

---

## 12. Open Items and Future Considerations

### Mercury Bank Integration for Automated Payouts

Greg currently pays reps manually via Mercury bank and marks commissions as paid in the Admin panel. When rep count or payout volume grows, automated disbursement becomes worth investigating. Options:

- **Mercury API** — Mercury offers an API for programmatic transfers. This could allow "Mark as Paid" to simultaneously initiate the bank transfer.
- **Stripe Connect** — If reps are onboarded as Stripe Connect accounts, payouts can be fully automated via Stripe's platform payout mechanics.

**Decision:** Out of scope for this build. Re-evaluate when payout volume justifies the integration effort.

### Mobile Access for Reps

The Sales Rep Dashboard is built as a responsive web UI. Reps can access it on mobile via browser. The deal creation and link-generation flow is simple enough that a native mobile wrapper (React Native / Expo) would be low effort if mobile access becomes a priority.

**Decision:** Monitor rep usage patterns. Build a native app only if browser-based mobile UX proves insufficient.

### Rep Self-Registration

Currently, rep accounts are created manually by Greg in the Admin panel. If the number of reps grows significantly, a self-registration or invite-link-based signup flow may be warranted.

**Decision:** Out of scope. Current manual process works at current scale.

### Chargeback and Cancellation Handling

Clawback policy and cancellation handling are fully defined in Section 4.3. The schema supports all required states: `cancelled` deal status and `voided` commission status are both included in the data model.
