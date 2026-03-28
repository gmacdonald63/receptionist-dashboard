# Location & Mapping Phase — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live dispatcher map, GPS broadcasting from tech devices, customer tracking SMS links, and tech dashboard redesign to the Reliant Support dashboard.

**Architecture:** App.jsx (2154 lines) is extracted into DispatcherDashboard.jsx (all dashboard UI/state/fetch logic) reducing App.jsx to ~400 lines (auth + role routing only). Four new tables are added via migration (tech_locations, tracking_tokens, client_destinations, plus geocoding/Twilio columns on existing tables). TechDashboard gets day navigation, redesigned job cards, and permission-gated detail views. A Leaflet-based Map tab is added to DispatcherDashboard with Supabase Realtime. Four new Edge Functions handle geocoding, token generation, tracking data, and Twilio SMS. A public TrackingPage provides customer-facing live tracking.

**Tech Stack:** React 18, Vite, Tailwind CSS, Supabase JS (existing), Leaflet 1.x + React-Leaflet 4.x (new), Stadia Maps tiles ($20/month Starter, `VITE_STADIA_API_KEY`), Google Geocoding API (`GOOGLE_GEOCODING_API_KEY` Supabase secret), Twilio REST API (credentials per client in `clients` table), Vitest (already installed, `environment: 'node'`)

---

## Chunk 1: Foundation

### Task 1: Verify Test Runner + Write Baseline Test

Vitest is already installed (`package.json` has `"test": "vitest run"`). Confirm it works before writing any code.

**Files:**
- Create: `src/utils/__tests__/baseline.test.js`

- [ ] **Step 1: Create the test file**

```javascript
// src/utils/__tests__/baseline.test.js
import { describe, it, expect } from 'vitest';

describe('baseline', () => {
  it('test runner is working', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run it**

```
npm test
```

Expected: `1 passed` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/baseline.test.js
git commit -m "test: add baseline test to verify vitest is operational"
```

---

### Task 2: Extract DispatcherDashboard.jsx from App.jsx

App.jsx is 2154 lines. All dashboard UI, state, and data-fetching logic moves to `DispatcherDashboard.jsx`. App.jsx becomes auth + URL detection + role routing only (~400 lines).

**Note on TDD for this task:** This is a pure extraction refactor — no new behavior is introduced. The Vitest environment is `node` (not jsdom), so React component render tests cannot run without adding `@testing-library/react` + jsdom. Adding that dependency is deferred until later tasks introduce testable logic. The acceptance test here is manual: the app loads and all existing functionality works after extraction. Unit tests for new component behavior begin in Task 6.

**Files:**
- Create: `src/DispatcherDashboard.jsx`
- Modify: `src/App.jsx`

**DispatcherDashboard props interface:**
```jsx
<DispatcherDashboard
  user={user}
  clientData={clientData}
  role={role}
  demoMode={demoMode}
  demoClientData={demoClientData}
  isPublicDemo={isPublicDemo}
  demoToken={demoToken}
  demoExpiresAt={demoExpiresAt}
/>
```

**What stays in App.jsx:**
- Auth state: `user`, `clientData`, `authLoading`, `role`, `techData`, `showAdmin`, `showResetPassword`
- Demo detection state: `demoMode`, `demoClientData`, `isPublicDemo`, `demoToken`, `demoExpiresAt`, `demoLoading`
- Initial `useEffect` for URL params (`#type=invite`, `?track`, `?activate`, `?rep-invite`)
- `supabase.auth.onAuthStateChange` subscription
- Demo token validation `useEffect` (`?demo=TOKEN`)
- Role-resolution `useEffect` (triggered on `user` change)
- The `return` statement routing to `<Login>`, `<Admin>`, `<ResetPassword>`, `<TechDashboard>`, `<DispatcherDashboard>`, `<OnboardingPage>`, `<ActivationPage>`, `<RepSetPasswordPage>`, `<SalesRepDashboard>`, `<TrackingPage>` (added Task 17)

**What moves to DispatcherDashboard.jsx:**
Everything else — all `activeTab`, `callLogs`, `appointments`, `stats`, `loading`, `businessHours`, `technicians`, `serviceTypes`, `reminderCount` state; all billing state; all data-fetching functions; all render functions (`renderAppointments`, `renderCallLogs`, `renderBilling`, `renderSettings`); the main dashboard JSX. Delete dead `showAddTech`/`editingTechId`/`techForm`/`savingTech` state (Settings tech section was already removed).

**`effectiveClientData` note:** In the current App.jsx, search for `const effectiveClientData` — it is a derived value defined near the top of the App component as `const effectiveClientData = demoMode && demoClientData ? demoClientData : clientData;`. Move this line verbatim into DispatcherDashboard.jsx (computed from the same-named props). Remove it from App.jsx entirely.

- [ ] **Step 1: Create DispatcherDashboard.jsx**

Copy all dashboard logic from App.jsx. Accept the props listed above. Delete the dead tech management state. Internal `effectiveClientData` computed from props.

- [ ] **Step 2: Reduce App.jsx to auth + routing**

Strip App.jsx to auth state, URL detection, role resolution, and routing return. Render `<DispatcherDashboard ... />` where it previously rendered the full dashboard inline.

- [ ] **Step 3: Verify the app loads**

```
npm run dev
```

Log in as owner. Verify all 4 tabs render, appointments load, Settings shows no Technicians section, tech login still routes to TechDashboard. Also verify demo mode: append `?demo=TEST` to the URL and confirm the demo loading path does not crash.

- [ ] **Step 4: Commit**

```bash
git add src/DispatcherDashboard.jsx src/App.jsx
git commit -m "refactor: extract DispatcherDashboard.jsx from App.jsx, reduce App to auth+routing"
```

---

### Task 3: Database Migration

**Files:**
- Create: `supabase/migrations/20260328001_location_mapping.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260328001_location_mapping.sql

-- ── tech_locations ─────────────────────────────────────────────────────────
CREATE TABLE tech_locations (
  technician_id   INT           PRIMARY KEY REFERENCES technicians(id) ON DELETE CASCADE,
  client_id       INT           NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lat             NUMERIC(10,7) NOT NULL,
  lng             NUMERIC(10,7) NOT NULL,
  accuracy_meters NUMERIC(6,1),
  heading         NUMERIC(5,2),
  speed_kmh       NUMERIC(6,2),
  non_job_status  TEXT,
  recorded_at     TIMESTAMPTZ   NOT NULL,
  received_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE tech_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tech_locations_select_dispatcher"
  ON tech_locations FOR SELECT USING (
    client_id IN (
      SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
      UNION
      SELECT id FROM clients WHERE email = auth.email()
    )
  );

CREATE POLICY "tech_locations_insert_tech"
  ON tech_locations FOR INSERT WITH CHECK (
    technician_id IN (
      SELECT id FROM technicians WHERE email = auth.email() AND is_active = true
    )
  );

CREATE POLICY "tech_locations_update_tech"
  ON tech_locations FOR UPDATE USING (
    technician_id IN (
      SELECT id FROM technicians WHERE email = auth.email() AND is_active = true
    )
  );

-- ── upsert_tech_location (conditional upsert guard) ────────────────────────
-- Prevents out-of-order delivery from overwriting a newer position with an older one.
-- SECURITY INVOKER: RLS still applies; caller must be authenticated.
CREATE OR REPLACE FUNCTION upsert_tech_location(
  p_technician_id   INT,
  p_client_id       INT,
  p_lat             NUMERIC,
  p_lng             NUMERIC,
  p_accuracy        NUMERIC,
  p_heading         NUMERIC,
  p_speed_kmh       NUMERIC,
  p_non_job_status  TEXT,
  p_recorded_at     TIMESTAMPTZ
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO tech_locations (
    technician_id, client_id, lat, lng, accuracy_meters,
    heading, speed_kmh, non_job_status, recorded_at
  )
  VALUES (
    p_technician_id, p_client_id, p_lat, p_lng, p_accuracy,
    p_heading, p_speed_kmh, p_non_job_status, p_recorded_at
  )
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
END;
$$;

-- ── tracking_tokens ────────────────────────────────────────────────────────
CREATE TABLE tracking_tokens (
  token           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  appointment_id  UUID        NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  technician_id   INT         NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  client_id       INT         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked         BOOL        NOT NULL DEFAULT false
);

ALTER TABLE tracking_tokens ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT policies for `anon` or `authenticated` — all reads and inserts go
-- through service-role Edge Functions (generate-tracking-token, get-tracking-data).
-- Exception: techs need to revoke their own tokens when marking a job complete.
CREATE POLICY "techs revoke own tracking tokens"
ON tracking_tokens FOR UPDATE
TO authenticated
USING (
  technician_id IN (
    SELECT id FROM technicians WHERE email = auth.email()
  )
)
WITH CHECK (revoked = true);  -- only allows setting revoked=true, never false

-- ── client_destinations ───────────────────────────────────────────────────
CREATE TABLE client_destinations (
  id          SERIAL  PRIMARY KEY,
  client_id   INT     NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label       TEXT    NOT NULL,
  sort_order  INT     NOT NULL DEFAULT 0,
  is_active   BOOL    NOT NULL DEFAULT true
);

ALTER TABLE client_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_destinations_select"
  ON client_destinations FOR SELECT USING (
    client_id IN (
      SELECT client_id FROM client_staff WHERE email = auth.email() AND is_active = true
      UNION
      SELECT id FROM clients WHERE email = auth.email()
      UNION
      SELECT client_id FROM technicians WHERE email = auth.email() AND is_active = true
    )
  );

CREATE POLICY "client_destinations_owner_write"
  ON client_destinations FOR ALL USING (
    client_id IN (SELECT id FROM clients WHERE email = auth.email())
  );

-- Seed default destinations for all existing clients
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM clients LOOP
    INSERT INTO client_destinations (client_id, label, sort_order)
    VALUES
      (r.id, 'Parts Supplier', 1),
      (r.id, 'Office',         2),
      (r.id, 'Lunch',          3),
      (r.id, 'Done for the Day', 4)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- ── appointments — add geocoding columns ──────────────────────────────────
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS job_lat        NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS job_lng        NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS geocode_status TEXT DEFAULT 'pending';

-- ── clients — add Twilio columns ──────────────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS twilio_account_sid  TEXT,
  ADD COLUMN IF NOT EXISTS twilio_auth_token   TEXT,
  ADD COLUMN IF NOT EXISTS twilio_from_number  TEXT;
```

