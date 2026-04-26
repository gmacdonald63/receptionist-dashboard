# Next Major Build: Invoicing + Estimates

> **Resume guide for a fresh session.** This file is the single source of truth for
> everything discovered and decided so far. Read top-to-bottom; the project `CLAUDE.md`
> covers infra (Supabase ref, Retell, Telnyx, etc.). The user prefers careful,
> considered planning — surface considerations they haven't thought of, explain
> tradeoffs, and don't rush to a plan. Two forks below (Payments + Pricing model) are
> the highest-leverage decisions; everything else flows downstream.
>
> **Where we are:** Discovery phase complete. Awaiting user answers on 8 forks. Once
> answered, dispatch a Plan agent and write the detailed implementation plan.

## Context

The user is evaluating what to build next for the Reliant Support AI voice receptionist
product. After discussion, the user chose **invoicing + estimates** as the next major
build (displacing earlier candidates like missed-call-to-text and customer recognition,
both of which remain viable future features).

**Problem this solves:** Today the dashboard captures the call, books the appointment,
dispatches the tech, tracks them, and requests a review — but the *money* part of the
workflow still happens in a separate tool (QuickBooks, paper, or a competing FSM like
Housecall Pro / ServiceTitan). Bringing invoicing + estimates in-product turns Reliant
from "AI receptionist" into "complete front office" and creates the most significant
revenue-expansion lever in the roadmap.

**Intended outcome:** Shops can build a customized pricing catalog, generate estimates
(with multiple options where appropriate), convert accepted estimates to invoices, send
them to customers, and record payment — all without leaving the dashboard.

---

## Status: discovery / decision phase

User is not ready to lock a plan. The next step is to resolve the key forks below, at
the user's pace, then produce a detailed implementation plan.

---

## Key decisions that shape the build

### Fork 1 — Payment processing scope (biggest decision)

**Path A — Invoices only (V1).** Generate invoices + estimates, send as links/PDFs.
Shop collects payment via their existing channels (cash, check, their own Stripe/Square).
We mark "paid" when the shop confirms. ~50% the build, ships in weeks.

**Path B — Full Stripe Connect.** Customer taps a link, pays by card; funds flow to the
*shop's* bank, not Reliant's. Reliant can take a platform fee. Requires per-client
Stripe Connect onboarding (KYC, bank linking). ~2x the build. Ships in months.

**Recommendation:** Path A first, Path B as a paid-tier upgrade. Gets the catalog /
estimate / invoice machinery shipped without the Connect onboarding distraction.

### Fork 2 — Pricing model

Flat-rate / T&M / hybrid? Recommendation: **hybrid with flat-rate as primary UX**. Each
pricing entry can be either type; T&M entries compute `labor_rate × hours` into the line.

### Fork 3 — Multi-option estimates ("good/better/best")

V1 must-have or V2? Recommendation: **V1** for big jobs (replacements). Changes the data
model — estimate isn't a flat line-item list, it's a list of option groups.

### Fork 4 — Tech-in-the-field estimate generation

Can techs create estimates from the TechDashboard, or office-only for V1? Field
generation is a big value-prop ("approve on your phone right now") but adds UI.

### Fork 5 — Starter pricing template

**Partially already solved.** The existing `service_types` table seeds every new
client with 156 HVAC services across 13 categories, each with duration and phrase
matches. Setup task is **pricing** those (and adding equipment/parts entries) —
not building a catalog from scratch.

