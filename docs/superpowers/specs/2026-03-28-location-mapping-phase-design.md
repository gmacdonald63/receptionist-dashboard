# Location & Mapping Phase — Design Spec
**Date:** 2026-03-28
**Project:** Reliant Support — AI Receptionist Dashboard
**Status:** Approved

---

## 1. Problem Being Solved

Dispatchers currently have no visibility into where their field technicians are. When an emergency job comes in, a dispatcher must call or text each tech to find the closest one. Customers call the office asking "where is my technician?" — requiring the dispatcher to call the tech, wait, then call the customer back. This phase eliminates both workflows:

- **Dispatcher map** — live view of all tech locations and today's job pins, so the dispatcher always knows where everyone is
- **Customer tracking link** — SMS with a live-tracking URL sent automatically when the tech taps "On My Way," so customers never need to call

Secondary improvement: techs currently see only today's jobs with no day navigation and no access to any customer or call data. The tech dashboard is redesigned to support day-by-day navigation and permission-gated job detail views.

---

## 2. Scope

### In Scope (this phase)

- **Stage 1 — App.jsx refactor:** Extract `DispatcherDashboard.jsx` from App.jsx (prerequisite for all map work)
- **Stage 2 — Schema & infrastructure:** New database tables, geocoding pipeline, map library installation
- **Stage 3 — GPS broadcasting:** Tech device broadcasts location when en route to a job
- **Stage 4 — Tech dashboard redesign:** Day navigation, job cards, permission-gated detail view, non-job status
- **Stage 5 — Dispatcher map view:** Live tech markers + job pins, Stadia.OSMBright tiles, Supabase Realtime
- **Stage 6 — Customer tracking link + SMS:** Token-gated public tracking page, automatic Twilio SMS on "On My Way"

### Out of Scope (deferred)

- SMS automation beyond the tracking link (e.g., booking confirmations, reminders)
- Route optimization or ETA from traffic data
- Historical location replay / breadcrumb trails
- Dedicated dispatcher dashboard redesign (dispatchers get a Map tab added to their existing view)
- Tech access to Customers or Calls tabs (deferred — data access policy decision needed)
- GPS tracking during non-job travel (Option B — deferred until client feedback confirms demand)
- Per-client toggle between job-only vs. all-travel GPS tracking

---

## 3. Architecture Overview

### Build Sequence

```
Stage 1: DispatcherDashboard.jsx extraction (App.jsx refactor)
    ↓
Stage 2: Schema migrations + geocoding Edge Function + Leaflet install
    ↓
Stage 3 + 4 run in parallel:
  [GPS broadcasting in TechDashboard]  [Tech dashboard redesign]
    ↓
Stage 5: Dispatcher map view
    ↓
Stage 6: Customer tracking page + Twilio SMS
```

Tech dashboard enhancements (Stage 4) have no dependencies on the GPS/map stack — they can begin immediately alongside Stage 1.

### New Files

| File | Purpose |
|---|---|
| `src/DispatcherDashboard.jsx` | Extracted dispatcher/owner dashboard (all current App.jsx UI) |
| `src/utils/locationService.js` | GPS broadcasting module — isolated, swappable |
| `src/pages/TrackingPage.jsx` | Public customer tracking page (no auth required) |
| `src/components/DispatcherMap.jsx` | Leaflet map component for dispatcher view |

### New Edge Functions

| Function | Purpose |
|---|---|
| `supabase/functions/generate-tracking-token/index.ts` | Generates tracking token + triggers SMS. Called client-side when tech taps "On My Way." Uses service role key. |
| `supabase/functions/get-tracking-data/index.ts` | Validates token + returns live tech location data. Called by TrackingPage. Uses service role key. Public (no-verify-jwt). |
| `supabase/functions/geocode-appointments/index.ts` | Geocodes appointment address → writes `job_lat`/`job_lng` back to the row. Called on appointment insert/update. |
| `supabase/functions/send-sms/index.ts` | Dedicated Twilio SMS dispatcher. Separate from `send-notification` (email). Accepts `{ to, from, body, twilio_account_sid, twilio_auth_token }`. |

### Modified Files

| File | Change |
|---|---|
| `src/App.jsx` | Reduced to auth + role-based routing only (~400 lines) |
| `src/TechDashboard.jsx` | Day navigation, new job cards, detail sheet, non-job status |
| `src/TeamTab.jsx` | New permission toggles for tech data access |

