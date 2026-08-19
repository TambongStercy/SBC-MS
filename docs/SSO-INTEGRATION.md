# SBC SSO — Integration Guide

How to add **"Log in with SBC"** to a satellite app (SBC Live, SBC Shop, …) and
read the user's profile, subscription, and referral network.

Source of truth: `user-service/src/services/sso.service.ts`,
`.../api/controllers/sso.controller.ts`, `.../api/routes/sso.routes.ts`,
`.../database/models/sso-client.model.ts`.

---

## 1. What it is

An **OAuth 2.0 authorization-code flow**, adapted for SBC's SPA architecture
(Bearer JWTs in `localStorage`, no session cookies). The standard browser
redirect-to-consent step is replaced by a backend POST that consumes the user's
**existing SBC JWT** and mints a short-lived auth code; your app's **backend**
then exchanges that code for tokens server-to-server.

SSO tokens are signed with a **separate secret** from the main SBC user JWT, so
the two are not interchangeable — an SBC login token can't be used as an SSO
access token and vice-versa.

### The flow

```
 ┌────────────┐   1. user clicks "Log in with SBC"        ┌──────────────────┐
 │  Your app  │ ───────────────────────────────────────▶ │  SBC web (SPA)   │
 │ (frontend) │                                           │  consent screen  │
 └────────────┘                                           └──────────────────┘
        ▲                                                          │
        │                          2. POST /api/sso/grant-code     │ (user's SBC JWT)
        │                             → { code }                    ▼
        │  3. redirect to                                   ┌──────────────┐
        │     ${redirect_uri}?code=…&state=…                │ user-service │
        │◀──────────────────────────────────────────────── │   (SSO)      │
        │                                                   └──────────────┘
 ┌────────────┐   4. POST /api/sso/token {code, secret}           ▲
 │  Your app  │ ─────────────────────────────────────────────────┘
 │ (backend)  │   ← { access_token, refresh_token, user }
 └────────────┘   5. GET /api/sso/userinfo (Bearer access_token) for fresh data
```

- **Steps 1–3** happen in the browser, driven by SBC's own web app.
- **Steps 4–5** happen server-to-server from **your backend** (the
  `client_secret` must never touch a browser).

---

## 2. Base URL

Everything is proxied through the gateway:

| Environment | Base |
|---|---|
| Production | `https://sniperbuisnesscenter.com/api/sso` |
| Preprod | `https://preprod.sniperbuisnesscenter.com/api/sso` |

All request/response bodies are JSON. Every response is
`{ success: boolean, data?: …, message?: string }`.

---

## 3. Register your client (one-time, done by SBC admin)

Clients live in the `ssoclients` collection. Provision one with the seed script
in `user-service`:

```bash
npx ts-node src/scripts/seed-sso-client.ts \
    --clientId=sbc-shop \
    --name="SBC Shop" \
    --redirectUri=https://shop.sniperbuisnesscenter.com/auth/callback \
    --redirectUri=http://localhost:5175/auth/callback \
    --scope=profile.read \
    --scope=referrals.read
```

It generates a random `client_secret`, stores only its **bcrypt hash**, and
**prints the plaintext secret once** — copy it into your app's backend env
(`SBC_SSO_CLIENT_ID`, `SBC_SSO_CLIENT_SECRET`). It cannot be recovered later; to
rotate, re-run the script (it upserts by `clientId`).

**Client record fields** (`sso-client.model.ts`):

| Field | Meaning |
|---|---|
| `clientId` | Public identifier (e.g. `sbc-shop`) |
| `clientSecretHash` | bcrypt hash of the secret; `select:false` |
| `redirectUris[]` | Exact-match whitelist. A `redirect_uri` not in here is rejected |
| `allowedScopes[]` | The scopes this client may request (default `['profile.read']`) |
| `enabled` | Kill switch; a disabled client authenticates as "invalid credentials" |
| `webhookUrl?`, `webhookSecret?` | Optional — outbound webhooks (see §9) |

---

## 4. Scopes

| Scope | Grants |
|---|---|
| `profile.read` | `GET /userinfo` — identity, subscription, referral count. **Required for login.** |
| `referrals.read` | `GET /referrals/relationship` and `GET /referrals/list` |
| `payments.write` | Reserved for SSO-driven payment flows (payment-service) |

