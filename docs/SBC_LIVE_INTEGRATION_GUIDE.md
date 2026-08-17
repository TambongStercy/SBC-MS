# SBC Live ↔ SBC Backend Integration Guide

This is the integration guide for the SBC Live team. It covers everything you
need to authenticate users via SBC SSO and charge them through SBC's payment
providers (CinetPay, MoneyFusion, FeexPay) without rebuilding any of that
infrastructure yourself.

Status: All endpoints below are live on **preprod**
(`https://preprod.sniperbuisnesscenter.com`) after Batch 1 + 2 + 3 deploy.
Production rollout follows once preprod is verified.

---

## 1. Big picture

```
                  ┌──────────────────┐
   user browser ──┤  SBC Live (yours)│
                  └──┬─────────────┬─┘
                     │             │
        SSO authorize│             │ webhook on payment events
                     ▼             ▲
                  ┌──────────────────┐
                  │   SBC backend    │
                  │  user + payment  │
                  └──┬─────────────┬─┘
                     │             │
   token + userinfo  │             │ provider → SBC checkout
                     ▼             ▼
                  ┌──────────────────┐
                  │  CinetPay/MF/etc │
                  └──────────────────┘
```

You never talk to CinetPay/MoneyFusion directly. You hit our `/api/payments/sso/intents`
endpoint, we route to the right provider, and we POST a signed webhook back to you
when the payment lands.

---

## 2. SSO authentication — getting a user-scoped access token

### 2.1 Redirect to consent

When a user clicks "Connect with SBC" in your app, redirect them to:

```
https://preprod.sniperbuisnesscenter.com/sso/authorize
  ?client_id=sbc-live
  &redirect_uri=https://live.sniperbuisnesscenter.com/auth/callback
  &response_type=code
  &scope=profile.read+payments.write+referrals.read
  &state=<random nonce you store in the user's session>
```

Scope list (request only what you actually use):

| Scope | What it grants |
|---|---|
| `profile.read` | `/api/sso/userinfo` returning id, name, email, country, subscriptions, `directReferralCount`, `sbcLiveBalance` |
| `payments.write` | `/api/payments/sso/intents` and `/api/payments/sso/refund-requests` |
| `referrals.read` | `/api/sso/referrals/relationship` (is user X a direct filleul of Y?) |

The user lands on `preprod-admin.sniperbuisnesscenter.com`'s consent screen,
clicks Authorize, and we redirect them back to your `redirect_uri` with `?code=<>&state=<>`.

### 2.2 Exchange the code for tokens

Your backend POSTs to `/api/sso/token`:

```http
POST /api/sso/token
Content-Type: application/json

{
  "code": "<the code from the redirect>",
  "client_id": "sbc-live",
  "client_secret": "<your secret, given out-of-band>",
  "redirect_uri": "<same as authorize step>"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "access_token": "<JWT, expires in ~1h>",
    "refresh_token": "<opaque, longer-lived>",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "profile.read payments.write referrals.read",
    "user": { "id": "...", "name": "...", "email": "...", "subscriptionTypes": [], "directReferralCount": 0, "sbcLiveBalance": 0, "isActivated": false }
  }
}
```

Persist the user payload in your DB keyed by `user.id` (24-char ObjectId).
Hand the `access_token` to your SPA via a httpOnly cookie or short-lived
storage — your call. The token is a JWT signed with SBC's `SSO_JWT_SECRET`;
you should treat it as opaque (don't try to introspect it locally — call our
`/api/sso/userinfo` for fresh data).

### 2.3 Refresh

When `expires_in` is about to run out, call `/api/sso/refresh`:

```http
POST /api/sso/refresh
{ "refresh_token": "...", "client_id": "sbc-live", "client_secret": "..." }
```

You get a fresh access token + a rotated refresh token.

### 2.4 Get fresh user info

```http
GET /api/sso/userinfo
Authorization: Bearer <access_token>
```

Returns the same `user` payload as the token exchange, but live.

### 2.5 Check the direct-filleul relationship

For filleul-gated lives:

```http
GET /api/sso/referrals/relationship?sponsorId=<creator's user.id>
Authorization: Bearer <access_token with referrals.read scope>
```

Response:

```json
{ "success": true, "data": { "isDirectFilleul": true, "depth": 1, "callerId": "...", "sponsorId": "..." } }
```

---

## 3. Eligibility — can this user create a formation?

Rufus's rule: **≥25 direct referrals OR active Visibilité Maximale subscription.**

In your code, after calling `/api/sso/userinfo`:

```js
const canCreate = user.directReferralCount >= 25
                || user.subscriptionTypes.includes('VISIBILITE_MAX');
```

Both fields come from a single `/userinfo` call. No extra endpoint needed.

For the **monetization gate** (charging viewers for lives — per the cahier
section 5): `user.directReferralCount >= 10000` OR sur demande (admin override
on our side, not yet exposed).

