<!-- ═══════════════════════════════════════════════════════════════════════════
     INSTRUCTIONS FOR ANY AI SESSION RECEIVING THIS FILE
     ═══════════════════════════════════════════════════════════════════════════

     This is a living master document for Reliant Support. It is the single
     source of truth for the project's history, decisions, features, and
     current state. It is intentionally shared across Claude Code sessions,
     Claude Chat, and ChatGPT so that any session can be fully oriented.

     WHEN YOU RECEIVE THIS FILE, DO THE FOLLOWING:

     1. READ THE ENTIRE DOCUMENT before doing anything else.

     2. SEARCH YOUR CONTEXT for anything not already captured here:
        - Conversations from this session (decisions made, features discussed,
          work completed, anything Greg said about plans or intent)
        - Code, git commits, files, or database changes you can see
        - Any rationale, constraints, or tradeoffs that were discussed

     3. UPDATE THIS DOCUMENT IN PLACE — do not create a new file:
        - Add new features to the Feature Inventory (Section 4) with status
        - Add new Edge Functions to Section 5
        - Add new database tables to Section 6
        - Add new phases or extend existing phases in the Timeline (Section 3)
        - Add new architectural decisions to Section 8 with the "why"
        - Move completed items out of Pending Work (Section 10) and into
          the appropriate section, noting when they were completed
        - Update the "Last Updated" line at the top of the document

     4. HANDLE CONFLICTS — where something was planned one way in one session
        and done a different way in another:
        - Keep both versions briefly noted
        - Clearly mark which was the FINAL DECISION with → **[FINAL]**
        - Example: "Initially planned X, later changed to Y → **[FINAL: Y]**"

     5. HANDLE CHANGED OR REPLACED WORK — where something was built, then
        later revised or replaced:
        - Update the entry to reflect the current state
        - Add a brief note: "*(replaced [old approach] — [reason])*"
        - Example: "SMS via Telnyx *(replaced Twilio — Greg's Twilio numbers
          were owned by Retell AI, not him)*"

     6. AVOID DUPLICATION — before adding anything, check whether it already
        exists. Update the existing entry rather than adding a duplicate.

     7. LOG YOUR CONTRIBUTION at the bottom of the document in Section 13
        (Session Log). Add one entry per session with:
        - Date
        - Session type (Claude Code / Claude Chat / ChatGPT / other)
        - A brief list of what you added or changed

     8. SAVE AND DELIVER — when you are done updating, do both of these
        without waiting to be asked:
        a. Commit the file to git and push to the current branch
        b. Use the SendUserFile tool to deliver the file directly to Greg
           so it appears in the chat and he can download it immediately.
        The file path is always:
        /home/user/receptionist-dashboard/Reliant-Support-Structure-and-History.md
        (For non-Claude-Code sessions that can't commit: just deliver the file.)

     GOAL: After running this through every active session, the document
     should contain everything known about this project from every source —
     with no duplicates, no contradictions, and a clear record of what the
     final state of every decision is.
═══════════════════════════════════════════════════════════════════════════ -->

# Reliant Support — Structure, History & Progress
**Last Updated:** June 5, 2026 (Flat Rate Pricing Module researched — competitive landscape mapped, build strategy defined)
**Maintained by:** All sessions — see Section 13 (Session Log) for contribution history

---

## 1. The Business

**Company:** Reliant Support
**Product:** AI voice receptionist designed specifically for HVAC shops
**Founder:** Greg MacDonald (`gmacdonald63@gmail.com`)
**Website / App:** `app.reliantsupport.net`
**Marketing site / landing pages:** `reliantsupport.net` (HostGator hosting)

### The Core Problem Being Solved
HVAC shops miss phone calls constantly — when techs are on jobs, after hours, or when the owner is the one answering. Every missed call that isn't immediately answered typically goes to a competitor. The Missed Revenue Audit math:

> `missed calls/day × 24 working days × booking rate % × avg job value = monthly lost revenue`

For a typical shop missing 5 calls/day at a 35% booking rate with a $350 average job: **$14,700/month lost**, or **$176,400/year**.

### The Solution
Reliant Support is an AI voice receptionist that:
- Answers every unanswered call (instead of voicemail)
- Books appointments directly to the shop's schedule
- Costs less per month than the shop is losing per week

The full dashboard goes beyond call answering — it also handles appointment management, customer tracking, tech dispatch, GPS tracking, estimates, invoicing, and more.

### Pricing Model
| Product | Price | Type |
|---------|-------|------|
| Setup Fee | $395 | One-time |
| Standard Plan | $495/month | Recurring |
| Pro Plan | $695/month | Recurring |

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite, Tailwind CSS 3 (dark theme) |
| Backend / DB | Supabase (Postgres + Auth + Storage + Edge Functions) |
| AI Voice | Retell AI (GPT-4.1 LLM, tool call strict mode) |
| Email | Resend (from: noreply@reliantsupport.net) |
| SMS | Telnyx *(replaced Twilio — Greg's Twilio numbers were owned by Retell AI, not him)* |
| Payments | Stripe (subscriptions + payment links) |
| Map Tiles | Stadia Maps (domain-auth, no API key in code) |
| Map Library | Leaflet + react-leaflet |
| Hosting | Vercel (SPA rewrites via vercel.json) |
| PDF Generation | pdf-lib 1.17.1 (Deno Edge Function) |
| CRM | HubSpot (deals created via Edge Function on lead capture) |

### Key Infrastructure IDs
- **Supabase project ref:** `zmppdmfdhknnwzwdfhwf`
- **Retell agent (production):** `agent_3bec4ff7311350d9b19b93db05` → client_id 1
- **Retell agent (demo):** `agent_c48b68df1da80f01e2c1eea6aa` → client_id 9999
- **Demo URL:** `app.reliantsupport.net/try-demo`
- **Demo receptionist test:** `app.reliantsupport.net/try-receptionist`
- **Telnyx phone number:** +1-503-245-4131

---

## 3. Project Timeline (from git history)

The oldest commit in this repository is dated **March 26, 2026**, meaning the repo was already past initial setup at that point. The project likely started earlier — the billing/Stripe system was already partially built at first commit.

### Phase 0 — Foundation (pre-git or early March 2026)
The project started as a basic dashboard wired to Retell AI. The earliest recoverable state includes:
- Supabase auth + basic `clients` table
- Retell AI agent connected for HVAC call answering
- Basic appointment display from Supabase + Retell call logs
- Login page, basic tab navigation

### Phase 1 — Billing & Subscriptions (March 26–27, 2026)
First tracked commits were all billing-related, suggesting this was a major early milestone:
- Stripe integration: setup fee ($395 one-time) + Standard ($495/mo) + Pro ($695/mo) plans
- Full client lifecycle: sales rep sends payment link → client pays → admin sets up → client activates → dashboard unlocks
- Stripe webhook handling (`stripe-webhook` Edge Function)
- Billing portal for self-service (update card, view invoices, cancel)
- Subscription gating — blocks dashboard access until active subscription
- `create-checkout-session`, `create-billing-portal`, `create-onboarding-checkout`, `create-subscription-checkout` Edge Functions

### Phase 2 — Sales Rep System (late March 2026)
Built a complete system for hiring commission-only remote sales reps:
- `invite-rep` Edge Function — generates invite link, sends welcome email (no Supabase auth email — used custom link flow to avoid deliverability issues)
- `RepSetPasswordPage` — custom welcome + password-set page for new reps
- `SalesRepDashboard` — rep-facing view showing their deals, commission status, payment history, and links to share
- `AdminSalesPanel` — admin view of all reps and their performance
- Deal stages: `onboarding_sent` → `setup_in_progress` → `active` / `cancelled`
- Commission tracking: `pending` → `due` → `paid` / `voided`
- `create-deal` Edge Function — creates a deal in HubSpot CRM when a rep closes a client
- `hubspot-sync` Edge Function — syncs deal/contact data to HubSpot

### Phase 3 — Onboarding Flow (late March–early April 2026)
- `OnboardingPage` — multi-step page for new clients: payment → business info form → thank you
- New client fills in: business name, address, services offered, business hours, special instructions
- `save-onboarding-data` + `get-onboarding-deal` Edge Functions
- `ActivationPage` — token-based activation page where new client sets their password
- `send-activation-invite`, `get-activation-data`, `verify-activation` Edge Functions
- Onboarding email notifications via Resend

### Phase 4 — Location, GPS & Dispatch Map (April 2026)
The biggest feature phase — turned the dashboard into a real field service management tool:
- **GPS tracking** (always-on in TechDashboard): `locationService.js` — `watchPosition`, handles Chrome Android silent hang bug, GPS warmup
- **Dispatcher Map tab** (`DispatcherMap.jsx`): live map of all active techs using Leaflet + Stadia Maps; real-time updates via Supabase Realtime subscriptions
- **Customer tracking page** (`TrackingPage.jsx`): public-facing page (no auth) where customers watch their tech approaching in real time
- **"On My Way" flow**: tech taps button → generates one-time token → sends SMS to customer with tracking link → customer sees live map
- SMS via Twilio initially, then **migrated to Telnyx** *(Greg's Twilio numbers were owned by Retell AI)*
- `generate-tracking-token`, `get-tracking-data`, `send-sms` Edge Functions
- `tech_locations` table, `tracking_tokens` table
- GPS status dot in tech header
- Map tab in dispatcher nav

### Phase 5 — Calendar UX & Appointment Features (April–May 2026)
- **Drag-and-drop appointment rescheduling**: pointer events system with drag intent detection, drag overlay ghost, drop preview, clamped grid snapping, iOS context menu prevention
- Google Calendar-style time picker dropdown *(replaced native HTML time input)*
- Fixed date handling (local date not UTC for "today")
- 12-hour AM/PM time formatting

### Phase 6 — AI Agent Settings & Communication (May 2026)
- **Greeting message editor** in Settings tab — changes saved directly to Retell AI agent via API
- **Voice selection** (Male/Female) — also saved to Retell agent
- **Business hours management** — saved to Supabase `business_hours` table AND pushed to Retell LLM system prompt
- **Review request SMS** — after job completion, tech can send customer a review request SMS via Telnyx

### Phase 7 — Pricing Catalog & Invoicing V1 (late April 2026)
Building toward full front-office replacement for HVAC shops:
- `service_types` table seeded with **157 HVAC services** (migration `20260314_replace_service_types_with_156.sql` — note: filename says 156, actual row count is 157, one extra Emergency entry over the 156-row `service-types-proposed.md` spec). 13 categories: Diagnostics 24, Maintenance 24, Repairs 27, Installation 20, Indoor Air Quality 11, Commercial 11, Ductwork 10, Ventilation 7, Controls 5, Hydronic 5, Emergency 5, System Design 4, Geothermal 4. Each carries `duration_minutes`, drives the appointment-booking dropdown (`DispatcherDashboard.jsx:522` fetches active rows ordered by `sort_order`) and the Retell agent's slot-duration calculation in `check-availability` + `book-appointment` Edge Functions. RLS: admin-only writes, all roles read.
- `pricing_catalog` table with RLS (migrations `20260426001` + `20260426002`)
- **PricingCatalog tab** (`PricingCatalog.jsx`, 637 lines): read and add/edit/delete catalog items
- CSV import with validation preview + CSV export (`papaparse` library)
- `clients.default_tax_rate` column for per-client tax settings
- Planning doc: invoicing + estimates roadmap (8 decision forks documented)

### Phase 8 — Estimates (early May 2026)
- `estimates` and `estimate_line_items` tables, `estimate_tokens` for public sharing (migrations `20260501001`–`20260501004`)
- `src/EstimateBuilder.jsx` (954 lines) — office-side estimate creation with line items from pricing catalog
- `src/EstimatesTab.jsx` (157 lines) — list view of all estimates with status tracking
- `src/pages/EstimateViewerPublic.jsx` — public customer-facing estimate view (no auth required)
- Tech field entry: techs can create estimates from `TechDashboard`
- `generate-estimate-token`, `get-estimate`, `approve-estimate`, `send-estimate` Edge Functions
- Estimate approval flow: customer approves online → status updates → ready to convert to invoice
- `estimate_legal_text` in Settings tab
- **Feature-gated (May 24, 2026, commit `32bcc40`):** Pricing and Estimates tabs are visible **only** to `gmacdonald63@gmail.com`. Hidden from all client-facing accounts pending launch. Gate lives in `src/DispatcherDashboard.jsx` (`isDeveloper` flag + `devOnlyTabs` filter — remove both to roll out). See Section 10 Pending Work.

### Phase 9 — Marketing Funnel (June 2026)
Built a complete lead generation and nurturing system:
- **`/missed-revenue` landing page** (`MissedRevenuePage.jsx`) — React page in the main app
- **`missed-revenue.html`** — standalone HTML for HostGator hosting at `reliantsupport.net/missed-revenue` (no React needed, connects directly to Supabase)
- Form collects: first name, company name, phone, email, missed calls/day, avg job value, booking rate
- On submit: calculates monthly/annual missed revenue, stores lead in Supabase, triggers PDF generation and email
- **`send-audit-pdf` Edge Function**: generates personalized 3-page PDF, stores in Supabase Storage (`audit-pdfs` bucket), emails to prospect via Resend, notifies Greg
- **`notify-new-lead` Edge Function**: thin dispatcher that triggers `send-audit-pdf`
- Fixed RLS bug (anon-only insert policy blocked authenticated users)
- Fixed 401 bug (JWT was being used as `apikey` header instead of separate publishable key)

#### The PDF Design — v5 Dark Personal Letter
The PDF went through multiple design iterations before the v5 dark design was approved:
- **3 pages**, dark editorial style (navy/dark background)
- **Page 1 — The Audit**: Large `$XX,XXX` missed revenue number at 96pt, 3 stat tiles (missed calls/day, missed calls/month, lost jobs/month), calculation formula, closing quote
- **Page 2 — Four Steps**: Eyebrow, headline, 4 numbered steps as plain text (no boxes — spec requirement)
- **Page 3 — Note from Greg**: Eyebrow, "Why I built this." headline, body paragraphs, Greg's signature, 2 side-by-side clickable CTA buttons
  - Cyan button: "Call the receptionist" → `app.reliantsupport.net/try-receptionist`
  - Blue button: "Try the dashboard" → `app.reliantsupport.net/try-demo`
- Logo: RELIANT SUPPORT logo (red on transparent) embedded as base64 PNG in the Edge Function
- Exact port of approved Python/ReportLab design (`v5_Dark_PersonalLetter_generator.py`) into TypeScript
- **v5 Light variant** (`v5_Light_PersonalLetter_generator.py`) also saved in repo for future use — cream/warm paper style, not yet wired into production

---

## 4. Full Feature Inventory

### Core Dashboard (all authenticated clients)
| Feature | Status |
|---------|--------|
| Appointments tab — calendar + list views | Live |
| Drag-and-drop rescheduling | Live |
| Google Calendar-style time picker | Live |
| Calls tab — Retell call log with summaries | Live |
| Customers tab — full CRM | Live |
| Customer notes | Live |
| Follow-up reminders | Live |
| Billing tab — plan status, portal link | Live |
| Settings tab — business hours, greeting, voice, tax | Live |

### AI Agent Configuration (via Settings)
| Feature | Status |
|---------|--------|
| Greeting message editor → pushes to Retell agent | Live |
| Voice selection (Male/Female) → pushes to Retell agent | Live |
| Business hours → pushes to Retell LLM system prompt | Live |
| Appointment duration + buffer time | Live |
| Timezone | Live |

### Field Service
| Feature | Status |
|---------|--------|
| Tech dashboard (own jobs only, read-only) | Live |
| Tech GPS tracking (always-on) | Live |
| Dispatcher map tab (live tech positions) | Live |
| "On My Way" SMS → customer tracking link | Live |
| Customer tracking page (public, live map) | Live |
| Assigned tech on appointments | Live |
| Review request SMS after job | Live |
| Create estimate from tech dashboard | Live |

### Team Management
| Feature | Status |
|---------|--------|
| Team tab — invite techs and dispatchers | Live |
| Per-tech feature toggles (`technician_permissions`) | Live |
| Role system: admin / owner / dispatcher / tech | Live |
| SMS configuration per client | Live |

### Estimates & Invoicing
| Feature | Status |
|---------|--------|
| Pricing catalog (CRUD, CSV import/export) | Built — **dev-gated** (only gmacdonald63@) |
| Estimate builder (line items from catalog) | Built — **dev-gated** |
| Estimates tab (list, status) | Built — **dev-gated** |
| Public estimate viewer (customer approves online) | Built — **dev-gated** |
| Tech field estimate creation | Built — **dev-gated** |
| Estimate legal text (customizable) | Built — **dev-gated** |
| Invoicing | In development |
| Flat rate pricing module (mobile tech UI + repair database) | Planned — research complete (see Section 10) |

### Billing & Subscriptions
| Feature | Status |
|---------|--------|
| $395 one-time setup fee (Stripe Payment Link) | Live |
| Standard plan $495/mo + Pro plan $695/mo | Live |
| Stripe Checkout flow | Live |
| Stripe Billing Portal (self-service) | Live |
| Subscription gating (blocks dashboard until active) | Live |
| Stripe webhook handling | Live |

### Sales Rep System
| Feature | Status |
|---------|--------|
| Commission-only rep invite flow | Live |
| Rep set-password page | Live |
| Sales rep dashboard (deals, commissions, links) | Live |
| Admin sales panel | Live |
| Deal stage tracking | Live |
| Commission status tracking | Live |
| HubSpot CRM integration | Live |

### Onboarding
| Feature | Status |
|---------|--------|
| New client onboarding page (payment → form → activate) | Live |
| Token-based activation with password set | Live |
| Onboarding email notifications | Live |

### Marketing Funnel
| Feature | Status |
|---------|--------|
| /missed-revenue landing page (React) | Live |
| missed-revenue.html (standalone HostGator) | Live |
| Personalized 3-page PDF audit generation | Live |
| PDF email delivery to prospect via Resend | Live |
| Greg notification email on each lead | Live |
| Supabase Storage for PDFs (`audit-pdfs` bucket) | Live |
| v5 Light PDF variant (saved, not yet wired) | Saved for future |

### Demo System
| Feature | Status |
|---------|--------|
| Demo dashboard (client_id=9999) | Live |
| Demo token validation | Live |
| reset-demo-data function | Live |
| Demo notification system | Live |

---

## 5. Supabase Edge Functions (36 total)

| Function | Purpose |
|----------|---------|
| `book-appointment` | Called by Retell AI during calls to confirm bookings |
| `check-availability` | Called by Retell AI to check if a time slot is open |
| `get-current-date` | Called by Retell AI at call start for today's date |
| `retell-webhook` | Post-call webhook — saves call data + appointments |
| `create-checkout-session` | Stripe checkout for subscriptions |
| `create-billing-portal` | Stripe self-service billing portal |
| `create-onboarding-checkout` | Stripe checkout for setup fee |
| `create-subscription-checkout` | Plan subscription checkout |
| `stripe-webhook` | Processes Stripe payment events, updates subscription status |
| `invite-user` | Invites new staff/dispatcher via Supabase auth |
| `invite-rep` | Invites commission-only sales rep (custom link, no Supabase auth email) |
| `send-notification` | Central notification sender (email templates) |
| `send-sms` | SMS delivery via Telnyx *(now effectively a passthrough — all callers call Telnyx directly; see Section 8)* |
| `send-review-sms` | Sends review request SMS to customer — calls Telnyx directly (no send-sms hop) |
| `generate-tracking-token` | Creates one-time token + sends "On My Way" SMS — calls Telnyx directly |
| `get-tracking-data` | Returns live tech location for public tracking page |
| `geocode-appointments` | Geocodes appointment addresses for map |
| `save-onboarding-data` | Saves new client onboarding form data |
| `get-onboarding-deal` | Fetches deal data for onboarding flow |
| `get-activation-data` | Fetches account data for activation page |
| `send-activation-invite` | Sends activation email to new client |
| `verify-activation` | Verifies activation token |
| `create-web-call` | Creates a Retell web call (for demo try-receptionist) |
| `create-deal` | Creates a deal in HubSpot CRM |
| `hubspot-sync` | Syncs contacts/deals to HubSpot |
| `generate-estimate-token` | Creates public token for estimate sharing |
| `get-estimate` | Returns estimate data for public viewer |
| `approve-estimate` | Marks estimate as customer-approved |
| `send-estimate` | Emails + SMS estimate link to customer — calls Telnyx directly |
| `notify-new-lead` | Triggers PDF generation when a lead submits the form |
| `send-audit-pdf` | Generates personalized PDF, stores + emails it |
| `generate-demo-token` | Creates demo access token |
| `validate-demo-token` | Validates demo token |
| `demo-notification` | Demo-specific notifications |
| `reset-demo-data` | Resets demo account to curated baseline data |
| `dynamic-api` | Unused scaffold |

---

## 6. Database Schema (key tables)

| Table | Purpose |
|-------|---------|
| `clients` | One row per company — Retell agent ID, API keys, billing status, Telnyx config |
| `appointments` | All bookings (AI + manual), has assigned tech, geocode status, tracking token |
| `customers` | Customer profiles — tags, addresses, contact info |
| `customer_notes` | Notes per customer |
| `follow_up_reminders` | Reminders with due dates |
| `client_staff` | Dispatcher accounts per client |
| `technicians` | Field techs per client — name, phone, color, email |
| `technician_permissions` | Per-tech feature flags |
| `tech_locations` | Live GPS positions — lat, lng, heading, speed, status, recorded_at |
| `tracking_tokens` | One-time tokens for customer tracking page |
| `business_hours` | Open/close times per day per client |
| `pricing_catalog` | Service/parts price entries per client |
| `estimates` | Estimate records with status |
| `estimate_line_items` | Line items on estimates |
| `estimate_tokens` | Public share tokens for estimates |
| `client_destinations` | Custom non-job status options (e.g. "At Warehouse") |
| `calls` | Call records with transcripts (used by demo for pre-loaded call data) |
| `service_types` | 157 HVAC services seeded per client — `name`, `category`, `duration_minutes`, `urgency`, `customer_phrases[]`, `sort_order`, `is_active`. Drives appointment-booking dropdown and Retell agent slot-duration lookups (`check-availability:189-244`, `book-appointment:116-165`). Admin-only writes via RLS. |

**Critical RLS rule:** All policies must use `auth.email()` — NOT a subquery to `auth.users`. The authenticated role cannot read `auth.users` directly; the subquery causes "permission denied" at runtime.

---

## 7. Sales & Marketing Strategy

### Lead Generation Funnel
1. Prospect visits `reliantsupport.net/missed-revenue`
2. Enters: name, company, phone, email, missed calls/day, avg job value, booking rate
3. Sees their personalized calculation instantly (client-side math)
4. Submits form → Supabase stores lead → triggers PDF pipeline
5. Receives personalized 3-page PDF audit by email within seconds
6. Greg receives notification email with the lead's details
7. (Planned) Samantha from the team follows up within 1–2 days

### PDF Audit as Sales Tool
The PDF is designed to do three things:
- **Page 1:** Confront them with their own numbers — not generic stats, *their* lost revenue
- **Page 2:** Give them four actionable steps (value-first, no pitch)
- **Page 3:** Greg's personal note explaining why he built Reliant Support + two CTAs

The v5 Dark design was approved after multiple iterations. A v5 Light (cream/editorial) variant was also designed and saved for potential A/B testing.

### Commission-Only Sales Reps
Built a full system to support remote, commission-only sales reps:
- Rep receives invite link with custom landing page
- Sets their password and accesses their own dashboard
- Dashboard shows: their deals, commission status (pending/due/paid), payment history
- Deal stages: `onboarding_sent` → `setup_in_progress` → `active` / `cancelled`
- Admin can see all reps and manage commission payments
- All deals synced to HubSpot CRM

### CRM — HubSpot
Connected to HubSpot for deal tracking. When a rep closes a client, a deal is created in HubSpot automatically via the `create-deal` Edge Function.

### Strategic Vision — Multi-Feature Platform for Broader Market Appeal
Greg's long-term goal is to build Reliant Support into a **top-tier, full-featured platform** where any HVAC company can come through **any one door** and discover the full suite. The model:

- A company that doesn't need an AI receptionist might still want **flat rate pricing + invoicing**
- A company that already has scheduling software might want the **AI receptionist only**
- A company doing manual invoicing might come for **estimates + invoicing**, then add dispatch
- Each feature is its own entry point — no single product dependency to close a deal

Goal: earn a reputation for being **top-tier in everything** — not just the AI receptionist. This dramatically widens the total addressable market beyond shops with a missed-call problem.

The flat rate pricing module (see Section 10) is the next major planned feature addition toward this vision, combined with a polished invoicing system already in development.

---

## 8. Key Architectural Decisions & Rationale

**Why no router library?**
Navigation is pure React state in App.jsx. This was a deliberate choice to keep the bundle simple and avoid router configuration overhead for a dashboard that doesn't need deep linking.

**Why Telnyx instead of Twilio?** → **[FINAL: Telnyx]**
Greg's Twilio phone numbers were registered under Retell AI's account, not Greg's. When it came time to send SMS from the dashboard, switching to Telnyx meant owning the phone numbers outright. Twilio was used briefly during Phase 4 development but fully replaced.

**Why Stadia Maps instead of Google Maps?**
Domain-based authentication (no API key in code, no per-request billing). Free plan covers current usage.

**Why pdf-lib instead of a PDF service?**
Runs entirely inside a Supabase Edge Function (Deno) — no external service, no latency, no additional cost. pdf-lib is pure JavaScript/TypeScript, installs from ESM CDN.

**Why the PDF design is a Python port?**
The approved design was originally prototyped in Python/ReportLab. pdf-lib and ReportLab share the same coordinate system (origin at bottom-left, points as units, 1 inch = 72pt), so coordinates translated 1:1 without conversion. A Python proof-of-concept was generated first, user approved it, then it was ported to TypeScript.

**Why custom invite links for sales reps instead of Supabase auth?**
Supabase's built-in `inviteUserByEmail` sends a styled email through their auth system. For the sales rep flow, a custom link with a branded welcome page was more appropriate. The `?rep-invite=TOKEN` URL pattern routes to `RepSetPasswordPage` which provides a custom experience.

**Why commission-only reps?**
No upfront payroll risk. Reps are paid only when they close a deal. The system automates the tracking and notification so Greg doesn't need to manually manage commissions.

**Why Vercel?**
SPA-friendly (handles React Router-style redirects via `vercel.json`). Free tier covers current traffic. Easy environment variable management.

**CLAUDE.md is stale on App.jsx** *(discovered June 5, 2026)*
CLAUDE.md describes App.jsx as ~1230 lines that owns the tab bar and all render functions. As of the current codebase, App.jsx is ~389 lines and is a thin auth router only. The tab bar, `activeTab` state, role gating, and all per-tab content rendering live in `src/DispatcherDashboard.jsx` (~1875 lines). Key locations in DispatcherDashboard.jsx: `activeTab` state at ~line 117; `ownerNavItems` array at ~lines 1412–1420 (7 tabs); `dispatcherNavItems` at ~lines 1422–1428 (5 tabs); authenticated tab content render at ~lines 1789+. Any future plan or session that references App.jsx for tab integration should target DispatcherDashboard.jsx instead. The Phase 1 invoicing plan was corrected to reflect this.

**Why hardcode the Supabase anon key in client-side code?**
This is standard practice for Supabase. The anon key is a *publishable* key — it only enables RLS-gated operations. All sensitive operations are protected by RLS policies on the database. The key is not a secret.

**Why TELNYX_API_KEY is a Supabase secret, not a DB column** → **[FINAL: Supabase secret]**
Originally `telnyx_api_key` was stored per-row in the `clients` table alongside `telnyx_from_number`. During Phase 8 SMS debugging this was changed: the API key is now stored as a Supabase Edge Function secret (`TELNYX_API_KEY`), read via `Deno.env.get("TELNYX_API_KEY")`. The `telnyx_from_number` remains per-client in `clients` because each client will have their own dedicated Telnyx number. The `SmsConfigForm` in `DispatcherDashboard.jsx` was updated to remove the API key field — it now only shows the from-number field.

**Why SMS functions call Telnyx directly instead of going through `send-sms`**
Supabase's Edge Function gateway strips `Authorization` headers on intra-function HTTP calls, regardless of the target function's `verify_jwt` setting. When `send-estimate`, `generate-tracking-token`, and `send-review-sms` called `send-sms` as an intermediary, every call returned 401. Fix: each function calls the Telnyx API (`api.telnyx.com/v2/messages`) directly using the `TELNYX_API_KEY` secret. The `send-sms` function still exists but is no longer used by other functions.

**Why `company_name` not `business_name` in clients queries**
The `clients` table column is `company_name`. An early version of `send-estimate` queried `business_name` (which doesn't exist). Supabase silently returns null for unknown select columns, so the entire query returned null with no error — causing "SMS not configured" failures downstream. Fixed by correcting the column name in all Edge Functions that query the `clients` table.

---

## 9. Demo System

- **Demo account:** client_id=9999, agent `agent_c48b68df1da80f01e2c1eea6aa`
- **Demo URL:** `app.reliantsupport.net/try-demo`
- **Try the receptionist:** `app.reliantsupport.net/try-receptionist` (Retell web call)
- `reset-demo-data` Edge Function wipes and re-populates demo account with curated data
- Demo call records use real CloudFront CDN URLs (transcripts + recordings) from the real agent
- The real production account (client_id=1) was frozen as a data source for the demo

---

## 10. Known Pending Work

*When something here gets completed, move it to the relevant section above and note the completion date. Do not delete it — update it.*

### Invoicing (in progress — Phase 1 plan ready to execute)
Pricing catalog and estimates are built but **dev-gated** (see Phase 8). Invoicing V1 (no Stripe Connect — shops collect payment via their own methods) is the next build.

**Fork decisions — all locked as of June 5, 2026:**
| Fork | Decision |
|------|----------|
| Fork 1 — Payment processing | **Deferred to Phase 4.** Phase 1–3 build invoice-only (no Stripe Connect). Shops collect payment via their own methods. Revisit when first client asks for integrated payments. |
| Fork 2 — Pricing model | **Hybrid.** Both flat-rate line items (parts, diagnostic fees) and hourly labor in the same estimate/invoice. One catalog, two unit types: `each` and `hour`. |
| Fork 6 — Tax handling | **Per-client rate + per-line flag.** `clients.default_tax_rate` (NUMERIC 6,5, stored as decimal e.g. 0.08750) + `pricing_catalog.taxable` boolean per line item. Already in DB from Phase 7. |
| Fork 8 — Customer portal | **V1 scoped.** Customer can view and approve estimates online (already built in Phase 8). Full payment portal deferred to Phase 4 with Fork 1. |
| Forks 3, 4, 7 | Already resolved by existing Phase 8 build. |

**Active planning branch: `claude/invoicing-v1` (commit `1fd8ce7`)**
Three planning docs committed:
- `docs/superpowers/specs/2026-04-26-invoicing-estimates-spec.md` — original discovery spec with all 8 forks
- `docs/superpowers/plans/2026-04-26-invoicing-estimates-roadmap.md` — master 4-phase roadmap with locked decisions + cross-cutting conventions
- `docs/superpowers/plans/2026-04-26-invoicing-phase-1-catalog.md` — detailed Phase 1 (Pricing Catalog) implementation plan in 4 chunks, fully reviewer-hardened

**To start building:** Open the `claude/invoicing-v1` worktree in a new session and say: *"Read `docs/superpowers/plans/2026-04-26-invoicing-phase-1-catalog.md` then execute it starting at Chunk 1."*

**Old planning doc superseded:** `docs/invoicing-plan.md` on `claude/plan-product-features-83iq2` (commit `f5b3327`) is the original discovery doc. It has been superseded by the three docs above. The new plan incorporates all fork decisions and was written with full knowledge of the existing Phase 8 build.

### Rollout of Pricing + Estimates tabs (blocked on launch decision)
The Pricing and Estimates tabs are built and functional but hidden from all client accounts behind `isDeveloper` / `devOnlyTabs` in `src/DispatcherDashboard.jsx`. Removing both will roll them out to all clients. Greg has not yet committed to a launch date.

### Flat Rate Pricing Module (researched June 2026 — build deferred pending outreach phase)
Full competitive research completed June 5, 2026. This is a major planned upgrade that, combined with the invoicing system, would move Reliant Support significantly closer to a full field-service management platform — and dramatically expand the total addressable market (see Section 7, Strategic Vision).

**What it is:** A mobile-first tool where field technicians browse a pre-built repair database, select line items for the job, present tiered pricing to the customer on-screen, collect a digital signature, and generate an invoice — all without leaving the dashboard.

**Competitive research summary (June 2026):**

| Competitor | Strength | Weakness | Key Insight |
|---|---|---|---|
| **Coolfront** (FieldEdge Flat Rate) | Pioneered the category, offline mode, zero setup | Generic 30k-repair database, $2.09/work order forever, poor search, no dispatch integration | Good workflow model but weakest database |
| **Profit Rhino** | Best price database: 10k+ HVAC-specific repairs, OEM parts search across 300+ manufacturers, quarterly price updates | Standalone — no native dispatch integration | Their `Integrate` API product proves the right architecture: price book as a pluggable module |
| **The New Flat Rate** | Best sales layer: 5-tier visual menu (Economy → Basic → Better → Best → Platinum), removes sales burden from techs, 2-3x reported ticket increases | $99/tech/month, they build menus for you (not self-serve) | The 5-tier visual menu is the key differentiator — customers self-select upward |
| **ServiceTitan** | Most complete enterprise platform, AI regional pricing averages, dynamic pricing | $245–398/tech/month, built for $2M+ companies | Overkill to model from; study their pricebook structure only |
| **Housecall Pro** | Best mid-market, natively integrates Profit Rhino, Good/Better/Best built in | Less HVAC-specific than Profit Rhino | Proof that a dispatch platform + pricing database integration is the right product shape |

**Recommended build approach — synthesize the best of all three:**
1. **Database structure from Profit Rhino:** HVAC-specific categories → subcategories → repairs → parts. OEM-aware. Admin can push price updates to all techs at once from the admin panel. Quarterly or on-demand updates.
2. **Presentation layer from The New Flat Rate:** When a tech selects a repair, customer sees a clean 3-tier visual "menu" (start with 3 tiers, scale to 5). No app chrome — just the options. Customer self-selects. No sales conversation required.
3. **Workflow simplicity from Coolfront:** Offline-capable, one-tap signature capture, instant invoice delivery to office and customer.
4. **Native advantage over all competitors:** Reliant Support already has dispatch, customers, appointment history, and tech location in one system. None of the competitors have this context. When a tech opens a job and taps "Build Estimate," they already see the customer's history, prior repairs, and any equipment on file.

**No per-work-order fee** — built into the platform subscription, unlike Coolfront's $2.09/job model.

**Why it waits:** Greg's immediate priority (June 2026) is outreach and lead generation to drive leads to his sales rep. The flat rate pricing module is a post-outreach-phase build. This research is saved here so any session can pick it up without re-doing the competitive analysis.

### Demo Reset Rewrite (planned)
`reset_demo_data()` needs to be rewritten to produce an exact replica of the real production dashboard's frozen state. The plan:
1. Snapshot all data from client_id=1 (appointments, customers, notes, calls with real transcripts/recordings)
2. Rewrite the function to re-insert with client_id=9999 and relative dates (so appointments always look current)

### 3-Page "Why I Built This" PDF Variant (requested June 2026)
A new/alternate PDF variant — same pages 1 and 2, but a shorter, punchier page 3 replacing the current longer Greg note. The approved text direction:
> *"If you got value from this audit, that's the whole point. Take the four steps and run with them. The math is solid, the work is real. But Reliant Support is a solution that does so much more. Other solutions fall short — voicemail loses jobs, and the services that took messages didn't actually book anything. So I built what I wished I'd had: something that answers every call, books appointments straight to your schedule, and costs less than what you're losing right now. If that sounds like something worth a fifteen-minute conversation, I'd be glad to walk you through it."*

### v5 Light PDF (saved, not yet wired)
The light/cream editorial variant (`v5_Light_PersonalLetter_generator.py`) is saved in the repo but not yet wired into production. Ready to deploy alongside or instead of the dark version when needed.

### SMS Carrier Approval — Blocked (10DLC rejected, toll-free recommended)
SMS code is fully deployed and working at the Telnyx API level (functions call Telnyx, Telnyx returns 200), but messages are silently blocked by carriers because no campaign is registered.

**What was tried:** Registered a 10DLC campaign under brand "Reliant Support LLC" (TCR ID: `C7LLQQS`, Telnyx campaign `4b30019d-dfc0-4f09-8711-b992bdda6915`). Rejected with error 710: *"Reseller / Non-compliant KYC. Register the brand info, not the agency behind the brand."*

**Why it failed:** Greg does not own an HVAC company. Reliant Support is a pure SaaS platform sending SMS on behalf of client HVAC shops. TCR correctly identified this as an ISV/reseller scenario. The brand that needs to be registered is the *end client's* brand, not Reliant Support.

**Recommended path: Toll-Free Numbers (TFV)**
- Switch from 10-digit local numbers to toll-free (+1-800/888/etc.) for each client
- Toll-Free Verification (TFV) is the correct registration path for ISVs/platforms
- Free to register, simpler process, designed for exactly this use case (transactional SMS sent on behalf of business clients)
- Each client gets their own toll-free number; `clients.telnyx_from_number` stays per-client
- Until this is resolved, all three SMS features (tracking links, estimates, review requests) will silently fail to deliver on most carriers (T-Mobile, Verizon, AT&T)

**Alternative long-term path:** 10DLC ISV/reseller registration — Telnyx supports this but requires each client brand to be individually registered ($4 one-time brand + $15 campaign + ~$10/month per client). More expensive and operationally complex.

### Missed-Call-to-Text (future idea)
Discussed as a viable future feature — auto-text a prospect if they hang up before being answered.

### Customer Recognition (future idea)
Retell AI recognizing returning customers by phone number during the call. Research already completed (prior session): Retell's inbound webhook is supported, response shape is `{call_inbound:{dynamic_variables:{...}}}`, 10-second timeout, 3 retries, all dynamic variables must be strings. **Implementation gotcha for whoever picks this up:** the codebase has `normalizePhone()` in `src/utils/addressNormalization.js:122-127` but no Edge Function currently uses it — phone-number matching across the customers table will need this normalizer wired in before lookups will reliably hit.

---

## 11. Known Decisions That Changed

*A record of things that were planned or built one way, then changed. Preserves the history.*

| Original | Changed To | Reason | Status |
|----------|-----------|--------|--------|
| Twilio SMS | Telnyx SMS | Greg's Twilio numbers were owned by Retell AI, not him | **[FINAL: Telnyx]** |
| Native HTML time input | Google Calendar-style dropdown | Better UX, more polished | **[FINAL: Dropdown]** |
| PDF generator (drifted implementation) | v5 Dark Personal Letter (exact Python port) | Previous implementation drifted from approved design | **[FINAL: v5 Dark]** |
| Supabase auth email for rep invites | Custom invite link + `RepSetPasswordPage` | More branded experience, avoids Supabase email styling limits | **[FINAL: Custom link]** |
| Pricing + Estimates launched to all clients | Dev-gated to gmacdonald63@ only | Tabs built but not ready for general rollout (commit `32bcc40`, May 24, 2026) | **[FINAL pending launch decision]** |
| `telnyx_api_key` stored in `clients` DB table | Stored as Supabase Edge Function secret `TELNYX_API_KEY` | Security + intra-function call auth issue (Supabase gateway strips Authorization headers) | **[FINAL: Supabase secret]** |
| SMS functions routing through `send-sms` intermediary | Each function calls Telnyx API directly | Supabase gateway strips Authorization headers on intra-function calls, causing 401 regardless of verify_jwt setting | **[FINAL: Direct Telnyx calls]** |
| 10DLC for Telnyx SMS carrier registration | Toll-free numbers + TFV (recommended) | Reliant Support is an ISV/platform — TCR rejected 10DLC brand as "reseller" (error 710). Greg has no HVAC company of his own. | **[FINAL pending implementation]** |

---

## 12. Context for Future Sessions

**Memory warning:** Claude Code sessions do not share memory with each other or with Claude.ai Chat. Each session only knows what's in the codebase, git history, and the current conversation. This document exists to bridge that gap.

**To orient a new session quickly:**
1. Upload or paste this document at the start of the session
2. Ask the session to read it before doing any work
3. At the end of the session, ask the session to update this document with anything new and re-download it

**Claude.ai Chat:** Completely separate from Claude Code. Design discussions, brainstorming, and planning conversations there are not visible here.

**ChatGPT:** Fully separate memory system. Conversations there are not visible here.

---

## 13. Session Log

*Each session that updates this document adds an entry here.*

| Date | Session Type | What Was Added / Changed |
|------|-------------|--------------------------|
| June 5, 2026 | Claude Code (receptionist-dashboard) | Initial document created. Compiled from 94 git commits, CLAUDE.md, all source files, and conversation context. Covers full project history from Phase 0 through Phase 9. |
| June 5, 2026 | Claude Code (receptionist-dashboard) | Added AI instructions block at top, renamed file, added Sections 11–13 (changed decisions log, context for future sessions, session log), converted to living document format. |
| June 5, 2026 | Claude Code (receptionist-dashboard, branch `claude/plan-product-features-83iq2`) | Reconciliation pass. Verified Phases 7–8 file existence against the repo. **Added:** `service_types` table to Section 6 (was missing — 157 seeded HVAC services drive booking durations); Phase 7 expanded with service_types details + category breakdown + corrected migration row count (file named "156" actually inserts 157 rows); Phase 8 noted that Pricing + Estimates tabs are dev-gated to `gmacdonald63@gmail.com` only via commit `32bcc40` (May 24, 2026) — this was previously undocumented; Section 4 Estimates/Invoicing rows updated from "Live" → "Built — dev-gated"; Section 10 split invoicing pending work into (a) invoicing-proper and (b) rollout of pricing/estimates tabs; Customer Recognition pending note enriched with normalizePhone gotcha (`src/utils/addressNormalization.js:122-127` exists but no Edge Function uses it); Section 11 added a row for the dev-gating decision; pointer to `docs/invoicing-plan.md` (branch `claude/plan-product-features-83iq2`, commit `f5b3327`) added under Section 10 with explicit caveat that 4 of its 8 forks are already resolved by the existing build. |
| June 5, 2026 | Claude Code (receptionist-dashboard, branch `claude/dreamy-mcnulty`) | **SMS architecture session.** Fixed `business_name`→`company_name` column bug in `send-estimate`. Moved `TELNYX_API_KEY` from DB to Supabase secret. Discovered and fixed Supabase intra-function auth bug (gateway strips Authorization headers — all SMS functions now call Telnyx API directly). Diagnosed 10DLC campaign rejection (error 710 — Reliant Support is an ISV/platform, not an end brand; Greg has no HVAC company). **Added to doc:** Section 8 — three new architectural decisions (Telnyx secret, direct Telnyx calls, company_name bug); Section 10 — SMS carrier approval blocker with full diagnosis and toll-free/TFV recommended path; Section 11 — three new changed-decisions rows; Section 5 — updated send-sms, send-review-sms, generate-tracking-token, send-estimate descriptions. |
| June 5, 2026 | Claude Code (receptionist-dashboard, worktree `invoicing-v1` / branch `claude/invoicing-v1`) | **Invoicing Phase 1 planning session.** Reviewed discovery spec (8 forks). Locked all open forks: Fork 1 deferred to Phase 4 (no Stripe Connect in Phase 1–3), Fork 2 = Hybrid pricing, Fork 6 = per-client tax rate + per-line taxable flag, Fork 8 = customer portal V1 already built. Created fresh worktree `claude/invoicing-v1`. Wrote and committed three planning docs: master roadmap (4 phases), Phase 1 detailed plan (4 chunks, ~1700 lines), and original spec. Plan was run through a reviewer pass across all 4 chunks; 14 issues fixed including: reuse existing DB trigger function, IN-clause RLS guards, DispatcherDashboard.jsx wiring (CLAUDE.md was stale — App.jsx is now a thin 389-line router), Tag icon instead of DollarSign collision, re-sort on save, FK 23503 user-friendly error, Windows-friendly paths, explicit Settings file pointers, branch-confirm before push. **Added to doc:** Section 8 — CLAUDE.md staleness note about App.jsx vs DispatcherDashboard.jsx; Section 10 — full invoicing pending work rewrite with locked fork table and new branch/plan references. |
| June 5, 2026 | Claude Code (receptionist-dashboard, branch `claude/research-pricing-app-U0GEQ`) | **Flat rate pricing research session — no code changes.** Researched Coolfront Mobile (FieldEdge Flat Rate) and the full competitive landscape for flat rate pricing apps. Compared: Coolfront, Profit Rhino, The New Flat Rate, ServiceTitan, Housecall Pro, Service Fusion. Built full competitive matrix with strengths/weaknesses and key insights per competitor. Defined recommended build approach: Profit Rhino database structure + The New Flat Rate visual menu presentation layer + Coolfront workflow simplicity + native dispatch/customer context advantage. Greg confirmed this is a major planned future upgrade (post-outreach phase). Outreach and lead generation is the immediate priority. **Added to doc:** Section 4 — flat rate pricing module row in Feature Inventory; Section 7 — Strategic Vision multi-feature platform section; Section 10 — Flat Rate Pricing Module pending work with full competitive research summary and build strategy; updated Last Updated line. |
