# Technician Dashboard Design Spec

**Date:** 2026-03-25
**Project:** Reliant Support — Receptionist Dashboard
**Feature:** Tech-Facing Mobile Dashboard + Dispatcher Role

---

## Overview

A mobile-optimized dashboard for field service technicians, accessible via PWA on their phone's home screen. Built within the existing React/Vite/Supabase app using the same dark Tailwind theme. Delivered in two phases.

**Phase 1:** Technician authentication, today's jobs view, job detail with navigation and status actions, client-side tech management, dispatcher staff role, and job assignment UI.

**Phase 2:** Live GPS tracking, client dispatch map (Mapbox), customer SMS notifications, and customer tracking link page.

---

## Architecture

The tech dashboard is a new top-level view inside the existing `App.jsx` auth flow — not a separate app. When a logged-in user is identified as a technician (via the `technicians` table), they are routed to `<TechDashboard />` instead of the main client dashboard. The same Supabase auth handles both user types.

Dispatchers (client staff) log in through the same flow. A lookup against `client_staff` identifies them and loads their `client_id` with restricted permissions (no Billing, no Settings).

The public customer tracking page (`/track`) is handled by a URL-param check at the very top of `App.jsx` — before the auth check — so no router library is needed.

---

## Existing Schema Notes

The `technicians` table already exists with these columns: `id` (integer serial), `client_id` (integer), `name`, `phone`, `color`, `is_active` (boolean). The `appointments` table stores `technician_id` as an integer FK. The Phase 1 database migration adds only what is missing — it does not recreate existing tables.

Appointment status values currently in use: `confirmed` (booked). New statuses added in Phase 1: `en_route`, `complete`. No enum constraint exists — these are free-text values. The existing calendar/appointments view already displays status; it should treat `en_route` and `complete` the same as `confirmed` for display purposes (show the appointment, not filter it out).

---

## Phase 1

### 1. Database Migrations

#### Migration: add `email` to `technicians`

The `technicians` table already exists. Add only the `email` column:

```sql
ALTER TABLE technicians ADD COLUMN email text UNIQUE;
```

Note: `id` remains an integer serial. `is_active` is the existing boolean column name (not `active`).

#### New table: `technician_permissions`

Per-tech feature toggles configured by the client.

```sql
CREATE TABLE technician_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id  int  NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  client_id      int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  feature        text NOT NULL,
  -- valid values: 'gps_tracking' | 'customer_sms' | 'customer_tracking_link' | 'job_notes' | 'mark_complete'
  enabled        bool NOT NULL DEFAULT true,
  UNIQUE(technician_id, feature)
);

ALTER TABLE technician_permissions ENABLE ROW LEVEL SECURITY;

-- Techs read their own permissions
CREATE POLICY "tech_read_own_permissions" ON technician_permissions
  FOR SELECT USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Clients manage permissions for their own techs
CREATE POLICY "client_manage_tech_permissions" ON technician_permissions
  FOR ALL USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

#### New table: `client_staff`

Dispatcher and other non-owner staff accounts per client.

```sql
CREATE TABLE client_staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  role        text NOT NULL DEFAULT 'dispatcher',  -- extensible for future roles
  active      bool NOT NULL DEFAULT true,
  invited_at  timestamptz DEFAULT now()
);

ALTER TABLE client_staff ENABLE ROW LEVEL SECURITY;

-- Staff can read their own row
CREATE POLICY "staff_read_own" ON client_staff
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Owners can manage their staff
CREATE POLICY "owner_manage_staff" ON client_staff
  FOR ALL USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

#### RLS additions for existing `technicians` table

```sql
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;

-- Clients manage their own techs (covers SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "client_manage_own_techs" ON technicians
  FOR ALL USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );

-- Techs read their own row
CREATE POLICY "tech_read_own" ON technicians
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );
```

---

### 2. Auth Flow

On login, `App.jsx` performs a four-step lookup in order:

1. **Check `clients`** by email → if found and `is_admin`, route to Admin view; if found (owner), route to main dashboard
2. **Check `client_staff`** by email → if found and `active`, route to main dashboard with dispatcher permissions (no Billing tab, no Settings tab)
3. **Check `technicians`** by email → if found and `is_active`, route to `<TechDashboard />`
4. If none match → show "Account not found" error