`grant-code` intersects requested scopes with the client's `allowedScopes`; only
the intersection is granted. Requesting a scope the client isn't allowed to use
is silently dropped, and if the intersection is empty the request 400s.

---

## 5. Endpoints

### 5.1 `POST /api/sso/grant-code` — mint an auth code

Called by **SBC's own frontend** (not your servers) after the user consents.

- **Auth:** `Authorization: Bearer <SBC user JWT>`
- **Body:** `{ client_id, redirect_uri, scopes: string[] }`

```json
// 200
{ "success": true, "data": {
    "code": "a1b2…(40 hex)",
    "expiresAt": "2026-08-19T14:10:00.000Z",
    "grantedScopes": ["profile.read", "referrals.read"]
}}
```

The code is **one-shot** and lives **10 minutes**. SBC's frontend redirects the
browser to `${redirect_uri}?code=<code>&state=<your-state>`.

### 5.2 `POST /api/sso/token` — exchange code for tokens

Called by **your backend**, server-to-server.

- **Auth:** `client_secret` in the body
- **Body:** `{ code, client_id, client_secret, redirect_uri }`
  (`redirect_uri` must match the one used in `grant-code`)

```json
// 200
{ "success": true, "data": {
    "access_token": "<JWT>",
    "refresh_token": "<JWT>",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "profile.read referrals.read",
    "user": { /* SsoUserInfo — see §6 */ }
}}
```

Replay-safe: the code is atomically marked used; a second exchange 400s
(`"Invalid, expired, or already-used authorization code"`). A `redirect_uri`
mismatch 400s and is logged as an attack indicator.

### 5.3 `GET /api/sso/userinfo` — fresh user profile

