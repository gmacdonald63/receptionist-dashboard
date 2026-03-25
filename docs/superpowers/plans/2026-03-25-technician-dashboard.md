# Technician Dashboard — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add technician authentication, a mobile-first today's-jobs dashboard, a dispatcher staff role, a Team management tab, and a server-side invite flow to the existing React/Supabase receptionist dashboard.

**Architecture:** Role resolution lives in a single `useEffect([user])` in App.jsx — the single source of truth triggered by all auth paths (page load, login, invite-link). Three new roles (`tech`, `dispatcher`, plus existing `owner`/`admin`) are resolved by sequential Supabase lookups. Techs see `TechDashboard.jsx` via a hard-return in the render waterfall; dispatchers see a filtered 4-tab view; owners see a new 6-tab view with a `TeamTab.jsx`. A new `invite-user` Edge Function handles server-side Supabase Auth invitations (requires service role key, unavailable client-side).

**Tech Stack:** React 18, Vite, Supabase (Auth, RLS, Edge Functions — Deno), Tailwind CSS, Lucide React, `@supabase/supabase-js@2`

**Phase 2 note:** GPS tracking, Mapbox dispatch map, Twilio SMS, and the customer tracking page (`?track=`) are out of scope for this plan. They are defined in the spec and should be planned separately once Phase 1 is shipped and stable.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260325001_technicians_email_rls.sql` | Create | Add `email` column + 3 RLS policies to `technicians` |
| `supabase/migrations/20260325002_appointments_tech_rls.sql` | Create | Add 2 tech RLS policies to `appointments` |
| `supabase/migrations/20260325003_technician_permissions.sql` | Create | Create `technician_permissions` table + 2 RLS policies |
| `supabase/migrations/20260325004_client_staff.sql` | Create | Create `client_staff` table + 2 RLS policies |
| `src/Login.jsx` | Modify | Remove `clients` lookup — just call `signInWithPassword` and pass `user` to `onLogin` |
| `src/App.jsx` | Modify | Add `role`/`techData` state, rewrite `getSession` block, update `onAuthStateChange` SIGNED_OUT, simplify `handleLogin`, add `useEffect([user])` resolver, add tech render return, update nav items, add TeamTab render block |
| `src/TechDashboard.jsx` | Create | Mobile-first today's-jobs view with job detail modal, Navigate/On My Way/Mark Complete actions |
| `src/TeamTab.jsx` | Create | Tech + dispatcher management (owner: full CRUD + permission toggles; dispatcher: read-only list) |
| `supabase/functions/invite-user/index.ts` | Create | Server-side `auth.admin.inviteUserByEmail` — dedup-checks existing users first |

---

## Chunk 1: Database Migrations

### Task 1: Migration A — Add `email` to `technicians` + RLS policies

**Files:**
- Create: `supabase/migrations/20260325001_technicians_email_rls.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260325001_technicians_email_rls.sql

-- Add email column (nullable — existing rows get NULL; they cannot log in until email is set)
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

