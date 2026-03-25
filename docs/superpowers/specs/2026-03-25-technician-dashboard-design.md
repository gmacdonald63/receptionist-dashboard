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

The public customer tracking page is handled by a synchronous URL-param check in the `App.jsx` render function — before any `useEffect` fires and before the auth check — so no router library is needed.

---

## Existing Schema Notes

**Technicians table** — already exists: `id` (integer serial), `client_id` (integer), `name`, `phone`, `color`, `is_active` (boolean). The `appointments` table stores `technician_id` as an integer FK.

**Appointments table column names:** The customer name column is `caller_name` (not `customer_name`). Any code referencing appointment records must use `apt.caller_name`.

**Appointment status values:** Currently in use: `confirmed` (booked). New statuses added in Phase 1: `en_route`, `complete`. No enum constraint — free-text values. The existing appointments view currently uses `.neq('status', 'cancelled')`. That filter should be updated to `.not('status', 'in', '("cancelled")')` to remain inclusive of new statuses. The tech dashboard uses `.in('status', ['confirmed', 'en_route', 'complete'])` intentionally — only explicitly recognized statuses appear to techs.

**Existing bottom nav tabs** (owner view): `appointments`, `customers`, `calls`, `billing`, `settings`. Phase 1 adds a `team` tab.

---

## Phase 1

### 1. Database Migrations

#### Migration A: add `email` and RLS to `technicians`

```sql
-- Add email column
ALTER TABLE technicians ADD COLUMN email text UNIQUE;

-- Enable RLS
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;

-- Clients manage their own techs (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "client_manage_own_techs" ON technicians
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );

-- Techs read their own row (email must be set and is_active must be true)
CREATE POLICY "tech_read_own" ON technicians
  FOR SELECT USING (
    is_active = true
    AND email IS NOT NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );
```

**Existing tech rows:** After this migration, all existing rows have `email = NULL` and cannot log in until an email is added via the updated form. This does not affect existing owner functionality.

**Email requirement:** Required for new techs. Optional when editing existing ones (tech cannot log in until set).

#### Migration B: RLS additions for `appointments`

```sql
-- Verify RLS is enabled before running. If not: ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
-- Then audit existing client/admin policies to ensure they still work.
--
-- Column-level note: FOR UPDATE RLS does not restrict which columns can be written.
-- Techs could technically update any column on their assigned appointment row.
-- For Phase 1 this is an acceptable trust boundary (techs are known employees,
-- app only sends status updates). To restrict: GRANT UPDATE (status) ON appointments TO authenticated;
-- and revoke broader UPDATE — but only if column-level grants are configured for all other roles too.

-- Techs read appointments assigned to them
CREATE POLICY "tech_read_own_appointments" ON appointments
  FOR SELECT USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email IS NOT NULL
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Techs update status on their assigned appointments
CREATE POLICY "tech_update_own_appointment_status" ON appointments
  FOR UPDATE
  USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email IS NOT NULL
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email IS NOT NULL
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );
```

#### Migration C: `technician_permissions` table

```sql
CREATE TABLE technician_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id  int  NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  client_id      int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  feature        text NOT NULL,
  -- Phase 1 values: 'job_notes' | 'on_my_way' | 'mark_complete'
  -- Phase 2 values: 'gps_tracking' | 'customer_sms' | 'customer_tracking_link'
  enabled        bool NOT NULL DEFAULT true,
  UNIQUE(technician_id, feature)
);

ALTER TABLE technician_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tech_read_own_permissions" ON technician_permissions
  FOR SELECT USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "client_manage_tech_permissions" ON technician_permissions
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

**Default when rows are missing (Phase 1 features):**
```js
const isAllowed = (permissions, feature) => permissions.find(p => p.feature === feature)?.enabled ?? true;
```

**Default when rows are missing (Phase 2 features):** Phase 2 features explicitly default to `false`:
```js
const isPhase2 = ['gps_tracking', 'customer_sms', 'customer_tracking_link'];
const isAllowed = (permissions, feature) => {
  const row = permissions.find(p => p.feature === feature);
  if (row) return row.enabled;
  return !isPhase2.includes(feature); // Phase 1 default on, Phase 2 default off
};
```

**On new tech creation**, the save action inserts these rows:
- `job_notes`: `enabled: true`
- `on_my_way`: `enabled: true`
- `mark_complete`: `enabled: true`
- `gps_tracking`: `enabled: false`
- `customer_sms`: `enabled: false`
- `customer_tracking_link`: `enabled: false`

**Backfill migration for existing techs:** Run once when Phase 2 ships to insert `enabled: false` rows for all existing techs that don't already have Phase 2 permission rows:

```sql
INSERT INTO technician_permissions (technician_id, client_id, feature, enabled)
SELECT t.id, t.client_id, f.feature, false
FROM technicians t
CROSS JOIN (VALUES ('gps_tracking'), ('customer_sms'), ('customer_tracking_link')) AS f(feature)
WHERE NOT EXISTS (
  SELECT 1 FROM technician_permissions tp
  WHERE tp.technician_id = t.id AND tp.feature = f.feature
);
```

#### Migration D: `client_staff` table

```sql
CREATE TABLE client_staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   int  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email       text NOT NULL,
  UNIQUE(client_id, email),  -- same person can be dispatcher for multiple clients
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
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

