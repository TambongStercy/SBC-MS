# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Ownership

**Rufus (also addressed as "Facilitateur") is the app owner and product authority.** When his
feedback or his team's feedback (forwarded by Sterling) contradicts your read of how a feature
should work, **Rufus is right by default**. Do not push back on his product calls with "but the
current code does X" reasoning — the code is the implementation, his intent is the spec.

In practice this means:
- When Rufus says "users shouldn't be able to log in without paying" → that's a product rule,
  even if the current frontend permits it. Treat it as a bug to fix, not a design discussion.
- When his team reports "the filleul is logged in but not activated" as a bug → it IS a bug
  from the product perspective, regardless of what login vs activation means architecturally.
- Don't waste tokens explaining "this is how it currently works" to Sterling when he's relaying
  a Rufus/Facilitateur complaint. Go straight to fixing it.
- Disagree only if there's a concrete safety, security, or regulatory concern. Otherwise
  implement Rufus's call.

Sterling is the technical lead and the one you collaborate with day-to-day. He has full
authority over technical decisions, deploys, and code. But when product behavior is in
question, defer to what he says Rufus wants.

## Architecture Overview

This is a microservices-based backend system for Sniper Business Center (SBC) with an admin frontend. The system consists of 8 Node.js/TypeScript microservices, a React admin frontend, and supporting infrastructure components.

### Core Services

- **Gateway Service** (port 3000): API gateway and routing
- **User Service** (port 3001): User management, authentication, referrals, subscriptions  
- **Notification Service** (port 3002): Email, SMS, WhatsApp notifications with Redis queue
- **Payment Service** (port 3003): Payment processing, transactions, crypto payments, withdrawals
- **Product Service** (port 3004): Product management and flash sales
- **Advertising Service** (port 3010 / preprod 6010): WhatsApp status advertising marketplace — campaigns, landing pages, tracking links, diffuseur payouts. Spec: `docs/ADVERTISING-FEATURE-SPEC.md`
- **Tombola Service** (port 3006): Lottery/tombola functionality
- **Settings Service** (port 3007): Global settings and file storage (Google Drive integration)
- **Admin Frontend** (port 3030): React/TypeScript admin dashboard with Vite

### Infrastructure

- **MongoDB**: Each service has its own database (e.g., `sbc_user_dev`, `sbc_payment_dev`)
- **Redis**: Used by notification service for job queues
- **Nginx**: Reverse proxy serving frontend and routing API requests

## Development Commands

### Docker Development (Recommended)
```bash
# Start all services
docker-compose up

# Start specific service
docker-compose up user-service

# Rebuild and start
docker-compose up --build

# View logs
docker-compose logs -f user-service
```

### Individual Service Development
Each backend service supports:
```bash
# Development with auto-reload
npm run dev

# Build TypeScript
npm run build

# Production start
npm start
```

### Admin Frontend
```bash
cd admin-frontend-ms
npm run dev     # Development server
npm run build   # Production build
npm run lint    # ESLint check
```

### Testing Commands
- **Notification Service**: `npm test` (Jest)
- **Gateway Service**: `npm test` (Jest) 
- **Product Service**: `npm test` or `npm run test:watch` (Jest)
- **Other services**: Tests not implemented

### Linting
- **Admin Frontend**: `npm run lint`
- **Tombola Service**: `npm run lint` or `npm run lint:fix`
- **Notification Service**: `npm run lint` or `npm run lint:fix`

## Service Architecture Patterns

### Common Structure
```
service-name/
├── src/
│   ├── api/
│   │   ├── controllers/     # Request handlers
│   │   ├── middleware/      # Auth, validation, rate limiting
│   │   └── routes/          # Route definitions
│   ├── database/
│   │   ├── models/          # Mongoose schemas
│   │   └── repositories/    # Data access layer
│   ├── services/            # Business logic
│   ├── utils/               # Shared utilities
│   └── server.ts            # Entry point
├── Dockerfile & Dockerfile.dev
└── package.json
```

### Key Technologies
- **Backend**: Node.js, TypeScript, Express, Mongoose, JWT
- **Frontend**: React, TypeScript, Vite, TailwindCSS, Recharts
- **Infrastructure**: Docker, Nginx, Redis, MongoDB

## Admin Frontend Development Rules

### UI/UX Standards

**CRITICAL: Never use browser alerts, prompts, or confirms in the admin frontend.**

The admin frontend must maintain professional UI/UX standards. Follow these rules:

1. **No JavaScript Alerts**: Never use `alert()`, `window.alert()`, `confirm()`, `window.confirm()`, or `prompt()` for user feedback.

2. **Use Toast Notifications**: For non-blocking feedback (success, error, warning, info):
   ```typescript
   import { useToast } from '../hooks/useToast';
   import ToastContainer from '../components/common/ToastContainer';

   const { toasts, removeToast, showSuccess, showError, showWarning, showInfo } = useToast();

   // Success feedback
   showSuccess('Operation completed successfully!');

   // Error feedback
   showError('Operation failed. Please try again.');

   // Add ToastContainer to JSX
   <ToastContainer toasts={toasts} onRemove={removeToast} />
   ```

