# Reliant Support — Restart Brief (October 29, 2026)

Written for Greg after a break, and meant to be pasted into a planning tool (Grok)
as the starting picture. Claude Code still does the building and keeps the docs up to date.

**The new direction:** the AI receptionist (**Reliant Reception**) is the main product,
sold on its own. The full dashboard (**Reliant Operations**) is the upgrade.

---

## 1. Where things stand

### Built and working
- **The AI receptionist** (Retell AI, HVAC-trained): answers calls, checks the calendar
  and books appointments, and saves every call with a transcript, recording and summary.
- **Full dashboard**: appointments calendar, calls, customers (CRM), team, technician app,
  live GPS dispatch map, "On My Way" tracking page, review requests, settings that update
  the AI (greeting, voice, business hours).
- **Payments**: Stripe setup fee ($395) plus monthly plans ($495 / $695), billing portal,
  and the dashboard stays locked until the subscription is active.
- **Sales system**: commission-only sales reps, a rep dashboard, the deal pipeline and HubSpot sync.
- **Onboarding**: payment, business info form, activation email, password setup.
- **Marketing funnel**: Missed Revenue calculator, a personalized 3-page PDF emailed
  automatically, plus the `/try-receptionist` (talk to the AI) and `/try-demo` (sample dashboard) pages.

### Built but hidden
- Pricing catalog and Estimates. These are visible only to Greg's login.

### Started, not finished: the Reception / Operations split
- **Decided** (spec: `docs/superpowers/specs/2026-07-18-ai-only-tier-design.md`):
  - Names: **Reliant Reception** (AI only) and **Reliant Operations** (everything).
  - Proposed prices: Reception $395 / $595, Operations $495 / $695.
  - Reception customers still log in, but see only the Calendar, Calls, Billing and
    Settings. The other sections show as locked "Upgrade" previews.
  - Upgrading happens inside the app: same account, same phone number, nothing to set up again.
- **Done:** the database now has a "tier" field on every client and deal (it's live).
- **Not done:** the new Stripe prices, the screens that hide and lock sections, the
  upgrade button, choosing a plan during onboarding, and rep commissions for Reception deals.

### Known problems
1. **Text messages don't get delivered.** Carriers rejected the phone number registration
   (10DLC). The recommended fix is toll-free numbers with toll-free verification. *This only
   affects Operations features (tracking links, estimates, review texts), so it does not
   block selling Reception.*
2. **The Retell API key is visible in the dashboard's public code.** Anyone who opens the
   dashboard can see it. Rotating the key doesn't fix this. The fix is to route those Retell
   calls through the server (`create-web-call` already works this way). **Fix this before onboarding real customers.**
3. **The documentation is out of date.** The master history doc was last updated June 5,
   and parts of `CLAUDE.md` describe how the code used to be organized. Everything is
   written as if the full platform is the product.
4. **The repo has unrelated projects in it**: a teleprompter app and a tire size calculator.
   They should move to their own repos.

### Customers and leads (from the live database)
- 6 client accounts: Greg's own (id 1), the demo (9999), and 4 test accounts. **As far as
  the database shows, there are no outside paying customers yet.** Please confirm.
- 16 leads from the Missed Revenue funnel. The last one came in July 8, 2026.

---

## 2. Decisions Greg needs to make first
These block the build. Grok can track them.

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Reception pricing: two minute plans ($395 / $595) **or** one plan plus a per-minute overage rate? | One plan plus overage. A typical shop uses 250–500 min a month, so the 2,000-minute plan may never sell. Needs Greg's Retell cost per minute. |
| D2 | Keep the $395 setup fee for Reception? | Consider lowering or waiving it for Reception so it's easier to say yes. Keep it for Operations. |
| D3 | Who sells in the next 90 days: Greg alone, Samantha, the reps? | Greg (and Samantha) first. Hold off on reps until the pitch is proven. |
| D4 | How to introduce the upgrades: all of Operations as one upgrade, or features released one at a time? | Start with a single "Operations" upgrade (already designed). Revisit later (see §4). |

---

## 3. The plan: start at the beginning

### Phase 1: Make Reception sellable
1. **Health check the AI agent.** Make a test call. Confirm booking, the calendar,
   `retell-webhook`, and the call log all still work after the break.
2. **Fix the exposed Retell key** (Known problem 2).
3. **Stripe:** create the Reception prices (based on D1 and D2) and connect them to the price list.
4. **Webhook:** set the client's tier from the price they paid for.
5. **Dashboard:** show Reception customers only Calendar, Calls, Billing and Settings,
   with locked previews for the rest.
6. **Onboarding:** add a Reception or Operations choice to the existing flow.
7. **Write down the setup steps for a new Reception customer** (Retell agent, phone number,
   business hours, services), so setting one up is the same every time.

### Phase 2: Repoint the story (sales and marketing)
1. Update the pricing on the landing pages and the PDF so Reception is the main offer.
2. Change the PDF/funnel call to action from "try the dashboard" to "hear the receptionist".
3. Rework the demo account so it opens on the Reception view.
4. A one-page sales sheet and a call script for Reception.

### Phase 3: Documentation reset
1. Rewrite `README.md` and `CLAUDE.md` around Reception first, with Operations as the upgrade.
2. Update the master history doc (`Reliant-Support-Structure-and-History.md`) with
   July–October and the new direction.
3. Mark older plans (invoicing, estimates, sales reps) as **"Operations — later"**.
4. Move the teleprompter app and the tire calculator out of this repo.

### Phase 4: Upgrades (Operations), after Reception has paying customers
- The in-app upgrade button (swap the Stripe price, unlock everything).
- Lock the database and server functions by tier, so a Reception account can't reach
  Operations data even outside the app.
- Rep commissions for Reception deals.
- Toll-free SMS registration, which turns on tracking links, estimates and review texts.
- Release Estimates and the pricing catalog. Invoicing.

---

## 4. Ways to introduce the upgrades (choose later, not now)
- **A. One big upgrade:** Reception → Operations (+$100). Easiest to sell and build. *(Current design.)*
- **B. Add-ons:** e.g. "+ Customer history", "+ Dispatch and tracking", "+ Estimates", each priced separately. More flexible, but much more billing work.
- **C. Upgrade when a need shows up:** offer Operations when a Reception customer hits a
  moment where they need it (adds a tech, asks about tracking). This is a sales approach,
  not a build, and works with A.

Suggested: **A + C**. Revisit B only if customers ask for one piece without the rest.

---

## 5. Next step
Answer D1 (Retell cost per minute → Reception pricing), then start Phase 1, step 1 (the agent health check).
