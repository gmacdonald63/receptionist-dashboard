# AI-Only Service Tier — Design Spec

**Date:** 2026-07-18
**Status:** Draft for review
**Author:** Orchestrator (Dream Team) + Greg

## 1. Summary

Split the product into two purchasable tiers so the AI receptionist can be sold
standalone for **$100 less** than today's all-in package, with the full dashboard
sitting behind a paid upgrade.

- **AI-only tier** — voice agent + full visibility into what the AI does (calls,
  transcripts, recordings, AI summaries, calendar of what the AI booked). Priced
  **$100 below** the current package.
- **Platform tier** — everything AI-only has, plus the full dashboard (CRM, dispatcher
  map, technician tracking, "On My Way" SMS, estimates/pipeline/advanced reporting).
  This is exactly the product sold today.

AI-only clients still **log in** and see the platform sections as locked "upgrade"
teasers — the land-with-AI, expand-to-platform hook. Upgrading is a live, in-app,
no-re-onboarding action.

### Pricing

| Tier | 1,000 min | 2,000 min |
|---|---|---|
| **AI-only** | $395/mo | $595/mo |
| **Platform** (AI + dashboard) | $495/mo | $695/mo |

The current live prices are already $495 / $695, so **today's product is the Platform
tier**. This project adds the two lower AI-only prices and the gating that separates them.

## 2. Scope

**In scope**
1. `plan_tier` field on the client record, driven by Stripe.
2. Two new Stripe prices (AI-only 1k, AI-only 2k) + annual variants; wire all 4 tiers
   into the existing price maps.
3. Backend gating: webhook writes `plan_tier`; RLS + edge-function tier checks protect
   platform-only data so AI-only clients can't reach it via the API.
4. Frontend: slimmed nav for AI-only, locked upgrade teasers on platform sections,
   route/tab guards.
5. Live in-app upgrade flow (swap to +$100 price → tier flips → platform unlocks).
6. Tier selection ("AI-only vs. Platform") added to the **existing** onboarding/activation
   flow — no new public signup funnel.
7. Commission engine extended so reps earn on AI-only deals at the $395/$595 base.

**Out of scope (explicitly deferred)**
- A separate self-serve public AI-only marketing/signup funnel (reuse existing onboarding).
- À-la-carte per-feature flags (a single two-value enum is sufficient for two tiers).
- Representing the $100 as a separate Stripe line item (rejected — see §4).

## 3. Success criteria

- An AI-only client logs in and sees only: Calendar (read-mostly), Calls, Billing,
  Settings. Platform sections appear as locked "Upgrade to unlock" teasers.
- An AI-only client **cannot** read CRM/dispatch data even by calling the API/DB directly
  (RLS + edge-function checks reject it).
- Clicking "Upgrade" swaps the subscription to the +$100 price; within seconds the webhook
  flips `plan_tier` to `platform` and the full nav appears — same account, same phone number,
  no re-onboarding.
- A rep-sold AI-only deal generates correct commission records at the $395/$595 base using
  the rep's existing Option-1/Option-2 rules.
- Existing subscribers are unaffected (all backfilled to `platform`).

## 4. Key decisions

1. **Single `plan_tier` enum**, not a per-feature flags table. Two tiers only; YAGNI.
2. **Four bundled flat prices**, NOT a separate $100 add-on line item. Rationale: the
   existing code (webhook, commission engine, billing UI) assumes exactly **one price per
   subscription** (`stripe-webhook` reads `items.data[0].price.id`; `clients.stripe_price_id`
   is a single column). Bundled prices fit this model with minimal change; upgrade = a single
   price swap that Stripe auto-prorates. The add-on-item approach would require reworking all
   three subsystems for a cosmetic invoice difference.
3. **Stripe price is the source of truth for tier.** A master `PRICE_ID → { tier, bucket }`
   map drives everything. The webhook writes the derived `plan_tier` onto the client so RLS
   and the UI can read a plain column instead of re-deriving from a price ID everywhere.
4. **Appointments = read-mostly calendar for AI-only.** They see everything the AI booked;
   platform-only in-tab controls (assign technician, dispatch, tech tracking) are hidden.
5. **Reps earn on AI-only** at the $395/$595 base; commission math (Option 1/2, annual bonus)
   is unchanged — only the base price differs by tier.