The result is stored in app state alongside the user object:
```js
{ user, role: 'owner' | 'dispatcher' | 'tech', clientId, techId? }
```

---

### 3. Tech Dashboard — Mobile UI

A new top-level component: `src/TechDashboard.jsx`

All screens use the existing dark theme (`bg-gray-900`, `text-white`, Tailwind utilities). Layout is mobile-first — single column, large touch targets (minimum 44px), no horizontal scroll.

#### Primary Screen: Today's Jobs

```
┌─────────────────────────────────┐
│  Good morning, [Tech Name]      │
│  Wednesday, March 25            │
├─────────────────────────────────┤
│  TODAY'S JOBS  (3)              │
│                                 │
│  ┌─────────────────────────┐    │
│  │ 9:00 AM                 │    │
│  │ Johnson Residence        │    │
│  │ 123 Maple St             │    │
│  │            [PENDING]    │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │ 11:30 AM                │    │
│  │ Acme HVAC               │    │
│  │ 456 Oak Ave              │    │
│  │          [EN ROUTE]     │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │ 2:00 PM                 │    │
│  │ Smith & Sons            │    │
│  │ 789 Pine Blvd            │    │
│  │         [COMPLETE]      │    │
│  └─────────────────────────┘    │
└─────────────────────────────────┘
```

**Data query:**
```js
supabase
  .from('appointments')
  .select('*')
  .eq('client_id', clientId)
  .eq('technician_id', techId)   // techId is integer
  .eq('date', todayISO)
  .in('status', ['confirmed', 'en_route', 'complete'])
  .order('start_time', { ascending: true })
```

Status display mapping:
- `confirmed` → yellow badge "PENDING"
- `en_route` → blue badge "EN ROUTE"
- `complete` → green badge "COMPLETE"

All three statuses display in the list — no filtering by status.

#### Job Detail Screen

Tap a job card to open the detail view:

```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Johnson Residence              │
│  9:00 AM – 10:00 AM             │
│                                 │
│  📍 123 Maple St                │
│     Springfield, IL 62701       │
│                                 │
│  👤 Bob Johnson                 │
│  📞 (555) 123-4567              │
│                                 │
│  Notes: Annual AC tune-up.      │
│  Check refrigerant levels.      │
│                                 │
│  ┌─────────────────────────┐    │
│  │       NAVIGATE          │    │  → native maps deep link (always shown)
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │      ON MY WAY          │    │  → updates status, hidden if not permitted
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │    MARK COMPLETE        │    │  → updates status, hidden if not permitted
│  └─────────────────────────┘    │
└─────────────────────────────────┘
```

**Button behaviors:**

- **NAVIGATE** — Always shown regardless of permissions. Opens native maps app via deep link:
  `https://maps.google.com/?daddr=<encodeURIComponent(full address)>`
  iOS presents a choice between Apple Maps and Google Maps. Android opens Google Maps directly.

- **ON MY WAY** — Only shown if `mark_complete` permission is enabled (reuses same permission gate as Mark Complete since both are action buttons). Updates appointment `status` to `en_route`. In Phase 2: also triggers GPS tracking and customer SMS. Hidden (not grayed out) if permission disabled.

- **MARK COMPLETE** — Only shown if `mark_complete` permission is enabled. Updates appointment `status` to `complete`. Confirms with a brief toast notification. Hidden if permission disabled.

  Note: "ON MY WAY" is hidden once status is already `en_route` or `complete`. "MARK COMPLETE" is hidden once status is `complete`.

- **Job Notes** — The notes field on job detail is only visible if `job_notes` permission is enabled. Hidden entirely if disabled.

---

### 4. Job Assignment UI

Jobs are assigned to technicians by the client owner or dispatcher from the existing appointments workflow. A "Technician" dropdown must be present when creating or editing an appointment. This dropdown is already implemented in `App.jsx` (the `technicianId` field in the appointment form). No new UI is needed for Phase 1 — it is already in place.

The dispatcher, having access to the Appointments tab, can open any appointment and change the assigned technician from that dropdown.

