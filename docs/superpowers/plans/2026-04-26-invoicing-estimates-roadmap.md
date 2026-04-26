# Invoicing + Estimates — Roadmap

> **Master roadmap.** This document is the high-level view of the entire build. Each
> phase has (or will have) its own detailed implementation plan. The spec lives at
> `docs/superpowers/specs/2026-04-26-invoicing-estimates-spec.md`.

**Goal:** Bring the *money* part of the HVAC workflow into the Reliant dashboard —
pricing catalog, estimates (with good/better/best options), invoices, customer-facing
approval/view portal, and (eventually) integrated card payments.

**Strategic framing:** Today the product captures the call, books the appointment,
dispatches the tech, tracks them, and requests a review. The shop still uses a separate
tool for invoicing (QuickBooks, paper, Housecall Pro, ServiceTitan). This build turns
Reliant from "AI receptionist" into "complete front office" and is the largest
revenue-expansion lever in the roadmap.

---

## Decisions locked during discovery

| # | Decision | Resolution |
|---|---|---|
| 1 | Payment processing scope | ⏸ Deferred to ~week 5 — Phase 1-3 work is identical for both Path A and Path B, so no need to commit yet |
| 2 | Pricing model | ✅ Hybrid — every catalog entry is either flat-rate or T&M; T&M lines compute `labor_rate × hours` at estimate time |
| 3 | Multi-option estimates | ✅ V1 required — "good / better / best" for replacement-sale jobs |
| 4 | Tech-in-field estimate generation | ✅ V1 required — replacement-sale workflow needs tech to build estimates on a phone in the field |
| 5 | Starter pricing template | ✅ Reuse existing `service_types` (156 HVAC services already seeded per client). Add CSV import for prices and shop's existing book. |
| 6 | Tax handling | ✅ Per-client default rate **and** per-line `taxable` boolean (some states tax parts but not labor) |
| 7 | Service-type labor duration | ✅ Already built — `service_types.duration_minutes` is wired into scheduler. Reuse for labor-time portion of quotes. |
| 8 | Customer-facing portal | ✅ V1 — token-protected unauthenticated page (same pattern as existing `tracking_tokens`). Required because Forks 3 + 4 are locked. |

---

## Phased delivery

Each phase is independently shippable. A phase doesn't ship to production until it's
been used internally by Greg and at least one beta shop (when one exists).

### Phase 1 — Pricing Catalog *(detailed plan: `2026-04-26-invoicing-phase-1-catalog.md`)*

**Ships:** Owner/admin can build, edit, import, and export a customized pricing catalog
of services / equipment / parts / materials, with per-line tax and unit-of-measure
support.

**New objects:**
- `pricing_catalog` table (per-client; references `service_types` where applicable)
- `clients.default_tax_rate` column
- `PricingCatalog.jsx` UI tab (owner/admin only)
- CSV import (paste or upload, with preview + validation)
- CSV export

**Key call-outs:**
- Schema explicitly supports good/better/best in Phase 2 via a `tier` field on
  catalog entries (so multiple priced rows can hang off one logical service).
- Every entry can optionally link to a `service_types(id)` row, so estimate UI in
  Phase 2 can auto-suggest the catalog item when the tech picks a service.
- RLS uses the `auth.email()` pattern per `CLAUDE.md` — never the `auth.users`
  subquery.

**Out of scope for Phase 1:**
- Estimates and invoices (Phase 2-3)
- Customer portal (Phase 2)
- Stripe Connect (Phase 4)
- Service-plan member pricing tiers (V2 — schema leaves room)

---

### Phase 2 — Estimates + Customer Portal *(plan written when Phase 1 ships)*

**Ships:** Office user or tech-in-field can build an estimate referencing catalog
items, group lines into good/better/best options, send the estimate via SMS/email
link, and the customer can view, select an option, and approve from a token-protected
page.

**New objects (preview):**
- `estimates` table (header: customer, appointment FK, status, expires_at, totals)
- `estimate_options` table (option groups for good/better/best)
- `estimate_line_items` table (lines under each option)
- `estimate_tokens` (mirrors `tracking_tokens` pattern for customer portal)
- `EstimateBuilder.jsx` (office UI + responsive enough for tech mobile use)
- `EstimateViewerPublic.jsx` (token-protected customer-facing page)
- Edge function: `generate-estimate-token`
- Edge function: `send-estimate` (SMS + email; reuses existing `send-sms`)

**Notable design decisions to lock during Phase 2 planning:**
- Whether tech-in-field UI is the same component as office UI (responsive) or a
  separate streamlined component (likely separate — tech UI is much more
  opinionated and barcode-scanner friendly).
- Approval mechanic: checkbox + timestamp + IP capture (legally sufficient in most
  states per discovery). Need to capture and persist; consider client's custom legal
  text field on `clients`.