3. **Use Confirmation Modals**: For user confirmations before dangerous actions:
   ```typescript
   import ConfirmationModal from '../components/common/ConfirmationModal';

   const [showConfirmModal, setShowConfirmModal] = useState(false);
   const [confirmAction, setConfirmAction] = useState<{
       title: string;
       message: string;
       onConfirm: () => void;
   } | null>(null);

   // Trigger confirmation
   setConfirmAction({
       title: 'Confirm Action',
       message: 'Are you sure you want to proceed?',
       onConfirm: async () => {
           // Execute action
           setShowConfirmModal(false);
       }
   });
   setShowConfirmModal(true);

   // Add ConfirmationModal to JSX
   {confirmAction && (
       <ConfirmationModal
           isOpen={showConfirmModal}
           title={confirmAction.title}
           message={confirmAction.message}
           confirmText="Confirm"
           cancelText="Cancel"
           onConfirm={confirmAction.onConfirm}
           onCancel={() => setShowConfirmModal(false)}
       />
   )}
   ```

4. **Available Toast Systems**:
   - Custom toast system: `useToast()` hook with ToastContainer component
   - React Hot Toast: `toast.success()`, `toast.error()` (used in some pages)

5. **When to Use Each**:
   - **Toast Notifications**: Success messages, error messages, warnings, non-critical info
   - **Confirmation Modals**: Delete operations, irreversible actions, role changes, bulk operations
   - **Form Validation**: Display errors inline or in modals, never with alerts

### Inter-Service Communication
Services communicate via HTTP REST APIs through the gateway. Service URLs are configured in docker-compose environment variables (e.g., `USER_SERVICE_URL: http://user-service:3001`).

### Authentication & Authorization
- JWT tokens for authentication
- Service-to-service auth via `SERVICE_SECRET` headers
- Role-based access control (RBAC) in user service

## Payment System Integration

The payment service integrates with multiple providers:
- **CinetPay**: Mobile money and card payments for African markets
- **FeexPay**: Local payment processing
- **MoneyFusion**: Mobile money for CM, CD, GA, NE, ML, GN, BF, SN, TD
- **NOWPayments**: Cryptocurrency payments
- **QR Code**: Payment UI with real-time updates

### ⚠️ Critical: payment-service handles real user money

Any change in `payment-service/` (especially `payment.service.ts`,
`moneyfusion.service.ts`, `cinetpay-payout.service.ts`, `feexpay-payout.service.ts`,
`withdrawal*` routes/controllers, the webhook handlers, and the operator/currency
maps in `utils/operatorMaps.ts`) can move real money or freeze user balances.
Treat every PR that touches these as financial code, not normal app code.

**Before merging any payment-service change, do the following — even if the
diff looks small:**