---

### 5. Client-Side Changes

#### Settings Tab additions (owner only)

**Technician Features section** — per-tech permission toggles:

Appears below existing settings. For each tech (listed by name), show a row of toggles:
- Job Notes
- Mark Complete / On My Way
- GPS Tracking *(Phase 2 — shown but disabled with "Coming soon" label in Phase 1)*
- Customer SMS Notifications *(Phase 2 — shown but disabled with "Coming soon" label in Phase 1)*
- Customer Tracking Link *(Phase 2 — shown but disabled with "Coming soon" label in Phase 1)*

Stored in `technician_permissions`. Default: all Phase 1 toggles enabled on tech creation. Phase 2 toggles stored as `enabled: false` and locked in the UI until Phase 2 ships.

**Team Members section** — dispatcher management:

- List of active dispatchers (name, email, active/inactive status)
- "Invite Dispatcher" button → sends Supabase auth invite email, creates `client_staff` row
- Tap a dispatcher → deactivate / reactivate (no delete — preserves audit trail)
- Dispatchers cannot see this section

#### Team Tab (new tab in client bottom nav)

**Phase 1 — List view only:**

- List of all techs (name, phone, color swatch, active/inactive)
- "Add Tech" button → form: name, email, phone, color → creates/updates `technicians` row (adds `email` to existing flow) → sends Supabase auth invite email
- Tap a tech → edit details, toggle active via `is_active`, manage their Phase 1 feature permissions
- Existing tech management UI in Settings can be migrated to this tab (or kept in both — TBD during implementation)

**Phase 2 — Map | List toggle at top:**

Map view (Mapbox GL JS):
- Centered on client's service area (derived from today's job addresses on first load)
- Live tech pins — labeled with name, updated every ~30s via Supabase Realtime subscription on `tech_locations`
- Customer pins for today's jobs — color-coded by status (confirmed=yellow, en_route=blue, complete=green)
- Tap a tech pin → shows name + current job assignment
- Tap a customer pin → shows job details and assigned tech name
- Map is read-only for the client; dispatch happens via the appointments workflow

---

## Phase 2

### New table: `tech_locations`

Live GPS coordinates, written by the tech's browser.

```sql
CREATE TABLE tech_locations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id  int  NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  client_id      int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lat            double precision NOT NULL,
  lng            double precision NOT NULL,
  recorded_at    timestamptz DEFAULT now()
);

ALTER TABLE tech_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tech_insert_own_location" ON tech_locations
  FOR INSERT WITH CHECK (
    technician_id = (
      SELECT id FROM technicians
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "client_read_tech_locations" ON tech_locations
  FOR SELECT USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

Rows older than 24 hours are pruned by a scheduled Supabase Edge Function (pg_cron or Supabase scheduled function).

### GPS Tracking

When a tech taps "On My Way":
1. App calls `navigator.geolocation.watchPosition()` requesting updates
2. Each position callback writes a row to `tech_locations` via Supabase client
3. Client's dispatch map subscribes to `tech_locations` via Supabase Realtime and updates pins live
4. GPS tracking stops when tech taps "Mark Complete" (calls `clearWatch()`) or navigates away

**iOS limitation (known constraint):** `navigator.geolocation.watchPosition` stops delivering updates when a PWA is backgrounded on iOS due to background app refresh restrictions (typically after ~30 seconds). This means GPS tracking only functions reliably while the app is in the foreground on iOS. Techs should be instructed to keep the app open while driving. A background sync workaround (service worker + Background Sync API) is out of scope for Phase 2.

Only runs if `gps_tracking` permission is enabled for the tech.

### Customer SMS Notification

When a tech taps "On My Way":
1. A Supabase Edge Function `send-tech-sms` is called with `appointment_id`
2. Function fetches: customer name + phone (from appointment/customer record), tech name, tech's most recent lat/lng from `tech_locations`, job address
3. Calculates ETA via Mapbox Directions API (driving profile, tech location → job address)
4. Sends SMS via Twilio:
   - With ETA: *"Hi [Customer Name], [Tech Name] is on the way and should arrive in approximately [X] minutes."*
   - Without ETA (no GPS fix yet or Mapbox error): *"Hi [Customer Name], [Tech Name] is on the way to your location."*
5. If `customer_tracking_link` permission is also enabled, appends the tracking URL to the SMS

Only runs if `customer_sms` permission is enabled for the tech.

### Customer Tracking Link

A public page — no auth required — rendered when `?track=<appointment_id>` is detected in the URL.

**Routing:** At the very top of `App.jsx`, before any auth check:
```js
const params = new URLSearchParams(window.location.search);
if (params.get('track')) {
  return <TrackingPage appointmentId={params.get('track')} />;
}
```

New component: `src/TrackingPage.jsx`

```
┌─────────────────────────────────┐
│  Reliant Support                │
│                                 │
│  [Tech Name] is on the way      │
│                                 │
│  ┌─────────────────────────┐    │
│  │   [MAPBOX MAP]          │    │
│  │   Tech pin (moving)     │    │
│  │   Destination pin       │    │
│  └─────────────────────────┘    │
│                                 │
│  Estimated arrival: 12 min      │
│  Last updated: 2 min ago        │
└─────────────────────────────────┘
```

- Map polls `tech_locations` every 30s for the assigned tech's latest position
- ETA recalculates on each update via Mapbox Directions API
- "Your location" pin is not shown (would require asking customer for location permission — not worth the friction)
- Destination pin shows the job address
- `appointment_id` is a UUID — not guessable, sufficient as access control

Note: The URL format is `https://app.reliantsupport.net/?track=<appointment_id>` (query param on root, not a path segment) so the existing Vercel SPA rewrite in `vercel.json` handles it without changes.

