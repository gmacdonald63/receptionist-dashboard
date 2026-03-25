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

The public customer tracking page is handled by a URL-param check at the very top of `App.jsx` — before the auth check — so no router library is needed.

---

## Existing Schema Notes

The `technicians` table already exists with these columns: `id` (integer serial), `client_id` (integer), `name`, `phone`, `color`, `is_active` (boolean). The `appointments` table stores `technician_id` as an integer FK. The Phase 1 database migration adds only what is missing — it does not recreate existing tables.

Appointment status values currently in use: `confirmed` (booked). New statuses added in Phase 1: `en_route`, `complete`. No enum constraint exists — these are free-text values. The existing appointments view uses `.neq('status', 'cancelled')` to display appointments. After this change it should use `.not('status', 'in', '("cancelled")')` or explicitly include `confirmed`, `en_route`, and `complete` — whichever makes future status additions safer. The tech dashboard uses `.in('status', ['confirmed', 'en_route', 'complete'])` intentionally, so only explicitly recognized statuses appear to the tech.

---

## Phase 1

### 1. Database Migrations

#### Migration: add `email` to `technicians`

The `technicians` table already exists. Add only the `email` column:

```sql
ALTER TABLE technicians ADD COLUMN email text UNIQUE;
```

`id` remains an integer serial. `is_active` is the existing boolean column name.

**Existing tech rows:** After this migration, all existing `technicians` rows have `email = NULL`. These techs cannot log in until an email is added to their record via the updated Add/Edit Tech form. This is expected — tech login is a new capability and does not affect existing owner functionality.

**Email required for new techs:** When creating a new tech (Phase 1), `email` is required. For editing an existing tech, the owner can add an email at any time; the tech cannot log in until one is set.

#### RLS additions for existing `technicians` table

```sql
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;

-- Clients manage their own techs (covers SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "client_manage_own_techs" ON technicians
  FOR ALL USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );

-- Techs read their own row (email must be set)
CREATE POLICY "tech_read_own" ON technicians
  FOR SELECT USING (
    email IS NOT NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );
```

#### RLS additions for existing `appointments` table

Techs need to read their assigned appointments and update status fields:

```sql
-- Assumes RLS is already enabled on appointments (verify before running)

-- Techs can read their own client's appointments assigned to them
CREATE POLICY "tech_read_own_appointments" ON appointments
  FOR SELECT USING (
    technician_id = (SELECT id FROM technicians WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );

-- Techs can update status on their assigned appointments
CREATE POLICY "tech_update_own_appointment_status" ON appointments
  FOR UPDATE USING (
    technician_id = (SELECT id FROM technicians WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    technician_id = (SELECT id FROM technicians WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

**Note for implementation:** Verify whether RLS is currently enabled on the `appointments` table before running these. If RLS is not enabled, enable it first and audit the existing owner/admin policies to ensure they are not broken.

#### New table: `technician_permissions`

Per-tech feature toggles configured by the client. Each button/feature has its own permission key.

```sql
CREATE TABLE technician_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id  int  NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  client_id      int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  feature        text NOT NULL,
  -- valid values:
  --   'job_notes'              — show job notes field on job detail
  --   'on_my_way'              — show On My Way button (Phase 2: also triggers GPS + SMS)
  --   'mark_complete'          — show Mark Complete button
  --   'gps_tracking'           — (Phase 2) enable GPS location writes
  --   'customer_sms'           — (Phase 2) send SMS on On My Way
  --   'customer_tracking_link' — (Phase 2) include tracking URL in SMS
  enabled        bool NOT NULL DEFAULT true,
  UNIQUE(technician_id, feature)
);

ALTER TABLE technician_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tech_read_own_permissions" ON technician_permissions
  FOR SELECT USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "client_manage_tech_permissions" ON technician_permissions
  FOR ALL USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

**Default behavior when rows are missing:** If a tech has no `technician_permissions` rows (e.g., they were created before this migration, or rows were accidentally deleted), the app treats all Phase 1 features as **enabled by default**. The permission check helper: `const isAllowed = (permissions, feature) => permissions.find(p => p.feature === feature)?.enabled ?? true;`

When a new tech is created, the owner's UI inserts default permission rows for all Phase 1 features (`job_notes`, `on_my_way`, `mark_complete`) with `enabled: true`, and Phase 2 features with `enabled: false`.

#### New table: `client_staff`

Dispatcher and other non-owner staff accounts per client.

```sql
CREATE TABLE client_staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  role        text NOT NULL DEFAULT 'dispatcher',
  active      bool NOT NULL DEFAULT true,
  invited_at  timestamptz DEFAULT now()
);

ALTER TABLE client_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_read_own" ON client_staff
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "owner_manage_staff" ON client_staff
  FOR ALL USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

---

### 2. Auth Flow

**Structural change to `App.jsx`:** The existing auth flow performs a single `clients` lookup and force-signs out the user if no record is found. This force sign-out must be moved to the end of the four-step chain. The new flow:

```js
// After Supabase auth session is confirmed:
const email = session.user.email;