- [ ] **Step 2: Apply in Supabase SQL Editor**

Paste and run the migration. Then verify:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('tech_locations', 'tracking_tokens', 'client_destinations');
-- Expected: 3 rows

SELECT column_name FROM information_schema.columns
WHERE table_name = 'appointments'
AND column_name IN ('job_lat', 'job_lng', 'geocode_status');
-- Expected: 3 rows
```

- [ ] **Step 3: Commit migration file**

```bash
git add supabase/migrations/20260328001_location_mapping.sql
git commit -m "feat: add location mapping schema — tech_locations, tracking_tokens, client_destinations"
```

---

### Task 4: Install Leaflet + Create Stub Files

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `src/main.jsx`
- Create: `src/utils/leafletIconFix.js`
- Create stubs: `src/utils/locationService.js`, `src/components/DispatcherMap.jsx`, `src/pages/TrackingPage.jsx`
- Create stubs: all 4 Edge Functions

- [ ] **Step 1: Install Leaflet**

```bash
npm install leaflet react-leaflet
```

- [ ] **Step 2: Add Leaflet icon fix file + import it from DispatcherMap**

The Leaflet CSS will be imported inside `DispatcherMap.jsx` (not globally in main.jsx) to avoid adding map CSS to routes that don't use the map. The icon fix is a one-time side-effect import.

Create the fix file:
```javascript
// src/utils/leafletIconFix.js
import L from 'leaflet';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });
```

Note: `DispatcherMap.jsx` (Task 11) will import both at the top:
```javascript
import 'leaflet/dist/leaflet.css';
import '../utils/leafletIconFix';
```

Do NOT add these imports to main.jsx — keep them scoped to the map component.

- [ ] **Step 3: Commit Leaflet install + icon fix** (before stub files)

```bash
git add src/utils/leafletIconFix.js package.json package-lock.json
git commit -m "feat: install leaflet + react-leaflet, add icon fix utility"
```

- [ ] **Step 4: Create stub files**

```javascript
// src/utils/locationService.js
const locationService = {
  startTracking: async (techId, clientId) => { console.warn('locationService.startTracking — stub'); },
  stopTracking: () => { console.warn('locationService.stopTracking — stub'); },
};
export default locationService;
```

```jsx
// src/components/DispatcherMap.jsx
const DispatcherMap = ({ clientId }) => (
  <div className="flex items-center justify-center h-full text-gray-400">Map coming soon</div>
);
export default DispatcherMap;
```

```jsx
// src/pages/TrackingPage.jsx
const TrackingPage = ({ token }) => (
  <div className="min-h-screen bg-gray-900 flex items-center justify-center text-gray-400">
    Loading tracking information...
  </div>
);
export default TrackingPage;
```

```typescript
// supabase/functions/geocode-appointments/index.ts
Deno.serve(() => new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }));
```

```typescript
// supabase/functions/send-sms/index.ts
Deno.serve(() => new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }));
```

```typescript
// supabase/functions/generate-tracking-token/index.ts
Deno.serve(() => new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }));
```

```typescript
// supabase/functions/get-tracking-data/index.ts
Deno.serve(() => new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }));
```

- [ ] **Step 5: Verify build passes**

```
npm run build
```

Expected: no errors.

- [ ] **Step 6: Commit stub files** (separate from the Leaflet install commit in Step 3)

```bash
git add src/utils/locationService.js src/components/DispatcherMap.jsx \
  src/pages/TrackingPage.jsx \
  supabase/functions/geocode-appointments/index.ts \
  supabase/functions/send-sms/index.ts \
  supabase/functions/generate-tracking-token/index.ts \
  supabase/functions/get-tracking-data/index.ts
git commit -m "feat: create stub files for location mapping phase"
```

---

## Chunk 2: GPS Service + Tech Dashboard Redesign

### Task 5: locationService.js — GPS Broadcasting Module (TDD)

Standalone ES module. No React imports. Pure functions exported for testing; stateful GPS logic not exported.

**Files:**
- Modify: `src/utils/locationService.js` (replace stub)
- Create: `src/utils/__tests__/locationService.test.js`

- [ ] **Step 1: Write the failing tests first**

```javascript
// src/utils/__tests__/locationService.test.js
import { describe, it, expect } from 'vitest';
import { haversineMeters, shouldWriteLocation, isSaneSpeed } from '../locationService.js';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(43.6532, -79.3832, 43.6532, -79.3832)).toBe(0);
  });
  it('returns ~111km per degree of latitude', () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
  it('returns distance between two Toronto-area points (~3-5km)', () => {
    const d = haversineMeters(43.6532, -79.3832, 43.6800, -79.3400);
    expect(d).toBeGreaterThan(3000);
    expect(d).toBeLessThan(5000);
  });
});

describe('shouldWriteLocation', () => {
  it('returns true when no previous location exists', () => {
    expect(shouldWriteLocation(null, null, 43.6532, -79.3832)).toBe(true);
  });
  it('returns true when moved >=50 meters (~5 lat hundredths)', () => {
    expect(shouldWriteLocation(43.6532, -79.3832, 43.6537, -79.3832)).toBe(true);
  });
  it('returns false when moved <50 meters (~1 lat hundredth)', () => {
    expect(shouldWriteLocation(43.6532, -79.3832, 43.6533, -79.3832)).toBe(false);
  });
});