---

## 4. Charging users — payment intents

### 4.1 Two shapes

#### A. Paid-live access (viewer pays creator)

```http
POST /api/payments/sso/intents
Authorization: Bearer <access_token with payments.write>
Content-Type: application/json

{
  "amount": 3000,
  "currency": "XAF",
  "beneficiaryUserId": "<creator's SBC user.id>",
  "clientReference": "live_123_viewer_456",   // your internal id for reconciliation
  "description": "Access to live 'Stratégie de vente' (15 juin 2026)",
  "returnUrl": "https://live.sniperbuisnesscenter.com/lives/123/joined"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "sessionId": "abc123xyz",
    "paymentIntentId": "...",
    "checkoutUrl": "https://preprod.sniperbuisnesscenter.com/api/payments/page/abc123xyz",
    "amount": 3000,
    "currency": "XAF",
    "splitPolicy": { "beneficiaryUserId": "...", "beneficiaryPercentage": 75, "sbcCommissionPercentage": 25 }
  }
}
```

Redirect the user's browser to `checkoutUrl`. We host the checkout page —
they enter their phone/operator, complete the mobile money flow, then
land on your `returnUrl`.

#### B. Visibilité Maximale subscription (creator pays SBC for the feature)

```http
POST /api/payments/sso/intents
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "amount": 50000,
  "currency": "XAF",
  "subscriptionType": "VISIBILITE_MAX",
  "subscriptionPlan": "monthly",
  "description": "Visibilité Maximale - 1 mois",
  "returnUrl": "https://live.sniperbuisnesscenter.com/account/vm"
}
```

No `beneficiaryUserId` — the money goes 100% to SBC. On payment success we
automatically create a `VISIBILITE_MAX` Subscription record for the buyer,
which surfaces in their next `/api/sso/userinfo` call inside `subscriptionTypes`.

Renewal is **manual in v1**: each month the user re-clicks "Renew" in your
app and you create a fresh intent. Re-activation extends `endDate` by one
month rather than creating a duplicate sub.

### 4.2 Polling for status (optional fallback)

If you missed our webhook, you can poll:

```http
GET /api/payments/intents/<sessionId>/status
```

Returns the current status. No auth needed for this read.

---

## 5. Webhooks — getting notified when payments complete

### 5.1 Setup

We register your webhook URL out-of-band — give us a single URL like
`https://live.sniperbuisnesscenter.com/sbc-webhook` and we give you back a
shared `webhookSecret`. Both stored on our `SsoClient` record.

### 5.2 What you receive

On terminal payment statuses (SUCCEEDED, FAILED, CANCELED) we POST to your
webhook URL:

```http
POST <your webhook url>
Content-Type: application/json
X-SBC-Signature: sha256=<hex>
X-SBC-Webhook-Timestamp: 1781234100000
X-SBC-Webhook-Event: payment.succeeded
User-Agent: sbc-payment-service-webhook/1

{
  "event": "payment.succeeded",
  "sessionId": "abc123xyz",
  "paymentIntentId": "67891...",
  "status": "SUCCEEDED",
  "amount": 3000,
  "currency": "XAF",
  "paidAmount": 3000,
  "paidCurrency": "XAF",
  "userId": "<buyer ObjectId>",
  "beneficiaryUserId": "<creator ObjectId or null>",
  "splitBeneficiaryCredit": 2250,
  "splitSbcCommission": 750,
  "subscriptionType": "VISIBILITE_MAX",
  "subscriptionPlan": "monthly",
  "clientReference": "live_123_viewer_456",
  "completedAt": "2026-06-19T02:15:00.000Z",
  "completedAtMs": 1781234100000
}
```

### 5.3 You MUST verify the signature

```js
import crypto from 'crypto';

function verify(req, rawBody) {
  const provided = (req.headers['x-sbc-signature'] || '').replace(/^sha256=/, '');
  const expected = crypto.createHmac('sha256', process.env.SBC_WEBHOOK_SECRET)
                         .update(rawBody, 'utf8')
                         .digest('hex');
  if (provided.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return false;

  // Replay protection: timestamp must be within ±5 minutes of now
  const ts = Number(req.headers['x-sbc-webhook-timestamp']);
  if (!ts || Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;

  return true;
}
```

You MUST use the **raw body bytes** for the HMAC, not the parsed JSON.
If you're on Express, use `express.json({ verify: (req, _res, buf) => req.rawBody = buf })`
and pass `req.rawBody` to the verifier.

### 5.4 You MUST dedupe

We retry 3 times (5s + 30s backoff). Network blips can deliver the same event
more than once. Dedupe on `(paymentIntentId, status)` — if you've already
processed it, return 200 immediately without redoing the work.

### 5.5 Respond fast

Return 2xx within 10s or we count it as a failure. Acknowledge fast, process
async if you need to.

---

## 6. Creator wallet

