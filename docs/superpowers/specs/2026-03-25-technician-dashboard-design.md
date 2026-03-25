# Technician Dashboard Design Spec

**Date:** 2026-03-25
**Project:** Reliant Support — Receptionist Dashboard
**Feature:** Tech-Facing Mobile Dashboard + Dispatcher Role

---

## Overview

A mobile-optimized dashboard for field service technicians, accessible via PWA on their phone's home screen. Built within the existing React/Vite/Supabase app using the same dark Tailwind theme. Delivered in two phases.

**Phase 1:** Technician authentication, today's jobs view, job detail with navigation and status actions, client-side tech management, and a dispatcher staff role.

**Phase 2:** Live GPS tracking, client dispatch map (Mapbox), customer SMS notifications, and customer tracking link page.

---

## Architecture

The tech dashboard is a new top-level view inside the existing `App.jsx` auth flow — not a separate app. When a logged-in user is identified as a technician (via the `technicians` table), they are routed to `<TechDashboard />` instead of the main client dashboard. The same Supabase auth handles both user types.

Dispatchers (client staff) log in through the same flow. A secondary lookup against `client_staff` identifies them and loads their `client_id` with restricted permissions (no Billing, no Settings).

---

## Phase 1

### 1. Database Changes

#### New table: `technicians`

Stores tech accounts linked to a client.

```sql
CREATE TABLE technicians (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  phone         text,
  active        bool NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;

-- Techs can read their own row
CREATE POLICY "tech_read_own" ON technicians
  FOR SELECT USING (
    auth.uid() = (SELECT id FROM auth.users WHERE email = technicians.email)
  );

-- Clients can read their own techs
CREATE POLICY "client_read_own_techs" ON technicians
  FOR SELECT USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
  );

-- Clients can insert/update their own techs
CREATE POLICY "client_manage_own_techs" ON technicians
  FOR ALL USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
  );
```

#### New table: `technician_permissions`

Per-tech feature toggles configured by the client.

```sql
CREATE TABLE technician_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id  uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  client_id      int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  feature        text NOT NULL,  -- 'gps_tracking' | 'customer_sms' | 'customer_tracking_link' | 'job_notes' | 'mark_complete'
  enabled        bool NOT NULL DEFAULT true,
  UNIQUE(technician_id, feature)
);

ALTER TABLE technician_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tech_read_own_permissions" ON technician_permissions
  FOR SELECT USING (
    technician_id = (SELECT id FROM technicians WHERE email = auth.email())
  );

CREATE POLICY "client_manage_tech_permissions" ON technician_permissions
  FOR ALL USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
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
  role        text NOT NULL DEFAULT 'dispatcher',  -- extensible
  active      bool NOT NULL DEFAULT true,
  invited_at  timestamptz DEFAULT now()
);

ALTER TABLE client_staff ENABLE ROW LEVEL SECURITY;

-- Staff can read their own row
CREATE POLICY "staff_read_own" ON client_staff
  FOR SELECT USING (
    auth.uid() = (SELECT id FROM auth.users WHERE email = client_staff.email)
  );

-- Owners can manage their staff
CREATE POLICY "owner_manage_staff" ON client_staff
  FOR ALL USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
  );
```

#### Phase 2 table: `tech_locations`

Live GPS coordinates, written by the tech's browser.

```sql
CREATE TABLE tech_locations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id  uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  client_id      int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lat            double precision NOT NULL,
  lng            double precision NOT NULL,
  recorded_at    timestamptz DEFAULT now()
);

-- Only keep latest N rows per tech (managed via trigger or scheduled cleanup)
ALTER TABLE tech_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tech_insert_own_location" ON tech_locations
  FOR INSERT WITH CHECK (
    technician_id = (SELECT id FROM technicians WHERE email = auth.email())
  );

CREATE POLICY "client_read_tech_locations" ON tech_locations
  FOR SELECT USING (
    client_id = (SELECT id FROM clients WHERE email = auth.email())
  );
```

---

### 2. Auth Flow

On login, `App.jsx` performs a three-step lookup in order:

1. **Check `clients`** by email → if found and `is_admin`, route to Admin view; if found (owner), route to main dashboard
2. **Check `client_staff`** by email → if found and `active`, route to main dashboard with dispatcher permissions (no Billing tab, no Settings tab)
3. **Check `technicians`** by email → if found and `active`, route to `<TechDashboard />`
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

Jobs are fetched from the `appointments` table filtered by `client_id`, assigned tech, and today's date. Status badge colors: yellow = pending, blue = en route, green = complete.

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
│  │       NAVIGATE          │    │  → opens native maps deep link
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │      ON MY WAY          │    │  → starts GPS, updates status
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │    MARK COMPLETE        │    │  → updates appointment status
│  └─────────────────────────┘    │
└─────────────────────────────────┘
```

**Button behaviors:**

- **NAVIGATE** — Opens native maps app via deep link:
  `https://maps.google.com/?daddr=<encoded address>` (universal; iOS will offer Apple Maps or Google Maps)

- **ON MY WAY** — Updates appointment status to `en_route`. In Phase 2: starts browser Geolocation API polling (every 30s), writes coordinates to `tech_locations`. In Phase 1, GPS is not active yet — button only updates status.