---

### 2. Auth Flow

**Role resolution lives entirely in `useEffect([user])`** — this is the single source of truth, triggered by every auth path (page load via `getSession`, email/password login via `Login.jsx`, and invite-link completion via `onAuthStateChange SIGNED_IN`):

```js
useEffect(() => {
  if (!user) return;

  const resolveRole = async () => {
    const email = user.email;

    // Step 1: owner / admin
    const { data: clientRecord } = await supabase
      .from('clients').select('*').eq('email', email).maybeSingle();
    if (clientRecord) {
      setRole(clientRecord.is_admin ? 'admin' : 'owner');
      setClientData(clientRecord);
      setAuthLoading(false);
      return;
    }

    // Step 2: dispatcher
    const { data: staffRecord } = await supabase
      .from('client_staff').select('*').eq('email', email).eq('active', true).maybeSingle();
    if (staffRecord) {
      const { data: ownerData } = await supabase
        .from('clients').select('*').eq('id', staffRecord.client_id).single();
      setRole('dispatcher');
      setClientData(ownerData);
      setAuthLoading(false);
      return;
    }

    // Step 3: technician
    const { data: techRecord } = await supabase
      .from('technicians').select('*').eq('email', email).eq('is_active', true).maybeSingle();
    if (techRecord) {
      setRole('tech');
      setTechData(techRecord);
      setAuthLoading(false);
      return;
    }

    // Step 4: no match — sign out
    await supabase.auth.signOut();
    setAuthLoading(false);
  };

  resolveRole();
}, [user]);
```

**Changes required by this approach:**

- **`getSession` block:** Remove the `clients` lookup and force sign-out entirely. Just call `setUser(session.user)` (or skip if `?track` is present — see Section 3). `setAuthLoading(false)` moves inside `resolveRole` at each branch.
- **`onAuthStateChange`:** Unchanged. When `SIGNED_IN` fires (invite link), `setUser` is called at line 155, which re-triggers `useEffect([user])` → role is resolved automatically.
- **`Login.jsx`:** Remove the `clients` lookup. Just call `supabase.auth.signInWithPassword` and on success call `onLogin(user)` — no clientData needed. The `useEffect([user])` in App.jsx handles the rest.
- **`handleLogin` in `App.jsx`:** Simplify to `(user) => setUser(user)`.

App state shape:
```js
{ user, role: 'admin' | 'owner' | 'dispatcher' | 'tech', clientData, techData? }
```

**Deactivated techs:** RLS subqueries include `is_active = true`, so deactivated tech queries return no data after next token refresh. Session expires naturally (~1 hour). Immediate lockout is a Phase 2 concern.

**`clients` RLS subquery multi-row safety:** `clients.email` is unique — subqueries always return 0 or 1 rows.

---

### 3. URL Param Handling

The `?track=<uuid>` check is handled in two places: (a) in the `getSession` block — skip `setUser` and set `authLoading(false)` immediately so no role lookup fires for the unauthenticated tracking visitor, and (b) synchronously in the render function before the `authLoading` spinner gate:

```jsx
function App() {
  // ... all useState/useEffect hooks must still run (React rules) ...

  // Priority 1: public tracking page — before authLoading gate
  const searchParams = new URLSearchParams(window.location.search);
  const trackingId = searchParams.get('track');
  if (trackingId) {
    return <TrackingPage appointmentId={trackingId} />;
  }

  // Existing authLoading gate follows
  if (authLoading || demoLoading) return <spinner />;
  // ...
}
```

Note: All `useState`/`useEffect` calls must remain above the early return (React rules of hooks). Only the *render output* short-circuits.