The 75% creator share lands in their `sbcLiveBalance` field — surfaced in
`/api/sso/userinfo`. Read it whenever you want to show a creator their pending
earnings.

**Withdrawal** of the SBC Live wallet happens through SBC's existing
withdrawal flow (admin-approved mobile money payout). The frontend currently
defaults to the main `balance` — adding a source-wallet selector so creators
can pick between `balance` and `sbcLiveBalance` is a **deferred follow-up**
(see `FOLLOW_UPS.md`). Until that ships, creators accumulate in `sbcLiveBalance`
but can't self-serve withdraw it. Workaround: SBC admin can manually
transfer between wallets on request.

---

## 7. Refunds

We provide a refund queue but **all approvals are manual** by SBC admin
(Jamelle by default), per Rufus's policy. You file a request, we (Jamelle) decide.

### 7.1 File a refund request

```http
POST /api/payments/sso/refund-requests
Authorization: Bearer <access_token with payments.write>
Content-Type: application/json

{
  "sessionId": "abc123xyz",           // the original payment session
  "refundAmount": 3000,                // can be partial (≤ original)
  "reason": "Creator no-show: live cancelled within 1h of start",
  "clientReference": "refund_live_123_viewer_456"  // optional, your internal id
}
```

Response (status PENDING_REVIEW):

```json
{
  "success": true,
  "data": {
    "id": "...",
    "status": "PENDING_REVIEW",
    "refundAmount": 3000,
    "creatorClawbackAmount": 2250,
    "sbcCommissionReturnedAmount": 750,
    ...
  }
}
```

### 7.2 Policy reference (so you know what Jamelle will decide)

| Scenario | Default action |
|---|---|
| One-time access + live cancelled by creator | Full refund |
| One-time access + user just didn't attend | No refund |
| Monthly/yearly sub + single live cancelled | No refund (other content was accessible) |
| Monthly/yearly sub + creator stops creating entirely | Pro-rata refund (admin discretion) |
| Platform outage | Pro-rata or full, admin discretion |

### 7.3 What happens on approval

- Creator's `sbcLiveBalance` is debited by 75% of the refund amount
- Buyer's main `balance` is credited by the full refund amount
- A REFUND transaction is created linking back to the original payment
- If the creator has already withdrawn their share, the refund moves to
  `FAILED_INSUFFICIENT_FUNDS` and a human (Sterling/Jamelle) intervenes

You'll see the final status when you GET your own refund or when an admin
updates you via separate channels (no webhook for refund state changes in v1).

---

## 8. Errors you might see

| HTTP | Code | What it means |
|---|---|---|
| 401 | — | Missing/expired Bearer token — refresh and retry |
| 403 | `INSUFFICIENT_SCOPE` | Token doesn't have the scope this endpoint requires — request it at the next consent step |
| 400 | — | Validation failure (missing fields, amount ≤ 0, etc.) |
| 409 | — | Idempotency conflict (e.g., duplicate refund clientReference) |
| 503 | — | Provider or upstream service unavailable — retry with backoff |

---

## 9. Quick test checklist for your integration

- [ ] User can authorize and we get an access token back
- [ ] Token has the scopes you requested (decode in jwt.io or hit `/userinfo`)
- [ ] Creator eligibility check: `directReferralCount >= 25 || subscriptionTypes.includes('VISIBILITE_MAX')`
- [ ] Create a paid-live intent with `beneficiaryUserId` → user completes payment on `checkoutUrl` → you receive `payment.succeeded` webhook with valid HMAC
- [ ] Re-deliver the same webhook → your dedupe layer makes it a no-op
- [ ] Create a VM intent → user completes payment → user's next `/userinfo` shows `VISIBILITE_MAX` in `subscriptionTypes`
- [ ] File a refund request → see it in PENDING_REVIEW status

---

## 10. Open items / coming soon

| Item | Status |
|---|---|
| Source-wallet selector for creator withdrawals from `sbcLiveBalance` | **Deferred** — see `FOLLOW_UPS.md` |
| Admin refund queue UI on `admin.sniperbuisnesscenter.com` | **Deferred** — backend endpoints exist, frontend not built yet |
| Auto-renewal for monthly subscriptions | **v2** — v1 is manual re-payment |
| Refund state change webhooks | **v2** — v1 you poll or ask Jamelle |
| Durable webhook queue (Bull/Redis) survives restarts | **Future** — current in-process retry is sufficient for v1 traffic |

---

## 11. Contacts

- Technical questions (integration, debugging): Sterling
  (`tambongkersten7@gmail.com`)
- Product questions (policy, pricing, gating rules): Rufus via Sterling
- Bug reports / urgent issues: ping Sterling on WhatsApp

---

Generated 2026-06-19 covering Batches 1 + 2 + 3 of the SBC Live payment
integration. Reflects the production code on preprod after the merges of
PRs #63 (Batch 1), #64 (Batch 2), and #65 (Batch 3).
