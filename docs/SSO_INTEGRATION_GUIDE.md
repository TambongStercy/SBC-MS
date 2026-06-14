# SBC SSO Integration Guide

Authoritative reference for integrating a third-party app with **"Log in with SBC"**.

Initial consumer: SBC Live (`live.sniperbuisnesscenter.com`). The same flow works
for any future app — only the registered `client_id` / `redirect_uri` differ.

---

## TL;DR

1. SBC's frontend gives your app a short-lived **authorization code** after the
   user approves your app on a consent screen.
2. Your **backend** exchanges that code for an **access token** + **refresh token**
   + the user's profile.
3. Your backend stores those tokens, creates a session for the user.
4. When the access token expires (1h), your backend uses the refresh token (30d)
   to get a new one.

```
┌──────────┐  1. /sso/authorize        ┌─────────────────┐
│ SBC Live │ ───────────────────────►  │  SBC frontend   │
│ (browser)│   (consent screen)         │ sniperbuiness…  │
└──────────┘                            └─────────────────┘
                                              │
                                              │ 2. POST /api/sso/grant-code
                                              ▼  (with SBC user JWT)
                                        ┌─────────────────┐
                                        │  SBC backend    │
                                        └─────────────────┘
                                              │
                                              │ 3. redirect_uri?code=...
                                              ▼
┌──────────┐  4. POST /api/sso/token   ┌─────────────────┐
│ SBC Live │ ◄───── server-to-server ─►│  SBC backend    │
│ backend  │     (access + refresh +   │                 │
│          │      user payload)        └─────────────────┘
└──────────┘
```

---

## Prerequisites

Before you can integrate, an SBC admin must register your app and give you:

| Field | Example | Notes |
|---|---|---|
| `client_id` | `sbc-live` | Public. Goes in the authorize URL the user sees. |
| `client_secret` | `2bd6f9…` | **Secret.** Never expose to the browser. Backend-only. |
| `redirect_uri(s)` | `https://live.sniperbuisnesscenter.com/auth/callback` | Whitelisted. Must match exactly on every request. |
| `allowed_scopes` | `profile.read`, `payments.write` | Maximum your app can request. |

To register, ask an SBC operator to run the seed script:

```bash
cd user-service
npx ts-node src/scripts/seed-sso-client.ts \
  --clientId=sbc-live \
  --name="SBC Live" \
  --redirectUri=https://live.sniperbuisnesscenter.com/auth/callback \
  --redirectUri=http://localhost:5174/auth/callback \
  --scope=profile.read \
  --scope=payments.write
```

The script prints the secret **once**. Save it in the SBC-Live backend's secret
manager. Re-running the script rotates the secret.

---

## Scopes

| Scope | Grants access to |
|---|---|
| `profile.read` | `GET /api/sso/userinfo` — name, email, phone, country, avatar, active subscription types, direct referral count, isActivated flag |
| `payments.write` | _(future)_ Create payment intents on behalf of the user via the SBC payment-service |
| `wallet.read` | _(future)_ Read the user's SBC wallet balance |

For SBC Live's v1, **request `profile.read` and `payments.write`** — the payments
scope is needed to charge users for paid lives and the Visibilité Maximale add-on.

---

## The four endpoints

All paths below are relative to `https://sniperbuisnesscenter.com`.

### 1. `POST /api/sso/grant-code` (called from SBC's frontend, not yours)

You don't call this directly. SBC's own frontend hits it after the user clicks
"Authorize" on the consent screen. We document it here only so the contract is
clear.

**Body**

```json
{
  "client_id": "sbc-live",
  "redirect_uri": "https://live.sniperbuisnesscenter.com/auth/callback",
  "scopes": ["profile.read", "payments.write"]
}
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "code": "5f3a…",
    "expiresAt": "2026-06-12T01:42:31.000Z",
    "grantedScopes": ["profile.read", "payments.write"]
  }
}
```

SBC's frontend then redirects the user's browser to:

```
https://live.sniperbuisnesscenter.com/auth/callback?code=5f3a…&state=<your_state>
```

Your `auth/callback` route is what kicks off step 2.

---

### 2. `POST /api/sso/token` — exchange code for tokens (server-to-server)