### Environment Variables / Secrets (new)

| Key | Where stored | Purpose |
|---|---|---|
| `GOOGLE_GEOCODING_API_KEY` | Supabase secret | Used by `geocode-appointments` Edge Function |
| `STADIA_MAPS_API_KEY` | Vite env / Vercel env var | Appended to Stadia tile URL for production (`?api_key=...`) |

---

## 4. Database Schema Changes

### New Table: `tech_locations`
One row per active tech. Upsert pattern — never grows unbounded.

```sql
CREATE TABLE tech_locations (
  technician_id   INT           PRIMARY KEY REFERENCES technicians(id) ON DELETE CASCADE,
  client_id       INT           NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lat             NUMERIC(10,7) NOT NULL,
  lng             NUMERIC(10,7) NOT NULL,
  accuracy_meters NUMERIC(6,1),
  heading         NUMERIC(5,2),     -- degrees 0–360, null when stationary
  speed_kmh       NUMERIC(6,2),     -- null when stationary
  non_job_status  TEXT,             -- e.g. "Parts Supplier", "Office" — set by non-job status dropdown; cleared on next job en_route
  recorded_at     TIMESTAMPTZ   NOT NULL,  -- when device captured the fix
  received_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
```

**Upsert guard** — prevents out-of-order delivery from overwriting a newer position with an older one:

```sql
INSERT INTO tech_locations (technician_id, client_id, lat, lng, accuracy_meters, heading, speed_kmh, non_job_status, recorded_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (technician_id) DO UPDATE SET
  lat             = EXCLUDED.lat,
  lng             = EXCLUDED.lng,
  accuracy_meters = EXCLUDED.accuracy_meters,
  heading         = EXCLUDED.heading,
  speed_kmh       = EXCLUDED.speed_kmh,
  non_job_status  = EXCLUDED.non_job_status,
  recorded_at     = EXCLUDED.recorded_at,
  received_at     = now()
WHERE EXCLUDED.recorded_at > tech_locations.recorded_at;
```

**Non-job status persistence:** When a tech selects a non-job destination, the client browser upserts `tech_locations` setting `non_job_status` to the selected label (e.g., `"Parts Supplier"`). Lat/lng are set to the tech's last known position. The dispatcher's Realtime subscription on `tech_locations` already covers this — no additional subscription needed. `non_job_status` is cleared (set to `null`) when GPS tracking starts on the next `en_route` job.

### New Table: `tracking_tokens`
One token per appointment. Used to gate the customer tracking page.

`appointments.id` is confirmed `UUID` (verified against live schema). The foreign key below is correct.

```sql
CREATE TABLE tracking_tokens (
  token           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  appointment_id  UUID        NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  technician_id   INT         NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  client_id       INT         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,  -- appointment end_time + 2 hours
  revoked         BOOL        NOT NULL DEFAULT false
);
```

**Token generation** is performed exclusively by the `generate-tracking-token` Edge Function using the service role key. Client browsers never insert directly into this table. RLS on this table is therefore: no direct client access (all reads/writes go through service-role Edge Functions).

### New Table: `client_destinations`
Client-configurable non-job status options shown to techs in the status dropdown.

```sql
CREATE TABLE client_destinations (
  id          SERIAL      PRIMARY KEY,
  client_id   INT         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label       TEXT        NOT NULL,  -- e.g. "Parts Supplier", "Office", "Lunch", "Home"
  sort_order  INT         NOT NULL DEFAULT 0,
  is_active   BOOL        NOT NULL DEFAULT true
);
```

Default rows seeded via the same migration that creates the table — a `DO $$ BEGIN ... END $$` block inserts four rows for all existing clients. For new clients created after this migration, the `clients` insert trigger (or the `Admin.jsx` create-client flow) inserts the same four defaults: "Parts Supplier", "Office", "Lunch", "Done for the Day".

### Modified Table: `appointments`
Add geocoded coordinates for job pins on the dispatcher map.

```sql
ALTER TABLE appointments
  ADD COLUMN job_lat NUMERIC(10,7),
  ADD COLUMN job_lng NUMERIC(10,7),
  ADD COLUMN geocode_status TEXT DEFAULT 'pending';
  -- geocode_status: 'pending' | 'success' | 'failed'
```