describe('isSaneSpeed', () => {
  it('returns true for null (stationary)', () => { expect(isSaneSpeed(null)).toBe(true); });
  it('returns true for 0 km/h', () => { expect(isSaneSpeed(0)).toBe(true); });
  it('returns true for 120 km/h (highway)', () => { expect(isSaneSpeed(120)).toBe(true); });
  it('returns false for 201 km/h (GPS noise)', () => { expect(isSaneSpeed(201)).toBe(false); });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```
npm test src/utils/__tests__/locationService.test.js
```

Expected: FAIL — `haversineMeters is not a function`

- [ ] **Step 3: Implement locationService.js**

```javascript
// src/utils/locationService.js
import { supabase } from '../supabaseClient.js';

// ── Pure helpers (exported for tests) ─────────────────────────────────────
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function shouldWriteLocation(lastLat, lastLng, newLat, newLng) {
  if (lastLat === null || lastLng === null) return true;
  return haversineMeters(lastLat, lastLng, newLat, newLng) >= 50;
}

export function isSaneSpeed(speedKmh) {
  if (speedKmh === null || speedKmh === undefined) return true;
  return speedKmh <= 200;
}

// ── Module state ──────────────────────────────────────────────────────────
let watchId = null, lastLat = null, lastLng = null, lastWrittenAt = null;
let heartbeatTimer = null, watchdogTimer = null, lastCallbackAt = null;
let wakeLock = null, activeTechId = null, activeClientId = null;
let isTracking = false, isStationary = false, stationaryStart = null;

// In-memory offline queue (spec: IndexedDB with 200-entry cap).
// In-memory is sufficient for most network blips; IndexedDB persistence is a post-launch upgrade.
const MAX_QUEUE = 200;
let offlineQueue = []; // each entry: [lat, lng, accuracy, heading, speedKmh, nonJobStatus, recordedAt]

async function flushOfflineQueue() {
  if (offlineQueue.length === 0) return;
  const toFlush = offlineQueue.splice(0); // take all and clear
  for (const args of toFlush) {
    try {
      const { error } = await supabase.rpc('upsert_tech_location', {
        p_technician_id:  activeTechId,
        p_client_id:      activeClientId,
        p_lat:            args[0], p_lng: args[1], p_accuracy: args[2],
        p_heading:        args[3], p_speed_kmh: args[4],
        p_non_job_status: args[5], p_recorded_at: args[6],
      });
      if (error) throw error;
    } catch {
      offlineQueue.unshift(...toFlush.slice(toFlush.indexOf(args))); // re-queue remaining on fail
      break;
    }
  }
}

async function writeLocation(lat, lng, accuracy, heading, speedKmh, nonJobStatus, recordedAt) {
  try {
    const { error } = await supabase.rpc('upsert_tech_location', {
      p_technician_id:  activeTechId,
      p_client_id:      activeClientId,
      p_lat:            lat,
      p_lng:            lng,
      p_accuracy:       accuracy ?? null,
      p_heading:        heading ?? null,
      p_speed_kmh:      speedKmh ?? null,
      p_non_job_status: nonJobStatus ?? null,
      p_recorded_at:    recordedAt,
    });
    if (error) throw error;
    lastLat = lat; lastLng = lng; lastWrittenAt = Date.now();
    // Flush any queued fixes now that we're back online
    if (offlineQueue.length > 0) flushOfflineQueue().catch(() => {});
  } catch (err) {
    console.error('[locationService] write failed, queuing:', err.message);
    if (offlineQueue.length < MAX_QUEUE) {
      offlineQueue.push([lat, lng, accuracy, heading, speedKmh, nonJobStatus, recordedAt]);
    }
  }
}

function handlePosition(pos) {
  if (!isTracking) return;
  lastCallbackAt = Date.now();
  const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
  const speedKmh = speed != null ? speed * 3.6 : null;
  const recordedAt = new Date(pos.timestamp).toISOString();

  if (!isSaneSpeed(speedKmh)) return;

  if (speedKmh !== null && speedKmh < 3) {
    if (!stationaryStart) stationaryStart = Date.now();
    if (Date.now() - stationaryStart > 60000) isStationary = true;
  } else {
    stationaryStart = null;
    if (isStationary) { isStationary = false; _registerWatch(true); }
  }

  const isForced = lastWrittenAt === null || Date.now() - lastWrittenAt > 60000;
  if (!isForced && !shouldWriteLocation(lastLat, lastLng, lat, lng)) return;
  writeLocation(lat, lng, accuracy, heading, speedKmh, null, recordedAt);
}

function handlePositionError(err) {
  console.warn('[locationService] GPS error:', err.code, err.message);
  if (err.code === 3 && !isStationary) _registerWatch(false); // TIMEOUT → low accuracy fallback
}

function _registerWatch(highAccuracy) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    handlePosition, handlePositionError,
    { enableHighAccuracy: highAccuracy, maximumAge: 15000, timeout: 10000 }
  );
}

const locationService = {
  async startTracking(techId, clientId) {
    if (!navigator?.geolocation) { console.warn('[locationService] Geolocation not available'); return; }
    if (isTracking) locationService.stopTracking();

    activeTechId = techId; activeClientId = clientId;
    isTracking = true; lastLat = null; lastLng = null; lastWrittenAt = null;
    lastCallbackAt = Date.now(); isStationary = false; stationaryStart = null;

    _registerWatch(true);

    // iOS watchdog: re-register if callbacks go silent >45s
    watchdogTimer = setInterval(() => {
      if (!isTracking) return;
      if (lastCallbackAt && Date.now() - lastCallbackAt > 45000) {
        console.warn('[locationService] iOS watchdog: re-registering GPS');
        _registerWatch(!isStationary);
      }
    }, 30000);

    // 60s heartbeat: force write even when stationary
    heartbeatTimer = setInterval(() => {
      if (!isTracking || lastLat === null) return;
      if (Date.now() - (lastWrittenAt ?? 0) > 55000) {
        writeLocation(lastLat, lastLng, null, null, null, null, new Date().toISOString());
      }
    }, 60000);

    try { wakeLock = await navigator.wakeLock?.request('screen'); }
    catch (e) { console.warn('[locationService] WakeLock unavailable:', e.message); }
  },

  stopTracking() {
    isTracking = false;
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (watchdogTimer)  { clearInterval(watchdogTimer);  watchdogTimer  = null; }
    wakeLock?.release().catch(() => {});
    wakeLock = null; activeTechId = null; activeClientId = null;
  },
};

export default locationService;
```

- [ ] **Step 4: Run tests — confirm PASS**

```
npm test src/utils/__tests__/locationService.test.js
```

Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add src/utils/locationService.js src/utils/__tests__/locationService.test.js
git commit -m "feat: implement locationService GPS module (TDD) — haversine filter, watchdog, heartbeat"
```

---

### Task 6: Tech Dashboard — Day Navigation

**Files:**
- Modify: `src/TechDashboard.jsx`

- [ ] **Step 1: Add date state + helpers**

Replace `const todayISO = new Date().toISOString().split('T')[0];` with:

```javascript
const todayISO = new Date().toISOString().split('T')[0];
const [selectedDate, setSelectedDate] = useState(todayISO);

const formatDisplayDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

const isPastDate    = selectedDate < todayISO;
const shiftDate = (days) => {
  const d = new Date(selectedDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  setSelectedDate(d.toISOString().split('T')[0]);
};
```

Update `fetchJobs` to use `selectedDate` instead of `todayISO`. Find the `.eq('date', todayISO)` line inside `fetchJobs` and change it to:

```javascript
.eq('date', selectedDate)
```

Add `selectedDate` to `useEffect` dependency array:

```javascript
useEffect(() => { fetchJobs(); }, [selectedDate]);
```

- [ ] **Step 2: Replace date display in header**

Replace the existing `<p className="text-xs text-gray-400 mt-0.5">` date line with:

```jsx
<div className="flex items-center gap-1 mt-1">
  <button
    onClick={() => shiftDate(-1)}
    className="p-2 hover:bg-gray-700 rounded-lg min-w-[48px] min-h-[48px] flex items-center justify-center"
    aria-label="Previous day"
  >
    <ChevronLeft className="w-5 h-5 text-gray-400" />
  </button>
  <button
    onClick={() => document.getElementById('tech-date-picker').showPicker?.()}
    className="flex-1 text-center text-sm text-gray-300 py-2"
  >
    {formatDisplayDate(selectedDate)}
    {selectedDate === todayISO && (
      <span className="ml-1 inline-block w-1.5 h-1.5 bg-blue-500 rounded-full align-middle" />
    )}
    {isPastDate && <span className="ml-1 text-gray-500 text-xs">(past)</span>}
  </button>
  <input
    id="tech-date-picker"
    type="date"
    value={selectedDate}
    onChange={e => setSelectedDate(e.target.value)}
    className="sr-only"
  />
  <button
    onClick={() => shiftDate(1)}
    className="p-2 hover:bg-gray-700 rounded-lg min-w-[48px] min-h-[48px] flex items-center justify-center"
    aria-label="Next day"
  >
    <ChevronRight className="w-5 h-5 text-gray-400" />
  </button>
</div>
```

Add `ChevronLeft` to the lucide-react import at the top of TechDashboard.jsx.

- [ ] **Step 3: Hide action buttons on past dates**

Pass `isPastDay={isPastDate}` to `<JobDetail />`. In `JobDetail`, replace the action buttons block:

```jsx
{isPastDay ? (
  <div className="text-center py-3">
    <span className="text-xs text-gray-500 bg-gray-700 px-3 py-1 rounded-full">View Only</span>
  </div>
) : (
  <div className="space-y-3">
    {/* Navigate button — unchanged */}
    {/* On My Way button — unchanged */}
    {/* Mark Complete button — unchanged */}
  </div>
)}
```

Update the `JobDetail` function signature: `const JobDetail = ({ apt, permissions, updatingId, onClose, onUpdateStatus, isPastDay }) => {`

- [ ] **Step 4: Manual verify**

Open the app as a tech. Left/right arrows change the displayed date. Jobs load per day. Past dates show "View Only" pill. Tapping date label opens native date picker.

- [ ] **Step 5: Commit**

```bash
git add src/TechDashboard.jsx
git commit -m "feat: add day navigation to TechDashboard — prev/next arrows, date picker, past-day view-only"
```

---

### Task 7: Tech Dashboard — Redesigned Job Cards + Detail Sheet

**Files:**
- Modify: `src/TechDashboard.jsx`

- [ ] **Step 1: Update job card to show service type**

In the `jobs.map(...)` block, update the card content to:

```jsx
<div className="flex-1 min-w-0">
  <p className="text-white font-medium truncate">{apt.caller_name || 'Customer'}</p>
  {apt.service_type && (
    <p className="text-blue-400 text-xs mt-0.5 truncate">{apt.service_type}</p>
  )}
  <p className="text-gray-400 text-sm mt-1">
    {apt.start_time ? apt.start_time.slice(0, 5) : '—'}
    {apt.end_time   ? ` – ${apt.end_time.slice(0, 5)}` : ''}
  </p>
  {(apt.address || apt.city) && (
    <p className="text-gray-500 text-xs mt-1 truncate">
      <MapPin className="w-3 h-3 inline mr-1" />
      {[apt.address, apt.city].filter(Boolean).join(', ')}
    </p>
  )}
</div>
```

- [ ] **Step 2: Update JobDetail to show service type + full address**

In the customer/job info section of `JobDetail`, add service type after caller_name:

```jsx
{apt.service_type && (
  <div>
    <p className="text-xs text-gray-500 uppercase tracking-wide">Service Type</p>
    <p className="text-white font-medium">{apt.service_type}</p>
  </div>
)}
```

Update the address block to show city/state/zip on a second line:

```jsx
{(apt.address || apt.city) && (
  <div>
    <p className="text-xs text-gray-500 uppercase tracking-wide">Address</p>
    <p className="text-gray-300 text-sm">{apt.address}</p>
    {(apt.city || apt.state || apt.zip) && (
      <p className="text-gray-400 text-xs mt-0.5">
        {[apt.city, apt.state, apt.zip].filter(Boolean).join(', ')}
      </p>
    )}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/TechDashboard.jsx
git commit -m "feat: update TechDashboard job cards and detail sheet — service type, richer address"
```

---

### Task 8: Tech Dashboard — Permission-Gated Sections + Non-Job Status + GPS Wiring

**Files:**
- Modify: `src/TechDashboard.jsx`

- [ ] **Step 1: Add new permission features to PHASE2_FEATURES**

```javascript
const PHASE2_FEATURES = [
  'gps_tracking', 'customer_sms', 'customer_tracking_link',
  'view_customer_history', 'view_customer_notes',
  'view_call_transcript', 'view_call_recording',
];
```

- [ ] **Step 2: Add sub-components above JobDetail**

```jsx
// Customer history: last 5 prior appointments for this customer
const CustomerHistorySection = ({ apt }) => {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    if (!apt.caller_name) return;
    supabase
      .from('appointments')
      .select('date, start_time, service_type, status')
      .eq('client_id', apt.client_id)
      .eq('caller_name', apt.caller_name)
      .neq('id', apt.id)
      .order('date', { ascending: false })
      .limit(5)
      .then(({ data }) => setHistory(data || []));
  }, [apt.id]);
  if (!history || history.length === 0) return null;
  return (
    <div className="mb-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Prior Visits</p>
      <div className="space-y-1">
        {history.map((h, i) => (
          <div key={i} className="flex justify-between text-xs text-gray-400 bg-gray-900 rounded px-3 py-2">
            <span>{h.date} {h.start_time?.slice(0, 5)}</span>
            <span className="text-gray-500">{h.service_type || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const CallTranscriptSection = ({ callId }) => {
  const [transcript, setTranscript] = useState(null);
  useEffect(() => {
    supabase.from('calls').select('transcript').eq('call_id', callId).single()
      .then(({ data }) => setTranscript(data?.transcript || null));
  }, [callId]);
  if (!transcript) return null;
  return (
    <div className="mb-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Call Transcript</p>
      <p className="text-gray-300 text-sm bg-gray-900 rounded-lg p-3 border border-gray-600 max-h-40 overflow-y-auto whitespace-pre-wrap">
        {transcript}
      </p>
    </div>
  );
};

const CallRecordingSection = ({ callId }) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    supabase.from('calls').select('recording_url').eq('call_id', callId).single()
      .then(({ data }) => setUrl(data?.recording_url || null));
  }, [callId]);
  if (!url) return null;
  return (
    <div className="mb-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Call Recording</p>
      <audio controls src={url} className="w-full" />
    </div>
  );
};
```

- [ ] **Step 3: Add CustomerNotesSection sub-component**

`view_customer_notes` must NOT render `apt.notes` — that's already shown by the existing `job_notes`/`canNotes` block above it (both render the same field, causing duplicates). `view_customer_notes` instead fetches from the `customer_notes` table (linked by customer name).

Add above `JobDetail`:

```jsx
// Fetches notes from customer_notes table (not apt.notes — that's job_notes' responsibility)
const CustomerNotesSection = ({ apt }) => {
  const [notes, setNotes] = useState(null);
  useEffect(() => {
    if (!apt.caller_name) return;
    // Find customer by name + client_id, then fetch their notes
    supabase
      .from('customers')
      .select('id')
      .eq('client_id', apt.client_id)
      .ilike('name', apt.caller_name)
      .limit(1)
      .single()
      .then(({ data: customer }) => {
        if (!customer) { setNotes([]); return; }
        return supabase
          .from('customer_notes')
          .select('note, created_at')
          .eq('customer_id', customer.id)
          .order('created_at', { ascending: false })
          .limit(5);
      })
      .then(res => setNotes(res?.data || []));
  }, [apt.id]);
  if (!notes || notes.length === 0) return null;
  return (
    <div className="mb-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Customer Notes</p>
      <div className="space-y-2">
        {notes.map((n, i) => (
          <p key={i} className="text-gray-300 text-sm bg-gray-900 rounded-lg px-3 py-2 border border-gray-600">
            {n.note}
          </p>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Wire sub-components into JobDetail**

Below the existing Job Notes block (`canNotes && apt.notes`), add:

```jsx
{isAllowed(permissions, 'view_customer_history') && (
  <CustomerHistorySection apt={apt} />
)}
{isAllowed(permissions, 'view_customer_notes') && (
  <CustomerNotesSection apt={apt} />
)}
{isAllowed(permissions, 'view_call_transcript') && apt.call_id && (
  <CallTranscriptSection callId={apt.call_id} />
)}
{isAllowed(permissions, 'view_call_recording') && apt.call_id && (
  <CallRecordingSection callId={apt.call_id} />
)}
```

- [ ] **Step 5: Wire GPS to status updates**

Add import at top of TechDashboard.jsx:
```javascript
import locationService from './utils/locationService.js';
const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';
```

In `updateStatus`, replace the two `showToast` calls with:
```javascript
if (newStatus === 'en_route') {
  locationService.startTracking(techData.id, techData.client_id);
  // Token generation wired in Task 17
  showToast("Status updated — on your way!");
}
if (newStatus === 'complete') {
  locationService.stopTracking();
  // Revoke any active tracking token for this appointment (spec: Mark Complete revokes token)
  // RLS policy added in Task 3 migration allows authenticated techs to set revoked=true on their own rows
  supabase.from('tracking_tokens')
    .update({ revoked: true })
    .eq('technician_id', techData.id)
    .eq('appointment_id', apt.id)
    .eq('revoked', false)
    .then(() => {});  // fire-and-forget — customer page transitions to "complete" via apt.status anyway
  showToast('Job marked complete!');
}
```

- [ ] **Step 6: Add non-job status dropdown**

Add state near top of TechDashboard component:
```javascript
const [destinations, setDestinations] = useState([]);
const [showStatusModal, setShowStatusModal] = useState(false);
```

Add fetch in a `useEffect`:
```javascript
useEffect(() => {
  supabase
    .from('client_destinations')
    .select('id, label, sort_order')
    .eq('client_id', techData.client_id)
    .eq('is_active', true)
    .order('sort_order')
    .then(({ data }) => setDestinations(data || []));
}, []);
```

Add handler:
```javascript
const setNonJobStatus = async (label) => {
  setShowStatusModal(false);
  // IMPORTANT: Use a recorded_at 2 minutes in the past so the upsert guard
  // does not block the first real GPS fix when the tech later taps "On My Way".
  // The upsert_tech_location guard only overwrites if the new recorded_at is newer
  // than the stored one; a past timestamp ensures any subsequent GPS fix always wins.
  const pastTimestamp = new Date(Date.now() - 120000).toISOString();
  await supabase.rpc('upsert_tech_location', {
    p_technician_id:  techData.id,
    p_client_id:      techData.client_id,
    p_lat:            0,
    p_lng:            0,
    p_accuracy:       null,
    p_heading:        null,
    p_speed_kmh:      null,
    p_non_job_status: label,
    p_recorded_at:    pastTimestamp,
  });
  showToast(`Status: ${label}`);
};
```

Add button + modal below the jobs list (inside the `<div className="p-4">` section, after `</div>` closing the `jobs.map`):

```jsx
{destinations.length > 0 && (
  <div className="mt-4">
    <button
      onClick={() => setShowStatusModal(true)}
      className="w-full py-3 bg-gray-700 text-gray-300 rounded-xl text-sm border border-gray-600"
    >
      Set Status
    </button>
  </div>
)}

{showStatusModal && (
  <div className="fixed inset-0 bg-black/80 z-40 flex flex-col justify-end">
    <div className="bg-gray-800 rounded-t-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Set Status</h3>
        <button onClick={() => setShowStatusModal(false)} className="p-2 hover:bg-gray-700 rounded-lg">
          <X className="w-5 h-5 text-gray-400" />
        </button>
      </div>
      <div className="space-y-2">
        {destinations.map(d => (
          <button
            key={d.id}
            onClick={() => setNonJobStatus(d.label)}
            className="w-full py-4 bg-gray-700 text-white rounded-xl font-medium text-left px-4"
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 7: Manual verify**

Open app as tech. Verify:
- Permission-gated sections appear only when toggled on in TeamTab
- Customer History shows prior appointments (not current)
- Customer Notes shows `customer_notes` entries (not `apt.notes` again)
- "On My Way" logs GPS start to console
- "Mark Complete" stops GPS
- "Set Status" modal shows client destinations, selecting one calls `upsert_tech_location`

- [ ] **Step 8: Commit**

```bash
git add src/TechDashboard.jsx
git commit -m "feat: permission-gated job detail, non-job status dropdown, GPS wiring in TechDashboard"
```

---

### Task 9: TeamTab — Add Phase 2 Permission Toggles

**Files:**
- Modify: `src/TeamTab.jsx`

- [ ] **Step 1: Add PHASE2_FEATURES_DISPLAY array + update toggle rendering**

**Do NOT add the 4 new features to `PHASE1_FEATURES`** — that array defaults to `enabled = true` when no row exists, which would show the toggles as ON in TeamTab but they'd be OFF in TechDashboard (because TechDashboard has them in `PHASE2_FEATURES`). The UI and logic would disagree.

Instead, add a separate array:

```javascript
// Below the existing PHASE1_FEATURES definition:
const PHASE2_FEATURES_DISPLAY = [
  { key: 'view_customer_history', label: 'Customer History',  description: 'Can view prior appointments in job detail' },
  { key: 'view_customer_notes',   label: 'Customer Notes',    description: 'Can view customer notes in job detail'     },
  { key: 'view_call_transcript',  label: 'Call Transcript',   description: 'Can view AI call transcript in job detail' },
  { key: 'view_call_recording',   label: 'Call Recording',    description: 'Can play AI call recording in job detail'  },
];
```

In the toggle rendering loop, the existing loop over `PHASE1_FEATURES` uses:
```javascript
const enabled = permRow ? permRow.enabled : true; // defaults ON when no row
```

Add a second loop below it for `PHASE2_FEATURES_DISPLAY`:
```javascript
{PHASE2_FEATURES_DISPLAY.map(feat => {
  const permRow = techPerms.find(p => p.feature === feat.key);
  const enabled = permRow ? permRow.enabled : false; // Phase 2 defaults OFF
  return (
    // Same toggle JSX as PHASE1_FEATURES loop — copy the JSX pattern
    // Key difference: enabled defaults to false here
  );
})}
```

This ensures: no row exists → toggle shows **OFF** in TeamTab → matches `isAllowed()` returning `false` in TechDashboard.

- [ ] **Step 1b: Fix handleSaveTech default-permission inserts for new techs**

In `handleSaveTech`, find the block that inserts default permission rows after creating a new tech. Add the 4 new features with `enabled: false`:

```javascript
// In the default permissions insert after tech creation, add to the existing array:
{ technician_id: newTechId, client_id: clientData.id, feature: 'view_customer_history', enabled: false },
{ technician_id: newTechId, client_id: clientData.id, feature: 'view_customer_notes',   enabled: false },
{ technician_id: newTechId, client_id: clientData.id, feature: 'view_call_transcript',  enabled: false },
{ technician_id: newTechId, client_id: clientData.id, feature: 'view_call_recording',   enabled: false },
```

This ensures new techs have explicit `enabled: false` rows for these features — the toggle shows the correct OFF state immediately, and no ambiguity with the default logic.

- [ ] **Step 2: Verify in the app**

Open TeamTab as owner. Expand a tech's permission panel.
- Confirm 3 existing Phase 1 toggles still show as ON (job_notes, on_my_way, mark_complete)
- Confirm 4 new Phase 2 toggles show as OFF (customer_history, customer_notes, call_transcript, call_recording)
- Toggle `view_customer_history` ON. Open TechDashboard as that tech, tap a job — confirm "Prior Visits" section appears.

Also create a new test tech, confirm the 4 new features are inserted as `enabled: false` and show OFF in the panel.

- [ ] **Step 3: Commit**

```bash
git add src/TeamTab.jsx
git commit -m "feat: add view_customer_history/notes/call_transcript/recording permission toggles to TeamTab"
```

---

## Chunk 3: Dispatcher Map

### Task 10: geocode-appointments Edge Function

**Files:**
- Modify: `supabase/functions/geocode-appointments/index.ts`

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/geocode-appointments/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { appointment_id } = await req.json();
    if (!appointment_id) return new Response(JSON.stringify({ error: "missing appointment_id" }), { status: 400, headers: cors });

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const key = Deno.env.get("GOOGLE_GEOCODING_API_KEY");
    if (!key) return new Response(JSON.stringify({ error: "GOOGLE_GEOCODING_API_KEY not set" }), { status: 500, headers: cors });

    const { data: apt } = await sb.from("appointments").select("address, city, state, zip").eq("id", appointment_id).single();
    if (!apt) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: cors });

    const addrStr = [apt.address, apt.city, apt.state, apt.zip].filter(Boolean).join(", ");
    if (!addrStr) {
      await sb.from("appointments").update({ geocode_status: "failed" }).eq("id", appointment_id);
      return new Response(JSON.stringify({ ok: false, error: "no address" }), { headers: cors });
    }

    const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addrStr)}&key=${key}`);
    const geoData = await geoRes.json();

    if (geoData.status !== "OK" || !geoData.results?.[0]) {
      await sb.from("appointments").update({ geocode_status: "failed" }).eq("id", appointment_id);
      return new Response(JSON.stringify({ ok: false, error: geoData.status }), { headers: cors });
    }

    const { lat, lng } = geoData.results[0].geometry.location;
    await sb.from("appointments").update({ job_lat: lat, job_lng: lng, geocode_status: "success" }).eq("id", appointment_id);
    return new Response(JSON.stringify({ ok: true, lat, lng }), { headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
});
```

- [ ] **Step 2: Set the Google API key secret**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase secrets set GOOGLE_GEOCODING_API_KEY=<your-key> --project-ref zmppdmfdhknnwzwdfhwf
```

Obtain the key from Google Cloud Console → APIs & Services → Credentials. Enable the **Geocoding API** for the project.

- [ ] **Step 3: Deploy**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy geocode-appointments --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

- [ ] **Step 4: Wire fire-and-forget call in DispatcherDashboard**

In DispatcherDashboard, find the appointment save handler (wherever `supabase.from('appointments').insert/update` is called). After a successful save, add:

```javascript
// Fire-and-forget geocoding — don't await, don't block the UX
const savedAptId = result.data?.id ?? editingAptId; // whichever matches your existing variable
if (savedAptId) {
  supabase.auth.getSession().then(({ data: { session } }) => {
    fetch(`${SUPABASE_FUNCTIONS_URL}/geocode-appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ appointment_id: savedAptId }),
    }).catch(() => {});
  });
}
```

Make sure `SUPABASE_FUNCTIONS_URL` is defined in DispatcherDashboard.jsx (it's already in App.jsx — move/copy it).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/geocode-appointments/index.ts src/DispatcherDashboard.jsx
git commit -m "feat: geocode-appointments Edge Function + fire-and-forget geocoding on appointment save"
```

---

### Task 11: DispatcherMap Component (Full Implementation)

**Files:**
- Modify: `src/components/DispatcherMap.jsx`

- [ ] **Step 1: Implement DispatcherMap.jsx**

```jsx
// src/components/DispatcherMap.jsx
import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';  // Scoped here only — do NOT import in main.jsx
import { supabase } from '../supabaseClient';
import { X, Users } from 'lucide-react';

const STADIA_URL = `https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png?api_key=${import.meta.env.VITE_STADIA_API_KEY || ''}`;
const STADIA_ATTR = '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors';

const STATUS_COLORS = { confirmed: '#EAB308', en_route: '#3B82F6', complete: '#22C55E' };
const minsAgo = (ts) => ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 60000) : null;

const DispatcherMap = ({ clientId, technicians, jobs }) => {
  const [techLocations, setTechLocations] = useState([]);
  const [selectedTechId, setSelectedTechId] = useState(null);
  const [selectedJobId,  setSelectedJobId]  = useState(null);
  const [realtimeOk, setRealtimeOk] = useState(true);
  const [showLegend, setShowLegend] = useState(false);  // collapsed by default
  const realtimeOkRef = useRef(true);  // ref mirror avoids stale closure in setInterval

  // Initial load
  useEffect(() => {
    supabase.from('tech_locations').select('*').eq('client_id', clientId)
      .then(({ data }) => setTechLocations(data || []));
  }, [clientId]);

  // Realtime subscription
  useEffect(() => {
    const ch = supabase
      .channel(`tech-locations:${clientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tech_locations', filter: `client_id=eq.${clientId}` },
        (payload) => setTechLocations(prev => {
          const idx = prev.findIndex(l => l.technician_id === payload.new.technician_id);
          if (idx >= 0) { const n = [...prev]; n[idx] = payload.new; return n; }
          return [...prev, payload.new];
        })
      )
      .subscribe(s => {
        const ok = s === 'SUBSCRIBED';
        setRealtimeOk(ok);
        realtimeOkRef.current = ok;  // keep ref in sync for poll guard
      });

    // Fallback poll when realtime drops — uses ref to avoid stale closure
    const poll = setInterval(() => {
      if (realtimeOkRef.current) return;
      supabase.from('tech_locations').select('*').eq('client_id', clientId)
        .then(({ data }) => { if (data) setTechLocations(data); });
    }, 30000);

    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [clientId]);

  const techById = Object.fromEntries(technicians.map(t => [t.id, t]));
  const selectedTechLoc = techLocations.find(l => l.technician_id === selectedTechId);
  const selectedJob = jobs.find(j => j.id === selectedJobId);
  // Active job for the tapped tech — shown in tech detail panel per spec
  const selectedTechJob = jobs.find(j =>
    j.technician_id === selectedTechId &&
    (j.status === 'en_route' || j.status === 'confirmed')
  );

  return (
    <div className="relative h-full w-full">
      {!realtimeOk && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-amber-600 text-white text-xs px-3 py-1 rounded-full shadow">
          Live updates paused — reconnecting...
        </div>
      )}

      <MapContainer center={[39.5, -98.35]} zoom={5} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <TileLayer url={STADIA_URL} attribution={STADIA_ATTR} />

        {techLocations.map(loc => {
          const age = minsAgo(loc.received_at);
          const veryStale = age > 15;
          const stale = age > 5;
          const color = veryStale ? '#6B7280' : (stale ? '#9CA3AF' : (techById[loc.technician_id]?.color || '#3B82F6'));
          return (
            <CircleMarker key={loc.technician_id} center={[loc.lat, loc.lng]} radius={10}
              pathOptions={{ color: loc.technician_id === selectedTechId ? '#fff' : color, fillColor: color, fillOpacity: veryStale ? 0.3 : 0.8, weight: loc.technician_id === selectedTechId ? 3 : 1.5 }}
              eventHandlers={{ click: () => { setSelectedTechId(loc.technician_id); setSelectedJobId(null); } }}
            />
          );
        })}

        {jobs.map(apt => apt.job_lat && apt.job_lng ? (
          <CircleMarker key={apt.id} center={[apt.job_lat, apt.job_lng]} radius={8}
            pathOptions={{ color: '#fff', fillColor: STATUS_COLORS[apt.status] || '#EAB308', fillOpacity: 0.9, weight: 1.5 }}
            eventHandlers={{ click: () => { setSelectedJobId(apt.id); setSelectedTechId(null); } }}
          />
        ) : null)}
      </MapContainer>

      {/* Tech detail panel */}
      {selectedTechLoc && (
        <div className="absolute bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4 z-[1000]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: techById[selectedTechLoc.technician_id]?.color || '#6B7280' }} />
              <div>
                <p className="text-white font-medium">{techById[selectedTechLoc.technician_id]?.name || 'Unknown'}</p>
                {selectedTechLoc.non_job_status && <p className="text-amber-400 text-xs">{selectedTechLoc.non_job_status}</p>}
                <p className="text-gray-500 text-xs">
                  {minsAgo(selectedTechLoc.received_at) != null ? `Updated ${minsAgo(selectedTechLoc.received_at)} min ago` : 'Unknown'}
                </p>
              </div>
            </div>
            <button onClick={() => setSelectedTechId(null)} className="p-2 hover:bg-gray-700 rounded-lg">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          {/* Current job info — shown when tech has an active en_route or confirmed job */}
          {selectedTechJob && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <p className="text-gray-300 text-sm font-medium">{selectedTechJob.caller_name || 'Customer'}</p>
              {(selectedTechJob.address || selectedTechJob.city) && (
                <p className="text-gray-500 text-xs mt-0.5">
                  {[selectedTechJob.address, selectedTechJob.city].filter(Boolean).join(', ')}
                </p>
              )}
              {selectedTechJob.start_time && (
                <p className="text-gray-500 text-xs">
                  {selectedTechJob.start_time.slice(0,5)}{selectedTechJob.end_time ? ` – ${selectedTechJob.end_time.slice(0,5)}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Job detail panel with reassign */}
      {selectedJob && (
        <JobPanel job={selectedJob} technicians={technicians} clientId={clientId} onClose={() => setSelectedJobId(null)} />
      )}

      {/* Legend — collapsible, collapsed by default on mobile to preserve map space */}
      {techLocations.length > 0 && (
        <div className="absolute top-2 right-2 z-[1000]">
          <button
            onClick={() => setShowLegend(v => !v)}
            className="bg-gray-800/90 rounded-lg p-2 shadow flex items-center gap-1"
            title={showLegend ? 'Hide legend' : 'Show legend'}
          >
            <Users className="w-4 h-4 text-gray-300" />
            {!showLegend && <span className="text-xs text-gray-400">{techLocations.length}</span>}
          </button>
          {showLegend && (
            <div className="mt-1 bg-gray-800/90 rounded-lg px-3 py-2 shadow">
              {technicians.filter(t => techLocations.find(l => l.technician_id === t.id)).map(t => (
                <div key={t.id} className="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {techLocations.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[500]">
          <div className="bg-gray-800/90 text-gray-300 text-sm px-4 py-3 rounded-lg text-center max-w-xs">
            Locations appear here when techs tap "On My Way"
          </div>
        </div>
      )}
    </div>
  );
};

const JobPanel = ({ job, technicians, clientId, onClose }) => {
  const [reassigning, setReassigning] = useState(false);

  const reassign = async (techId) => {
    setReassigning(false);
    await supabase.from('appointments').update({ technician_id: parseInt(techId) }).eq('id', job.id);
    onClose();
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4 z-[1000]">
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="text-white font-medium">{job.caller_name || 'Customer'}</p>
          <p className="text-gray-400 text-sm">{job.start_time?.slice(0,5)}{job.end_time ? ` – ${job.end_time.slice(0,5)}` : ''}</p>
          {job.service_type && <p className="text-gray-500 text-xs">{job.service_type}</p>}
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg"><X className="w-4 h-4 text-gray-400" /></button>
      </div>
      {reassigning ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase mb-1">Select Tech</p>
          {technicians.filter(t => t.is_active).map(t => (
            <button key={t.id} onClick={() => reassign(t.id)}
              className="w-full py-3 bg-gray-700 text-white rounded-lg text-left px-3 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />{t.name}
            </button>
          ))}
        </div>
      ) : (
        <button onClick={() => setReassigning(true)} className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium">
          Reassign
        </button>
      )}
    </div>
  );
};

export default DispatcherMap;
```

- [ ] **Step 2: Add `.env.local` for local dev**

Create (or update) `.env.local` in the project root — this file is gitignored:
```
VITE_STADIA_API_KEY=your_stadia_api_key_here
```

Sign up at `client.stadiamaps.com` → API Keys → Create Key (Starter plan, $20/month).

- [ ] **Step 3: Verify map renders**

```
npm run dev
```

Navigate to Map tab. Stadia tiles should load. No JS errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/DispatcherMap.jsx
git commit -m "feat: DispatcherMap with Leaflet, tech/job markers, Realtime, reassign flow, legend"
```

---

### Task 12: Map Tab in DispatcherDashboard

**Files:**
- Modify: `src/DispatcherDashboard.jsx`

- [ ] **Step 1: Add Map import**

```javascript
import DispatcherMap from './components/DispatcherMap.jsx';
import { ..., MapPin } from 'lucide-react'; // add MapPin if not already imported
```

- [ ] **Step 2: Add Map to tab nav**

Find the tab array or nav JSX in DispatcherDashboard. Add a Map entry:

```javascript
// In the tabs array:
{ id: 'map', label: 'Map', icon: MapPin }
```

Update the bottom nav grid. The nav uses a role-based conditional that was copied from App.jsx during Task 2. Both branches need +1 for the new Map tab:

```jsx
<div className={`grid ${role === 'dispatcher' ? 'grid-cols-5' : 'grid-cols-7'} ...`}>
```

**Important:** Both `'grid-cols-5'` and `'grid-cols-7'` are static string literals in a ternary — this is safe from Tailwind's production purge. Do NOT use a template literal like `` `grid-cols-${n}` `` — that would be purged in production.

- [ ] **Step 3: Render DispatcherMap**

In the content area switch/conditional, add:

```jsx
{activeTab === 'map' && (
  <div style={{ height: 'calc(100vh - 56px - 56px)' }}>
    <DispatcherMap
      clientId={effectiveClientData.id}
      technicians={technicians}
      jobs={appointments.filter(a => a.date === new Date().toISOString().split('T')[0])}
    />
  </div>
)}
```

- [ ] **Step 4: Verify**

5-tab nav renders. Map tab shows the Leaflet map with Stadia tiles. No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/DispatcherDashboard.jsx
git commit -m "feat: add Map tab to dispatcher nav with DispatcherMap component"
```

---

## Chunk 4: Customer Tracking + SMS

### Task 13: send-sms Edge Function

**Files:**
- Modify: `supabase/functions/send-sms/index.ts`

- [ ] **Step 1: Implement**

```typescript
// supabase/functions/send-sms/index.ts
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { to, body, twilio_account_sid, twilio_auth_token, twilio_from_number } = await req.json();
    if (!to || !body || !twilio_account_sid || !twilio_auth_token || !twilio_from_number)
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: cors });

    const formData = new URLSearchParams();
    formData.append("To", to);
    formData.append("From", twilio_from_number);
    formData.append("Body", body);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilio_account_sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${twilio_account_sid}:${twilio_auth_token}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }
    );
    const result = await res.json();
    if (!res.ok) return new Response(JSON.stringify({ error: result.message, code: result.code }), { status: res.status, headers: cors });
    return new Response(JSON.stringify({ ok: true, sid: result.sid }), { headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
});
```

- [ ] **Step 2: Deploy**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy send-sms --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-sms/index.ts
git commit -m "feat: send-sms Edge Function for Twilio SMS delivery"
```

---

### Task 14: generate-tracking-token Edge Function

**Files:**
- Modify: `supabase/functions/generate-tracking-token/index.ts`

- [ ] **Step 1: Implement**

```typescript
// supabase/functions/generate-tracking-token/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const APP_URL = "https://app.reliantsupport.net";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { appointment_id, technician_id } = await req.json();
    if (!appointment_id || !technician_id)
      return new Response(JSON.stringify({ error: "missing appointment_id or technician_id" }), { status: 400, headers: cors });

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: apt } = await sb.from("appointments")
      .select("caller_name, caller_phone, end_time, service_type, client_id, date")
      .eq("id", appointment_id).single();
    if (!apt) return new Response(JSON.stringify({ error: "appointment not found" }), { status: 404, headers: cors });

    const { data: client } = await sb.from("clients")
      .select("twilio_account_sid, twilio_auth_token, twilio_from_number")
      .eq("id", apt.client_id).single();

    const { data: tech } = await sb.from("technicians").select("name").eq("id", technician_id).single();
    const techFirst = tech?.name?.split(' ')[0] || 'Your technician';

    // Revoke existing tokens for this appointment
    await sb.from("tracking_tokens").update({ revoked: true })
      .eq("appointment_id", appointment_id).eq("revoked", false);

    // expires_at = appointment end_time + 2 hours (fallback: now + 4h)
    let expiresAt: string;
    if (apt.end_time && apt.date) {
      const d = new Date(`${apt.date}T${apt.end_time}`);
      d.setHours(d.getHours() + 2);
      expiresAt = d.toISOString();
    } else {
      const d = new Date(); d.setHours(d.getHours() + 4);
      expiresAt = d.toISOString();
    }

    const { data: tokenRow } = await sb.from("tracking_tokens")
      .insert({ appointment_id, technician_id, client_id: apt.client_id, expires_at: expiresAt })
      .select("token").single();

    const trackingUrl = `${APP_URL}/?track=${tokenRow!.token}`;

    // Send SMS if Twilio configured and customer has a phone
    if (client?.twilio_account_sid && client?.twilio_from_number && apt.caller_phone) {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: apt.caller_phone,
          body: `Hi ${apt.caller_name || 'there'}, ${techFirst} is on the way! Track their location: ${trackingUrl}`,
          twilio_account_sid: client.twilio_account_sid,
          twilio_auth_token: client.twilio_auth_token,
          twilio_from_number: client.twilio_from_number,
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true, tracking_url: trackingUrl }), { headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
});
```

- [ ] **Step 2: Deploy**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy generate-tracking-token --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/generate-tracking-token/index.ts
git commit -m "feat: generate-tracking-token Edge Function — creates token, revokes old, sends customer SMS"
```

---

### Task 15: get-tracking-data Edge Function

**Files:**
- Modify: `supabase/functions/get-tracking-data/index.ts`

- [ ] **Step 1: Implement**

```typescript
// supabase/functions/get-tracking-data/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new Response(JSON.stringify({ error: "missing token" }), { status: 400, headers: cors });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: row } = await sb.from("tracking_tokens")
    .select("appointment_id, technician_id, expires_at, revoked").eq("token", token).single();

  if (!row || row.revoked || new Date(row.expires_at) < new Date())
    return new Response(JSON.stringify({ error: "invalid or expired token" }), { status: 403, headers: cors });

  const { data: apt } = await sb.from("appointments")
    .select("status, start_time, end_time, service_type").eq("id", row.appointment_id).single();
  if (!apt) return new Response(JSON.stringify({ error: "appointment not found" }), { status: 404, headers: cors });

  // Complete: return 200 with status only — no live location
  if (apt.status === "complete")
    return new Response(JSON.stringify({ status: "complete" }), { headers: cors });

  const { data: loc } = await sb.from("tech_locations")
    .select("lat, lng").eq("technician_id", row.technician_id).single();
  const { data: tech } = await sb.from("technicians")
    .select("name, color").eq("id", row.technician_id).single();

  return new Response(JSON.stringify({
    status: "en_route",
    tech: {
      first_name: tech?.name?.split(' ')[0] || 'Your technician',
      color: tech?.color || '#3B82F6',
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
    },
    appointment: { start_time: apt.start_time, end_time: apt.end_time, service_type: apt.service_type },
  }), { headers: cors });
});
```

- [ ] **Step 2: Deploy**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy get-tracking-data --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

- [ ] **Step 3: Test**

```bash
curl "https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1/get-tracking-data?token=INVALID" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs"
# Expected: {"error":"invalid or expired token"} — HTTP 403
# (Without the apikey header Supabase returns 401 before the function runs)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/get-tracking-data/index.ts
git commit -m "feat: get-tracking-data Edge Function — validates token, returns live tech location"
```

---

### Task 16: TrackingPage Component

**Files:**
- Modify: `src/pages/TrackingPage.jsx`

- [ ] **Step 1: Implement TrackingPage.jsx**

```jsx
// src/pages/TrackingPage.jsx
import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';  // Must import here — TrackingPage renders without DispatcherMap in the tree
import { CheckCircle } from 'lucide-react';
import logo from '../assets/RELIANT SUPPORT LOGO.svg';

const FN_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';
const STADIA = `https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png?api_key=${import.meta.env.VITE_STADIA_API_KEY || ''}`;

const TrackingPage = ({ token }) => {
  const [status, setStatus] = useState('loading'); // loading | en_route | complete | error
  const [data, setData] = useState(null);
  const pollRef = useRef(null);

  const fetch_ = async () => {
    try {
      // apikey header required by Supabase API gateway even on --no-verify-jwt functions
      const res = await fetch(`${FN_URL}/get-tracking-data?token=${token}`, {
        headers: { 'apikey': SUPABASE_ANON_KEY },
      });
      if (res.status === 403) { setStatus('error'); return; }
      const d = await res.json();
      if (d.status === 'complete') { setStatus('complete'); clearInterval(pollRef.current); return; }
      setData(d); setStatus('en_route');
    } catch { setStatus('error'); }
  };

  useEffect(() => {
    fetch_();
    pollRef.current = setInterval(fetch_, 30000);
    return () => clearInterval(pollRef.current);
  }, [token]);

  if (status === 'loading') return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center text-gray-400">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p>Loading tracking information...</p>
      </div>
    </div>
  );

  if (status === 'error') return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <div className="text-center">
        <img src={logo} alt="Reliant Support" className="h-8 mx-auto mb-6" />
        <p className="text-gray-300 text-lg mb-2">This tracking link has expired.</p>
        <p className="text-gray-500 text-sm">The technician has arrived, or this link is no longer valid.</p>
      </div>
    </div>
  );

  if (status === 'complete') return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <div className="text-center">
        <img src={logo} alt="Reliant Support" className="h-8 mx-auto mb-6" />
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <p className="text-white text-xl font-semibold mb-2">Service Complete</p>
        <p className="text-gray-400">Thank you for choosing Reliant Support.</p>
      </div>
    </div>
  );

  // en_route
  const { tech, appointment } = data;
  const hasLoc = tech?.lat != null && tech?.lng != null;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center gap-3">
        <img src={logo} alt="Reliant Support" className="h-6" />
        <div>
          <p className="text-white text-sm font-medium">{tech?.first_name || 'Your technician'} is on the way!</p>
          {appointment?.start_time && (
            <p className="text-gray-400 text-xs">
              Scheduled: {appointment.start_time.slice(0,5)}{appointment.end_time ? ` – ${appointment.end_time.slice(0,5)}` : ''}
            </p>
          )}
        </div>
        <div className="ml-auto w-4 h-4 rounded-full" style={{ backgroundColor: tech?.color || '#3B82F6' }} />
      </div>
      <div className="flex-1">
        {hasLoc ? (
          <MapContainer center={[tech.lat, tech.lng]} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={false}>
            <TileLayer url={STADIA} />
            <CircleMarker center={[tech.lat, tech.lng]} radius={12}
              pathOptions={{ color: '#fff', fillColor: tech.color, fillOpacity: 0.9, weight: 2 }} />
          </MapContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
            Waiting for location update...
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackingPage;
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/TrackingPage.jsx
git commit -m "feat: TrackingPage public customer tracking view with Leaflet map and polling"
```

---

### Task 17: App.jsx ?track= Routing + SMS Config Settings + Full "On My Way" Wiring

Three final integration steps in one commit.

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/DispatcherDashboard.jsx`
- Modify: `src/TechDashboard.jsx`

- [ ] **Step 1: Wire ?track= routing in App.jsx**

Add import:
```javascript
import TrackingPage from './pages/TrackingPage.jsx';
```

In the App component's `return` statement, place the `?track=` check as the **first thing** — before the `authLoading` spinner and before any user/auth checks. TrackingPage is fully public; when this param is present we skip auth entirely and render immediately:

```jsx
// In App component's return — FIRST LINE, before everything:
const trackToken = new URLSearchParams(window.location.search).get('track');
if (trackToken) return <TrackingPage token={trackToken} />;

// Then the rest of the existing return logic:
if (authLoading || demoLoading) return <div className="..."><Spinner /></div>;
if (!user) return <Login ... />;
// ... rest of role-based routing
```

**Why before `authLoading`:** This is the same pattern used for other URL-param short-circuits in this codebase (e.g., `_onboardToken`, `_activateToken`). When `?track=` is present, we never show the auth UI — placing it first means no spinner flash, no login redirect, no role check. The customer lands directly on TrackingPage with zero auth overhead.

- [ ] **Step 2: Add SmsConfigForm to DispatcherDashboard settings**

Add `SmsConfigForm` as a component above `DispatcherDashboard`:

```jsx
const SmsConfigForm = ({ clientData }) => {
  const [form, setForm] = useState({
    twilio_account_sid:  clientData?.twilio_account_sid  || '',
    twilio_auth_token:   clientData?.twilio_auth_token   || '',
    twilio_from_number:  clientData?.twilio_from_number  || '',
  });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('clients').update({
      twilio_account_sid:  form.twilio_account_sid  || null,
      twilio_auth_token:   form.twilio_auth_token   || null,
      twilio_from_number:  form.twilio_from_number  || null,
    }).eq('id', clientData.id);
    setSaving(false);
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
  };

  const fields = [
    { key: 'twilio_account_sid',  label: 'Account SID',  placeholder: 'ACxxxxxxxx' },
    { key: 'twilio_auth_token',   label: 'Auth Token',   placeholder: '••••••••', type: 'password' },
    { key: 'twilio_from_number',  label: 'From Number',  placeholder: '+15551234567' },
  ];

  return (
    <div className="space-y-3">
      {fields.map(({ key, label, placeholder, type }) => (
        <div key={key}>
          <label className="text-xs text-gray-400 block mb-1">{label}</label>
          <input type={type || 'text'} value={form[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            placeholder={placeholder}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm border border-gray-600 focus:border-blue-500 outline-none"
          />
        </div>
      ))}
      <button onClick={save} disabled={saving}
        className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save SMS Settings'}
      </button>
    </div>
  );
};
```

In `renderSettings()` inside DispatcherDashboard, add before the closing return (owner only):

```jsx
{role === 'owner' && (
  <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 mb-4">
    <h3 className="text-white font-medium mb-1">SMS Configuration</h3>
    <p className="text-gray-400 text-xs mb-4">
      Enables automatic tracking link SMS to customers when a tech taps "On My Way."
      Uses your existing Twilio number (same as your AI receptionist).
    </p>
    <SmsConfigForm clientData={effectiveClientData} />
  </div>
)}
```

- [ ] **Step 3: Wire generate-tracking-token in TechDashboard "On My Way"**

**Prerequisite:** Task 8 (Chunk 2) already added `locationService` import and `locationService.startTracking()` / `stopTracking()` calls to TechDashboard. This step extends that existing `updateStatus` handler — do not re-add the import or re-wire GPS start/stop, only add the token generation call.

**Also confirm** `SUPABASE_FUNCTIONS_URL` is defined near the top of `TechDashboard.jsx` before using it. If it's not there, add:
```javascript
const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';
```

In `updateStatus`, extend the existing `en_route` block:

```javascript
if (newStatus === 'en_route') {
  locationService.startTracking(techData.id, techData.client_id);

  // Generate tracking token + send customer SMS (fire-and-forget, non-blocking)
  supabase.auth.getSession().then(({ data: { session } }) => {
    fetch(`${SUPABASE_FUNCTIONS_URL}/generate-tracking-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ appointment_id: apt.id, technician_id: techData.id }),
    })
    .then(r => r.json())
    .then(d => { if (d.tracking_url) console.log('[TechDashboard] Tracking URL:', d.tracking_url); })
    .catch(err => console.error('[TechDashboard] Token generation failed:', err));
  });

  showToast("Status updated — on your way!");
}
```

- [ ] **Step 4: End-to-end test checklist**

- [ ] Log in as tech → tap "On My Way" → console shows tracking URL
- [ ] Open tracking URL in a fresh incognito tab → TrackingPage renders
- [ ] Tech taps "Mark Complete" → tracking page transitions to "Service Complete"
- [ ] Log in as owner → Settings → SMS Configuration section visible
- [ ] Enter Twilio credentials → Save → reload → credentials persist
- [ ] Log in as dispatcher → 5-tab nav visible → Map tab renders with Stadia tiles

- [ ] **Step 5: Final build check**

```bash
npm run build
```

Expected: no errors, no warnings about missing env vars (Vite will warn about `VITE_STADIA_API_KEY` being empty in build — that's fine, it's set in Vercel for production).

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/DispatcherDashboard.jsx src/TechDashboard.jsx
git commit -m "feat: wire TrackingPage routing, SMS config settings, full On My Way token + GPS flow"
```

---

### Task 18: Deploy Edge Functions + Set Vercel Env + Final Push

- [ ] **Step 1: Deploy all four Edge Functions**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy geocode-appointments       --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy send-sms                   --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy generate-tracking-token    --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy get-tracking-data          --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

- [ ] **Step 2: Set Vercel environment variable**

In Vercel Dashboard → Project Settings → Environment Variables, add:
```
VITE_STADIA_API_KEY = <your-stadia-api-key>
```

- [ ] **Step 3: Push to main → auto-deploy**

```bash
git push origin main
```

- [ ] **Step 4: Production smoke test**

Open `https://app.reliantsupport.net` in a browser and verify:
- Map tab renders Stadia tiles in production (confirms `VITE_STADIA_API_KEY` is set)
- Tech login → day navigation works
- Tracking URL from console opens without auth on mobile

- [ ] **Step 5: Tag the release**

```bash
git tag location-mapping-v1
git push origin location-mapping-v1
```