If `?track` and `?demo` are both present, `?track` wins. `?billing=success` useEffect is safe — it only runs when `user` is set, which techs and dispatchers can have; however it queries `clients` directly. Dispatchers have a `clients` row via `clientData`, so they are safe. Techs don't hit this useEffect because they have no `?billing` redirect path.

**Render waterfall — tech short-circuit:**
The existing guard `if (user && !clientData)` (line 1783) would show "No Account Found" for techs since they set `techData`, not `clientData`. Add a role check before this guard:

```jsx
// After: if (!user) return <Login />
// Before: if (user && !clientData) return <NoAccountFound />

if (role === 'tech' && techData) {
  return <TechDashboard techData={techData} />;
}
```

---

### 4. Tech Dashboard — Mobile UI

New component: `src/TechDashboard.jsx`. Same dark theme (`bg-gray-900`, `text-white`), mobile-first, minimum 44px touch targets.

**Data query:**
```js
supabase
  .from('appointments')
  .select('*')
  .eq('client_id', techData.client_id)   // defense-in-depth; RLS also filters by technician_id
  .eq('technician_id', techData.id)       // both integers
  .eq('date', todayISO)
  .in('status', ['confirmed', 'en_route', 'complete'])
  .order('start_time', { ascending: true })
```

Note: `technician_id` integers are globally unique (serial PK), so `client_id` is redundant but kept as an explicit safety guard.

Status display: `confirmed` → yellow "PENDING" | `en_route` → blue "EN ROUTE" | `complete` → green "COMPLETE"

**States:**
- Loading: skeleton placeholder cards
- Empty: "No jobs scheduled for today."
- Error: "Could not load your jobs. Pull down to retry." + retry button

#### Job Detail

Customer name displayed from `apt.caller_name`.

- **NAVIGATE** — Always shown. `https://maps.google.com/?daddr=<encodeURIComponent(address + ' ' + city + ' ' + state + ' ' + zip)>`
- **ON MY WAY** — Shown if `on_my_way` permitted AND status is `confirmed`. Updates status → `en_route`.
- **MARK COMPLETE** — Shown if `mark_complete` permitted AND status is not `complete`. Updates status → `complete` with toast.
- **Job Notes** — Section visible only if `job_notes` permitted.

All hidden elements are removed from the DOM entirely.

---

### 5. Technician Form Updates

The existing `techForm` (name, phone, color) adds:
- **Email field** — required for new techs, optional for editing existing ones
- **"Send invite" checkbox** — default checked for new techs

**Save action order:**
1. Insert/update `technicians` row
2. If new tech: insert default `technician_permissions` rows (all 6 features)
3. If invite is checked: call `invite-user` Edge Function (see below)

**Invite Edge Function (`invite-user`):**
Client-side Supabase cannot call `auth.admin.inviteUserByEmail` (requires service role key). A new Edge Function handles this:

```
POST /functions/v1/invite-user
Body: { email, name, role }   // role: 'tech' | 'dispatcher'
```

The function:
1. Checks `auth.admin.listUsers()` to see if the email already exists in `auth.users`
2. If user exists: returns `{ existing: true }` — app shows: *"An account with this email already exists. They can log in immediately."*
3. If user does not exist: calls `auth.admin.inviteUserByEmail(email)` and returns success

**Atomicity:** The DB row is saved first. If the invite Edge Function fails, a non-blocking warning is shown: *"Tech saved, but the invite email could not be sent. You can resend it by editing the tech."* The DB row is not rolled back. Same pattern for dispatcher invites.

---

### 6. Tab Structure

**Owner tab order:** `appointments` | `customers` | `calls` | `team` | `billing` | `settings` (6 tabs)

`team` is inserted between `calls` and `billing`.

**`grid-cols` update required:** The existing bottom nav uses `grid grid-cols-5` in two places (lines 1745 and 1998 in `App.jsx`). This class must be made dynamic based on the number of tabs visible for the current role: `grid-cols-6` for owners (6 tabs), `grid-cols-4` for dispatchers (4 tabs). Use `grid-cols-${navItems.length}` where `navItems` is the filtered array of visible tabs.

**Dispatcher tab visibility:**

| Tab | Owner | Dispatcher |
|---|---|---|
| Appointments | ✅ | ✅ |
| Customers | ✅ | ✅ |
| Calls | ✅ | ✅ |
| Team | ✅ (manage) | ✅ (view only) |
| Billing | ✅ | ❌ hidden |
| Settings | ✅ | ❌ hidden |

Dispatchers see Calls — read-only, same as the existing calls view.

**Team tab — owner view:** Full CRUD on techs + permission management. "Add Tech" button.