-- Techs read their own row
CREATE POLICY "tech_read_own" ON technicians
  FOR SELECT USING (
    is_active = true
    AND email IS NOT NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Dispatchers read all techs for their client (needed for Team tab read-only list)
CREATE POLICY "dispatcher_read_client_techs" ON technicians
  FOR SELECT USING (
    client_id = (
      SELECT client_id FROM client_staff
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
        AND active = true
    )
  );
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `mcp__308cb25c-0e49-4cf3-9e1e-1dc768d6ee47__apply_migration` tool with the SQL content above and name `technicians_email_rls`.

Expected: Success. No error message.

- [ ] **Step 3: Verify the column was added**

Run via `mcp__308cb25c-0e49-4cf3-9e1e-1dc768d6ee47__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'technicians' AND column_name = 'email';
```
Expected: 1 row — `email`, `text`, `YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260325001_technicians_email_rls.sql
git commit -m "feat: add email column and RLS policies to technicians table"
```

---

### Task 2: Migration B — RLS on `appointments` for technicians

**Files:**
- Create: `supabase/migrations/20260325002_appointments_tech_rls.sql`

- [ ] **Step 1: Check if RLS is already enabled on `appointments`**

Run via Supabase MCP execute_sql:
```sql
SELECT relrowsecurity FROM pg_class WHERE relname = 'appointments';
```
If result is `false`, the `ALTER TABLE` line below must be included. If `true`, remove it.

- [ ] **Step 2: Create the migration file**

```sql
-- supabase/migrations/20260325002_appointments_tech_rls.sql
-- NOTE: Include the ALTER TABLE line only if RLS is not already enabled (check Step 1 result).
-- ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- Techs read appointments assigned to them (for today's jobs query)
CREATE POLICY "tech_read_own_appointments" ON appointments
  FOR SELECT USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email IS NOT NULL
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Techs update status on their assigned appointments (en_route, complete)
-- Column-level note: FOR UPDATE RLS does not restrict which columns can be written.
-- Techs could technically update any column on their assigned row. For Phase 1 this is
-- an acceptable trust boundary — techs are known employees and the app only sends status updates.
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

- [ ] **Step 3: Apply migration**

Apply via Supabase MCP, name `appointments_tech_rls`.

Expected: Success. No "already exists" errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260325002_appointments_tech_rls.sql
git commit -m "feat: add tech read/update RLS policies to appointments table"
```

---

### Task 3: Migration C — `technician_permissions` table

**Files:**
- Create: `supabase/migrations/20260325003_technician_permissions.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260325003_technician_permissions.sql

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

-- Techs read their own permissions (to know which buttons to show)
CREATE POLICY "tech_read_own_permissions" ON technician_permissions
  FOR SELECT USING (
    technician_id = (
      SELECT id FROM technicians
      WHERE is_active = true
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Owners manage permissions for their client's techs
CREATE POLICY "client_manage_tech_permissions" ON technician_permissions
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

- [ ] **Step 2: Apply migration**

Apply via Supabase MCP, name `technician_permissions`.

Expected: Table created, 2 policies. No errors.

- [ ] **Step 3: Verify table exists**

```sql
SELECT COUNT(*) FROM technician_permissions;
```
Expected: `0` (empty new table, no error).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260325003_technician_permissions.sql
git commit -m "feat: create technician_permissions table with RLS"
```

---

### Task 4: Migration D — `client_staff` table (dispatchers)

**Files:**
- Create: `supabase/migrations/20260325004_client_staff.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260325004_client_staff.sql

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

-- Staff read their own row (for resolveRole() lookup)
CREATE POLICY "staff_read_own" ON client_staff
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Owners manage staff for their client
CREATE POLICY "owner_manage_staff" ON client_staff
  FOR ALL
  USING (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    client_id = (SELECT id FROM clients WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
```

- [ ] **Step 2: Apply migration**

Apply via Supabase MCP, name `client_staff`.

Expected: Table created, 2 policies. No errors.

- [ ] **Step 3: Verify**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'client_staff'
ORDER BY ordinal_position;
```
Expected: `id`, `client_id`, `email`, `name`, `role`, `active`, `invited_at`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260325004_client_staff.sql
git commit -m "feat: create client_staff table for dispatcher accounts"
```

---

## Chunk 2: Auth Flow Refactor

### Task 5: Add `role` and `techData` state to App.jsx

**Files:**
- Modify: `src/App.jsx` (lines 25–35, state declarations)

`role` drives which view renders and which nav tabs show. `techData` holds the technician row for the tech dashboard.

- [ ] **Step 1: Add new state variables after line 29**

After `const [authLoading, setAuthLoading] = useState(true);` (line 29), insert:

```js
const [role, setRole] = useState(null); // 'admin' | 'owner' | 'dispatcher' | 'tech' | null
const [techData, setTechData] = useState(null);
```

- [ ] **Step 2: Build to confirm no syntax errors**

```bash
npm run build 2>&1 | head -20
```
Expected: Build succeeds (or same errors as before — no new ones).

---

### Task 6: Rewrite `getSession` block in App.jsx

**Files:**
- Modify: `src/App.jsx` (lines 111–133)

The existing block performs a `clients` table lookup and force-signs-out non-clients. This must be removed — role resolution moves entirely to `useEffect([user])`. The only job of this block is: short-circuit if `?track` is in the URL (Phase 2 prep), otherwise set `user` to trigger the resolver.

- [ ] **Step 1: Replace the getSession block with the new version**

> **Important for implementers:** The "old" block below must match the file character-for-character for automated Edit tools to succeed. Read `src/App.jsx` lines 111–133 first and confirm they match before applying the replacement. If whitespace or comments differ, use the exact text from the file.

**Remove this (lines 111–133 — verify exact match before editing):**
```js
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        // Fetch client data — sign out if no clients record exists
        supabase
          .from('clients')
          .select('*')
          .eq('email', session.user.email)
          .single()
          .then(async ({ data }) => {
            if (data) {
              setClientData(data);
            } else {
              // No client record — force sign out
              await supabase.auth.signOut();
              setUser(null);
            }
            setAuthLoading(false);
          });
      } else {
        setAuthLoading(false);
      }
    });
```

**Replace with:**
```js
supabase.auth.getSession().then(({ data: { session } }) => {
  // Phase 2: ?track short-circuit — no auth needed for tracking page
  if (new URLSearchParams(window.location.search).get('track')) {
    setAuthLoading(false);
    return;
  }
  if (session?.user) setUser(session.user);
  // authLoading is set to false inside resolveRole() at each branch for authenticated users
  else setAuthLoading(false);
});
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | head -20
```
Expected: No new errors.

---

### Task 7: Update `onAuthStateChange` SIGNED_OUT handler

**Files:**
- Modify: `src/App.jsx` (lines 149–153)

The existing handler clears `user` and `clientData` but not `role` or `techData`. If a tech logs out and an owner logs in on the same browser tab, stale `role === 'tech'` would re-render TechDashboard.

- [ ] **Step 1: Replace the SIGNED_OUT block**

**Remove:**
```js
if (event === 'SIGNED_OUT') {
  setUser(null);
  setClientData(null);
  return;
}
```

**Replace with:**
```js
if (event === 'SIGNED_OUT') {
  setUser(null);
  setClientData(null);
  setRole(null);
  setTechData(null);
  return;
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | head -20
```

---

### Task 8: Simplify `handleLogin` in App.jsx

**Files:**
- Modify: `src/App.jsx` (lines 280–283)

The existing `handleLogin` accepts `(user, clientData)` and sets both. With role resolution now in `useEffect([user])`, it only needs `user`.

- [ ] **Step 1: Replace handleLogin**

**Remove:**
```js
const handleLogin = (user, clientData) => {
  setUser(user);
  setClientData(clientData);
};
```

**Replace with:**
```js
const handleLogin = (user) => {
  setUser(user);
};
```

---

### Task 9: Add `useEffect([user])` role resolver to App.jsx

**Files:**
- Modify: `src/App.jsx` (add after the existing `useEffect` blocks, around line 218)

This is the single source of truth for role resolution. It runs whenever `user` changes — covering page load (via `getSession`), password login (via `Login.jsx`), and invite-link completion (via `onAuthStateChange SIGNED_IN`).

- [ ] **Step 1: Add the resolver useEffect**

Place after the `}, [clientData]);` closing line of the `clientData` useEffect (line 218 in the original file), and before the `// After Stripe checkout redirect` comment block (line 220). Do NOT insert inside any existing `useEffect` closure.

```js
// Role resolution — single source of truth for all auth paths
useEffect(() => {
  if (!user) return;

  const resolveRole = async () => {
    const email = user.email;

    // Step 1: owner / admin — check clients table
    const { data: clientRecord } = await supabase
      .from('clients')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (clientRecord) {
      setRole(clientRecord.is_admin ? 'admin' : 'owner');
      setClientData(clientRecord);
      setAuthLoading(false);
      return;
    }

    // Step 2: dispatcher — check client_staff table
    const { data: staffRecord } = await supabase
      .from('client_staff')
      .select('*')
      .eq('email', email)
      .eq('active', true)
      .maybeSingle();
    if (staffRecord) {
      const { data: ownerData } = await supabase
        .from('clients')
        .select('*')
        .eq('id', staffRecord.client_id)
        .single();
      setRole('dispatcher');
      setClientData(ownerData);
      setAuthLoading(false);
      return;
    }

    // Step 3: technician — check technicians table
    const { data: techRecord } = await supabase
      .from('technicians')
      .select('*')
      .eq('email', email)
      .eq('is_active', true)
      .maybeSingle();
    if (techRecord) {
      setRole('tech');
      setTechData(techRecord);
      setAuthLoading(false);
      return;
    }

    // Step 4: no match — sign out (unknown user)
    await supabase.auth.signOut();
    setAuthLoading(false);
  };

  resolveRole();
}, [user]);
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | head -20
```
Expected: No errors.

- [ ] **Step 3: Checkpoint commit for App.jsx auth changes (Tasks 5–9)**

```bash
git add src/App.jsx
git commit -m "feat: add role/techData state, useEffect([user]) resolver, simplified getSession and SIGNED_OUT handler"
```

---

### Task 10: Simplify Login.jsx

**Files:**
- Modify: `src/Login.jsx`

The existing Login.jsx performs a `clients` table lookup after `signInWithPassword` and rejects non-clients. This must be removed — the `resolveRole()` in App.jsx now handles all role checks. The `onLogin` prop signature changes from `(user, clientData)` to just `(user)`.

- [ ] **Step 1: Replace the `handleLogin` function in Login.jsx**

**Remove lines 11–43:**
```js
const handleLogin = async (e) => {
  e.preventDefault();
  setLoading(true);
  setError(null);

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    // Get client data for this user
    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('email', email)
      .single();

    if (clientError || !clientData) {
      // User authenticated but no client record — sign them out and show error
      await supabase.auth.signOut();
      throw new Error('No account found. Please contact your administrator for an invitation.');
    }

    onLogin(data.user, clientData);
  } catch (error) {
    setError(error.message);
  } finally {
    setLoading(false);
  }
};
```

**Replace with:**
```js
const handleLogin = async (e) => {
  e.preventDefault();
  setLoading(true);
  setError(null);

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    onLogin(data.user);
    // Role resolution happens in App.jsx useEffect([user])
  } catch (error) {
    setError(error.message);
  } finally {
    setLoading(false);
  }
};
```

Note: The "No account found" error case is now handled by `resolveRole()` — if no role matches, it calls `supabase.auth.signOut()` and the user sees the login page again. Consider showing a clearer message: at the end of `resolveRole()` Step 4, you could set an error state. For Phase 1, the sign-out + login redisplay is acceptable.

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | head -20
```

- [ ] **Step 3: Manual smoke test — existing owner login and sign-out state clearing**

```bash
npm run dev
```
1. Open http://localhost:3000
2. Log in as an existing owner account (e.g. `gmacdonald63@gmail.com`)
3. Verify: dashboard loads normally with existing tab nav
4. Log out — verify: login screen shows, no console errors
5. Open React DevTools (or add `console.log(role, techData)` temporarily): verify `role` is `null` and `techData` is `null` after sign-out

- [ ] **Step 4: Commit Login.jsx change**

```bash
git add src/Login.jsx
git commit -m "feat: simplify Login.jsx — remove clients lookup, pass only user to onLogin"
```

---

## Chunk 3: TechDashboard Component

### Task 11: Create `src/TechDashboard.jsx`

**Files:**
- Create: `src/TechDashboard.jsx`

Mobile-first dashboard for field techs. Shows today's assigned jobs in a scrollable list, with a bottom-sheet job detail modal for Navigate / On My Way / Mark Complete actions. Reads permissions from `technician_permissions` to show/hide buttons. Uses `caller_name` (not `customer_name`) for the customer name column.

- [ ] **Step 1: Create the file**

```jsx
// src/TechDashboard.jsx
import React, { useState, useEffect } from 'react';
import { MapPin, CheckCircle, Navigation, RefreshCw, LogOut, ChevronRight, X } from 'lucide-react';
import { supabase } from './supabaseClient';
import logo from './assets/RELIANT SUPPORT LOGO.svg';

const STATUS_CONFIG = {
  confirmed: { label: 'PENDING',   color: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' },
  en_route:  { label: 'EN ROUTE',  color: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' },
  complete:  { label: 'COMPLETE',  color: 'bg-green-500/20 text-green-400 border border-green-500/30' },
};

// Phase 1 features default on when row is absent; Phase 2 features default off
const PHASE2_FEATURES = ['gps_tracking', 'customer_sms', 'customer_tracking_link'];
const isAllowed = (permissions, feature) => {
  const row = permissions.find(p => p.feature === feature);
  if (row) return row.enabled;
  return !PHASE2_FEATURES.includes(feature);
};

const buildMapsUrl = (apt) => {
  const addr = [apt.address, apt.city, apt.state, apt.zip].filter(Boolean).join(' ');
  return `https://maps.google.com/?daddr=${encodeURIComponent(addr)}`;
};

// ── Job Detail Bottom Sheet ──────────────────────────────────────────────────
const JobDetail = ({ apt, permissions, updatingId, onClose, onUpdateStatus }) => {
  const sc = STATUS_CONFIG[apt.status] || STATUS_CONFIG.confirmed;
  const canOnMyWay  = isAllowed(permissions, 'on_my_way');
  const canComplete = isAllowed(permissions, 'mark_complete');
  const canNotes    = isAllowed(permissions, 'job_notes');

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex flex-col justify-end">
      <div className="bg-gray-800 rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Job Detail</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Status badge */}
        <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full mb-4 ${sc.color}`}>
          {sc.label}
        </span>

        {/* Customer / job info */}
        <div className="space-y-3 mb-5">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Customer</p>
            <p className="text-white font-medium">{apt.caller_name || 'Customer'}</p>
          </div>
          {(apt.address || apt.city) && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Address</p>
              <p className="text-gray-300 text-sm">
                {[apt.address, apt.city, apt.state, apt.zip].filter(Boolean).join(', ')}
              </p>
            </div>
          )}
          {(apt.start_time || apt.end_time) && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Time</p>
              <p className="text-gray-300 text-sm">
                {apt.start_time?.slice(0, 5)}{apt.end_time ? ` – ${apt.end_time.slice(0, 5)}` : ''}
              </p>
            </div>
          )}
        </div>

        {/* Job notes — only if permitted and notes exist */}
        {canNotes && apt.notes && (
          <div className="mb-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Job Notes</p>
            <p className="text-gray-300 text-sm bg-gray-900 rounded-lg p-3 border border-gray-600">
              {apt.notes}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-3">
          {/* Navigate — always shown */}
          <a
            href={buildMapsUrl(apt)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-4 bg-blue-600 text-white rounded-xl font-medium text-base min-h-[56px]"
          >
            <Navigation className="w-5 h-5" />
            Navigate
          </a>

          {/* On My Way — shown if permitted AND status is confirmed */}
          {canOnMyWay && apt.status === 'confirmed' && (
            <button
              onClick={() => onUpdateStatus(apt, 'en_route')}
              disabled={updatingId === apt.id}
              className="flex items-center justify-center gap-2 w-full py-4 bg-amber-600 text-white rounded-xl font-medium text-base min-h-[56px] disabled:opacity-50"
            >
              {updatingId === apt.id
                ? <RefreshCw className="w-5 h-5 animate-spin" />
                : <MapPin className="w-5 h-5" />}
              On My Way
            </button>
          )}

          {/* Mark Complete — shown if permitted AND not already complete */}
          {canComplete && apt.status !== 'complete' && (
            <button
              onClick={() => onUpdateStatus(apt, 'complete')}
              disabled={updatingId === apt.id}
              className="flex items-center justify-center gap-2 w-full py-4 bg-green-600 text-white rounded-xl font-medium text-base min-h-[56px] disabled:opacity-50"
            >
              {updatingId === apt.id
                ? <RefreshCw className="w-5 h-5 animate-spin" />
                : <CheckCircle className="w-5 h-5" />}
              Mark Complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main TechDashboard ───────────────────────────────────────────────────────
const TechDashboard = ({ techData }) => {
  const [jobs, setJobs]             = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [toast, setToast]           = useState(null);

  const todayISO = new Date().toISOString().split('T')[0];

  const fetchJobs = async () => {
    setError(null);
    try {
      const [jobsRes, permsRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('*')
          .eq('client_id', techData.client_id)   // defense-in-depth; RLS also filters
          .eq('technician_id', techData.id)
          .eq('date', todayISO)
          .in('status', ['confirmed', 'en_route', 'complete'])
          .order('start_time', { ascending: true }),
        supabase
          .from('technician_permissions')
          .select('feature, enabled')
          .eq('technician_id', techData.id),
      ]);
      if (jobsRes.error) throw jobsRes.error;
      setJobs(jobsRes.data || []);
      setPermissions(permsRes.data || []);
    } catch (err) {
      console.error('TechDashboard fetch error:', err);
      setError('Could not load your jobs. Tap Retry to try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const updateStatus = async (apt, newStatus) => {
    setUpdatingId(apt.id);
    try {
      const { error } = await supabase
        .from('appointments')
        .update({ status: newStatus })
        .eq('id', apt.id);
      if (error) throw error;

      // Optimistic update — don't wait for a re-fetch
      setJobs(prev => prev.map(j => j.id === apt.id ? { ...j, status: newStatus } : j));
      if (selectedJob?.id === apt.id) setSelectedJob(prev => ({ ...prev, status: newStatus }));

      if (newStatus === 'complete')  showToast('Job marked complete!');
      if (newStatus === 'en_route')  showToast("Status updated — on your way!");
    } catch (err) {
      console.error('Status update error:', err);
      showToast('Failed to update status. Please try again.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // onAuthStateChange SIGNED_OUT in App.jsx clears all state and renders Login
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 p-4">
        <div className="flex items-center justify-between mb-6">
          <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-gray-800 rounded-lg p-4 mb-3 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-700 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
        <p className="text-gray-400 text-center mb-4">{error}</p>
        <button
          onClick={() => { setLoading(true); fetchJobs(); }}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 pb-6">
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 left-4 right-4 z-50 bg-gray-700 text-white px-4 py-3 rounded-lg shadow-lg text-sm text-center">
          {toast}
        </div>
      )}

      {/* Job detail bottom sheet */}
      {selectedJob && (
        <JobDetail
          apt={selectedJob}
          permissions={permissions}
          updatingId={updatingId}
          onClose={() => setSelectedJob(null)}
          onUpdateStatus={updateStatus}
        />
      )}

      {/* Sticky header */}
      <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-4 py-3 z-10">
        <div className="flex items-center justify-between">
          <div>
            <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setLoading(true); fetchJobs(); }}
              className="p-2 hover:bg-gray-700 rounded-lg"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5 text-gray-400" />
            </button>
            <button onClick={handleLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
              <LogOut className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Jobs list */}
      <div className="p-4">
        <h2 className="text-lg font-semibold text-white mb-3">
          {techData.name} — Today's Jobs
        </h2>

        {jobs.length === 0 ? (
          <div className="bg-gray-800 rounded-lg p-8 text-center border border-gray-700">
            <CheckCircle className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No jobs scheduled for today.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map(apt => {
              const sc = STATUS_CONFIG[apt.status] || STATUS_CONFIG.confirmed;
              return (
                <button
                  key={apt.id}
                  onClick={() => setSelectedJob(apt)}
                  className="w-full bg-gray-800 rounded-lg p-4 border border-gray-700 text-left hover:border-gray-500 transition-colors active:bg-gray-750"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{apt.caller_name || 'Customer'}</p>
                      <p className="text-gray-400 text-sm mt-0.5">
                        {apt.start_time ? apt.start_time.slice(0, 5) : '—'}
                        {apt.end_time ? ` – ${apt.end_time.slice(0, 5)}` : ''}
                      </p>
                      {apt.address && (
                        <p className="text-gray-500 text-xs mt-1 truncate">
                          <MapPin className="w-3 h-3 inline mr-1" />{apt.address}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${sc.color}`}>
                        {sc.label}
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-500" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TechDashboard;
```

- [ ] **Step 2: Build to verify no syntax errors**

```bash
npm run build 2>&1 | head -20
```
Expected: `dist/` folder created, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/TechDashboard.jsx
git commit -m "feat: create TechDashboard mobile component with job list and detail modal"
```

---

### Task 12: Wire TechDashboard into App.jsx render waterfall

**Files:**
- Modify: `src/App.jsx`

Two changes: import `TechDashboard`, then add the hard-return guard before the `!clientData` check. This MUST be a hard `return` — falling through to line 1783 (`if (user && !clientData)`) would show "No Account Found" for techs, and falling to line 1814 (subscription gate) would crash reading null `clientData` properties.

- [ ] **Step 1: Add import at top of App.jsx**

After the existing component imports (around line 9), add:
```js
import TechDashboard from './TechDashboard';
```

- [ ] **Step 2: Add the tech render return**

The insertion point is after line 1780 (`return <Login onLogin={handleLogin} />;`) and before line 1783 (`if (user && !clientData)`).

Add:
```jsx
// Tech view — hard return before clientData null check and subscription gate
if (role === 'tech' && techData) {
  return <TechDashboard techData={techData} />;
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | head -20
```

- [ ] **Step 4: Smoke test tech login**

To test, first create a tech record with an email:
1. In Supabase dashboard → Table Editor → `technicians` → add `email` to an existing tech row (e.g. `testtech@example.com`)
2. In Supabase dashboard → Authentication → Users → Invite user with that email (or create manually)
3. Log in as that tech at http://localhost:3000
4. Expected: TechDashboard renders (Today's Jobs, no client dashboard visible)
5. Log out — expected: Login screen, no stale role state

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat: wire TechDashboard into App.jsx render waterfall with hard-return guard"
```

---

## Chunk 4: TeamTab Component + Nav Update

### Task 13: Create `src/TeamTab.jsx`

**Files:**
- Create: `src/TeamTab.jsx`

Owner view: full CRUD on technicians (name, phone, color, email, invite checkbox) + per-tech permission toggles for Phase 1 features + dispatcher management. Dispatcher view: read-only list (same data, no edit controls, no Add buttons).

- [ ] **Step 1: Create the file**

```jsx
// src/TeamTab.jsx
import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from './supabaseClient';

const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';

const TECH_COLORS = [
  { hex: '#3B82F6', name: 'Blue'   },
  { hex: '#10B981', name: 'Green'  },
  { hex: '#F59E0B', name: 'Amber'  },
  { hex: '#EF4444', name: 'Red'    },
  { hex: '#8B5CF6', name: 'Purple' },
  { hex: '#EC4899', name: 'Pink'   },
  { hex: '#06B6D4', name: 'Cyan'   },
  { hex: '#F97316', name: 'Orange' },
];

// Phase 1 permission features shown in the toggle panel
const PHASE1_FEATURES = [
  { key: 'job_notes',     label: 'Job Notes',     description: 'Can view job notes on device' },
  { key: 'on_my_way',     label: 'On My Way',     description: 'Can set status to En Route'   },
  { key: 'mark_complete', label: 'Mark Complete', description: 'Can mark jobs complete'        },
];

const formatPhone = (raw) => {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const callInviteFunction = async (email, name, role) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/invite-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ email, name, role }),
  });
  return res.json();
};