// Step 1: owner / admin
const { data: clientRecord } = await supabase.from('clients').select('*').eq('email', email).maybeSingle();
if (clientRecord) {
  setRole(clientRecord.is_admin ? 'admin' : 'owner');
  setClientData(clientRecord);
  return; // stop here
}

// Step 2: dispatcher
const { data: staffRecord } = await supabase.from('client_staff').select('*').eq('email', email).eq('active', true).maybeSingle();
if (staffRecord) {
  const { data: ownerData } = await supabase.from('clients').select('*').eq('id', staffRecord.client_id).single();
  setRole('dispatcher');
  setClientData(ownerData);
  return;
}

// Step 3: technician
const { data: techRecord } = await supabase.from('technicians').select('*').eq('email', email).eq('is_active', true).maybeSingle();
if (techRecord) {
  setRole('tech');
  setTechData(techRecord);
  return;
}

// Step 4: no match — sign out
await supabase.auth.signOut();
setError('Account not found.');
```

App state shape:
```js
{ user, role: 'admin' | 'owner' | 'dispatcher' | 'tech', clientData, techData? }
```

---

### 3. Tech Dashboard — Mobile UI

A new top-level component: `src/TechDashboard.jsx`

All screens use the existing dark theme (`bg-gray-900`, `text-white`, Tailwind utilities). Layout is mobile-first — single column, large touch targets (minimum 44px), no horizontal scroll.

#### Primary Screen: Today's Jobs

**Data query:**
```js
supabase
  .from('appointments')
  .select('*')
  .eq('client_id', techData.client_id)
  .eq('technician_id', techData.id)   // both integers
  .eq('date', todayISO)
  .in('status', ['confirmed', 'en_route', 'complete'])
  .order('start_time', { ascending: true })
```

Status display mapping:
- `confirmed` → yellow badge "PENDING"
- `en_route` → blue badge "EN ROUTE"
- `complete` → green badge "COMPLETE"

**Empty state:** If no jobs are assigned today, show: *"No jobs scheduled for today."*

**Error state:** If the query fails, show: *"Could not load your jobs. Pull down to retry."* with a retry button.

**Loading state:** Show skeleton cards (3 placeholder rows) while the query is in-flight.

#### Job Detail Screen

**Button behaviors:**

- **NAVIGATE** — Always shown. Opens: `https://maps.google.com/?daddr=<encodeURIComponent(address + city + state + zip)>`

- **ON MY WAY** — Shown only if `on_my_way` permission is enabled AND status is `confirmed`. Updates status to `en_route`. In Phase 2: triggers GPS tracking and customer SMS.

- **MARK COMPLETE** — Shown only if `mark_complete` permission is enabled AND status is not `complete`. Updates status to `complete`. Shows a brief toast on success.

- **Job Notes** — The notes section is visible only if `job_notes` permission is enabled.

All hidden buttons are removed from the DOM entirely — no grayed-out states.

---

### 4. Technician Form Updates (Add/Edit Tech)

The existing `techForm` in `App.jsx` currently collects `name`, `phone`, and `color`. Phase 1 adds:

- **Email field** (required for new techs, optional for editing existing ones)
- **Send invite toggle** (default on for new techs): when checked, the save action calls `supabase.auth.admin.inviteUserByEmail(email)` after the DB insert

**Invite flow atomicity:** The `technicians` row is inserted/updated first. If that succeeds and the invite is requested, `inviteUserByEmail` is called. If the invite fails (e.g., email already registered), a non-blocking warning is shown: *"Tech saved, but the invite email could not be sent. They can log in if they already have an account, or you can resend the invite later."* The tech record is not rolled back on invite failure — the email can be re-invited from the edit screen.

The same pattern applies to the "Invite Dispatcher" flow: create the `client_staff` row first, then send the Supabase invite. Show a warning (not an error) if the invite step fails.

---

### 5. Client-Side Changes

#### Settings Tab additions (owner only)

**Technician Features section** — per-tech permission toggles:

For each tech (listed by name), show toggles:
- Job Notes
- On My Way
- Mark Complete
- GPS Tracking *(Phase 2 — visible but non-interactive, labeled "Coming soon")*
- Customer SMS Notifications *(Phase 2 — visible but non-interactive, labeled "Coming soon")*
- Customer Tracking Link *(Phase 2 — visible but non-interactive, labeled "Coming soon")*

Phase 2 toggles are read-only in Phase 1 regardless of their stored value. When Phase 2 ships, the "Coming soon" label and disabled state are removed.

**Team Members section** — dispatcher management:

- List of dispatchers (name, email, active/inactive status)
- "Invite Dispatcher" button → form: name, email → creates `client_staff` row, sends invite
- Tap a dispatcher → deactivate / reactivate
- Dispatchers cannot see this section

#### Team Tab (new tab in client bottom nav)

**Phase 1 — List view (owner and dispatcher):**

Owner view:
- List of all techs (name, phone, color swatch, active/inactive)
- "Add Tech" button → form: name, email, phone, color → inserts `technicians` row + sends invite + inserts default `technician_permissions` rows
- Tap a tech → edit details, toggle `is_active`, manage Phase 1 permissions