### Modified Table: `clients`
Add Twilio credentials for SMS delivery.

```sql
ALTER TABLE clients
  ADD COLUMN twilio_account_sid  TEXT,
  ADD COLUMN twilio_auth_token   TEXT,
  ADD COLUMN twilio_from_number  TEXT;
```

### New Permission Flags (`technician_permissions`)
Four new feature flags added alongside existing ones. All default to `false`.

| Feature | What it enables |
|---|---|
| `view_customer_history` | Tech sees prior appointments for this customer in job detail |
| `view_customer_notes` | Tech sees dispatcher/owner notes in job detail |
| `view_call_transcript` | Tech sees AI call transcript in job detail (if applicable) |
| `view_call_recording` | Tech can play AI call recording in job detail (if applicable) |

---

## 5. GPS Broadcasting (`locationService.js`)

### Interface

```javascript
locationService.startTracking(techId, clientId)  // called on "On My Way"
locationService.stopTracking()                     // called on "Mark Complete"
```

### Behavior

- Uses `navigator.geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 })`
- **Distance filter:** Only writes to Supabase if tech has moved ≥50 meters from last recorded position
- **Heartbeat:** Forces a write every 60 seconds regardless of movement — keeps the dispatcher map showing the tech as "live"
- **Low-accuracy fallback:** If `enableHighAccuracy` times out, falls back to `enableHighAccuracy: false` (wifi/cell). Marks location as approximate.
- **Speed sanity check:** Discards readings implying >200 km/h movement (GPS noise in urban canyons)
- **iOS watchdog timer:** Every 30 seconds, checks if the last GPS callback was >45 seconds ago. If so, tears down and re-registers `watchPosition`. Fixes silent iOS failure after phone calls or app switches.
- **Stationary mode:** If speed <3 km/h for 60+ seconds, switches to `enableHighAccuracy: false` to reduce battery drain. Switches back on movement detection.
- **`non_job_status` clearing:** `locationService.startTracking()` includes `non_job_status: null` in its first upsert to `tech_locations`, clearing any previously set non-job status label in the same write.
- **Screen wakelock:** Requests `navigator.wakeLock.request('screen')` when tracking is active, with a user-visible "Keep screen on while navigating" indicator.

### Offline Queue

Location fixes that fail to reach Supabase are queued in `IndexedDB`. On network reconnect, queue is flushed in chronological order. Queue capped at 200 entries. On `QuotaExceededError`, trims oldest entries and shows a warning toast.

### Write Pattern

Direct Supabase JS client upsert from the tech's browser, gated by RLS. No Edge Function required for location writes.

**Auth session requirement:** Techs log in via the Supabase Auth invite flow (same as dispatchers — they receive an invite email, set a password via `RepSetPasswordPage`-equivalent, and thereafter have a full Supabase auth session). `auth.email()` in RLS policies will equal `technicians.email` for any authenticated tech. This is confirmed by App.jsx's role resolution step 3, which reads the tech's row from `technicians` by `auth.email()`.

---

## 6. Tech Dashboard Redesign

### Day Navigation
Sticky header gains a three-element date row:
```
[← ChevronLeft]  [Tuesday, March 28]  [ChevronRight →]
```
- Arrows are 48×48px tap targets
- Center label opens native `<input type="date">` on tap
- Blue dot under today's date; dimmed text for past dates
- No swipe gestures (conflicts with iOS system gestures)

### Job Cards
Each card shows without tapping:
- Customer name + service type
- Time window (e.g., "2:00 PM – 4:00 PM")
- Address (street + city, one line)
- Status badge

### Tap-to-Expand Job Detail Sheet
Always visible (no permissions needed):
- Full address, job notes, Navigate button
- Status action buttons ("On My Way" / "Mark Complete")
- For past-day jobs: action buttons hidden, replaced with "View Only" pill

Permission-gated sections (shown only if owner has enabled for this tech):
- **Customer History** — prior appointments for this customer
- **Customer Notes** — dispatcher/owner notes
- **Call Transcript** — if job was booked by AI receptionist
- **Call Recording** — playable audio, if AI-booked