**Team tab — dispatcher view (read-only):** Same tech list (name, phone, active/inactive). No "Add Tech" button. Tapping a tech shows details but no edit controls.

**Phase 2:** Map | List toggle added to Team tab for both owner and dispatcher.

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
      WHERE is_active = true
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "client_read_tech_locations" ON tech_locations
  FOR SELECT USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

**Pruning:** A new Edge Function `prune-tech-locations` runs on a daily schedule (Supabase pg_cron or scheduled function, `0 3 * * *` — 3 AM daily):

```sql
DELETE FROM tech_locations WHERE recorded_at < now() - interval '24 hours';
```

### GPS Tracking

On My Way (if `gps_tracking` + `on_my_way` both enabled): calls `navigator.geolocation.watchPosition()`, writes each position to `tech_locations`. Stops on Mark Complete (`clearWatch()`).

**iOS limitation (known constraint):** `watchPosition` stops when PWA is backgrounded on iOS (~30 seconds). Techs must keep the app in the foreground while driving. Background sync is out of scope.

### Customer SMS

On My Way (if `customer_sms` enabled): calls Edge Function `send-tech-sms` with `appointment_id`. Fetches `caller_name` + phone, calculates ETA via Mapbox Directions API, sends via Twilio. Appends tracking URL if `customer_tracking_link` also enabled.

### Customer Tracking Link

`?track=<appointment_id>` renders `<TrackingPage>` synchronously (see Section 3).

**Data model:** `TrackingPage` calls Edge Function `get-tracking-data` (service role, no caller auth required):

```
POST /functions/v1/get-tracking-data
Body: { appointment_id: "<uuid>" }
Returns: { tech_name, lat, lng, recorded_at, job_address, eta_minutes }
```

Function validates the UUID, fetches the appointment + assigned tech's latest `tech_locations` row + job address, calls Mapbox Directions API for ETA. The UUID is the access control — not guessable.

Mapbox map: tech pin (moving) + destination pin (job address). Polls every 30s. ETA recalculates each poll.

URL: `https://app.reliantsupport.net/?track=<appointment_id>` — compatible with existing Vercel SPA rewrite.

---

## Permissions Matrix

| Feature | Owner | Dispatcher | Tech |
|---|---|---|---|
| Appointments tab | ✅ full | ✅ full | ❌ |
| Customers tab | ✅ full | ✅ full | ❌ |
| Calls tab | ✅ full | ✅ read-only | ❌ |
| Team tab | ✅ manage | ✅ view only | ❌ |
| Billing tab | ✅ | ❌ hidden | ❌ |
| Settings tab | ✅ | ❌ hidden | ❌ |
| Assign jobs to techs | ✅ | ✅ | ❌ |
| Today's Jobs view | ❌ | ❌ | ✅ |
| Navigate | ❌ | ❌ | ✅ always |
| On My Way | ❌ | ❌ | ✅ if on_my_way permitted |
| Mark Complete | ❌ | ❌ | ✅ if mark_complete permitted |
| Job Notes | ❌ | ❌ | ✅ if job_notes permitted |

---

## Tech Stack Additions

| Concern | Tool |
|---|---|
| Mapping | Mapbox GL JS |
| Routing / ETA | Mapbox Directions API |
| SMS | Twilio (~$0.01/text) |
| GPS | Browser Geolocation API |
| Real-time location | Supabase Realtime |
| Navigation deep link | `maps.google.com/?daddr=` |
| Tracking page data | Edge Function `get-tracking-data` |
| Auth invite (server-side) | Edge Function `invite-user` |
| Location pruning | Edge Function `prune-tech-locations` (daily cron) |

---

## Out of Scope

- Job creation by techs
- In-app messaging
- Photo uploads
- Offline mode / service worker caching
- Payroll / time tracking
- Native mobile app — PWA only
- Background GPS on iOS when app minimized
- Immediate session invalidation on tech deactivation

---

## Success Criteria

**Phase 1:**
- A tech can log in on their phone, see today's assigned jobs, navigate to a job, mark On My Way, and mark Complete
- A client owner can add techs with email (invite sent server-side), invite dispatchers, and configure each tech's permissions independently per button
- A dispatcher can log in, see Appointments/Customers/Calls/Team, assign jobs — no Billing or Settings

**Phase 2:**
- Tech's live location appears on dispatch map within 60 seconds of On My Way (app foregrounded)
- Customer receives SMS with ETA and a tracking link showing the tech's live position on Mapbox
- Client sees all active techs on dispatch map simultaneously with color-coded job status pins