const TeamTab = ({ clientData, role }) => {
  const [technicians, setTechnicians]   = useState([]);
  const [staff, setStaff]               = useState([]);
  const [loading, setLoading]           = useState(true);

  // Tech form state
  const [showTechForm, setShowTechForm]     = useState(false);
  const [editingTechId, setEditingTechId]   = useState(null);
  const [techForm, setTechForm]             = useState({ name: '', phone: '', color: '#3B82F6', email: '', sendInvite: true });
  const [savingTech, setSavingTech]         = useState(false);
  const [techFormError, setTechFormError]   = useState(null);

  // Dispatcher form state
  const [showStaffForm, setShowStaffForm]   = useState(false);
  const [staffForm, setStaffForm]           = useState({ name: '', email: '' });
  const [savingStaff, setSavingStaff]       = useState(false);
  const [staffFormError, setStaffFormError] = useState(null);

  // Permission panel state
  const [expandedTechId, setExpandedTechId]       = useState(null);
  const [permissions, setPermissions]               = useState({});  // { [techId]: [{feature, enabled}] }
  const [savingPermTechId, setSavingPermTechId]     = useState(null);

  const isOwner = role === 'owner' || role === 'admin';

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    const [techRes, staffRes] = await Promise.all([
      supabase.from('technicians').select('*').eq('client_id', clientData.id).order('name'),
      supabase.from('client_staff').select('*').eq('client_id', clientData.id).order('name'),
    ]);
    setTechnicians(techRes.data || []);
    setStaff(staffRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [clientData.id]);

  // ── Permission helpers ─────────────────────────────────────────────────────
  const fetchPermissions = async (techId) => {
    const { data } = await supabase
      .from('technician_permissions')
      .select('feature, enabled')
      .eq('technician_id', techId);
    setPermissions(prev => ({ ...prev, [techId]: data || [] }));
  };

  const handleToggleExpand = async (techId) => {
    if (expandedTechId === techId) { setExpandedTechId(null); return; }
    setExpandedTechId(techId);
    if (!permissions[techId]) await fetchPermissions(techId);
  };

  const handleTogglePermission = async (techId, feature, currentEnabled) => {
    setSavingPermTechId(techId);
    try {
      await supabase
        .from('technician_permissions')
        .upsert(
          { technician_id: techId, client_id: clientData.id, feature, enabled: !currentEnabled },
          { onConflict: 'technician_id,feature' }
        );
      setPermissions(prev => ({
        ...prev,
        [techId]: (prev[techId] || []).map(p =>
          p.feature === feature ? { ...p, enabled: !currentEnabled } : p
        ),
      }));
    } catch (err) {
      console.error('Permission toggle error:', err);
    } finally {
      setSavingPermTechId(null);
    }
  };

  // ── Tech form handlers ─────────────────────────────────────────────────────
  const resetTechForm = () => {
    setTechForm({ name: '', phone: '', color: '#3B82F6', email: '', sendInvite: true });
    setShowTechForm(false);
    setEditingTechId(null);
    setTechFormError(null);
  };

  const handleEditTech = (tech) => {
    setTechForm({ name: tech.name, phone: tech.phone || '', color: tech.color || '#3B82F6', email: tech.email || '', sendInvite: false });
    setEditingTechId(tech.id);
    setShowTechForm(true);
    setTechFormError(null);
  };

  const handleSaveTech = async () => {
    setTechFormError(null);
    if (!techForm.name.trim()) { setTechFormError('Name is required.'); return; }
    if (!editingTechId && !techForm.email.trim()) { setTechFormError('Email is required for new technicians.'); return; }

    setSavingTech(true);
    try {
      let techId = editingTechId;

      if (editingTechId) {
        // Update existing tech
        const updateData = { name: techForm.name.trim(), phone: techForm.phone.trim() || null, color: techForm.color };
        if (techForm.email.trim()) updateData.email = techForm.email.trim().toLowerCase();
        const { error } = await supabase.from('technicians').update(updateData).eq('id', editingTechId);
        if (error) throw error;
      } else {
        // Insert new tech
        const { data, error } = await supabase
          .from('technicians')
          .insert({
            client_id: clientData.id,
            name: techForm.name.trim(),
            phone: techForm.phone.trim() || null,
            color: techForm.color,
            email: techForm.email.trim().toLowerCase(),
          })
          .select('id')
          .single();
        if (error) throw error;
        techId = data.id;

        // Insert default permissions for all 6 features
        await supabase.from('technician_permissions').insert([
          { technician_id: techId, client_id: clientData.id, feature: 'job_notes',              enabled: true  },
          { technician_id: techId, client_id: clientData.id, feature: 'on_my_way',              enabled: true  },
          { technician_id: techId, client_id: clientData.id, feature: 'mark_complete',          enabled: true  },
          { technician_id: techId, client_id: clientData.id, feature: 'gps_tracking',           enabled: false },
          { technician_id: techId, client_id: clientData.id, feature: 'customer_sms',           enabled: false },
          { technician_id: techId, client_id: clientData.id, feature: 'customer_tracking_link', enabled: false },
        ]);
      }

      // Fire invite (non-blocking — DB row is already saved)
      if (techForm.sendInvite && techForm.email.trim()) {
        try {
          const result = await callInviteFunction(techForm.email.trim().toLowerCase(), techForm.name.trim(), 'tech');
          if (result.existing) {
            alert('Tech saved. An account with this email already exists — they can log in immediately.');
          }
        } catch (inviteErr) {
          console.error('Invite failed (non-fatal):', inviteErr);
          alert('Tech saved, but the invite email could not be sent. You can resend it by editing the tech.');
        }
      }

      await fetchAll();
      resetTechForm();
    } catch (err) {
      console.error('Save tech error:', err);
      setTechFormError(err.message || 'Failed to save technician.');
    } finally {
      setSavingTech(false);
    }
  };

  const handleToggleTechActive = async (tech) => {
    try {
      await supabase.from('technicians').update({ is_active: !tech.is_active }).eq('id', tech.id);
      setTechnicians(prev => prev.map(t => t.id === tech.id ? { ...t, is_active: !tech.is_active } : t));
    } catch (err) {
      console.error('Toggle tech active error:', err);
    }
  };

  // ── Staff (dispatcher) form handlers ──────────────────────────────────────
  const resetStaffForm = () => {
    setStaffForm({ name: '', email: '' });
    setShowStaffForm(false);
    setStaffFormError(null);
  };

  const handleSaveStaff = async () => {
    setStaffFormError(null);
    if (!staffForm.name.trim()) { setStaffFormError('Name is required.'); return; }
    if (!staffForm.email.trim()) { setStaffFormError('Email is required.'); return; }

    setSavingStaff(true);
    try {
      const { error } = await supabase.from('client_staff').insert({
        client_id: clientData.id,
        name: staffForm.name.trim(),
        email: staffForm.email.trim().toLowerCase(),
        role: 'dispatcher',
      });
      if (error) throw error;

      // Always send invite for dispatchers (no checkbox — always required for login)
      try {
        const result = await callInviteFunction(staffForm.email.trim().toLowerCase(), staffForm.name.trim(), 'dispatcher');
        if (result.existing) {
          alert('Dispatcher saved. An account with this email already exists — they can log in immediately.');
        }
      } catch (inviteErr) {
        console.error('Dispatcher invite failed (non-fatal):', inviteErr);
        alert('Dispatcher saved, but the invite email could not be sent. Contact them to set up their account manually.');
      }

      await fetchAll();
      resetStaffForm();
    } catch (err) {
      console.error('Save staff error:', err);
      setStaffFormError(err.message || 'Failed to save dispatcher.');
    } finally {
      setSavingStaff(false);
    }
  };

  const handleToggleStaffActive = async (staffMember) => {
    try {
      await supabase.from('client_staff').update({ active: !staffMember.active }).eq('id', staffMember.id);
      setStaff(prev => prev.map(s => s.id === staffMember.id ? { ...s, active: !staffMember.active } : s));
    } catch (err) {
      console.error('Toggle staff active error:', err);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Technicians section ── */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Technicians</h3>
          {isOwner && !showTechForm && (
            <button
              onClick={() => { resetTechForm(); setShowTechForm(true); }}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
            >
              <Plus className="w-4 h-4" /> Add Tech
            </button>
          )}
        </div>

        {/* Add / Edit form (owner only) */}
        {isOwner && showTechForm && (
          <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-600 space-y-3">
            <p className="text-sm font-medium text-gray-300">
              {editingTechId ? 'Edit Technician' : 'New Technician'}
            </p>
            {techFormError && <p className="text-red-400 text-sm">{techFormError}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-400 text-xs mb-1">Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={techForm.name}
                  onChange={e => setTechForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Tech name"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Phone</label>
                <input
                  type="tel"
                  value={techForm.phone}
                  onChange={e => setTechForm(f => ({ ...f, phone: formatPhone(e.target.value) }))}
                  placeholder="(555) 123-4567"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-400 text-xs mb-1">
                Email {!editingTechId && <span className="text-red-400">*</span>}
                {editingTechId && <span className="text-gray-500 ml-1">(leave blank to keep existing)</span>}
              </label>
              <input
                type="email"
                value={techForm.email}
                onChange={e => setTechForm(f => ({ ...f, email: e.target.value }))}
                placeholder="tech@example.com"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-gray-400 text-xs mb-1">Calendar Color</label>
              <div className="flex gap-2 flex-wrap">
                {TECH_COLORS.map(c => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setTechForm(f => ({ ...f, color: c.hex }))}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${techForm.color === c.hex ? 'border-white scale-110' : 'border-transparent hover:border-gray-500'}`}
                    style={{ backgroundColor: c.hex }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            {!editingTechId && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={techForm.sendInvite}
                  onChange={e => setTechForm(f => ({ ...f, sendInvite: e.target.checked }))}
                  className="w-4 h-4 accent-blue-500"
                />
                <span className="text-sm text-gray-300">Send invite email to tech</span>
              </label>
            )}

            <div className="flex gap-2">
              <button onClick={resetTechForm} className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
                Cancel
              </button>
              <button
                onClick={handleSaveTech}
                disabled={savingTech || !techForm.name.trim()}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
              >
                {savingTech ? 'Saving...' : editingTechId ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {/* Tech list */}
        {technicians.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No technicians added yet.</p>
        ) : (
          <div className="space-y-2">
            {technicians.map(tech => {
              const isExpanded = expandedTechId === tech.id;
              const techPerms  = permissions[tech.id] || [];
              return (
                <div
                  key={tech.id}
                  className={`rounded-lg border ${tech.is_active ? 'bg-gray-750 border-gray-600' : 'bg-gray-750/50 border-gray-700'}`}
                >
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: tech.color || '#3B82F6' }} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${tech.is_active ? 'text-white' : 'text-gray-500 line-through'}`}>
                        {tech.name}
                      </p>
                      {tech.phone && <p className="text-xs text-gray-400">{tech.phone}</p>}
                      {tech.email && <p className="text-xs text-gray-500">{tech.email}</p>}
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleEditTech(tech)}
                          className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleTechActive(tech)}
                          className={`px-2 py-1 text-xs rounded ${tech.is_active ? 'text-amber-400 hover:bg-amber-900/30' : 'text-green-400 hover:bg-green-900/30'}`}
                        >
                          {tech.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => handleToggleExpand(tech.id)}
                          className="px-2 py-1 text-xs text-blue-400 hover:bg-blue-900/30 rounded flex items-center gap-0.5"
                        >
                          Perms {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Permission toggles — owner only, shown when expanded */}
                  {isOwner && isExpanded && (
                    <div className="border-t border-gray-600 px-3 py-3 space-y-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Permissions</p>
                      {PHASE1_FEATURES.map(feat => {
                        const permRow = techPerms.find(p => p.feature === feat.key);
                        const enabled = permRow ? permRow.enabled : true; // Phase 1 default on
                        return (
                          <div key={feat.key} className="flex items-center justify-between gap-3">
                            <div className="flex-1">
                              <p className="text-sm text-white">{feat.label}</p>
                              <p className="text-xs text-gray-500">{feat.description}</p>
                            </div>
                            <button
                              onClick={() => handleTogglePermission(tech.id, feat.key, enabled)}
                              disabled={savingPermTechId === tech.id}
                              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${enabled ? 'bg-blue-600' : 'bg-gray-600'} disabled:opacity-50`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
                              />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Dispatchers section (owner only) ── */}
      {isOwner && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Dispatchers</h3>
            {!showStaffForm && (
              <button
                onClick={() => { resetStaffForm(); setShowStaffForm(true); }}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
              >
                <Plus className="w-4 h-4" /> Add Dispatcher
              </button>
            )}
          </div>

          {showStaffForm && (
            <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-600 space-y-3">
              <p className="text-sm font-medium text-gray-300">New Dispatcher</p>
              {staffFormError && <p className="text-red-400 text-sm">{staffFormError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={staffForm.name}
                    onChange={e => setStaffForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Dispatcher name"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Email <span className="text-red-400">*</span></label>
                  <input
                    type="email"
                    value={staffForm.email}
                    onChange={e => setStaffForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="dispatcher@example.com"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">An invite email will be sent automatically.</p>
              <div className="flex gap-2">
                <button onClick={resetStaffForm} className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleSaveStaff}
                  disabled={savingStaff || !staffForm.name.trim() || !staffForm.email.trim()}
                  className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
                >
                  {savingStaff ? 'Saving...' : 'Add & Invite'}
                </button>
              </div>
            </div>
          )}

          {staff.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No dispatchers added yet.</p>
          ) : (
            <div className="space-y-2">
              {staff.map(s => (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${s.active ? 'bg-gray-750 border-gray-600' : 'bg-gray-750/50 border-gray-700'}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${s.active ? 'text-white' : 'text-gray-500 line-through'}`}>{s.name}</p>
                    <p className="text-xs text-gray-400">{s.email}</p>
                    <p className="text-xs text-gray-600 capitalize">{s.role}</p>
                  </div>
                  <button
                    onClick={() => handleToggleStaffActive(s)}
                    className={`px-2 py-1 text-xs rounded flex-shrink-0 ${s.active ? 'text-amber-400 hover:bg-amber-900/30' : 'text-green-400 hover:bg-green-900/30'}`}
                  >
                    {s.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
};

export default TeamTab;
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | head -20
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/TeamTab.jsx
git commit -m "feat: create TeamTab component with tech management, permission toggles, and dispatcher management"
```

---

### Task 14: Update nav items and wire TeamTab into App.jsx

**Files:**
- Modify: `src/App.jsx` (navItems constant ~line 1541, authenticated nav render ~line 1998, main content area ~line 1993)

- [ ] **Step 1: Add import for TeamTab at the top of App.jsx**

After `import TechDashboard from './TechDashboard';`, add:
```js
import TeamTab from './TeamTab';
```

- [ ] **Step 2: Replace the `navItems` constant block (lines 1541–1547)**

**Remove:**
```js
const navItems = [
  { id: 'appointments', label: 'Appointments', icon: Calendar },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'calls', label: 'Calls', icon: Phone },
  { id: 'billing', label: 'Billing', icon: DollarSign },
  { id: 'settings', label: 'Settings', icon: Settings }
];
```

**Replace with:**
```js
// Demo nav — unchanged (used by the isPublicDemo render block above)
const navItems = [
  { id: 'appointments', label: 'Appointments', icon: Calendar },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'calls', label: 'Calls', icon: Phone },
  { id: 'billing', label: 'Billing', icon: DollarSign },
  { id: 'settings', label: 'Settings', icon: Settings }
];

// Authenticated nav — owner gets 6 tabs, dispatcher gets 4 tabs
const teamTab = { id: 'team', label: 'Team', icon: Users };

const ownerNavItems = [
  { id: 'appointments', label: 'Appointments', icon: Calendar },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'calls', label: 'Calls', icon: Phone },
  teamTab,
  { id: 'billing', label: 'Billing', icon: DollarSign },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const dispatcherNavItems = [
  { id: 'appointments', label: 'Appointments', icon: Calendar },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'calls', label: 'Calls', icon: Phone },
  teamTab,
];

const activeNavItems = role === 'dispatcher' ? dispatcherNavItems : ownerNavItems;
```

- [ ] **Step 3: Update the authenticated bottom nav (around line 1998)**

Find:
```jsx
<div className="grid grid-cols-5 gap-1">
  {navItems.map(item => (
```

Replace with:
```jsx
<div className={`grid grid-cols-${activeNavItems.length} gap-1`}>
  {activeNavItems.map(item => (
```

- [ ] **Step 4: Guard billing/settings content blocks from dispatcher**

Find the billing tab content block:
```jsx
{activeTab === 'billing' && (
```
Change to:
```jsx
{activeTab === 'billing' && role !== 'dispatcher' && (
```

Find the settings tab content block:
```jsx
{activeTab === 'settings' && (
```
Change to:
```jsx
{activeTab === 'settings' && role !== 'dispatcher' && (
```

- [ ] **Step 5: Add team tab content block**

After the settings block (before the closing `</main>`), add:
```jsx
{activeTab === 'team' && (
  <>
    <div className="flex items-center justify-between mb-3">
      <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
      <div className="flex items-center gap-1">
        {clientData?.is_admin && (
          <button onClick={() => setShowAdmin(true)} className="p-2 hover:bg-gray-700 rounded-lg" title="Admin Dashboard">
            <Settings className="w-5 h-5 text-gray-400" />
          </button>
        )}
        <button onClick={handleLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
          <LogOut className="w-5 h-5 text-gray-400" />
        </button>
      </div>
    </div>
    <TeamTab clientData={clientData} role={role} />
  </>
)}
```

- [ ] **Step 6: Build**

```bash
npm run build 2>&1 | head -20
```
Expected: No errors.

- [ ] **Step 7: Manual test — owner sees 6 tabs with Team tab**

```bash
npm run dev
```
1. Log in as owner account
2. Verify: bottom nav shows 6 tabs (Appointments, Customers, Calls, Team, Billing, Settings)
3. Click **Team** tab — TeamTab renders with tech list + "Add Tech" button
4. Add a new tech with email, check invite box — verify tech row appears and invite triggers (check Supabase Auth → Users for the new invite)
5. Expand "Perms" on a tech — verify 3 toggle switches appear (Job Notes, On My Way, Mark Complete)
6. Toggle one off, then refresh page — verify the toggle state persisted (check `technician_permissions` table in Supabase)
7. Add a dispatcher — verify row appears in Dispatchers section

- [ ] **Step 8: Manual test — dispatcher sees 4 tabs**

1. Add a dispatcher row to `client_staff` via Supabase dashboard
2. Create auth user for that email
3. Log in as dispatcher
4. Verify: 4-tab nav (Appointments, Customers, Calls, Team)
5. Click Team tab — tech list visible, no "Add Tech" button, no Perms toggles
6. Billing and Settings are not in nav and cannot be accessed

- [ ] **Step 9: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add 6-tab owner nav, 4-tab dispatcher nav, TeamTab wired into App.jsx"
```

---

## Chunk 5: invite-user Edge Function

### Task 15: Create and deploy `invite-user` Edge Function

**Files:**
- Create: `supabase/functions/invite-user/index.ts`

This function is the only way to call `auth.admin.inviteUserByEmail` — it requires the service role key which cannot be used client-side. The caller must be an authenticated owner (verified by JWT + `clients` table lookup). The function deduplicates by calling `auth.admin.getUserByEmail()` — a direct lookup that avoids the 50-user pagination limit of `listUsers()`.

- [ ] **Step 1: Create the function**

```typescript
// supabase/functions/invite-user/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Authenticate caller ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Verify caller is an owner ────────────────────────────────────────────
    const { data: callerClient } = await supabase
      .from("clients")
      .select("id")
      .eq("email", user.email)
      .maybeSingle();
    if (!callerClient) {
      return new Response(JSON.stringify({ error: "Only owners can send invitations" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Validate request body ────────────────────────────────────────────────
    const { email, name, role } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Dedup check: email already in auth.users? ────────────────────────────
    // Using getUserByEmail (direct lookup) instead of listUsers() which only
    // returns the first 50 users and would miss existing accounts beyond that.
    const { data: existingUser } = await supabase.auth.admin.getUserByEmail(email);
    if (existingUser?.user) {
      console.log(`invite-user: ${email} already exists — skipping invite`);
      return new Response(JSON.stringify({ existing: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Send invite ──────────────────────────────────────────────────────────
    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email);
    if (inviteError) {
      console.error("inviteUserByEmail error:", inviteError);
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`invite-user: sent invite to ${email} (role: ${role || "unspecified"})`);
    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("invite-user error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Deploy the function**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy invite-user --project-ref zmppdmfdhknnwzwdfhwf --no-verify-jwt
```

Expected output: `Deployed Function invite-user`

- [ ] **Step 3: Smoke test — invite a new user**

```bash
# Get an owner JWT by logging into the app and copying from browser devtools Network tab
# (look for any Supabase request → Authorization header → Bearer <token>)

curl -X POST \
  https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1/invite-user \
  -H "Authorization: Bearer <owner-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"email":"newtech@example.com","name":"New Tech","role":"tech"}'
```

Expected: `{"sent":true}` — and an invite email appears in Supabase Auth → Users.

- [ ] **Step 4: Smoke test — existing user returns `existing: true`**

```bash
curl -X POST \
  https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1/invite-user \
  -H "Authorization: Bearer <owner-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"email":"gmacdonald63@gmail.com","name":"Owner","role":"owner"}'
```

Expected: `{"existing":true}` — no duplicate invite sent.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/invite-user/index.ts
git commit -m "feat: add invite-user Edge Function for server-side auth invitations with dedup check"
```

---

## Chunk 6: Final Integration Verification

### Task 16: End-to-end integration test

This task has no code changes. It verifies all five paths through the auth flow work correctly together.

- [ ] **Step 1: Test owner login flow**

1. Start dev server: `npm run dev`
2. Log in as owner (e.g. `gmacdonald63@gmail.com`)
3. Expected: Role resolves to `owner`, 6-tab nav appears
4. Navigate all 6 tabs — no crashes, Team tab shows technicians
5. Log out — login screen appears, no stale state

- [ ] **Step 2: Test tech login flow**

Prerequisites:
- A row in `technicians` with `email` set and `is_active = true`
- A Supabase auth user with that email (use invite flow from Team tab, or create manually)

Steps:
1. Log in as that tech email
2. Expected: `TechDashboard` renders (not the main dashboard)
3. Verify today's jobs list loads (may be empty — that's fine: "No jobs scheduled for today.")
4. If an appointment exists: tap a job card → job detail bottom sheet opens → Navigate button links to Google Maps
5. Log out — login screen appears

- [ ] **Step 3: Test dispatcher login flow**

Prerequisites:
- A row in `client_staff` with `email`, `active = true`, and a valid `client_id`
- A Supabase auth user with that dispatcher email

Steps:
1. Log in as dispatcher
2. Expected: 4-tab nav (Appointments, Customers, Calls, Team)
3. Verify: NO Billing or Settings tabs
4. Click Team tab — tech list visible, no "Add Tech" button, no Perms toggles
5. Log out — login screen appears

- [ ] **Step 4: Test unknown user is rejected**

1. Create a Supabase auth user that is NOT in `clients`, `client_staff`, or `technicians`
2. Log in as that user
3. Expected: `resolveRole()` reaches Step 4 → `supabase.auth.signOut()` → login screen reappears
4. Verify: no crash, no "No Account Found" page, clean redirect to login

- [ ] **Step 5: Test page refresh retains session**

1. Log in as owner
2. Hard-refresh the page (Ctrl+R)
3. Expected: `getSession` fires → `setUser` → `useEffect([user])` resolves role → dashboard loads without login screen

- [ ] **Step 6: Final commit (if any cleanup)**

```bash
git add -p  # review any uncommitted changes
git commit -m "feat: Phase 1 tech dashboard complete — tech auth, jobs view, team tab, dispatcher role"
```

---

## Phase 2 Preview (out of scope for this plan)

When Phase 1 is stable, Phase 2 adds:
- `tech_locations` table + `prune-tech-locations` Edge Function (daily cron)
- GPS tracking in TechDashboard (`navigator.geolocation.watchPosition`)
- `send-tech-sms` Edge Function (Twilio)
- `get-tracking-data` Edge Function
- `TrackingPage.jsx` component + `?track=` render block in App.jsx
- Mapbox dispatch map in TeamTab (Map/List toggle)
- Phase 2 permission toggles in TeamTab (gps_tracking, customer_sms, customer_tracking_link)
- Backfill migration for existing techs missing Phase 2 permission rows