- Photo / note attachments on lines (techs show what's wrong — closes more jobs).

---

### Phase 3 — Invoices + AR *(plan written when Phase 2 ships)*

**Ships:** When a job is marked complete, an invoice is auto-generated from the
accepted estimate option's lines (or from scratch for ad-hoc jobs). Office or tech can
edit/finalize, send via SMS/email, and mark paid (cash/check/card-collected). Office
manager has an AR aging view.

**New objects (preview):**
- `invoices` table (header: customer FK, appointment FK, estimate FK, number, status,
  totals, dates)
- `invoice_line_items` (mirrors estimate_line_items shape)
- `payments` table (records payment events: method, amount, reference, recorded_by)
- `InvoiceBuilder.jsx`, `InvoiceViewerPublic.jsx`
- AR dashboard view (open / overdue / partial)
- Edge function: `send-invoice`
- Edge function: `auto-send-invoice-on-complete` (or equivalent — reuse review-request
  pattern that already auto-fires on job completion)

**Notable design decisions:**
- Sequential invoice numbering per client (gap-free is hard; gap-allowed is fine).
- Statuses: draft, sent, viewed, paid, partial, overdue, void, refunded.
- Discount/waiver permissions per role (configurable).
- Estimate → Work Order → Invoice as three distinct objects with clean transitions
  (per Monday-walkthrough spec note).

---

### Phase 4 — Payments *(decision point at end of Phase 3; plan written then)*

**Two paths, decision deferred:**

**Path A — Invoices-only.** Customer receives invoice link, pays via shop's existing
processor (Square, etc.). "Mark Paid" button in dashboard records the event. Optionally,
a one-off Stripe Payment Link feature for deposits (no Connect required).

**Path B — Full Stripe Connect.** Each shop onboards their own Stripe Standard Connect
account (Stripe handles KYC, money transmission, 1099-Ks). Customer taps "Pay Now" on
invoice/estimate, funds flow customer → Stripe → shop's bank, Reliant takes platform
fee. Sticky, recurring revenue, demo-friendly.

**By the end of Phase 3, the user will have:**
- Real invoicing workflow shipped
- Better understanding of Stripe Connect operational reality (lightweight ongoing burden
  with Standard Connect — see discussion in this branch's session history)
- Possibly first paying clients giving feedback on what they actually need

That information makes the Path A vs B decision much sharper than it is today.

---

## Build order rationale

The phases are sequenced so that:

1. **Phase 1 is identical regardless of payment path.** Building it first commits us to
   nothing payment-related and ships shop-usable software immediately (a configured
   pricing catalog has standalone value — it's the foundation for any quote in any
   tool).
2. **Phase 2 unlocks the most differentiated feature in pitch.** Multi-option estimates
   with customer self-approval is genuinely better than what most competitors ship and
   doesn't require payments.
3. **Phase 3 closes the loop without payments.** Mark-paid manual flow is enough to
   replace the shop's invoicing tool entirely. At this point Reliant is a complete
   front office.
4. **Phase 4 is the upgrade.** Whether Path A or B, it sits on top of a fully-functional
   invoice product.

---

## Cross-cutting concerns (build right from Phase 1)

### Schema design discipline
- Every new table has `client_id` FK and an RLS policy keyed on it (multi-tenancy is
  non-negotiable).
- Every new table includes `created_at` (timestamptz, default now()) and `updated_at`
  (manual or trigger-managed — prefer manual to keep migrations simple).
- Foreign keys use `ON DELETE` clauses appropriately (`CASCADE` for child rows,
  `SET NULL` for soft references like `service_type_id`).

### RLS pattern
**Always use `auth.email()`.** Never `(SELECT email FROM auth.users WHERE id = auth.uid())` —
this fails at runtime with "permission denied for table users." Reference: migration
`supabase/migrations/20260325005_fix_rls_use_auth_email.sql` lines 10-33, 81-88.

### Token-based public pages
The customer portal in Phase 2 and invoice viewer in Phase 3 follow the existing
`tracking_tokens` pattern exactly:
- Migration: `20260328001_location_mapping.sql:91-114` (table)
- Edge fn: `supabase/functions/generate-tracking-token/index.ts:1-100`
- Anon RLS read policy: `20260330001:7-13`

### Edge function conventions
All Edge Functions in this repo:
- Define CORS headers at top (see `check-availability/index.ts:6-10`)
- Validate Bearer JWT via `supabase.auth.getUser(jwt)` (see
  `generate-tracking-token/index.ts:15-29`)
- Use service-role key for database writes (`SUPABASE_SERVICE_ROLE_KEY`)
- Are deployed with `--no-verify-jwt` flag
- Log errors with `console.error` and emoji prefix for ease of grep

### Tailwind / UI conventions
- Dark theme palette: `bg-gray-900` (page), `bg-gray-800` (panels), `bg-gray-750`
  (inputs), `border-gray-700`/`gray-600` (borders), `text-white`/`text-gray-400`
  (typography).
- Form input class: `w-full px-2.5 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm`
  (from `AppointmentSidePanel.jsx:35-37`).
- Modals: fixed overlay `bg-black bg-opacity-50`, container `bg-gray-800 rounded-lg border border-gray-700` (see `Admin.jsx:491-493`).
- **Never use dynamic Tailwind classes** like `` `grid-cols-${n}` `` — they get purged
  in production. Always use explicit conditionals. (CLAUDE.md gotcha.)

### Auth context
- `clientId` resolves from auth in `App.jsx` (~lines 17-115). Owners read from
  `clients.email = auth.email()`. Dispatchers from `client_staff`. Techs from
  `technicians`.
- New components receive `clientId` as a prop. Don't re-resolve.

---

## Working agreement

- Each phase ships independently. Don't start Phase 2 work mid-Phase 1.
- Each phase is built in a fresh worktree off `main` (Phase 1's worktree is
  `.claude/worktrees/invoicing-v1`, branch `claude/invoicing-v1`).
- Each phase ends with: working in browser, manually verified end-to-end by Greg, then
  PR to `main`, then merged.
- The detailed plan for the next phase is written *after* the previous phase ships, so
  it can incorporate what we learned.

---

## Where to start

Read the detailed Phase 1 plan: `2026-04-26-invoicing-phase-1-catalog.md`.