### Status Action Buttons
- **"On My Way"** → status: `en_route`, starts GPS via `locationService.startTracking()`, generates tracking token, sends customer SMS
- **"Mark Complete"** → status: `complete`, stops GPS via `locationService.stopTracking()`, revokes tracking token
- Both: optimistic UI update, then Supabase write

### Non-Job Status Dropdown
Persistent "Set Status" button at the bottom of the screen (outside job cards). Opens a modal with `client_destinations` options. Selecting one:
- Posts a status label visible to the dispatcher on the map (tech dot gets a label: "Mike — Parts Supplier")
- Does NOT start GPS tracking
- Dispatcher sees the label change in real time via Supabase Realtime

---

## 7. Dispatcher Map View

### Map Stack
- **Library:** Leaflet 1.x + React-Leaflet 4.x
- **Tiles:** Stadia.OSMBright — tile URL: `https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png?api_key={STADIA_MAPS_API_KEY}`
- **API key:** `STADIA_MAPS_API_KEY` stored as a Vite env variable (`VITE_STADIA_API_KEY`) and set in Vercel environment variables for production
- **Account:** Stadia Maps — $20/month Starter plan (commercial use required; free tier is non-commercial)
- **Map container:** `calc(100vh - 56px - 56px)` height (full bleed minus header and bottom nav)

### New Tab
Dispatchers get a 5th tab: **Map** (MapPin icon from lucide-react). Added to the dispatcher nav array. Uses explicit static class `grid-cols-5` (not template literal — avoids Tailwind purge).

### Tech Markers
- `CircleMarker` with `color` and `fillColor` from `tech.color` in DB
- Radius: 10px
- `en_route` status: CSS pulsing ring animation on the stroke
- Stale (>5 min no update): marker dims, tooltip shows "Last seen X min ago"
- Very stale (>15 min): marker grays out entirely

### Job Markers
- Standard Leaflet marker, colored by status:
  - Yellow: confirmed/unassigned
  - Blue: en route
  - Green: complete
- Only today's appointments shown

### Tech Detail Panel (on marker tap)
Bottom sheet: tech name, color dot, current job (customer + address + time), status, "last updated" timestamp.

### Job Detail Panel (on pin tap)
Bottom sheet: customer name, time window, service type, assigned tech (with color dot), "Reassign" button.

### Reassign Flow (3 taps)
1. Tap job pin → bottom panel
2. Tap "Reassign" → inline dropdown of active techs
3. Select tech → optimistic update + Supabase write + toast confirmation

### Real-time Updates
```javascript
supabase
  .channel(`tech-locations:${clientData.id}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'tech_locations',
    filter: `client_id=eq.${clientData.id}`
  }, payload => updateTechMarker(payload.new))
  .subscribe()
```

Fallback: if subscription drops, poll `tech_locations` every 30 seconds. Amber dot indicator: "Live updates paused — reconnecting."

### Floating Legend
Collapsible card (top-right). Each row: color dot + tech name + status badge. Collapses to an icon on mobile to preserve map space.

### Empty States
- No GPS-enabled techs: banner overlay — "Locations appear here when techs tap On My Way"
- No jobs today: job pins absent; map still renders with tech markers

---

## 8. Customer Tracking Page

### URL Structure
`https://app.reliantsupport.net/?track={token}`

Handled in App.jsx URL routing (same pattern as `?activate=` and `?rep-invite=`). Renders `<TrackingPage token={token} />` with no auth check.

### Token Generation
Triggered when tech taps "On My Way." The tech's browser calls the `generate-tracking-token` Edge Function (service role key) which:
1. Inserts a row into `tracking_tokens`
2. Sets `expires_at = appointment.end_time + 2 hours`
3. Returns the full tracking URL to the caller
4. Calls the `send-sms` Edge Function with the tracking URL and the client's Twilio credentials

If the dispatcher reassigns a job mid-route (tech A is en_route, dispatcher reassigns to tech B): the `generate-tracking-token` Edge Function revokes any existing token for that appointment (sets `revoked = true` on the existing row) before inserting the new token for tech B, then sends a new SMS to the customer.

### Token Validation (every request)
The `TrackingPage` component calls a `get-tracking-data` Edge Function (service role key — no auth). The function validates:
- Token exists and is not revoked
- `expires_at` has not passed
- Appointment status is currently `en_route`

If any check fails, returns 403 → page shows "This tracking link has expired."