6. **RLS uses `auth.email()`** exclusively — never a subquery on `auth.users` (project rule,
   enforced by migration 20260325005).

## 5. Architecture

### 5.1 Data model changes

**`clients` table**
- Add `plan_tier TEXT NOT NULL DEFAULT 'platform'` with a check constraint in
  `('ai_only','platform')`.
- Backfill: no-op — every existing row defaults to `platform`, which is correct since all
  current subscribers are on $495/$695.

**`deals` table**
- Add `tier TEXT NOT NULL DEFAULT 'platform'` with the same check constraint. Legacy deals
  default to `platform`. Set at deal/plan-selection time in onboarding.
- Existing `plan` column (`standard` | `pro`) continues to encode the **minute bucket**
  (standard = 1k, pro = 2k). Tier is now a second, independent dimension.

### 5.2 Price map (single source of truth)

A canonical map, defined once and reused (shared constant or duplicated consistently across
the JS billing UI and the Deno edge functions):

```
PRICE_CATALOG = {
  ai_only:  { standard: { monthly: <395>, annual: <...> },
              pro:      { monthly: <595>, annual: <...> } },
  platform: { standard: { monthly: price_1TFNy4... /495/, annual: <...> },
              pro:      { monthly: price_1TFLwt... /695/, annual: <...> } },
}
```

- Reverse map `PRICE_ID → { tier, bucket }` derived from the catalog, replacing/extending
  the current `PRICE_ID_TO_PLAN` in `DispatcherDashboard.jsx` and `PRICE_IDS` in
  `create-subscription-checkout`.
- New Stripe prices to create in the Stripe dashboard: AI-only 1k ($395) and AI-only 2k
  ($595), monthly + annual, live + test as needed. Their IDs get filled into the catalog.

### 5.3 Webhook (`supabase/functions/stripe-webhook/index.ts`)

- On `checkout.session.completed` (subscription), `customer.subscription.updated`, and
  `customer.subscription.deleted`: after resolving the price ID, look it up in the reverse
  map and write **both** `stripe_price_id` **and** `plan_tier` onto the client. This is what
  makes an upgrade flip the tier live.
- Commission calculation on `invoice.paid`: the deal now carries `tier`; base price becomes
  `PLAN_PRICES[deal.tier][deal.plan]` (see §5.6). Guard for unknown tier/plan.

### 5.4 Backend gating (RLS + edge functions)

Platform-only tables get a tier gate keyed on the **owning client's** `plan_tier`:

- Tables to gate: `customers`, `customer_notes`, `follow_up_reminders`, `technicians`,
  `technician_permissions`, `tech_locations`, `client_destinations`, `tracking_tokens`, and
  the estimates/invoices tables.
- Policy pattern (SELECT/INSERT/UPDATE/DELETE as appropriate), always via `auth.email()`:

  ```sql
  EXISTS (
    SELECT 1 FROM clients c
    WHERE c.id = <table>.client_id
      AND c.email = auth.email()      -- or the client the caller belongs to
      AND c.plan_tier = 'platform'
  )
  ```

  For sub-accounts (dispatcher via `client_staff`, tech via `technicians`), the gate resolves
  to the **parent client's** tier. In practice an AI-only client has no techs/dispatchers, so
  this is defense-in-depth.
- Edge functions that read/write platform data (e.g. SMS/tracking/estimate functions)
  independently verify the caller's client is `platform` before proceeding, returning 403
  otherwise. New migration follows the existing numbered convention.

**Migration note:** existing policies must not be broken. New tier clauses are added to
platform-only tables only; AI-visible tables (`appointments`, `calls`) keep their current
policies. All new/edited policies use `auth.email()`.

### 5.5 Frontend gating (`src/DispatcherDashboard.jsx`, `src/App.jsx`)

- Compute `tier = clientData?.plan_tier ?? 'platform'` (default platform so nothing regresses).
- **Nav:** derive `aiOnlyNavItems = [appointments (calendar), calls, billing, settings]`.
  For AI-only, the platform tabs (customers, team, map, estimates, pricing) are rendered as
  **locked teaser entries** rather than removed. Keep the existing `isDeveloper` dev-tab
  filter behavior intact.
- **Tab/route guard:** if `tier === 'ai_only'` and `activeTab` is a platform tab (via deep
  link or stale state), render the upgrade teaser for that section instead of the real view.