1. **Trace every code path the change affects**, not just the one in front of you.
   Withdrawal flows have at least four siblings: user-initiated (\`processWithdrawal\`,
   currently dead-code-commented), admin-approved (\`processMobileMoneyWithdrawalPayout\`),
   admin-direct (\`adminInitiateUserWithdrawal\` / \`adminInitiateDirectPayout\`), and
   recovery scripts. A new gateway must be wired into all of them — or each one needs
   an explicit \`else\` that throws on unknown gateways so silent no-ops can't happen
   (one of these silent no-ops froze a real user's withdrawal mid-flight).

2. **Check the wallet debit/credit lifecycle for every change.** SBC uses
   **debit-on-success** for mobile-money withdrawals: the wallet is debited only
   after the provider confirms COMPLETED. So:
   - On success → mark COMPLETED + debit wallet (\`updateUserBalance(userId, -amount)\`)
   - On failure → mark FAILED, **do nothing to the wallet** (no refund — wallet was
     never debited)
   - The FeexPay webhook handler at \`payment.service.ts:5870\` is the canonical
     reference. Match its pattern. A wrong refund here over-credits users on every
     failure — happened in PR #18, caught before going to prod.

3. **Verify the request shape against provider docs literally**, including
   field name casing (snake_case vs camelCase), country code casing (lowercase),
   phone format (with/without country prefix), and operator-slug values. The
   operator maps (e.g. \`MoneyFusion.WITHDRAW_MODES\`) must exactly match the
   provider's published table — even when the provider's table looks like a typo
   (CG legitimately maps to \`orange-money-mali\` per MoneyFusion docs).
   The map keys must match the **stored** operator names from
   \`operatorMaps.ts\` (long-form like \`MTN_MOMO_CMR\`), not abbreviations
   (\`MTN_CM\` was wrong and silently failed every CM withdrawal).

4. **Walk admin approval, OTP, and global-disable gates.** Confirm the change
   doesn't bypass them. \`config.withdrawalsEnabled\` and
   \`{provider}.withdrawalsEnabled\` are the global kill switches; respect them
   on every code path.

5. **Run real preprod tests before promoting to master** for any non-trivial
   payment change. \`MONEYFUSION_WITHDRAWALS_ENABLED=false\` (or equivalent
   per-provider) is the safety net while testing — set it on prod if a fix is
   in flight, then re-enable after deploy.

6. **Manually inspect the diff for**: missing \`else\` in gateway-selection
   blocks (silent no-op), \`updateUserBalance\` calls that don't match the
   debit-on-success pattern, hardcoded operator slugs that aren't in the
   provider's docs, and any path that starts a payout without setting
   \`externalTransactionId\`/\`serviceProvider\` (untraceable transactions).

7. **Stuck withdrawals get refunded via the existing webhook simulation**
   pattern (plant a sentinel \`externalTransactionId\`, POST a cancelled event
   to the provider's webhook URL on localhost) — not direct DB writes.
   But verify which debit model applies first: with debit-on-success, no
   refund is needed because the wallet was never debited.

If any of these is unclear in a particular code area, stop and ask before
merging. Real money has been moved or frozen by skipping these checks in the
past; the cost of pausing is far lower than the cost of cleaning up.

### Withdrawal investigation cheat-sheet (read before pinging Sterling)

Recurring "user says they didn't receive their withdrawal" requests. The
useful fields on a withdrawal Transaction document:

| Field | What it tells you |
|---|---|
| `metadata.accountInfo.fullMomoNumber` | Recipient phone we sent to (canonical for withdrawal flow). NOT `metadata.phoneNumber` — that's used by other flows. |
| `metadata.accountInfo.momoOperator` | Operator (e.g. ORANGE_CMR, MTN_MOMO_CMR) |
| `metadata.accountInfo.countryCode` | Destination country |
| `amount` | **Gross debit (what MF dashboard displays, rounded to integer)** |
| `metadata.netAmountRequested` | Net amount the USER asked for, before our fees — **do NOT search MF dashboard for this number** |
| `fee` | Our internal fee (gross − net) |
| `externalTransactionId` / `metadata.moneyFusionTokenPay` | Provider tx id. Use this to search MF/CinetPay/FeexPay dashboards — it's the unambiguous lookup, beats searching by amount+phone. |
| `metadata.payoutCompletedAt` | When WE marked it done (manual reconciliation OR real webhook) |
| `metadata.manualCompletion` | Present only on records completed via the PR #72 admin UI. Absence + a 1-day-plus gap between `createdAt` and `payoutCompletedAt` is a flag that the old webhook-simulation pattern was used (which assumed delivery without verifying) — re-check MF dashboard before trusting `status=completed`. |

Verified empirically 2026-06-29: MF dashboard `Montant` column = our `amount`
rounded to integer (2306.25 → MF shows 2306; 2050 → MF shows 2050). NOT
`netAmountRequested`. Investigating Rufus's "did user receive X" — search MF
dashboard by tokenPay or by gross integer amount, not by net.

### Verification failures: suspect OUR code first, NOT WhatsApp (hard rule)

**Do not blame WhatsApp, "throttling", "flaky sync", or "lossy backfill" for an
ads-network verification failure until you have PROVEN, from logs/data, that the
failure is at the WhatsApp boundary and not in our own logic.** This burned real
trust: the "Jour 2 refusé — aucun ne contient votre lien" complaints were
repeatedly (and wrongly) attributed to WhatsApp; the real cause was a code bug in
`verification.service.ts` where an already-VERIFIED day re-ran `findMatchingStatus`
and consumed the NEXT day's post (all days share one tracking code, so days are
told apart only by which status backs them). Fixed in PR #201 — a verified day now
only ever refreshes its own status by id.

Discipline to follow every time:
1. **Two different failure classes, don't conflate them.**
   - *Link-phase* failure — the socket never reaches `connection === 'open'`
     (`reason=408` **before** connect, hangs then closes). This one CAN be WhatsApp
     / datacenter-IP throttling. The `verificationStats()` tally
     (`verification-session.service.ts`) splits `before_connect` vs `after_connect`
     precisely so you can tell.
   - *Verification-result* failure — statuses WERE read (`extracted N status(es)`
     logs) but a day is refused. This is **almost always our code**: check
     `findMatchingStatus`, `captionHasTrackingCode`, the `claimedFor` set, the
     `notBefore`/inter-day gate, the VERIFIED-day branch. Never call this "WhatsApp".
2. **Prove it with the actual data before concluding.** Add a temporary log of the
   real extracted statuses (id, postedAt, caption, hasCode) and the claimed set;
   read them; only then form a hypothesis. A hypothesis that "looks obvious"
   (message-wrapping, empty sync) has been wrong here more than once.
3. **Confirm a test actually ran before saying "still failing".** Check the last
   verification timestamp in the logs — an unchanged DB often just means the user
   has not retried since the fix deployed, not that the fix failed.
4. Err heavily toward "it's our bug." Check 50 times if that's what it takes.

### Cloud Storage bills egress, not storage — and signed URLs defeat every cache

August 2026: $79.63, of which **$64.32 was 636 GiB of download egress** and
**$1.23 was storage**. The buckets hold ~36 GiB total. So bucket size tells you
almost nothing; what costs money is `file size × number of distinct fetches`.

Two buckets, very different failure modes:

| | `sbc-file-storage` (public) | `sbc-status-media-private` |
|---|---|---|
| Contents | avatars (15,310 files, **947 KiB avg**), products (31,331, 522 KiB avg), campaign creatives + verification videos (up to 84 MiB) | live statuses only, ~900 KiB avg, 121 MiB total |
| Served by | direct `storage.googleapis.com` URLs | V4 signed URLs |
| Cacheable | yes — stable URL + 1yr `Cache-Control`, so a *returning* viewer is free | **was: never** |

**The signed-URL trap (fixed 2026-09-04).** `getSignedUrl` used
`expires: Date.now() + expiresIn*1000`, so every call produced a different
signature and therefore a different URL for the same bytes. Caches key on the
URL, so no browser or CDN could ever hit — every status-feed open re-downloaded
every image and video in full. Expiry is now snapped **up to an hourly
boundary**, so the same object yields the same URL to everyone within the hour.
**If you add any signed-URL flow, snap the expiry the same way** or you
reintroduce this.

Other standing facts:
- **Nothing fronts `storage.googleapis.com`** — no CDN, no shared cache. Our own
  origin IS behind Cloudflare, so routing through `/api/settings/files/<id>` is
  the cheap path and the direct bucket URL is the expensive one. A comment in
  `SBCApiService.generateStreamedFileUrl` used to claim the opposite; that is why
  the pattern spread.
- `?w=<px>` on `/api/settings/files/:id` returns a WebP resize (sharp, bounded
  16–1024, `immutable`). Avatars went 1.78 MB → ~2 KB. Use
  `generateThumbnailUrl` anywhere an image is drawn smaller than uploaded;
  `Avatar` (`SBC-WEB-UI/src/components/common/Avatar.tsx`) does it for people.
  It refuses to resize video — sharp cannot, and trying pulls the whole file first.
- **GCS usage logs are NOT enabled**, so per-object request counts do not exist.
  Any claim about *which* files drove the bill is inference, not measurement —
  say so. `settings-service/src/scripts/audit-storage-egress.ts` inventories both
  buckets (it needs the service's own credentials; a bare `new Storage()` reaches
  only the public bucket anonymously and silently omits the private one).

### Phone formats: Congo-Brazzaville (+242) keeps its leading 0

Most countries here treat a leading 0 on the national number as a trunk prefix to
strip before the country code (CM `6XXXXXXXX`, no 0). **Congo-Brazzaville (+242) is
the exception — the 0 is part of the subscriber number** (mobile `05…`/`06…`), so
the WhatsApp/E.164 number is `+242 0X XXX XX XX` and stripping it makes WhatsApp
fail to match the account. Confirmed by Rufus (native). The ads-network verify form
(`SBC-WEB-UI/src/pages/AdsNetworkDiffuseur.tsx`) keeps the 0 when the dial code is
`242` and strips it otherwise; `advertising-service` verification.controller only
strips in its no-country-code fallback, so a `242…`-prefixed number passes through.
If another market reports the same, add its code to the keep-zero set — don't
blanket-strip. (`recoveryHelpers.normalizePhoneNumber` never strips; it only
prepends the country code, so signup/profile already keep the 0.)

### Gateway proxy registration

`gateway-service/src/server.ts` uses explicit `app.use('/api/<prefix>', proxy(...))`
per top-level route prefix. **Anything not explicitly proxied returns 404 at the
gateway** — silently, without any service ever seeing the request. When adding
a new top-level API route (e.g. PR #60 added `/api/sso`), the gateway file must
be updated too. PR #66 fixed the post-#60 gap; PR #67 fixed a related issue
where admin-frontend called paths the gateway didn't recognise.

### user-service admin routes are mounted at `/users/admin/...`, not `/admin/...`

`user-service/src/api/routes/index.ts` has `router.use('/users/admin', adminRoutes)`.
So the full path is e.g. `/api/users/admin/users/:userId/unblock`. The inline
comments inside `admin.routes.ts` claim `/api/admin/users/...` — **those comments
are wrong**; the actual mount overrides them. Admin frontend must call
`/users/admin/users/...`. PR #67 fixed an instance where the admin frontend was
on the wrong pattern.

### user-service internal routes: there is no `GET /users/internal/:userId`

Only the routes explicitly registered on `serviceRouter` in
`user-service/src/api/routes/user.routes.ts` exist. A bare single-user fetch is
**not** among them — `GET /users/internal/<id>` 404s. Use one of the POST batch
endpoints with a single id.

Worse: **`POST /internal/batch-details` returns a narrow projection** —
`name email phoneNumber avatar momoNumber momoOperator balance notificationPreference
role language cryptoWalletAddress cryptoWalletCurrency`. No `country`, `city`,
`region`, `sex`, `birthDate`, `interests`, `profession`, `referralCode`. A consumer
that needs demographics gets objects back with every such field `undefined` — no
error, just silently empty matching. This broke advertising-service's campaign
targeting (fixed 2026-08-08); `sbclove-service` avoided it with its own
`POST /internal/sbclove-details` projection.

**When a module needs profile fields, add its own internal projection endpoint**
(`advertising-details`, `sbclove-details`) rather than reusing `batch-details`.
Always read the repository's `.select()` before trusting an internal route.

### notification-service internal sends: exact path AND recipient required

`POST /api/notifications/internal/create` — the `/notifications` segment is
mandatory (`/api/internal/create` 404s), and the **email channel requires
`recipient`** (the address itself — the service does NOT resolve userId→email;
missing it 400s). Both failures are invisible at call sites because every
client is deliberately best-effort. Discovered 2026-08-09: every advertising
email ever (offers, approvals, day-opened) had silently failed on both counts;
tombola's PUSH channel skips the recipient requirement, sbclove was correct.
When adding a notification call, test one real delivery — a 2xx-shaped silence
proves nothing.

### Health endpoints aren't standardised

| Service (prod port / preprod port) | Health path |
|---|---|
| user (3001/6001), notification (3002/6002), payment (3003/6003), product (3004/6004), settings (3007/6007) | `/health` |
| tombola (3006/6006), chat (3008/6008) | `/api/health` |

Post-deploy health checks must try both URLs and pass if either responds 2xx
(fixed in PR #74). Verified empirically 2026-06-29.

### Prod deploy concurrency lock gotchas (post-PR #73)

After PR #73, `deploy-web` no longer requires environment approval. Only
`deploy-backend` does. So the normal flow per prod deploy:

1. Merge PR to master → workflow triggers
2. **Click Approve once on Backend** at github.com/.../actions (production env)
3. Backend deploys (~30s) → Web UI auto-runs as no-op (~5s) → Health Check runs
4. Concurrency lock releases — next deploy can pick up

If a deploy gets stuck "waiting", check whether it's queued behind an older
still-active prod deploy run. Old (pre-#73) deploys may still be in the queue
holding the lock — cancel them to release.

### Deploying a brand-new service to prod (learned shipping advertising-service, 2026-08-17)

Adding a service to the deploy scripts is not enough — its first prod deploy
fails in three separate places, each silently:

1. **`scripts/deploy-prod.sh` updates itself.** The workflow runs the script,
   and the script does the `git pull`. So the run that ships a change *to the
   script* executes the OLD copy. Adding a service to its `PM2_NAME` map takes
   effect on the NEXT deploy — the first one pulls the code and skips the
   service entirely (no "Services to update" entry, no error).
2. **`npm install` only runs when `package.json` is in the diff.** On a re-run
   the pull is a no-op, so the script falls back to "rebuild everything" with
   `NEEDS_INSTALL=false`. A service with no `node_modules` then fails with
   `sh: 1: tsc: not found` and the job's own summary is the only place it shows
   (`Failed (1): <svc>:build`) — the SSH step still exits 0 and reports success.
   For a first deploy, run `npm install` in the service dir on the server.
3. **`gateway-service/.env` overrides the code default.** `config` reads
   `process.env.<SVC>_SERVICE_URL || 'http://localhost:<right port>'`, so a
   stale/wrong var beats the correct fallback. Prod had
   `ADVERTISING_SERVICE_URL=http://localhost:3005` — every `/api/advertising/*`
   call returned a generic 500 while the service itself answered 200 on
   `localhost:3010`. Check the var, then `pm2 reload gateway-service --update-env`.

Fastest sanity check after any new-service deploy: `curl localhost:<port>/health`
(direct, proves the process) AND `curl https://<domain>/api/<prefix>/...`
(proves the gateway var + nginx). Different failures, same-looking symptom.

### CinetPay per-country accounts

CinetPay's new platform (which we use, at `api.cinetpay.co` with OAuth) issues
**separate merchant accounts and balances per country**. Each country has its
own credentials in env: `CINETPAY_<CC>_API_KEY`, `CINETPAY_<CC>_API_PASSWORD`.
`cinetpayPayoutService.getBalance(countryCode)` MUST be called with the
specific country, otherwise it falls back to `Object.keys(config.cinetpay.countries)[0]`
and returns an arbitrary country's balance. PR #68/69 fixed an instance where
the caller passed nothing and CI users were blocked by CM's empty balance.

The interface comment at `payment-service/src/config/index.ts:78` mentions
`https://api.cinetpay.net` ("new unified API") but the actual base URL we use
is `https://api.cinetpay.co`. Probably interchangeable aliases — but the `.co`
host is what's in env and what the live code talks to.

### MoneyFusion payout webhooks — reality check (corrected 2026-07-01)

Earlier notes in this doc claimed "MoneyFusion never sends payout webhooks".
That was wrong. Sterling pulled MF's official docs which explicitly define
`payout.session.completed` / `payout.session.cancelled` webhook events, and
prod logs confirm MF has delivered payout webhooks (rare, but happens).

Actual behavior:
  - MF DOES send payout webhooks — but only when their system reaches a
    terminal state (`completed` or `cancelled`)
  - For many of our stuck payouts, MF's system never reaches terminal state
    — it just hangs indefinitely on their side (neither confirmed nor
    cancelled). No webhook fires because there's nothing to fire.
  - Log-based sanity: prod has hundreds of payin webhooks from MF vs single
    digits of payout webhooks. Payouts hanging is the norm, not the exception.
  - MF has NO public status-verify API (unlike CinetPay), so we can't poll to
    resolve hung ones — admin must verify on MF dashboard and mark manually.

### MoneyFusion payout webhooks — reality check (rewritten 2026-07-21)

**MoneyFusion DOES send payout webhooks reliably.** Do not repeat the earlier
wrong assumption that they "hang" or "never fire". Verified empirically
2026-07-21 by comparing 55+ transactions we had stuck in `processing` against
Rufus's MF-dashboard export — every single one was `Validé` on MF's side. MF
finished, MF sent us the webhook. **We dropped it.**

Root cause: race condition between MF's async webhook and our own sync
initiation flow.

  1. We POST to MF `/api/v1/withdraw` with a `webhook_url`
  2. MF generates a `tokenPay`, returns it in the response, AND fires the
     `payout.session.completed` webhook at basically the same instant
     (empirical: <50ms after our POST returns; sometimes BEFORE our POST
     response is fully awaited by our own code)
  3. Our webhook handler at `payment.service.ts:3392` looks up
     `findByExternalId(tokenPay)` → returns null because our initiation flow
     hasn't finished storing that tokenPay on the transaction yet
  4. Handler logs "Transaction not found for tokenPay X" and returns `200`
  5. MF sees `200`, considers the webhook delivered, never retries
  6. Our own initiation flow completes seconds later and stores the tokenPay,
     but the webhook is already gone. Transaction stays `processing` forever.

Prod evidence (2026-07-20 18:33):
  - `18:33:15` — webhook arrives with tokenPay `6a5e4dbfbb...7d64`, handler
    logs "Transaction not found", returns 200
  - `18:33:15` — our own initiation code finally logs "Stored MF tokenPay
    6a5e4dbfbb...7d64 for tx hJGzLePYgM2xIXDO"

Same pattern for every other stuck payout — MF fired, we weren't ready to
receive it. Only 5 payout webhooks recorded across all of prod's rotated
nginx logs (vs 2000+ payin webhooks), and every one shows this race in the
payment-service logs.

Log-based sanity: prod nginx has hundreds of MF payin webhook hits vs
5 payout hits across all rotated logs. Payin is fine (initiation is a
redirect flow, tokenPay lands in DB before payer even authenticates).
Payout is the race-loser because it's an async server-side confirmation.

**Do NOT investigate this as "MF is unreliable" or "MF hangs" — the fix is
on our side.** Ideas: pending-webhook buffer keyed by tokenPay that gets
swept after initiation stores tokenPay; return 500 on tx-not-found so MF
retries; poll MF `/paiementNotif/{tokenPay}` after initiation (payin uses
this pattern already at `moneyfusion.service.ts:268` — payout equivalent
unknown but worth asking MF).

Fix workflow (PR #72 + #77):
  - `/fix-moneyfusion-withdrawals` admin page lists all stuck MF withdrawals
  - Admin verifies on MF dashboard, clicks Mark Completed / Mark Failed
  - Marker `metadata.manualCompletion: { by, at, reason }` stamped for audit
  - Old records (pre-PR #72) have no such marker — the gap between
    `createdAt` and `payoutCompletedAt` is the only clue they were manually
    marked without webhook confirmation

### MoneyFusion withdraw_mode slugs: trust the live API, not the written docs

`GET https://pay.moneyfusion.net/api/v1/withdraw/methods` (no auth) returns the
authoritative per-country payout slugs. Verified 2026-08-30 — several slugs in
`MoneyFusion.WITHDRAW_MODES` had been guessed from their written docs and were
wrong, each producing a 100% failure rate on prod:

| Country | Was (wrong) | Actual | Prod evidence |
|---|---|---|---|
| TD Airtel | `airtel-money-td` | `airtel-td` | country wasn't even in operatorMaps |
| GA Airtel | `airtel-money-ga` | `airtel-ga` | 10 failed, 0 completed |
| CD Airtel | `airtel-money-cd` | `airtel-cd` | 8 failed, 0 completed |
| NE (all) | `mtn-ne`, `mauritel-ne` (don't exist) | `airtel-money-ne`, `amana-ne`, `zamanicash-ne`, `moov-money-ne`, `nita-ne` | 9 failed, 0 completed |

Also: the map keys must match the operator names we **store**. Niger stored
`ORANGE_NER`/`MOOV_NER`, but the map was keyed on `AIRTEL_NER`/`MTN_NER` — so
lookup missed entirely. Orange Niger is now **Zamani**, so `ORANGE_NER` maps to
`zamanicash-ne`.

Countries MF does NOT pay out to (their list is empty or absent): CF, GN, and
KE/GH/RW (not in their list at all — GH withdrawals succeed via another
provider, so don't "fix" those entries). CG is routed to FeexPay, not MF.

**Before adding or changing any MF slug, curl that endpoint and match it
literally.** A wrong slug fails every payout for that operator silently.

### MF dashboard limits — what you can and can't verify

Sterling confirmed empirically 2026-06-29:
  - MF dashboard's `Statut` column has NO filter for failed/cancelled
    transactions — only shows pending + successful
  - No public endpoint to query MF by tokenPay or our own reference
  - So if our `externalTransactionId` (the MF tokenPay) is **absent from MF
    dashboard**, three things are indistinguishable: never received, received
    and silently failed, or received and pending forever. Treat all three as
    "not delivered" for refund purposes.

Investigation procedure when a user says "didn't receive":
  1. Pull the tx — confirm `metadata.selectedPayoutService: 'MoneyFusion'`,
     status `completed`, and grab `metadata.accountInfo.fullMomoNumber`,
     `amount`, `externalTransactionId`
  2. Ask admin to search MF dashboard for that recipient number AND/OR amount
     (gross, rounded to integer). NOT `netAmountRequested` — MF shows our gross.
  3. If absent from MF dashboard → refund full gross `amount` to user's
     `balance`, insert a RECONCILIATION transaction citing the original tx,
     update the original tx's status to `refunded` with metadata trail. Rhinansou
     case 2026-06-29 is the canonical example.
  4. If present in MF dashboard → push it to MF support / Orange CM (whichever
     network); the money left our hands successfully.

### CinetPay payout webhooks — they mostly DON'T call us; POLL instead

Confirmed empirically 2026-06-30 → 07-01. Nginx + app logs show CinetPay has
NEVER hit `/api/payouts/webhooks/cinetpay` — zero requests across the entire
prod history — despite our `notify_url` being correctly set and the route
being reachable (FeexPay successfully hits the parallel `/feexpay` path).

Our `notify_url` field name IS correct per CinetPay's own `/v1/transfer`
docs (verified 2026-07-01 — they list it as required). Unknown why they
don't call. Possibilities: their new-platform migration broke webhook
delivery; needs to be enabled per-account; needs to be configured in
merchant dashboard globally instead of per-request.

**But CinetPay's own docs explicitly recommend polling their status API as
the fallback when notifications don't arrive** (quote from their `/v1/transfer/{id}`
docs: "vous pouvez utiliser le statut de transaction pour vérifier en temps
réel le statut actuel d'un paiement. En pratique, cela peut être utile lorsque
les notifications ne sont pas envoyées"). So we can't and shouldn't rely on
their webhook.

Fix workflow (PR shipped 2026-07-01, feature/fix-cinetpay-withdrawals-page):
  - `/fix-cinetpay-withdrawals` admin page lists stuck CinetPay withdrawals
  - Admin clicks "Verify & Apply" → we call `cinetpayPayoutService.checkPayoutStatus`
    → we act on the answer:
      - `completed` → mark COMPLETED + debit wallet
      - `failed` → mark FAILED, no wallet movement
      - `pending` → leave alone, tell admin to try later
  - Marker `metadata.reconciliation: { by, at, source, cinetpayStatus, reason }`
    stamped for audit
  - No admin verification against CinetPay dashboard needed — the status API
    is authoritative

### CinetPay top-level `serviceProvider` field is NOT set

Pre-existing gap: withdrawals routed through CinetPay have `serviceProvider: null`
in the transaction document, but `metadata.selectedPayoutService: 'CinetPay'`.
MoneyFusion sets both. This tripped up my first filter attempt for the CinetPay
reconciler; use `$or: [{ serviceProvider: 'CinetPay' }, { 'metadata.selectedPayoutService': 'CinetPay' }]`
when querying. Longer-term cleanup: set `serviceProvider` consistently on the
CinetPay branch of `processMobileMoneyWithdrawalPayout`.

### Payment sandbox (preprod only)

`PAYMENT_SANDBOX_ENABLED=true` in payment-service `.env` fakes every provider call
(payins AND withdrawals) — no real money moves. Hard-refused when
`NODE_ENV=production` regardless of the flag. Interception is at the
provider-client boundary (`*PayoutService.initiatePayout`, the payin initiators,
`checkPayoutStatus`), so all sibling flows — user+OTP, admin-approved,
admin-direct, status-checker cron, `/fix-*-withdrawals` pages — run their REAL
code including debit-on-success. A sweeper (`jobs/sandbox-sweeper.job.ts`)
resolves each fake payment ~15s later (`SANDBOX_COMPLETE_DELAY_MS` to change)
through the provider's genuine webhook processor. Fake references are
self-describing: `SBX-<outcome>-<dueEpochMs>-<suffix>`.

Magic values:
- **Payins, FeexPay countries (BJ/TG/CG)** — the phone is typed on OUR page, so
  its ending rules: `..00` rejected at initiation, `..11` FAILED webhook, `..22`
  hangs forever, anything else SUCCESS.
- **Payins, hosted-checkout flows (MoneyFusion, CinetPay, crypto)** — our page
  never collects payment details, so magic phones can't apply. The user is
  redirected to the **sandbox checkout page**
  (`/api/payments/sandbox/checkout/:sessionId`, 404 unless sandbox active) with
  buttons: simulate success / simulate failure; closing the page = abandoned
  checkout (stays pending).
- **Withdrawals (all providers incl. crypto)** — net amount's last 2 digits:
  `..01` FAILED (wallet untouched), `..02` hangs (tests the fix pages), `..03`
  rejected at initiation, anything else COMPLETED (wallet debited — XAF gross
  for MOMO, USD amount+fee for crypto).

Assertions: `payment-service/src/scripts/check-sandbox.ts` (needs local Mongo).

### Provider webhook + API status quick-reference

| Provider | Sends payout webhooks | Has status verify API | Recommended reconcile strategy |
|---|---|---|---|
| FeexPay | Yes (reliable) | Yes | Trust webhook; no manual tool needed |
| MoneyFusion | Only on terminal state (many payouts hang) | No | Admin verifies on MF dashboard + `/fix-moneyfusion-withdrawals` page |
| CinetPay | No (empirically zero calls, unknown why) | **Yes — recommended** | Poll status API via `/fix-cinetpay-withdrawals` page |
| NOWPayments (crypto) | Yes | Yes | Trust webhook |

### Master deploys need ONE click (post-PR #73)

Sterling has SSH access at the `contabo` host (configured in his `~/.ssh/config`)
and standing approval to merge develop-target PRs once CI is green. Master-target
PRs need his explicit OK to merge AND a manual click in GitHub Environments to
release the deploy. After PR #73, that's a single click on Backend (Web UI
auto-runs as a no-op). The prod environment is at `/var/www/SBC-MS/`, preprod at
`/var/www/SBC-MS-preprod/`. Backend services managed by PM2 (`payment-service`,
`user-service`, etc. for prod; `payment-preprod`, `user-preprod`, etc. for preprod).

## Database Conventions

- Each service uses its own MongoDB database
- Mongo host on prod: `mongodb://localhost:27017` (no auth). Same host serves preprod DBs alongside prod.
- Models use Mongoose schemas with TypeScript interfaces; repository pattern for data access
- Development databases (local): `sbc_{service}_dev` (e.g., `sbc_user_dev`)

### Actual prod / preprod DB names (empirically verified 2026-07-16, do not guess)

| Service | Prod DB | Preprod DB |
|---|---|---|
| user | `sbc_users` (plural, no suffix) | `sbc_users_preprod` |
| payment | `sbc_payment` (no suffix — 190k+ tx docs; `sbc_payment_prod` also exists but is EMPTY, do NOT query it) | `sbc_payment_preprod` |
| notification | `sbc_notifications` | `sbc_notifications_preprod` |
| product | `sbc_products` | `sbc_products_preprod` |
| settings | `sbc_settings` | `sbc_settings_preprod` |
| tombola | `sbc_tombola` | `sbc_tombola_preprod` |
| chat | `sbc_chat` | `sbc_chat_preprod` |
| sbclove | (not yet on prod) | `sbc_sbclove_preprod` |
| advertising | `sbc_advertising` | (n/a) |

Gotchas:
- **user db is `sbc_users` (plural), not `sbc_users_prod` or `sbc_user_prod`.** Every service uses a no-suffix name on prod.
- `sbc_payment_prod` shows up in `getDBNames()` but is EMPTY (a stale ghost). Real prod payment data lives in `sbc_payment` (no suffix). Verified 2026-07-19.
- Guessing DB names returns null silently — always confirm with `db.getMongo().getDBNames().filter(n=>/sbc/i.test(n))` AND `db.<coll>.countDocuments({})` on a stable collection before running real queries.

### User model quick-reference (`sbc_users.users`)

- `role`: `'user' | 'admin' | 'withdrawal_admin' | 'tester'` (single string, not array). Enum defined in `user-service/src/database/models/user.model.ts` as `UserRole`.
- JWT payload shape (signed in user-service): `{ userId, id, email, role }` — both `userId` and `id` are the same ObjectId string. Callers should read `req.user.userId` (canonical) with `req.user.id` as fallback.
- Admin panel bypasses various tier gates by checking `role === 'admin' || 'tester'` in JWT — e.g. the formation subscription filter in `settings-service/src/api/controllers/settings.controller.ts`.
- Test a subscription-gated feature as a real non-admin user. Admin accounts falsely appear to "see everything" because bypass is intentional.

## File Structure Notes

- Payment service includes EJS views and public assets for payment UI
- Settings service handles file uploads to Google Drive
- Notification service supports WhatsApp Business API integration
- Multiple documentation files exist for specific features (crypto payments, withdrawals, etc.)

## Special Scripts

### User Service
```bash
npm run recalc:partners           # Recalculate partner transactions (dry run)
npm run recalc:partners:apply     # Apply partner transaction recalculation
npm run check:countries           # Analyze country data
npm run fix:countries             # Fix country data issues
```

### Payment Service  
```bash
npm run build-css                # Build Tailwind CSS for payment UI
```

### Notification Service
```bash
npm run dev:worker:broadcast      # Run broadcast worker in development
npm run validate:whatsapp         # Validate WhatsApp setup
```

When working with this codebase, always check the specific service's package.json for available scripts and refer to the comprehensive README.md for deployment instructions.

## Git Workflow (CRITICAL — Must Follow)

This project uses **GitFlow**. All Claude Code sessions MUST follow these rules:

### Branches
- `master` — production. **NEVER push directly to master.**
- `develop` — preprod/staging. **NEVER push directly to develop.**
- `feature/*` — for new work (branch from `develop`)
- `hotfix/*` — for urgent prod fixes (branch from `master`)
- `release/*` — for release prep (branch from `develop`)

### Rules
1. **NEVER commit or push directly to `master` or `develop`.** Always use a feature branch and Pull Request.
2. **Before starting any work**, check which branch you're on with `git branch`. If on `master` or `develop`, create a feature branch first:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/description-of-work
   ```
3. **When work is done**, commit and push the feature branch:
   ```bash
   git add <specific-files>
   git commit -m "descriptive message"
   git push -u origin feature/description-of-work
   ```
   Then inform the user to create a PR to `develop` on GitHub.
4. **NEVER merge branches locally.** All merges happen via Pull Requests on GitHub using `gh` CLI:
   ```bash
   # Create a PR to develop
   gh pr create --base develop --title "feat: description" --body "Summary of changes"
   
   # Merge a PR (after CI passes)
   gh pr merge <PR-number> --merge --delete-branch
   
   # List open PRs
   gh pr list
   
   # View PR status/checks
   gh pr checks <PR-number>
   ```
5. **Hotfixes** (urgent prod bugs) branch from `master`:
   ```bash
   git checkout master
   git pull origin master
   git checkout -b hotfix/description-of-fix
   ```

### When to Use Feature Branches vs Direct Commits
- **Feature branches + PRs**: Required for code changes that affect app behavior (features, bug fixes, refactors)
- **Batch non-code changes**: Documentation, README updates, config tweaks, and other changes that don't affect the running app should NOT get their own feature branch. Instead:
  - Commit them locally on `develop`
  - Push them together with the next real code change, OR
  - Push them when several non-code changes have accumulated
- This avoids wasting time and tokens on CI/PR cycles for trivial changes.

### CI/CD Pipeline
- PRs to `develop` or `master` trigger CI checks (build)
- Merging to `develop` → auto-deploys to **preprod** (`preprod.sniperbuisnesscenter.com`)
- Merging to `master` → deploys to **production** (requires approval)

### Environments
- **Production**: services on ports 3000-3008, domain `sniperbuisnesscenter.com`
- **Preprod**: services on ports 6000-6008, domain `preprod.sniperbuisnesscenter.com`
- **Admin prod**: `admin.sniperbuisnesscenter.com`
- **Admin preprod**: `preprod-admin.sniperbuisnesscenter.com`