Still recommend CSV import for prices (and for importing a shop's existing book).

### Fork 6 — Tax handling

Per-client flat rate only, or per-line-item taxable flag too? Rules vary by state
(some tax parts but not labor). Recommendation: **both** — per-client tax rate +
`taxable` boolean on each pricing line.

### Fork 7 — Service-type labor duration (RESOLVED: already built)

**Correction from earlier analysis.** The `service_types` table already exists with
156 HVAC services seeded per client (migration
`20260314_replace_service_types_with_156.sql`), each with:
- `name`, `category`, `duration_minutes`, `urgency`, `customer_phrases[]`,
  `sort_order`, `is_active`, `client_id`.

**Already wired:**
- `supabase/functions/check-availability/index.ts:189-244` — looks up
  `duration_minutes` via exact name → `customer_phrases` fuzzy → partial name match.
- `supabase/functions/book-appointment/index.ts:116-165` — same lookup cascade.
- `src/AppointmentSidePanel.jsx:276-289` — manual-booking dropdown lists every
  service with formatted duration; on selection auto-populates the appointment
  duration field.
- `src/DispatcherDashboard.jsx:485` — fetches service types and passes to calendar
  + side panel.

**Admin-only RLS** (migration `20260314_add_client_id_to_service_types.sql`) — techs
and dispatchers read, only admins insert/update/delete.

**Implication for invoicing plan:** no scheduler refactor required. The estimator/
invoicer can read `service_types.duration_minutes` directly for the labor-time
portion of quotes. Massive simplification vs. what I originally assumed.

### Fork 8 — Customer-facing portal

An unauthenticated, token-protected page (same pattern as existing `tracking_tokens`
for the On-My-Way feature) where customers view estimates/invoices, pick options,
approve (signature = timestamp + IP + checkbox, legally sufficient in most states).
Recommendation: **yes, in V1**.

---

## Gaps surfaced by the "Monday walkthrough" exercise

Items not captured in the initial feature list that the workflow walkthrough surfaced:

1. **AI "draft estimate" hook on call intake.** When AI flags a call as replacement/
   quote-inquiry, auto-create a pending-draft estimate tied to the appointment so the
   diagnostic tech arrives with a shell to fill in.
2. **Three distinct objects with clean transitions: estimate → work order → invoice.**
   Not two objects with a blurry line. Accepted estimate is stamped and immutable;
   invoice is generated from the accepted option's lines when work completes.
3. **Field generation is not optional for big-ticket work.** The replacement-sale
   scenario requires tech-in-the-field estimate building on mobile. Fork 4 effectively
   resolves to "V1 required."
4. **Ad-hoc line items** — first-class support for lines not in the catalog. Techs
   will always encounter custom situations.
5. **Quantity + unit-type on pricing entries** (each / hour / pound / foot). Not a
   flat `price` field. Refrigerant, wire feet, etc.
6. **Mark-paid flow for cash/check/card-collected-at-door.** Tech-in-field button +
   office-manager reconciliation view.
7. **Aging / open-AR dashboard.** Day-1 requirement for the office manager, not a
   reporting nice-to-have.
8. **Discount/waiver permissions** — configurable per-tech or per-role.
9. **Deposit collection is Path A's weak spot.** The "$2K deposit on approval" moment
   exactly where not-taking-payments hurts. Consider a minimal Stripe link feature
   even in Path A (deposit-only, one-link-per-invoice) without full Connect.
10. **Auto-send invoice SMS on job completion.** Same pattern as the existing review-
    request SMS auto-fire. Reuses `send-sms` Edge Function.
11. **Multi-option estimate UX decision (Fork 3).** The Monday walkthrough made this
    concrete — without good/better/best, the replacement-sale workflow breaks. Locks
    to V1 required.

## Things the user hasn't mentioned that matter

Captured here so we don't lose them:

1. **Deposits** — install jobs >$3K typically require a deposit. Invoice needs partial
   payment support.
2. **Estimate validity period** — "good for 30 days" is standard. Data model needs
   `expires_at`.
3. **Invoice numbering** — sequential per client.
4. **Invoice statuses** — draft, sent, viewed, paid, partial, overdue, void, refunded.
5. **Reminders for unpaid invoices** — automated nudges (likely V2).
6. **Photos / notes attached to estimates** — techs show what's wrong, helps close jobs.
7. **AI-generated estimates from call transcripts** — V2 differentiator. Make sure data
   model can support it (don't build in V1, but don't block future extension).
8. **Compliance / legal** — some states require written estimates above $ thresholds.
   Store signature timestamp + IP + client's custom legal text. Don't be a tax/legal
   engine; give the shop the controls.
9. **Service plan discounts / tiered pricing** — service-plan member pricing, senior
   discount, after-hours premium. Probably V2 but flag in data model.

---

## What the current codebase gives us vs. what we'll build

### Reusable today
- `clients` table with per-client settings (pattern for new pricing config)
- Stripe SaaS billing (`create-checkout-session`, `stripe-webhook`) — establishes the
  Stripe pattern but is for *our* billing, not customer payments. Connect is separate.
- `tracking_tokens` table + pattern — same pattern for customer-facing invoice/estimate
  links (token-based, unauthenticated, scoped).
- `send-sms` Edge Function + Telnyx infra — send estimate/invoice links via SMS.
- Retell webhook + `custom_analysis_data` extraction — foundation for V2 AI-generated
  estimates from call transcripts.
- `appointments` table — invoices link back to appointments.

### Genuinely new
- `pricing_catalog` table (per-client, priceable items: services, equipment, parts,
  materials, labor-hour rates). References `service_types(id)` where applicable
  (labor duration reused from existing table). Supports multiple priced entries
  per service_type for good/better/best or member-vs-standard pricing.
- `estimates` table + `estimate_options` + `estimate_line_items`
- `invoices` table + `invoice_line_items`
- `payments` table (records payment events, method, reference)
- Catalog editor UI (list + search + edit + CSV import + starter template loader)
- Estimate builder UI (pick service, pick options, add line items, preview)
- Invoice viewer / sender UI
- Customer-facing portal page (token-based route)
- Tax calculation logic

(No scheduler refactor — `service_types.duration_minutes` already drives scheduling.)

---

## Reference: what the earlier conversation landed on

- **Review request automation** — confirmed already built. Do not re-scope.
- **Missed-call-to-text** — user deferred after realizing the reply-black-hole problem
  requires the inbox feature. Not dead; revisit when two-way SMS exists.
- **Customer recognition at call start** — user was enthusiastic, then pivoted to
  invoicing first. Research completed (Retell inbound webhook confirmed supported,
  response shape `{call_inbound:{dynamic_variables:{...}}}`, 10s timeout, 3 retries,
  all dynamic variables must be strings). Codebase has `normalizePhone()` in
  `src/utils/addressNormalization.js:122-127` but Edge Functions don't use it —
  flagged as a gotcha for when we return to this feature.
- **Two-way SMS / unified inbox** — foundation for many things (missed-call replies,
  review-request replies, tracking-link replies). Likely the next major build after
  invoicing.

---

## Open decisions at a glance

| # | Decision | My recommendation | Status |
|---|---|---|---|
| 1 | Payment processing scope | Path A (invoices only) first, Path B (Stripe Connect) later — but consider minimal Stripe link for deposits even in Path A | **Awaiting user** |
| 2 | Pricing model | Hybrid (flat-rate primary UX, T&M supported) | **Awaiting user** |
| 3 | Multi-option estimates | V1 required (Monday walkthrough confirmed) | **Leaning locked** |
| 4 | Tech-in-the-field generation | V1 required (Monday walkthrough confirmed) | **Leaning locked** |
| 5 | Starter pricing template | 156-service catalog already seeded. Add CSV import for prices. | **Partially resolved** |
| 6 | Tax handling | Per-client rate + per-line `taxable` boolean | **Awaiting user** |
| 7 | Service-type labor | Already built. Reuse as-is. | ✅ Resolved |
| 8 | Customer-facing portal | Yes, V1 (token-based like `tracking_tokens`) | **Awaiting user** |

Forks 1 and 2 shape ~70% of the architecture. The user has indicated they'll answer
on their own timeline.

---

## When user returns: pick up from here

1. Review their answers on the 8 forks.
2. Fill in any remaining gaps via targeted questions.
3. Dispatch a Plan agent with full context (research findings + locked decisions).
4. Write the detailed implementation plan.
5. Propose phased rollout (catalog → estimates → invoices → portal, or similar
   sequencing).
6. ExitPlanMode for approval.
