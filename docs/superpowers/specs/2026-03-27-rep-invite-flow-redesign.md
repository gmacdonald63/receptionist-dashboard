# Spec: Sales Rep Invite Flow Redesign
**Date:** 2026-03-27
**Status:** Approved

---

## Problem

The current sales rep invite flow in `Admin.jsx` calls `supabase.auth.signUp()` followed by `supabase.auth.resetPasswordForEmail()`. This triggers two Supabase Auth emails per invite, both counting against Supabase's auth email rate limiter. The emails use Supabase's generic "Confirm Your Signup" template — wrong copy, wrong branding. When a rep clicks the link they are logged straight in without being prompted to set a password, leaving them with no usable credentials.

---

## Solution

Replace the Supabase Auth email flow with the same `generateLink` + `send-notification` → Resend pattern used for client activation. Zero Supabase auth emails sent for rep invites. Rep receives a branded email, clicks a link, lands on a clean password-setup page, sets their password, and is routed to the SalesRepDashboard via App.jsx role resolution.

---

## Email Strategy (Reference)

| Flow | Email sender | Notes |
|---|---|---|
| Rep invite | Resend API via `send-notification` | This spec |
| Client onboarding invite | Resend API via `send-notification` | Already done |
| Client activation invite | Resend API via `send-notification` | Already done |
| Forgot password | Supabase Auth → Resend SMTP | Must stay — baked into Supabase security model |
| All notifications | Resend API via `send-notification` | Already done |

---

## Architecture

### 1. New Edge Function: `invite-rep`

**Purpose:** Generate invite tokens for sales reps and send a branded email via Resend. No Supabase auth email sent.

**Precondition:** The rep's `clients` row must already exist (created by the admin via "Add Rep" in Admin.jsx) before `invite-rep` is called. The function receives a `client_id` and looks up the existing row — it does not create new rows.

**Auth:** JWT in `Authorization` header → `auth.getUser()` → look up `clients` row → reject (`403`) if `!is_admin`.

**Input:**
```json
{ "client_id": 42 }
```

**Steps:**
1. Look up target client by `client_id` — `404` if not found
2. Validate `is_sales_rep: true` — return `400 { error: "not_a_rep" }` if not. Prevents the rep invite flow from being used on a regular client row (which would bypass their subscription setup and land them on the wrong dashboard).
3. Call `supabase.auth.admin.generateLink({ type: 'invite', email: targetClient.email })` — Supabase generates a token without sending any email
4. If step 3 fails (user already exists in Supabase Auth — resend scenario), fall back to `supabase.auth.admin.generateLink({ type: 'recovery', email: targetClient.email })`. This fallback is intentional: on a resend, the rep already has a Supabase Auth account so `invite` type fails. The `verify-activation` function tries both `type: 'invite'` and `type: 'recovery'` OTP verification, so either token type works transparently.
5. If both fail, log error and return `500`
6. Generate `activation_token = crypto.randomUUID()`
7. Write to `clients` row in one update: `{ activation_token, invite_token_hash: linkData.properties.hashed_token, invite_sent: true, invite_sent_at: new Date().toISOString() }`. This also invalidates any previous invite link by overwriting the old `activation_token` and `invite_token_hash`.
8. Call `send-notification` with `rep_invite` template using anon key as both `apikey` header and `Authorization: Bearer` header (same server-to-server pattern as `send-activation-invite`). `send-notification` is deployed with `--no-verify-jwt`. If the call returns a non-ok response, throw — return `500`.
9. Return `{ sent: true }`

**`rep_name` field:** Use `targetClient.company_name || targetClient.email` as the display name. There is no dedicated `name` column for reps; `company_name` is the correct field. Fall back to email if `company_name` is null.

**Error responses:**
- `401` — missing/invalid JWT
- `403` — caller is not admin
- `404` — client not found
- `400 { error: "not_a_rep" }` — target client is not a sales rep
- `500` — token generation or email send failed

---

### 2. New Template: `rep_invite` in `send-notification`

**`NotificationRequest` interface update:** Add `rep_name?: string` to the existing interface.

Added as an early-return branch before the deal lookup (same pattern as `activation_invite`).

**Required fields:** `to`, `rep_name`, `activation_token`

**Email:**
- **From:** `"Reliant Support <noreply@reliantsupport.net>"` (same as all other emails)
- **Subject:** "You've been invited to Reliant Support"
- **Heading:** "Welcome to Reliant Support"
- **Body:** "You've been added as a sales rep. Click below to set your password and access your dashboard."
- **CTA button:** "Set My Password" → `https://app.reliantsupport.net/?rep-invite=<activation_token>`
- **Footer:** "If you have any questions, contact us at support@reliantsupport.net"

If `rep_name` is empty/null, fall back to `to` (the email address) in the email greeting.

---

### 3. `App.jsx` Updates

Two additions mirroring the existing `?activate=` handling.

**Auth loading bypass** — inside the `getSession().then()` callback at the same location as the existing `?activate=` bypass:
```js
if (new URLSearchParams(window.location.search).get('rep-invite')) {
  setAuthLoading(false);
  return;
}
```
With `authLoading` set to `false` by the bypass, the render-time route fires without delay regardless of where it sits relative to the authLoading spinner block.

**Render-time route** — placed at the same location as the existing `?activate=` route guard (after the authLoading spinner block, alongside the other URL-param-driven routes):
```jsx
import RepSetPasswordPage from './pages/RepSetPasswordPage.jsx';

const _repInviteToken = _onboardParams.get('rep-invite');
if (_repInviteToken) {
  return <RepSetPasswordPage repInviteToken={_repInviteToken} />;
}
```