Your **backend** receives the code from the browser query string and immediately
exchanges it. **Never expose `client_secret` to the browser.**

**Body**

```json
{
  "code": "5f3a…",
  "client_id": "sbc-live",
  "client_secret": "2bd6f9…",
  "redirect_uri": "https://live.sniperbuisnesscenter.com/auth/callback"
}
```

`redirect_uri` must match the one used in step 1 exactly, or the exchange fails.

**Response 200**

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "profile.read payments.write",
    "user": {
      "id": "65d2b034…",
      "name": "Rufus Herma",
      "email": "rufus@example.com",
      "phoneNumber": "237696921761",
      "country": "CM",
      "avatarUrl": "https://sniperbuisnesscenter.com/api/users/avatar/<fileId>",
      "subscriptionTypes": ["CIBLE"],
      "directReferralCount": 247,
      "isActivated": true
    }
  }
}
```

Codes are **one-shot**. A second exchange with the same code returns 400. They
also expire after **10 minutes**.

**Error responses**

| HTTP | When |
|---|---|
| 400 | bad code (expired, used, doesn't match this client, redirect_uri mismatch) |
| 401 | bad `client_id` or `client_secret` |

---

### 3. `GET /api/sso/userinfo` — fresh user info

Use this on session creation, not just at token exchange — subscription state
can change. The token payload at exchange time is a snapshot.

**Headers**

```
Authorization: Bearer <access_token>
```

**Response 200** — same `user` shape as in the token response.

**Error responses**

| HTTP | When |
|---|---|
| 401 | token invalid, expired, wrong issuer, or missing `profile.read` scope |
| 403 | token is a refresh token, or scope check failed |

---

### 4. `POST /api/sso/refresh` — rotate an access token

When you get a 401 from `/userinfo` (or any future scoped endpoint), use the
refresh token to mint a new access token. The endpoint also returns a new
refresh token; replace your stored one with it (rolling refresh).

**Body**

```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…",
  "client_id": "sbc-live",
  "client_secret": "2bd6f9…"
}
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "access_token": "…",
    "refresh_token": "…",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "profile.read payments.write"
  }
}
```

When the refresh token itself eventually expires (30d), the user must log in
again via the full flow.

---

## What to build on your side

### Frontend (SBC Live web app)

1. **"Log in with SBC" button**. On click:

   ```ts
   const params = new URLSearchParams({
     client_id: "sbc-live",
     redirect_uri: "https://live.sniperbuisnesscenter.com/auth/callback",
     scope: "profile.read payments.write",
     state: cryptoRandomString(32),  // for CSRF protection
   });
   sessionStorage.setItem("sso_state", params.get("state")!);
   window.location.href =
     `https://sniperbuisnesscenter.com/sso/authorize?${params}`;
   ```

   _(The page at `/sso/authorize` is part of the SBC-WEB-UI frontend and handles
   the consent + grant-code call. You don't build it.)_

2. **`/auth/callback` route**:

   ```ts
   const url = new URL(window.location.href);
   const code = url.searchParams.get("code");
   const state = url.searchParams.get("state");
   if (state !== sessionStorage.getItem("sso_state")) {
     throw new Error("CSRF: state mismatch");
   }
   sessionStorage.removeItem("sso_state");

   // Send the code to YOUR backend — never call /sso/token from the browser.
   await fetch("/api/auth/sso-callback", {
     method: "POST",
     body: JSON.stringify({ code }),
     headers: { "Content-Type": "application/json" },
   });

   // Your backend exchanges the code, sets a session cookie, redirects to /.
   ```

### Backend (SBC Live API)

1. **`POST /api/auth/sso-callback`** handler:

   ```ts
   app.post("/api/auth/sso-callback", async (req, res) => {
     const { code } = req.body;
     const r = await fetch("https://sniperbuisnesscenter.com/api/sso/token", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({
         code,
         client_id: process.env.SBC_SSO_CLIENT_ID,
         client_secret: process.env.SBC_SSO_CLIENT_SECRET,
         redirect_uri: process.env.SBC_SSO_REDIRECT_URI,
       }),
     });
     const { data } = await r.json();
     // Store in your session/DB:
     //   - data.access_token  (1h)
     //   - data.refresh_token (30d)
     //   - data.user          (snapshot)
     // Set your own session cookie / JWT, redirect user to /.
   });
   ```

2. **Refresh helper** — call before any outbound request that uses an SBC access
   token; if the JWT's `exp` claim is < 1 minute from now, hit `/sso/refresh`.

3. **Logout** — clear your session. SBC tokens don't need explicit revocation in
   v1; they expire naturally. Future versions will add `POST /api/sso/revoke`.

---

## Sequence summary

```
USER                  SBC LIVE FE      SBC FE        SBC BE      SBC LIVE BE
 │  click login          │              │              │              │
 │ ─────────────────────►│              │              │              │
 │                       │ redirect to /sso/authorize                 │
 │ ◄───────────────────────────────────►│              │              │
 │  approve              │              │              │              │
 │ ────────────────────────────────────►│              │              │
 │                                      │ POST /api/sso/grant-code    │
 │                                      │ (with user JWT)             │
 │                                      │ ────────────►│              │
 │                                      │ ◄────────────│ code         │
 │  redirect to callback?code=…         │              │              │
 │ ◄────────────────────────────────────│              │              │
 │  POST /api/auth/sso-callback                                       │
 │ ──────────────────────────────────────────────────────────────────►│
 │                                                     │ POST /api/sso/token
 │                                                     │ ◄────────────│
 │                                                     │ access+refresh+user
 │                                                     │ ────────────►│
 │                                      session set, redirect to /    │
 │ ◄──────────────────────────────────────────────────────────────────│
