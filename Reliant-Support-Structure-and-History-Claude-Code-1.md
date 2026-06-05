# Reliant Support — Structure, History & Progress
**Source:** Claude Code session — compiled from git history, codebase, CLAUDE.md, and conversation context
**Compiled:** June 5, 2026
**Session:** Claude Code (receptionist-dashboard repo)

> **Note on memory:** Claude Code sessions do not share memory with each other or with Claude.ai Chat. Each session only knows what's in the codebase, git history, and the current conversation. To get the fullest picture, run this same exercise in every active Claude Code session AND in Claude.ai Chat (which may have separate conversation history). ChatGPT sessions are fully separate.

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
| SMS | Telnyx (replaced Twilio — Greg's Twilio numbers were owned by Retell AI, not him) |
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
- SMS via Twilio initially, then **migrated to Telnyx** (Greg's Twilio numbers were owned by Retell AI)
- `generate-tracking-token`, `get-tracking-data`, `send-sms` Edge Functions
- `tech_locations` table, `tracking_tokens` table
- GPS status dot in tech header
- Map tab in dispatcher nav

### Phase 5 — Calendar UX & Appointment Features (April–May 2026)
- **Drag-and-drop appointment rescheduling**: pointer events system with drag intent detection, drag overlay ghost, drop preview, clamped grid snapping, iOS context menu prevention
- Google Calendar-style time picker dropdown (replaced native HTML time input)
- Fixed date handling (local date not UTC for "today")
- 12-hour AM/PM time formatting

### Phase 6 — AI Agent Settings & Communication (May 2026)
- **Greeting message editor** in Settings tab — changes saved directly to Retell AI agent via API
- **Voice selection** (Male/Female) — also saved to Retell agent
- **Business hours management** — saved to Supabase `business_hours` table AND pushed to Retell LLM system prompt
- **Review request SMS** — after job completion, tech can send customer a review request SMS via Telnyx

### Phase 7 — Pricing Catalog & Invoicing V1 (May 2026)
Building toward full front-office replacement for HVAC shops:
- `pricing_catalog` table with RLS
- **PricingCatalog tab** (`PricingCatalog.jsx`): read and add/edit/delete catalog items
- CSV import with validation preview + CSV export (`papaparse` library)
- `clients.default_tax_rate` column for per-client tax settings
- Planning doc: invoicing + estimates roadmap (8 decision forks documented)

### Phase 8 — Estimates (May–June 2026)
- `estimates` and `estimate_line_items` tables, `estimate_tokens` for public sharing
- `EstimateBuilder.jsx` — office-side estimate creation with line items from pricing catalog
- `EstimatesTab.jsx` — list view of all estimates with status tracking
- `EstimateViewerPublic.jsx` — public customer-facing estimate view (no auth required)
- Tech field entry: techs can create estimates from `TechDashboard`
- `generate-estimate-token`, `get-estimate`, `approve-estimate`, `send-estimate` Edge Functions
- Estimate approval flow: customer approves online → status updates → ready to convert to invoice
- `estimate_legal_text` in Settings tab

### Phase 9 — Marketing Funnel (June 2026 — current branch)
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
- **3 pages**, dark editorial style (navy/dark background)
- **Page 1 — The Audit**: Large `$XX,XXX` missed revenue number at 96pt, 3 stat tiles (missed calls/day, missed calls/month, lost jobs/month), calculation formula, closing quote
- **Page 2 — Four Steps**: Eyebrow, headline, 4 numbered steps as plain text (no boxes — spec requirement)
- **Page 3 — Note from Greg**: Eyebrow, "Why I built this." headline, 5 body paragraphs, Greg's signature, 2 side-by-side clickable CTA buttons
  - Cyan button: "Call the receptionist" → `app.reliantsupport.net/try-receptionist`
  - Blue button: "Try the dashboard" → `app.reliantsupport.net/try-demo`
- Logo: RELIANT SUPPORT logo (red on transparent) embedded as base64 PNG
- Exact port of approved Python/ReportLab design (`v5_Dark_PersonalLetter_generator.py`)
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
| Pricing catalog (CRUD, CSV import/export) | Live |
| Estimate builder (line items from catalog) | Live |
| Estimates tab (list, status) | Live |
| Public estimate viewer (customer approves online) | Live |
| Tech field estimate creation | Live |
| Estimate legal text (customizable) | Live |
| Invoicing | In development |

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
| Personalized PDF audit generation | Live |
| PDF email delivery to prospect via Resend | Live |
| Greg notification email on each lead | Live |
| Supabase Storage for PDFs | Live |
| v5 Light PDF variant (saved, not yet wired) | Saved |

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
| `send-sms` | SMS delivery via Telnyx |
| `send-review-sms` | Sends review request SMS to customer |
| `generate-tracking-token` | Creates one-time token + sends "On My Way" SMS |
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
| `send-estimate` | Emails estimate link to customer |
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

---

## 8. Key Architectural Decisions & Rationale

**Why no router library?**
Navigation is pure React state in App.jsx. This was a deliberate choice to keep the bundle simple and avoid router configuration overhead for a dashboard that doesn't need deep linking.

**Why Telnyx instead of Twilio?**
Greg's Twilio phone numbers were registered under Retell AI's account, not Greg's. When it came time to send SMS from the dashboard, switching to Telnyx meant owning the phone numbers outright.

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

**Why hardcode the Supabase anon key in client-side code?**
This is standard practice for Supabase. The anon key is a *publishable* key — it only enables RLS-gated operations. All sensitive operations are protected by RLS policies on the database. The key is not a secret.

---

## 9. Demo System

- **Demo account:** client_id=9999, agent `agent_c48b68df1da80f01e2c1eea6aa`
- **Demo URL:** `app.reliantsupport.net/try-demo`
- **Try the receptionist:** `app.reliantsupport.net/try-receptionist` (Retell web call)
- `reset-demo-data` Edge Function wipes and re-populates demo account with curated data
- Demo call records use real CloudFront CDN URLs (transcripts + recordings) from the real agent
- The real production account (client_id=1) was frozen as a data source for the demo

---

## 10. Known Pending Work (as of June 5, 2026)

### Invoicing (in progress)
The pricing catalog and estimates are live. Invoicing V1 (no Stripe Connect — shops collect payment via their own methods) is the next build.

### Demo Reset Rewrite (planned)
`reset_demo_data()` needs to be rewritten to produce an exact replica of the real production dashboard's frozen state. The plan:
1. Snapshot all data from client_id=1 (appointments, customers, notes, calls with real transcripts/recordings)
2. Rewrite the function to re-insert with client_id=9999 and relative dates (so appointments always look current)

### 3-Page "Why I Built This" PDF Variant (requested)
A new PDF variant was in progress at the time of this compilation:
- Pages 1 and 2: same as current v5 dark design
- Page 3: replaces the current page 3 (longer Greg note + buttons) with a shorter, punchier "Why I built this" note:
  > *"If you got value from this audit, that's the whole point. Take the four steps and run with them. The math is solid, the work is real. But Reliant Support is a solution that does so much more. Other solutions fall short — voicemail loses jobs, and the services that took messages didn't actually book anything. So I built what I wished I'd had: something that answers every call, books appointments straight to your schedule, and costs less than what you're losing right now. If that sounds like something worth a fifteen-minute conversation, I'd be glad to walk you through it."*

### v5 Light PDF
The light/cream editorial variant (`v5_Light_PersonalLetter_generator.py`) is saved in the repo but not yet wired into production. Ready to deploy alongside or instead of the dark version when needed.

### Missed-Call-to-Text (future)
Discussed as a viable future feature — auto-text a prospect if they hang up before being answered.

### Customer Recognition (future)
Retell AI recognizing returning customers by phone number during the call.

---

## 11. Current Git Branch

`claude/build-missed-revenue-page-ULyAC`

This branch contains all the marketing funnel work (missed-revenue page, PDF pipeline, v5 dark generator). Not yet merged to main.

---

## 12. Advice on Other Sessions

To get the most complete picture across all your AI tools:

**Other Claude Code sessions:** Each session that has worked on this repo will have its own conversation history that may contain additional rationale, decisions, and context not captured in git commits. Run the same "compile history" request in each one.

**Claude.ai Chat (claude.ai):** Completely separate from Claude Code. If you've had design discussions, brainstorming sessions, or planning conversations there, those exist only in that context. Claude Chat has no access to this repo.

**ChatGPT:** Fully separate memory system. If you've used ChatGPT for any part of this project, those conversations exist only there.

**Recommendation:** After collecting all three outputs (this file + Claude Chat summary + ChatGPT summary), the most useful thing to do is merge them into a single master document and store it in the repo as a permanent context file. That way any new session — in any tool — can be primed with the full picture in seconds.