Only accessible if `customer_tracking_link` permission is enabled for the tech.

---

## Permissions Matrix

| Feature | Owner | Dispatcher | Tech |
|---|---|---|---|
| Appointments tab | ✅ full | ✅ full | ❌ (tech dashboard only) |
| Customers tab | ✅ full | ✅ full | ❌ |
| Team tab | ✅ full | ✅ view only | ❌ |
| Billing tab | ✅ | ❌ hidden | ❌ |
| Settings tab | ✅ full | ❌ hidden | ❌ |
| Assign jobs to techs | ✅ | ✅ | ❌ |
| Today's Jobs view | ❌ | ❌ | ✅ |
| Navigate button | ❌ | ❌ | ✅ (always) |
| On My Way button | ❌ | ❌ | ✅ (if mark_complete permitted) |
| Mark Complete | ❌ | ❌ | ✅ (if mark_complete permitted) |
| Job Notes visible | ❌ | ❌ | ✅ (if job_notes permitted) |

---

## Tech Stack Additions

| Concern | Tool |
|---|---|
| Mapping (dispatch map + tracking page) | Mapbox GL JS (free tier: 50k map loads/month) |
| Routing / ETA | Mapbox Directions API |
| SMS | Twilio (~$0.01/text) |
| GPS | Browser Geolocation API (`navigator.geolocation.watchPosition`) |
| Real-time location updates | Supabase Realtime (Postgres changes on `tech_locations`) |
| Deep link (navigation) | Universal `https://maps.google.com/?daddr=` URL |

---

## Out of Scope (Phase 1 + 2)

- Job creation by techs (read-only job list)
- In-app messaging between tech and dispatcher
- Photo uploads from job site
- Offline mode / service worker job caching
- Payroll or time tracking
- Native mobile app (iOS/Android) — PWA only
- Background GPS on iOS when app is minimized

---

## Success Criteria

**Phase 1:**
- A tech can log in on their phone, see today's assigned jobs, tap Navigate to get directions, tap On My Way to update status, and mark a job complete
- A client owner can add techs (with email for login), invite dispatchers, and configure per-tech feature permissions
- A dispatcher can log in and see the full job/customer view and assign jobs, but cannot access Billing or Settings

**Phase 2:**
- When a tech taps "On My Way" with the app in the foreground, their live location appears on the client's dispatch map within 60 seconds
- The customer receives an SMS with a tracking link that shows the tech's live position on a Mapbox map
- The client can see all active techs on the dispatch map simultaneously with color-coded job status pins