- **Auth:** `Authorization: Bearer <access_token>` (needs `profile.read`)
- Returns the current [`SsoUserInfo`](#6-the-user-payload-ssouserinfo). **Call
  this on each session creation** rather than trusting the snapshot from token
  exchange — subscription state changes.

### 5.4 `POST /api/sso/refresh` — rotate an expired access token

- **Auth:** `client_secret` in the body
- **Body:** `{ refresh_token, client_id, client_secret }`
- Returns a new `access_token` **and** a new `refresh_token` (rolling refresh),
  same shape as token (minus `user`).

### 5.5 `GET /api/sso/referrals/relationship` — is the caller a direct filleul of X?

- **Auth:** `Bearer <access_token>` (needs `referrals.read`)
- **Query:** `sponsorId=<24-char ObjectId>`

```json
{ "success": true, "data": {
    "isDirectFilleul": true,
    "depth": 1,               // 1 if direct, null otherwise
    "callerId": "…",
    "sponsorId": "…"
}}
```

Direction is **caller → sponsor only** ("am I one of X's filleuls?"). Only
Niveau-1 (direct) counts as a filleul.

### 5.6 `GET /api/sso/referrals/list` — the caller's own direct filleuls

- **Auth:** `Bearer <access_token>` (needs `referrals.read`)
- **Query:** `page` (default 1), `pageSize` (default 50, capped at 100)
- The caller is derived from the token — there is **no** `userId` param, so a
  leaked token can only enumerate its own owner's network.

```json
{ "success": true, "data": {
    "total": 132, "page": 1, "pageSize": 50, "totalPages": 3, "hasMore": true,
    "items": [
        { "id": "…", "name": "Awa N.", "avatarUrl": "https://…", "joinedAt": "2026-05-01T…" }
    ]
}}
```

---

## 6. The user payload (`SsoUserInfo`)

Returned by `token` (as `data.user`) and by `userinfo`:

```ts
{
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  country: string | null;
  avatarUrl: string | null;
  subscriptionTypes: string[];   // e.g. [] | ["CLASSIQUE"] | ["CIBLE","RELANCE"] | ["VISIBILITE_MAX"]
  directReferralCount: number;   // paid level-1 referrals
  isActivated: boolean;          // true if any active subscription
  sbcLiveBalance: number;        // XAF creator earnings (read-only here)
}
```

- **Subscription check:** read `subscriptionTypes` / `isActivated`. Registration
  tiers are `CLASSIQUE` / `CIBLE`; feature subs include `RELANCE`,
  `VISIBILITE_MAX`.
- **SBC Live creation gate**, as an example rule: `directReferralCount >= 25 ||
  subscriptionTypes.includes('VISIBILITE_MAX')`.

---

## 7. Token lifetimes & secrets

| | Default | Env (user-service) |
|---|---|---|
| Access token | `1h` | `SSO_ACCESS_TOKEN_TTL` |
| Refresh token | `30d` | `SSO_REFRESH_TOKEN_TTL` |
| Auth code | 10 min (fixed) | — |
| Signing secret | — | `SSO_JWT_SECRET` (distinct from the main user JWT secret) |

Tokens are stateless JWTs (`{ sub, client_id, scopes, type }`). There is no
server-side revocation list today — a short access TTL + refresh rotation is the
control. Keep the access token in your backend session; **never** expose the
`client_secret` or refresh token to the browser.

---

## 8. End-to-end example

**Frontend (your app) — start the flow:**
```
// Send the user to SBC's consent screen with your params.
// Route: /sso/authorize — reads client_id, redirect_uri, scope, state from the
// query string. Scopes are space-separated.
window.location.href =
  `https://sniperbuisnesscenter.com/sso/authorize` +
  `?client_id=sbc-shop` +
  `&redirect_uri=${encodeURIComponent('https://shop.sniperbuisnesscenter.com/auth/callback')}` +
  `&scope=${encodeURIComponent('profile.read referrals.read')}` +
  `&state=${csrfState}`;
// SBC's SPA authenticates the user, calls POST /api/sso/grant-code itself,
// then redirects back to your redirect_uri with ?code=…&state=…
```

**Backend (your app) — the callback handler:**
```js
// GET /auth/callback?code=…&state=…
const { data } = await axios.post(
  'https://sniperbuisnesscenter.com/api/sso/token',
  {
    code,
    client_id: process.env.SBC_SSO_CLIENT_ID,
    client_secret: process.env.SBC_SSO_CLIENT_SECRET,
    redirect_uri: 'https://shop.sniperbuisnesscenter.com/auth/callback',
  },
);
const { access_token, refresh_token, user } = data.data;
// create YOUR session; store tokens server-side, keyed to it.

// later, refresh the profile (subscription may have changed):
const me = await axios.get(
  'https://sniperbuisnesscenter.com/api/sso/userinfo',
  { headers: { Authorization: `Bearer ${access_token}` } },
);
if (!me.data.data.isActivated) denyPaidFeature();
```

**When the access token expires (401):**
```js
const { data } = await axios.post('https://sniperbuisnesscenter.com/api/sso/refresh', {
  refresh_token,
  client_id: process.env.SBC_SSO_CLIENT_ID,
  client_secret: process.env.SBC_SSO_CLIENT_SECRET,
});
// persist data.data.access_token AND data.data.refresh_token (both rotate)
```

---

## 9. Webhooks (optional)

If your client has a `webhookUrl`/`webhookSecret`, SBC services (currently
payment-service) POST SSO-linked events to it, signed with the secret. The secret
is `select:false` and only handed out internally via
`GET /api/users/internal/sso-clients/:clientId/webhook-config` (SERVICE_SECRET
gated). Set it at provisioning with `--webhookUrl=…`. Skip this section if your
app only needs login + profile.

---

## 10. Errors

| Status | When |
|---|---|
| 400 | Missing params; empty/disallowed scopes; expired/used/invalid code; `redirect_uri` mismatch; wrong token type |
| 401 | Missing/!Bearer token; invalid `client_id`/`client_secret`; disabled client |
| 403 | Access token lacks the required scope (`profile.read` / `referrals.read`) |
| 429 | Rate limited — `token` and `refresh` are strict-limited (brute-force targets) |

Every error is `{ "success": false, "message": "<reason>" }`.

---

## 11. Security checklist for integrators

- `client_secret`, `access_token`, `refresh_token` live **only** on your backend.
  The browser sees the `code` (one-shot, 10-min) and your own session cookie.
- Always send a `state` and verify it on callback (CSRF).
- Register **exact** `redirect_uri`s — no wildcards; mismatches are rejected.
- Don't cache `isActivated`/`subscriptionTypes` long — re-hit `userinfo` when it
  matters (subscriptions expire and get upgraded).
- Request the **fewest scopes** you need. Login = `profile.read` only.