- **MARK COMPLETE** — Updates appointment status to `complete`. Confirms with a brief toast.

Buttons that are disabled by permissions are not shown — they are fully hidden, not grayed out.

---

### 4. Client-Side Changes

#### Settings Tab additions (owner only)

**Technician Features section** — per-tech permission toggles:

For each tech, a list of toggleable features:
- Job Notes (show/hide notes on job detail)
- Mark Complete
- GPS Tracking *(Phase 2)*
- Customer SMS Notifications *(Phase 2)*
- Customer Tracking Link *(Phase 2)*

Stored in `technician_permissions`. Default: all enabled on tech creation.

**Team Members section** — dispatcher management:

- List of active dispatchers (name, email, status)
- "Invite Dispatcher" button → sends Supabase auth invite email, creates `client_staff` row
- Tap a dispatcher → deactivate / reactivate (no delete, preserves audit trail)
- Dispatchers cannot see this section

#### Team Tab (new tab in client bottom nav)

**Phase 1 — List view only:**

- List of all techs (name, phone, active/inactive)
- "Add Tech" button → form: name, email, phone → creates `technicians` row → sends Supabase auth invite
- Tap a tech → edit details, toggle active, manage their feature permissions

**Phase 2 — Map | List toggle at top:**

Map view (Mapbox GL JS):
- Centered on client's service area (derived from job addresses or configurable location)
- Live tech pins — labeled with name, updated every ~30s via Supabase Realtime subscription on `tech_locations`
- Customer pins for today's jobs — color-coded by status (pending/en route/complete)
- Tap a tech pin → shows name + current job
- Tap a customer pin → shows job details and assigned tech
- Map is read-only; job assignment is done via the appointments workflow

---

## Phase 2

### GPS Tracking

When a tech taps "On My Way":
1. App calls `navigator.geolocation.watchPosition()` with 30s interval
2. Each position update writes a row to `tech_locations` via Supabase client
3. Client's dispatch map subscribes to `tech_locations` via Supabase Realtime and updates pins live
4. GPS tracking stops when tech taps "Mark Complete" or closes the app (PWA lifecycle)
5. `tech_locations` rows older than 24 hours are pruned by a scheduled Supabase function

Only runs if `gps_tracking` permission is enabled for the tech.

### Customer SMS Notification

When a tech taps "On My Way":
1. A Supabase Edge Function `send-tech-sms` is called with `appointment_id`
2. Function fetches customer phone + tech name + ETA (calculated via Mapbox Directions API using tech's current lat/lng and job address)
3. Sends SMS via Twilio: *"Hi [Customer Name], [Tech Name] is on the way and should arrive in approximately [X] minutes."*
4. If no ETA available (GPS not yet active or Mapbox error), sends without ETA: *"...is on the way."*

Only runs if `customer_sms` permission is enabled for the tech.

### Customer Tracking Link

A separate public page (no auth required): `/track?job=<appointment_id>`

Rendered by a new component `src/TrackingPage.jsx`:

```
┌─────────────────────────────────┐
│  Reliant Support                │
│                                 │
│  [Tech Name] is on the way      │
│                                 │
│  ┌─────────────────────────┐    │
│  │   [MAPBOX MAP]          │    │
│  │   Tech pin (moving)     │    │
│  │   Your location pin     │    │
│  └─────────────────────────┘    │
│                                 │
│  Estimated arrival: 12 min      │
│  Last updated: 2 min ago        │
└─────────────────────────────────┘
```

- Map updates every 30s by polling `tech_locations` for the assigned tech
- ETA recalculates on each update via Mapbox Directions API
- Page is accessible via a link sent in the SMS
- The `appointment_id` is a UUID — not guessable, sufficient as access control for this use case

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
| On My Way button | ❌ | ❌ | ✅ (if permitted) |
| Mark Complete | ❌ | ❌ | ✅ (if permitted) |

---

## Tech Stack Additions

| Concern | Tool |
|---|---|
| Mapping (dispatch map + tracking page) | Mapbox GL JS (free tier: 50k map loads/month) |
| Routing / ETA | Mapbox Directions API |
| SMS | Twilio (~$0.01/text) |
| GPS | Browser Geolocation API (`navigator.geolocation.watchPosition`) |
| Real-time location updates | Supabase Realtime (Postgres changes on `tech_locations`) |
| Deep link (navigation) | Universal `maps.google.com/?daddr=` URL |

---

## Out of Scope (Phase 1 + 2)

- Job creation by techs (read-only job list)
- In-app messaging between tech and dispatcher
- Photo uploads from job site
- Offline mode / service worker job caching
- Payroll or time tracking
- Native mobile app (iOS/Android) — PWA only

---

## Success Criteria

**Phase 1:**
- A tech can log in on their phone, see today's assigned jobs, tap Navigate to get directions, and mark a job complete
- A client owner can add techs, invite dispatchers, and configure per-tech feature permissions
- A dispatcher can log in and see the full job/customer view but cannot access Billing or Settings

**Phase 2:**
- When a tech taps "On My Way," their live location appears on the client's dispatch map within 60 seconds
- The customer receives an SMS with an ETA and a tracking link that updates in real time
- The client can see all techs on the map simultaneously with color-coded job status pins