**`onAuthStateChange` handler:** The existing `SIGNED_IN` handler that routes newly-invited users (those with `invited_at` and no `last_sign_in_at`) to `<ResetPassword />` does not need modification. Reps arrive via the custom `?rep-invite=` branded URL and never trigger the Supabase magic-link `SIGNED_IN` event. No collision occurs.

---

### 4. New Component: `src/pages/RepSetPasswordPage.jsx`

**Props:** `repInviteToken`

**No load-time fetch.** Page renders immediately with static welcome content. Token validity is verified on form submit when `verify-activation` is called. A rep with an expired link will not see an error until they submit — this is an accepted trade-off given the 7-day expiry window. If `verify-activation` succeeds but the subsequent `setSession()` or redirect fails, the tokens are already cleared server-side; the rep cannot retry with the same link and must request a resend. This is the same trade-off as the client activation flow.

**UI:**
- Heading: "Welcome to Reliant Support"
- Subtext: "You've been added as a sales rep. Please set your password to access your dashboard."
- Password field — `type="password"`, `required`, placeholder "Minimum 8 characters"
- Confirm Password field — `type="password"`, `required`, placeholder "Re-enter your password"
- "Set My Password" submit button, disabled while `loading`

**Client-side validation (run before calling API):**
- `password.length < 8` → show "Password must be at least 8 characters."
- `password !== confirmPassword` → show "Passwords do not match."

**Submit flow:**
1. Call `verify-activation` edge function with `Content-Type` and `apikey` headers only (no `Authorization` header — matches the header set accepted by `verify-activation`'s CORS config):
   ```js
   fetch(`${SUPABASE_URL}/functions/v1/verify-activation`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
     body: JSON.stringify({ activation_token: repInviteToken, password }),
   })
   ```
2. On `{ access_token, refresh_token }`: call `supabase.auth.setSession({ access_token, refresh_token })` → `window.location.href = '/'`. App.jsx re-renders, `resolveRole()` detects `is_sales_rep: true` on the rep's `clients` row, and renders `SalesRepDashboard`. This is an indirect redirect via role resolution — no direct navigation to a `/sales-rep` route is needed.
3. On `{ error: 'token_expired' }`: show "This invite link has expired. Please contact support@reliantsupport.net to be resent an invite."
4. On any other error or non-ok response: show "Something went wrong. Please try again."

**Cross-flow note:** `verify-activation` is shared between client activation and rep invite flows. It accepts any valid `activation_token` / `invite_token_hash` pair without checking user type. Cross-use is prevented upstream: `invite-rep` validates `is_sales_rep: true` before writing a token to any row, so a client row will never carry a `?rep-invite=` token.

**Token invalidation mechanism:** Each `invite-rep` call overwrites `activation_token` and `invite_token_hash` on the rep's `clients` row. The old `activation_token` is orphaned — `verify-activation` will return `404 { error: "Invalid activation link." }` for any old links. Note: an old link will surface as "Invalid activation link" rather than "expired" — this is consistent with the existing `verify-activation` behavior and acceptable for this flow.

**Token expiry:** 7 days. After expiry, `verify-activation` will return `{ error: 'token_expired' }` with HTTP 200.

---

### 5. `Admin.jsx` — `handleSendRepInvite` Replacement

**Remove entirely:**
- Temp password generation (`Math.random().toString(36)...`)
- `supabase.auth.signUp()` call
- `supabase.auth.resetPasswordForEmail()` call
- Client-side `supabase.from('clients').update({ invite_sent, invite_sent_at })` — the edge function handles this; the duplicate client-side write must be removed to avoid clobbering the edge function's timestamp

**Replace with a single fetch to `invite-rep`:**
```js
const { data: { session } } = await supabase.auth.getSession();
const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-rep`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({ client_id: record.id }),
});
const data = await res.json();
if (!res.ok) throw new Error(data.error || 'Failed to send invite');
```

**Keep unchanged:** `setSendingInvite`, `setError(null)`, `setSuccessMessage(...)`, `catch` block, `fetchAllRecords()`, `finally { setSendingInvite(null) }`.

**`handleResendRepInvite`:** No changes needed. It calls `handleSendRepInvite` and automatically inherits the new behavior.

---

## Files Changed

| File | Change type |
|---|---|
| `supabase/functions/invite-rep/index.ts` | New |
| `supabase/functions/send-notification/index.ts` | Add `rep_name?: string` to interface + add `rep_invite` branch |
| `src/App.jsx` | Add `?rep-invite=` bypass + route + import |
| `src/pages/RepSetPasswordPage.jsx` | New |
| `src/Admin.jsx` | Replace `handleSendRepInvite` body |

## Files Unchanged

- `supabase/functions/verify-activation/index.ts` — reused as-is
- `src/Admin.jsx` `handleResendRepInvite` — inherits new behavior automatically

---

## Success Criteria

1. Admin clicks "Send Invite" for a rep → no Supabase auth email sent, no rate limit consumed
2. Rep receives branded email from `noreply@reliantsupport.net` with "Set My Password" CTA
3. Rep clicks link → lands on `RepSetPasswordPage` with welcome message and password form
4. Rep sets password → `supabase.auth.setSession()` called → `window.location.href = '/'` → role resolution → SalesRepDashboard
5. Admin clicks "Resend Invite" → new token generated, old token invalidated, new email sent
6. Expired link → error message shown on submit with support@reliantsupport.net
7. Old/overwritten link → "Invalid activation link" error on submit
8. Calling `invite-rep` with a non-rep `client_id` → `400 { error: "not_a_rep" }`