- **Appointments tab:** when `tier === 'ai_only'`, hide platform-only in-tab controls
  (assign technician, dispatch, tech-tracking affordances); the calendar of AI-booked
  appointments remains fully visible.
- **Upgrade teaser component:** a reusable panel ("Upgrade to unlock the full platform —
  +$100/mo") shown in place of each locked section, with a single upgrade CTA.

### 5.6 Commission engine (`src/utils/commissions.js` + webhook copy)

- `PLAN_PRICES` becomes tier-aware in both places (they are intentionally mirrored):

  ```
  PLAN_PRICES = {
    platform: { standard: 495, pro: 695 },
    ai_only:  { standard: 395, pro: 595 },
  }
  ```

- `calculateCommissions(deal, option, baseDate)` reads `PLAN_PRICES[deal.tier][deal.plan]`;
  default `deal.tier` to `platform` when absent (legacy safety). Option 1, Option 2, and the
  $200 annual bonus are unchanged. Update the JSDoc and the mirrored constant in the webhook
  together so they never drift.

### 5.7 Onboarding tier selection

- The existing onboarding/activation flow gains an **AI-only vs. Platform** choice that sets
  `deals.tier`. Downstream (`create-subscription-checkout`) selects the price from the catalog
  by `(tier, plan, billing_cycle)`. No new funnel.
- Both tiers still provision a Retell agent + Telnyx number; 10DLC brand/campaign/number is
  per-client regardless of tier. AI-only does not skip provisioning.

### 5.8 Live upgrade flow

- Upgrade CTA calls a checkout/subscription-update path that swaps the current subscription
  item to the platform price for the client's existing minute bucket (e.g. AI-only 1k → Platform
  1k). Stripe prorates automatically.
- `customer.subscription.updated` fires → webhook writes `plan_tier = 'platform'` → on next
  client-data refresh the full nav renders. Same account, phone number, and Stripe customer.

## 6. Testing

- **Commissions (unit):** extend existing `commissions` tests — AI-only Option 1 & 2, monthly
  & annual, assert bases of 395/595 and correct residual/bonus math; assert legacy deals with
  no `tier` still compute at platform base.
- **Tier derivation (unit):** price ID → `{ tier, bucket }` for all 4 prices (× monthly/annual),
  and unknown price → null/guarded.
- **Webhook (integration):** checkout/updated events write the correct `plan_tier`; upgrade
  event flips `ai_only` → `platform`.
- **RLS (integration):** an AI-only client is denied SELECT on `customers`/`technicians`/etc.;
  a platform client is allowed; `appointments`/`calls` remain readable for both.
- **Frontend:** AI-only nav shows only the 4 allowed tabs + locked teasers; platform-tab deep
  link renders the teaser, not the real view; Appointments hides tech-assignment for AI-only.

## 7. Risks & mitigations

1. **Price-ID drift across catalog copies (JS vs. Deno).** Mitigation: define the catalog in
   one obvious place, mirror deliberately, and cover with the tier-derivation unit test.
2. **RLS mistake locks out platform clients or leaks to AI-only.** Mitigation: default
   `plan_tier = 'platform'`, add tier clauses only to platform-only tables, and verify both
   the allow and deny paths in integration tests before deploy.
3. **Commission miscalculation on AI-only.** Mitigation: `deal.tier` defaults to platform;
   unit tests assert AI-only bases; webhook and `commissions.js` constants updated in the same
   change.
4. **Upgrade proration surprises.** Mitigation: bucket-preserving swap (1k→1k, 2k→2k) so the
   only delta is the +$100 tier step; confirm proration copy in the upgrade UI.

## 8. Build order (feeds the implementation plan)

1. Migration: `clients.plan_tier`, `deals.tier` (+ check constraints, defaults, backfill no-op).
2. Stripe: create AI-only prices; fill the price catalog; extend reverse maps.
3. Webhook: write `plan_tier`; make commission base tier-aware.
4. Commission engine: tier-aware `PLAN_PRICES` + tests.
5. RLS + edge-function tier checks on platform-only data + tests.
6. Frontend: tier-aware nav, tab guards, Appointments in-tab gating, reusable upgrade teaser.
7. Onboarding: tier selection → `deals.tier` → catalog price selection.
8. Live upgrade flow (swap price → tier flip → unlock).