```

---

## Security notes

- **`client_secret` never goes to the browser.** Backend-only.
- **`state` parameter is mandatory** for CSRF protection. Generate fresh per
  request, store in sessionStorage, verify on callback.
- **Validate `redirect_uri` exactly** on every request — including matching at
  both grant-code time and token-exchange time. The backend rejects mismatches.
- **HTTPS everywhere.** Both `sniperbuisnesscenter.com` and your
  `live.sniperbuisnesscenter.com` must be HTTPS-only.
- **Don't cache the user payload past the access token's expiry.** Call
  `/userinfo` to refresh — subscription state in particular changes.
- **Scope down.** Only request `payments.write` when you actually need to charge
  users. Don't request scopes you don't use.

---

## What's NOT in v1

- `POST /api/sso/revoke` to revoke tokens before their natural expiry.
- The `payments.write` scope is reserved but the payment-service does not yet
  enforce it. For now, brother's backend must still call payment-service with
  the user's existing SBC JWT (separate flow). Once enforcement lands in
  payment-service, the scoped SSO access token will be enough.
- An admin UI to manage SSO clients. For v1, use the seed script.
- Cookie-based "you're already logged in to SBC, skip the consent screen" UX.
  Currently the user always sees the consent screen (and a login screen first
  if they're not authenticated to SBC in their browser).

---

## Quick test (preprod)

Once SBC backend is deployed and a `sbc-live` client is seeded:

```bash
# 1. As a logged-in SBC user, get an SBC JWT (e.g. from your devtools localStorage)
SBC_JWT="eyJ..."

# 2. Mint an auth code
curl -X POST https://preprod.sniperbuisnesscenter.com/api/sso/grant-code \
  -H "Authorization: Bearer $SBC_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "sbc-live",
    "redirect_uri": "http://localhost:5174/auth/callback",
    "scopes": ["profile.read", "payments.write"]
  }'
# → { code: "..." }

# 3. Exchange it for tokens (this is what brother's backend will do)
curl -X POST https://preprod.sniperbuisnesscenter.com/api/sso/token \
  -H "Content-Type: application/json" \
  -d '{
    "code": "<code from above>",
    "client_id": "sbc-live",
    "client_secret": "<the secret from the seed script>",
    "redirect_uri": "http://localhost:5174/auth/callback"
  }'
# → { access_token, refresh_token, user, ... }

# 4. Fetch userinfo
curl https://preprod.sniperbuisnesscenter.com/api/sso/userinfo \
  -H "Authorization: Bearer <access_token>"
```

If all four work, the brother's backend integration just wraps these calls.

---

## Contact

Questions on the SBC side go to Sterling. Product / scope questions go to Rufus.