### Three States

**State 1 — En Route (live tracking, entry state via SMS link)**
- Live map: tech's colored dot moving, job destination pin static
- Tech's first name only (no last name, no phone)
- "Mike is on the way!"
- Rough ETA if calculable from distance

Note: The tracking token is only generated when status changes to `en_route`, so customers only ever open the link in this state. The token does not exist before "On My Way" is tapped.

`TrackingPage` polls `get-tracking-data` every 30 seconds. When the response includes `status: "complete"`, the page transitions to State 2 without a 403 — the Edge Function returns a 200 with `status: "complete"` and no live location data. A 403 is only returned for invalid or revoked tokens.

**State 2 — Complete**
- Static map, grayed out
- Green checkmark: "Your service is complete. Thank you for choosing [Company Name]."
- No live data served after this state

### Data Exposed via Tracking Endpoint
✅ Tech first name
✅ Tech color (for marker)
✅ Tech current lat/lng
✅ Appointment start/end time, service type, status

❌ Tech last name
❌ Tech phone number
❌ Tech's other appointments
❌ Other customers' data
❌ Business internal IDs, API keys, or configuration

### SMS Delivery
- Sent from client's `twilio_from_number` (same number as Retell receptionist agent)
- Via the new `send-sms` Edge Function (separate from `send-notification` which is email-only)
- `send-sms` accepts: `{ to, body, twilio_account_sid, twilio_auth_token, twilio_from_number }`
- Message format: *"Hi [Customer Name], your technician [Tech First Name] is on the way! Track their location: {tracking_url}"*
- Twilio credentials (`twilio_account_sid`, `twilio_auth_token`, `twilio_from_number`) are stored on the client's row in the `clients` table
- Admin panel gets a "SMS Configuration" section for configuring these fields per client

---

## 9. RLS Policies

### `tech_locations`
- **Owners/dispatchers:** SELECT all rows for their `client_id`
- **Techs:** INSERT and UPDATE only their own row (matched by `auth.email()` → `technicians.email`)
- **Public:** No access — customer tracking goes through Edge Function with service role key

### `tracking_tokens`
- **No direct client access.** All inserts and reads go through service-role Edge Functions (`generate-tracking-token`, `get-tracking-data`). RLS is enabled with no permissive policies for authenticated or anonymous roles — only the service role key bypasses it.

### `client_destinations`
- **Owners:** Full CRUD
- **Dispatchers:** SELECT only
- **Techs:** SELECT only (to populate the status dropdown)

All policies follow the established pattern: use `auth.email()` — NOT subqueries into `auth.users`.

---

## 10. Key Technical Decisions (Locked)

| Decision | Choice | Rationale |
|---|---|---|
| Map library | Leaflet + React-Leaflet | Lightweight (49KB), free, sufficient for scale |
| Map tiles | Stadia.OSMBright | Google Maps-like appearance, $20/month commercial, easy style switching |
| GPS tracking scope | En route to jobs only | Minimizes battery drain and privacy concerns; non-job travel is text-status only |
| Geocoding | Google Geocoding API | Most reliable for US addresses; one-time cost per appointment |
| Location update write | Direct Supabase JS upsert from tech browser | No Edge Function overhead; RLS enforces security |
| Dispatcher real-time | Supabase Realtime (Postgres Changes) | Already in stack; clean fallback to 30s polling |
| Customer tracking delivery | Twilio SMS, automatic on "On My Way" | Uses existing per-client Twilio numbers (same as Retell receptionist) |
| Location history | NOT stored (last-known only) | Avoids privacy/GDPR complexity; history can be added later if needed |
| Tech data access | Scoped to own appointments | Permission-gated per tech by owner; defaults all off |
| Non-job GPS | Deferred (text status only) | Build Option A first; upgrade to full GPS tracking if clients request it |

---

## 11. Success Metrics

- **Dispatcher "where is my tech?" calls drop** — target 50%+ reduction within 30 days of a client going live
- **Customer "where is my guy?" calls drop** — measurable reduction in inbound location inquiries
- **GPS activation rate** — 70%+ of `en_route` jobs have active location sharing within 60 days
- **Tracking link open rate** — % of sent SMS links that are opened (measures customer engagement)
- **Dispatcher daily map usage** — dispatchers actively opening the Map tab each shift