Dispatcher view (read-only):
- Same list — name, phone, active/inactive status
- No "Add Tech" button
- Tapping a tech shows their details but no edit controls

**Phase 2 — Map | List toggle at top** (owner and dispatcher both see the map):

Map view (Mapbox GL JS):
- Centered on client's service area
- Live tech pins updated via Supabase Realtime on `tech_locations`
- Customer pins for today's jobs, color-coded by status
- Tapping pins shows detail popups (read-only for both roles)

---

## Phase 2

### New table: `tech_locations`

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

Rows older than 24 hours pruned by scheduled Supabase Edge Function.

### GPS Tracking

When a tech taps "On My Way" (if `gps_tracking` and `on_my_way` both enabled):
1. App calls `navigator.geolocation.watchPosition()`
2. Each position callback upserts a row to `tech_locations`
3. Client's dispatch map subscribes via Supabase Realtime
4. GPS stops on "Mark Complete" (`clearWatch()`)

**iOS limitation (known constraint):** `watchPosition` stops when PWA is backgrounded on iOS (~30 seconds). Techs must keep the app in the foreground while driving. Background sync is out of scope.

### Customer SMS Notification

When a tech taps "On My Way" (if `customer_sms` enabled):
1. Supabase Edge Function `send-tech-sms` called with `appointment_id`
2. Fetches customer name + phone from appointment record, tech name, job address
3. Fetches latest lat/lng from `tech_locations` for ETA calculation
4. Calculates ETA via Mapbox Directions API
5. Sends via Twilio — with ETA if available, without if GPS fix not yet available
6. Appends `?track=<appointment_id>` tracking URL if `customer_tracking_link` also enabled

### Customer Tracking Link

Public page — no auth. Triggered by `?track=<appointment_id>` query param at the top of `App.jsx`:

```js
const params = new URLSearchParams(window.location.search);
if (params.get('track')) {
  return <TrackingPage appointmentId={params.get('track')} />;
}
```

**Data access model:** `TrackingPage` does not query Supabase directly with the anon key against `tech_locations` (which would require exposing location data to all anon users). Instead, it calls a Supabase Edge Function `get-tracking-data` with the `appointment_id`:

```
POST /functions/v1/get-tracking-data
Body: { appointment_id: "<uuid>" }
```

The function (using service role key) validates the UUID, fetches the appointment + assigned tech's latest location + job address, and returns only the data needed for the map. The UUID is the access control — not guessable, sufficient for this use case.

New component: `src/TrackingPage.jsx`:
- Calls `get-tracking-data` every 30s
- Shows Mapbox map with tech pin (moving) and destination pin (job address)
- Shows ETA (recalculated each poll) and "last updated" timestamp
- URL: `https://app.reliantsupport.net/?track=<appointment_id>` — works with existing Vercel SPA rewrite

---

## Permissions Matrix

| Feature | Owner | Dispatcher | Tech |
|---|---|---|---|
| Appointments tab | ✅ full | ✅ full | ❌ |
| Customers tab | ✅ full | ✅ full | ❌ |
| Team tab | ✅ full (manage) | ✅ view only | ❌ |
| Billing tab | ✅ | ❌ hidden | ❌ |
| Settings tab | ✅ full | ❌ hidden | ❌ |
| Assign jobs to techs | ✅ | ✅ | ❌ |
| Today's Jobs view | ❌ | ❌ | ✅ |
| Navigate button | ❌ | ❌ | ✅ (always) |
| On My Way button | ❌ | ❌ | ✅ (if on_my_way permitted) |
| Mark Complete | ❌ | ❌ | ✅ (if mark_complete permitted) |
| Job Notes visible | ❌ | ❌ | ✅ (if job_notes permitted) |

---

## Tech Stack Additions

| Concern | Tool |
|---|---|
| Mapping | Mapbox GL JS (free tier: 50k map loads/month) |
| Routing / ETA | Mapbox Directions API |
| SMS | Twilio (~$0.01/text) |
| GPS | Browser Geolocation API |
| Real-time location | Supabase Realtime |
| Navigation deep link | `https://maps.google.com/?daddr=` |
| Tracking page data | New Edge Function `get-tracking-data` (service role, no auth) |

---

## Out of Scope

- Job creation by techs
- In-app messaging
- Photo uploads
- Offline mode / service worker caching
- Payroll or time tracking
- Native mobile app — PWA only
- Background GPS on iOS when app minimized

---

## Success Criteria

**Phase 1:**
- A tech can log in on their phone, see today's assigned jobs, navigate to a job, tap On My Way to update status, and mark a job complete
- A client owner can add techs with email (triggering an invite), invite dispatchers, and configure per-tech feature permissions independently for each button
- A dispatcher can log in, see the full jobs/customers view with tech assignment capability, and see the Team tab in read-only mode — but cannot access Billing or Settings

**Phase 2:**
- When a tech taps "On My Way" with the app in the foreground, their live location appears on the client's dispatch map within 60 seconds
- The customer receives an SMS with an ETA and a tracking link that shows the tech's live position on a Mapbox map
- The client can see all active techs on the dispatch map simultaneously with color-coded job status pins
