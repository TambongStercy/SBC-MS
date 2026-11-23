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

### Admin redesign: parked on branch `admin-redesign` (2026-10-04)

A phone-first rebuild of the admin (one ☰ menu, `src/ui` components, modules
rebuilt) was merged to develop on 2026-10-04, then **taken off preprod the same
day at Rufus's request**: develop/preprod run the original admin again (with
the #299 safety fixes and half-height proof videos). The rebuild lives on the
`admin-redesign` branch (not deployed; it can be shown on preprod with the
manual "Deploy to preprod" workflow). Do not merge it back without Rufus's go.
Why he stopped it: the look (flat, generic icons, no animation, a weaker login
and loading screen) felt worse than the original — see memory
`feedback_admin_look`.

Backend changes made during the rebuild stayed on develop (they are compatible
with the original admin): moderator role and staff login (#300), member search
and filters (#301, #303), admin story delete (#306), admin relance routes acting
on every member's campaign + overview/parrains endpoints (#310), admin product
removal (#314). Facts found while rebuilding — still true of the backend:
- `POST /users/admin/users/:id/adjust-balance` (API only, no screen) now writes a
  transaction and a ledger movement for the main balance (support phase 2) and, since
  2026-11-22, a transaction for the activation balance too; it needs the admin's code
  (see "Money actions need the admin's own code").
- The live CinetPay balance (`/payments/admin/gateway-balances/live`) calls
  `getBalance()` without a country, so it is ONE country's balance (#305, open,
  fixes it).
- **Relance**: the member app shows ONE relance switch = `enabled &&
  !sendingPaused`; turning it on clears `enrollmentPaused`, which the app never
  displays. Deactivating one of the 7 email days leaves every filleul who reaches
  that day stuck on it (the sender `continue`s without advancing). The admin
  media upload builds `localhost` URLs that no email client can reach.
- **SBC Love**: the member never sees a rejection reason (fixed copy only).
  `PATCH /sbclove/admin/module` accepts any value, unvalidated.
- **Tombola**: the service draws only an OPEN tombola. Prizes are hard-coded
  English (`Bike`, `Phone`, `100k FCFA`) and pushed to winners as-is.
  `previousMonthWinners` is set only when an Impact Challenge creates the month.
  Delete leaves the month's paid tickets orphaned.
- **Boutique**: product `status` changes nothing — the member app lists
  products whatever their status (12k "pending" are public).
- **Impact Challenge**: the original admin pages were rebuilt against the real
  API on 2026-10-17 (`ImpactChallengePage`, `ChallengeDetailsPage`,
  `components/impactChallenge/*`, `services/impactChallengeApi.ts`).
  Payout needs `LOTTERY_POOL_ACCOUNT_ID` and `SBC_COMMISSION_ACCOUNT_ID` in
  `tombola-service/.env` — unset on prod and preprod as of 2026-10-04.
  API facts the UI works around: `PATCH /admin/:id` takes the raw body (any
  field, incl. status/totals) — the UI sends only name, dates, description;
  changing month/year on a draft does NOT re-link the month's tombola, so the
  UI never offers it. No unapprove route (service has `rejectEntrepreneur`,
  unrouted). Votes list returns `userId` only, no names, and there is no
  admin batch member lookup. A crashed payout leaves `distributionInProgress`
  true forever with no endpoint to clear it. Dates: a bare `YYYY-MM-DD` is
  UTC midnight and would end voting at the START of the last day, so the
  admin sends start/end of day in local time.

### Admin access per module (2026-11-16)

Rufus: staff accounts get, per module, no access / read-only / write.
- **Modules:** `user-service/src/config/admin-modules.ts` (dashboard, members,
  partners, leaderboard, finance, payments, withdrawals, payouts, boutique,
  tombola, impactChallenge, sbclove, ads, adsProofs, events, relance,
  notifications, communication, settings, whatsapp, staff).
  - `admin` = super admin: every module in write, plus `staff` (the team),
    which is never delegated.
  - `staff` = `users.adminPermissions` `{ module: 'read'|'write' }`; a missing
    module is not visible.
  - The two older roles keep what they had through `effectivePermissions`:
    withdrawal_admin → withdrawals, moderator → adsProofs.
    `scripts/convert-staff-roles.ts` (dry run, `--apply`) moves them to `staff`.
- **Enforced at the gateway**, `admin-allowlist.middleware.ts` + `admin-routes.ts`:
  - The table maps path → module. GET = read, anything else = write, except the
    read-only POSTs listed there (audience, previews).
  - The path is normalised first (decoded, lowercased, `//` and `..` resolved),
    because Express routes case-insensitively.
  - Rights come from `GET /users/internal/:id/admin-access`, cached 60 s, and a
    failed lookup refuses (503). A revoked account therefore keeps access for at
    most a minute. Since 2026-11-19 the same lookup checks the admin session
    (see "Admin sign-in" below); signing out takes effect at once.
  - `ADMIN_ALLOWLIST` still applies to every admin call, staff included.
  - An admin path missing from the table is super-admin only, so a new route
    stays closed to staff until it is mapped.
  - The table also covers admin routes without "/admin" in their path:
    sub-admins, withdrawals, payouts (webhooks stay public), WhatsApp, settings
    writes, storage, community events, notifications custom/templated/follow-up.
- **Services** only check that the caller is admin-capable (`admin`/`staff`,
  plus their older roles where they were accepted).
  - Role changes stay super-admin only in user-service too: `PATCH
    /users/admin/users/:id/role`, `/users/admin/staff*`, and a `role` field
    sent to `PUT /users/admin/users/:id`.
  - Mixed routes (members and admins on the same path, e.g. chat status
    delete/admin categories) cannot be told apart at the gateway; their admin
    actions stay `admin` only.
- **Holes closed at the same time:**
  - `/api/whatsapp/*` and `/api/notifications/whatsapp/qr*` had no authentication.
  - `/api/notifications/send-email-attachment` had none either: anyone could
    mail any attachment through our server. It now requires the service secret.
  - Settings logo/CGU/presentation/formations/gateway-balances/admin-balance/
    event-commissions writes, storage, and community-event writes were open to
    any signed-in member.
  - payment-service `/admin/recovery/*` was login-only.
  - custom/templated/follow-up compared the role with `'ADMIN'` and refused
    everyone.
- **Checks:** `gateway-service/src/scripts/check-admin-permissions.ts` (route
  table, path tricks, read-only/no-access/super admin, cache, fail-closed).
- **Team API (super admin):** `GET /users/admin/staff`, `PUT /users/admin/staff/:id
  {permissions}` (makes the member `staff`), `DELETE /users/admin/staff/:id`
  (back to member); `GET /users/admin/me/access` for the signed-in account.

### Admin sign-in: authenticator app, like the support desk (2026-11-19)

Sterling: "It should be like support desk". The admin signs in with the password,
then the 6-digit code of an authenticator app (Google/Microsoft Authenticator,
2FAS), or a single-use backup code. user-service `services/admin-auth.service.ts`,
routes `/users/admin/login`, `/login/email-code`, `/login/enroll/{start,confirm}`,
`/login/totp`, `/logout`, `/me/security`, `/me/backup-codes`,
`/staff/:id/reset-authenticator`.
- **First sign-in of each admin** (all of them after the deploy): password, then a
  code emailed to the account (proves the mailbox), then the authenticator is set
  up from a QR code and 10 backup codes are shown once.
- **Sessions:** the admin token carries `asid`. The gateway (and user-service's own
  admin routes) refuse any admin call whose session is missing, signed out, idle
  `ADMIN_IDLE_TIMEOUT_MIN` (30) or older than `ADMIN_SESSION_MAX_HOURS` (12):
  401 `ADMIN_SESSION_ENDED`, the admin app goes back to the sign-in. **A member-app
  token of an admin account no longer opens the admin** (it used to: same JWT,
  same role).
- **Lockout:** 5 failures (password or code) in 24 h lock the account 15 min,
  then 1 h, then 24 h, and email the admin; a new device and a used backup code
  email them too. Every refusal gives the same message.
- **Storage:** secrets AES-256-GCM with `ADMIN_TOTP_ENC_KEY`, in their own
  collections (`adminauths`, `adminsessions`, `adminloginchallenges`), never on
  the user document.
- **Lost phone:** sign in with a backup code; a super admin resets the
  authenticator in Équipe (not their own). Last resort on the server:
  `node dist/scripts/reset-admin-authenticator.js --email <email> [--apply]`.
- **Deploy (prod and preprod): set `ADMIN_TOTP_ENC_KEY` in user-service `.env`
  first** (`openssl rand -base64 32`, one per environment). Without it no admin can
  sign in (503); members are unaffected. Never rotate it without resetting every
  admin's authenticator. Check: `src/scripts/check-admin-authenticator.ts`
  (Node 20/22), gateway `check-admin-permissions.ts`.
- Still different from the desk: the admin token stays in localStorage (the admin
  calls the API cross-origin, so the desk's httpOnly cookie would need an `/api`
  location on the admin vhosts first). Money actions do re-check the code (below).
- **Money actions need the admin's own code (2026-11-22, Security plan Phase 3 item 6).**
  - **Where:** payment-service `requireAdminStepUp` guards withdrawal from a member's balance
    (`/withdrawals/admin/user`), direct payouts (`/withdrawals/admin/direct`,
    `/payouts/initiate`, `/payouts/test`), approve, bulk-approve and manual-complete.
    Reject and manual-fail are not guarded.
  - **How it is checked:** the code travels in the body (`adminCode` or `adminBackupCode`) and is
    stripped before the handler. user-service `stepUp` checks it against the admin's
    authenticator: used once, the same lockout as sign-in, a backup code is e-mailed.
  - **Window:** a code opens a window of `ADMIN_STEPUP_MINUTES` (10) on that admin session
    (`adminsessions.stepUpUntil`), so a batch of approvals needs one code.
  - **Refused:** a token without `asid`; a signed-out session (401).
  - **User-service down:** 503 (fails closed).
  - **Codes:** `ADMIN_CODE_REQUIRED` / `ADMIN_CODE_INVALID` / `ADMIN_CODE_LOCKED`. The admin app
    (`apiClient` interceptor + `AdminCodePrompt`) asks for the code and resends the request.
  - **Fraud check:** the Phase 4 decision already applies on the member-money paths
    (`assertWithdrawalsNotLocked(…, 'admin')`).
  - **Kill switch:** `ADMIN_STEPUP_REQUIRED=false` (payment-service).
  - **Checks:** user-service `check-admin-step-up.ts`, payment-service `check-admin-step-up.ts`,
    admin `AdminCodePrompt.test.tsx`.
  - **user-service money actions (2026-11-22).** Both are API-only (no screen), and both need
    the same code: `requireAdminStepUp` in user-service calls `stepUp` directly.
    - `adjust-balance`:
      - needs a reason of at least 10 characters (`ADMIN_MONEY_REASON_MIN`) and a non-zero amount;
      - activation-balance adjustments are recorded too (`ADMIN_ADJUSTMENT`,
        `metadata.balance: activation`, pending → completed/failed; refused if payment-service
        cannot record them);
      - an activation debit is one guarded write, so two at once never take it below zero.
    - `cancel-activation-transfer` turns activation money back into withdrawable balance:
      - payment-service first claims the cited transfer in ONE conditional write
        (`/internal/transactions/:id/claim-activation-reversal`). It must be this member's
        `activation_transfer_in`, completed, never reversed, and at least the amount. A refusal
        answers 409 `NOT_REVERSIBLE` with the reason.
      - The balance then moves under the ledger reference `activation-reversal:<transfer>`, so
        the same transfer can never move money twice.
      - A failed move releases the claim (`release-activation-reversal`).
      - Before this, nothing about the cited transfer was checked: one old transfer id could
        unlock any amount, again and again.
    - Checks: user-service `check-admin-balance-guard.ts`, payment-service
      `check-activation-reversal.ts`.

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

### Withdrawals are locked 48 h after an email or phone change (2026-10-22)

Rufus's rule, added after the October 2026 wallet drain: changing the account
email or phone number blocks every withdrawal for
`WITHDRAWAL_LOCK_HOURS_AFTER_CONTACT_CHANGE` hours (user-service `.env`,
default 48). The change stores `withdrawalsLockedUntil` + `withdrawalLockReason`
on the user, and an alert goes to the email held **before** the change (plus a
push), so a hijacker cannot silence it.
- **Every path that writes `email` or `phoneNumber` must add
  `withdrawalLockFields()`** (`user-service/src/utils/withdrawal-lock.ts`):
  confirm-change-email, confirm-change-phone, the plain profile save (`PUT
  /users/me` changes the phone with no OTP), and the admin user edit. Compare
  with `isSamePhoneNumber` first: old accounts store numbers without the
  dialling code, and the profile page resends the number on every save.
- payment-service calls `assertWithdrawalsNotLocked()` (reads `GET
  /users/internal/:userId/withdrawal-lock`, fails closed) at: mobile-money and
  crypto initiate, OTP verify, admin approval (single and bulk), admin
  withdrawal from a member's balance, the deprecated `/payments/crypto/payout`,
  and member-to-member `/transactions/payment`. A withdrawal refused at approval
  stays `pending_admin_approval` and can be approved once the lock ends.
- Not locked: admin direct payouts (`/withdrawals/admin/direct`,
  `/payouts/initiate`), which pay out of SBC's provider balance, not a
  member's.
- **MoMo number changes lock too (Security plan Phase 0, Rufus 2026-11-19).**
  `PUT /users/me` no longer changes `momoNumber`/`momoOperator`: unchanged
  details pass (any format), anything else answers 409
  `MOMO_CHANGE_NEEDS_CODE`. The change goes through
  `POST /users/me/momo/change {momoNumber, momoOperator, password, code}`:
  the account password + a code from the member's **authenticator app** (or
  a backup code), see "Member authenticator" below. The old e-mailed-code
  routes (`request-change`/`confirm-change`) answer 410. Replacing a number locks withdrawals
  (reason `momo_change`) and alerts the account email; a first number needs
  the code but no lock, and so does adding the operator to a number saved
  without one (same digits; 1,128 such members on prod 2026-11-23,
  `momoChangeLocks`, also for support's change). An admin replacing a member's number locks too.
  `utils/momo.ts`, `src/scripts/check-momo-and-country-lock.ts`. The member
  app's `MomoChangeSheet` (SBC-WEB-UI) drives it.
- **The country is not the member's to change** (same plan item): `PUT
  /users/me` ignores `country`; support or the admin edit changes it.
- **The crypto wallet locks too (same plan item).** `PUT /users/crypto/wallet`
  only accepts the wallet already saved (409 `CRYPTO_CHANGE_NEEDS_CODE`
  otherwise, a first wallet included). Setting or changing it:
  `POST /users/crypto/wallet/change {cryptoWalletCurrency, cryptoWalletAddress,
  password, code}` (authenticator code, like the MoMo change; old routes 410).
  Replacing a wallet locks
  withdrawals (reason `crypto_change`) and alerts the account email. Addresses
  are checked against the network's format (`utils/crypto-wallet.ts`): a TRON
  address on USDTBSC is refused before any code. payment-service's
  `processCryptoWithdrawalPayout` pays only the address recorded on the
  transaction at request time (`metadata.cryptoAddress`), and fails the
  withdrawal if the wallet changed since. Checks:
  `user-service/src/scripts/check-crypto-wallet-lock.ts`,
  `payment-service/src/scripts/check-crypto-payout-wallet.ts`.
- There is no admin "lift lock" action: to lift one, unset
  `withdrawalsLockedUntil` on the user document.
- **Payout seal: a destination changed outside the app freezes the money (2026-11-22, Sterling).**
  Someone with database access could rewrite `momoNumber` or the crypto wallet directly, skipping
  the authenticator code and the lock.
  - **The seal:** `users.payoutSeal` is an HMAC (`PAYOUT_SEAL_KEY`, only in user-service `.env`,
    never rotate) of the member id + MoMo number/operator + crypto wallet/network, plus their last
    digits.
  - **Writes through the code reseal by themselves:** `utils/payout-seal.ts` is a plugin on the User
    model that hooks every save/update touching those fields, whatever the path (member flows,
    admin, support, scripts). A doc whose seal is already broken is not resealed by a later write.
  - **Where a broken seal is caught:** in `GET /users/internal/:id/withdrawal-lock` (so before every
    withdrawal and admin approval), and by a nightly sweep at 03:50 Douala.
  - **What happens** (`services/payout-seal.service.ts`, `PAYOUT_SEAL_MODE=enforce`, the default;
    `log` = case only):
    - the money is frozen (`frozen.by = 'payout_seal'`), lifted only by support's approved unfreeze;
    - a critical `abnormal_behavior` case goes to the Fraude queue with the evidence: the sealed vs
      current last digits, and the numbers this member really withdrew to (payment-service
      `POST /api/internal/withdrawal-destinations`, last 9 digits only).
  - **Bootstrap:** `dist/scripts/payout-seal-bootstrap.js` (dry run, `--apply [--cases]`) seals
    everyone. It lists members whose current number never served their withdrawals, as warning
    cases without alert. Then set `PAYOUT_SEAL_SINCE` (the bootstrap date), after which a missing
    seal counts as a tamper too.
  - Check: `user-service/src/scripts/check-payout-seal.ts`.

### Withdrawal reservations, wallet ledger, webhook rules (support phase 2, 2026-11)

- **Reservation:** a withdrawal holds its gross amount from the request (`users.reservedBalance`,
  USD: `reservedUsdBalance`, rows in user-service `balancereservations`). Available money =
  `balance - debt - reservedBalance`. Every debit except a withdrawal's own settlement is
  refused beyond it (spend, transfer, conversion, admin adjust, internal withdrawal). Success
  converts (balance and reserved drop once, ledger ref `withdrawal:<txId>`); a confirmed
  failure, rejection, cancellation or approval expiry releases. Nothing releases on a timeout.
- **Ledger:** every balance change is a `walletmovements` row (unique `{reference, direction}`).
  Opening balances: `user-service/src/scripts/snapshot-opening-balances.ts` (dry run, `--apply`).
- **Status changes** go through `payment-service/src/services/withdrawal-lifecycle.ts`
  (one conditional write; money moves only for the call that made the transition).
- **MoneyFusion payout webhooks are hints.** A "completed" applies only with concordant
  amount + number (`MONEYFUSION_PAYOUT_STRICT_MATCH=true`, the default; `false` = the tokenPay
  match is enough, as before). A "cancelled" never fails a withdrawal: it opens a review case
  and the money stays reserved. So **the old webhook-simulation pattern (rule 7 above) no
  longer works for MoneyFusion**: use Mark Completed / Mark Failed or the support
  `regularize` route. A provider-confirmed success still completes a FAILED withdrawal (debit
  once, divergence case). A real payout webhook (prod, 2026-11-21) is
  `{event, tokenPay, montant: <our gross>, numeroRetrait: "6XXXXXXXX", moyen, webhook_url,
  createdAt}`: lowercase `montant`, number in `numeroRetrait`. Until 2026-11-22 the number
  was not read, so strict mode would have sent every real MoneyFusion payout to review.
- **MoneyFusion payin webhooks are hints too:** the status answer decides, and a
  "paid" applies only if `Montant + frais` ≥ the amount sent (`metadata.mfPayinAmount`,
  1 F tolerance) and its session matches; otherwise review + case. **Checked on prod
  2026-11-22:** the status answer's `Montant` is net of MoneyFusion's 3% fee (2,150 F →
  `Montant: 2085.5, frais: 64.5`), so `moneyFusionPayinGross` adds `frais` back
  (`Montant` alone would have sent every real payin to review). `paidAmount` stays the
  net `Montant`. Sandbox payins skip this check. Test payloads must use these real
  shapes (`check-support-money.ts`).
- **Deploy order:** user-service first (wallet routes `/api/users/internal/wallet/*`), then
  payment-service **immediately after, back to back**. Against an older user-service,
  payment-service refuses withdrawals with a 503 ("mise à jour en cours") — nothing is paid
  without a reservation. The other mix is the dangerous one: a new user-service guards every
  debit (`balance - debt - reserved`), and the OLD payment-service's FeexPay webhook handler
  marks a payout FAILED when its debit is refused — a paid payout recorded as failed. Keep
  the window between the two deploys as short as possible; `WITHDRAWALS_ENABLED=false` stops
  new payouts but not the webhooks of payouts already sent, so it does not close this window.
- **Required:** `NOWPAYMENTS_IPN_SECRET` in payment-service `.env` (every NOWPayments
  webhook without a valid HMAC is refused with 401, and crypto payins only complete through
  them). `SUPPORT_SERVICE_URL` in both services (cases are only logged without it).
- **Prod MongoDB must be ≥ 5.0** for the partial unique indexes
  (`paymentintents.uniq_gateway_ref_since_20261118`, `transactions.uniq_user_idempotency_key`,
  `walletconversions.one_open_conversion_per_user`); check with `db.version()` before deploying.
- Kill switches: `LEDGER_CHECK_DISABLED`, `FINANCE_RECONCILIATION_DISABLED`.
- Assertions: `user-service/src/scripts/check-wallet-reservations.ts`,
  `payment-service/src/scripts/check-support-money.ts` (test DBs only).

### Payment conversion (Security plan Phase 10, part 1, 2026-11-20)

- **Fewer empty payments** (`createPaymentIntent`): a second tap for the same
  payment (same member, amount, currency, type and metadata: `metadata.funnelKey`)
  reuses the open one (PENDING_USER_INPUT, no gateway, < 30 min); at most 5 new
  payments per member per 10 min (429). Admin manual intents pass
  `{ reuseAndLimit: false }`.
- **`submitPaymentDetails` refuses SUCCEEDED/CONFIRMED/PROCESSING/PARTIALLY_PAID**
  (409): the public submit route used to re-initiate any status, a paid one included.
- **Funnel stamps:** `metadata.pageOpenedAt`/`pageOpens` (payment page render),
  `metadata.creditedAt` (creating service answered 2xx to a paid callback).
- **Reconciler:** every 5 min, each waiting payment re-checked every 15 min
  (`PAYIN_RECONCILE_EVERY_MIN`); after 72 h (`PAYIN_EXPIRE_AFTER_HOURS`) a payment
  whose provider answered at least once becomes EXPIRED with failure
  `member/no_final_answer_72h`. Never-answered ones keep being checked until 7
  days. A late provider success still credits it (handlers skip only
  SUCCEEDED/FAILED).
- **Admin "Paiements" (`/paiements`, module payments):** `GET
  /api/payments/admin/conversion/summary?from&to` (funnel, provider, country,
  product, country×provider, daily, failure groups, top codes, stuck > 24 h,
  median time to pay; computed from paymentintents with the `{createdAt}` index,
  cached 10 min) and `/conversion/failures` (cursor list, `format=csv`).
- The payment page's polling read `result.data`, which the status route never
  sends, so it never saw a final status; fixed (`public/js/payment.js`).
- **Part 2 (2026-11-20):**
  - **French reason + next step for the member** (`utils/member-failure-text.ts`,
    by `failure.code`, else by group; the provider's own text is never shown).
    The payment page shows it for FAILED/EXPIRED/CANCELED and when an ERROR is
    reset for retry; the submit route answers `{message, reason, nextStep}` with
    the error's own status code (a paid payment now gets 409, not 500).
  - **MoMo number check** (`utils/payin-number.ts`, FeexPay countries only: BJ
    `01`+8 digits or old 8, TG 8 digits 7x/9x, CG 9 digits starting 0).
    `PAYIN_NUMBER_CHECK=log` (default) only records `metadata.numberCheck`;
    `enforce` refuses with 400 before the provider and leaves the payment open,
    so the member corrects the number on the same payment; `off`. Switch to
    enforce only after checking the logged misses against real successes.
  - **Team alerts** (`jobs/payment-alerts.job.ts`, every 5 min, collection
    `paymentalerts`): provider success rate in the last hour below half its
    7-day rate; "SBC code" failures spike (bad deploy); "provider API" spike per
    provider (outage); per-country spike; payments created 2–24 h ago still
    waiting above `PAYMENT_ALERT_STUCK` (100) per provider. One open alert per
    key, closes by itself. E-mailed once to `PAYMENT_ALERT_EMAILS` (empty = no
    e-mail); shown on the admin page (`GET /conversion/alerts`). Tunables:
    `PAYMENT_ALERT_MIN_ATTEMPTS`, `_SPIKE_MIN`, `_SPIKE_FACTOR`,
    `PAYMENT_ALERTS_ENABLED=false` to stop it.
  - **Abandoned payments are archived, never deleted** (Sterling;
    `jobs/payin-archive.job.ts`): PENDING_USER_INPUT with no provider, older than
    7 days, are copied whole to `paymentintents_archive` (same `_id`) then removed
    from `paymentintents`; still counted in the funnel (`$unionWith`, Mongo ≥ 4.4,
    server has 7.0). Off unless `PAYIN_ARCHIVE_ENABLED=true` (daily 04:10
    Douala); dry run first: `scripts/archive-abandoned-payins.ts`. An archived
    payment's link shows "Paiement expiré".
  - Dashboard: members above 20 attempts in a day (for Phase 4).
  - **« Contacter le support »** on a failed/expired/cancelled/archived payment
    page opens `<SUPPORT_HELP_URL>/demandes/nouvelle?paiement=<sessionId>` (member
    app « Aide », the form pre-fills the reference). Hidden while
    `SUPPORT_HELP_URL` is empty: set it when SBC Support goes live. The support
    desk's member page shows each payment's recorded failure (support branches).
  - A retry on the same payment moves the previous `failure` to `failureHistory`
    (kept), so each attempt keeps its own reason (#432).
- Not done (plan items): offering another provider (each country has ONE
  provider today, BF aside; needs Rufus's call and other provider accounts),
  web/app split (no signal on payment requests), DR Congo and NOWPayments
  routes (provider investigations), support case on paid-not-credited (support
  service not merged).
- Checks: `payment-service/src/scripts/check-payment-conversion.ts`,
  `check-payment-conversion-2.ts`.

### Signals: country, device, activity (Security plan Phase 1, 2026-11-20)

- **nginx (preprod done 2026-11-20, prod not yet):** `nginx/sbc-cloudflare.conf`
  (http level, `$sbc_from_cloudflare` from Cloudflare's IP list) + in the SBC 443
  blocks `if ($sbc_from_cloudflare = 0) { return 403; }`: the origin IP is
  public through the other sites on the server. `/api/` gets
  `X-SBC-Geo $http_cf_ipcountry` (overwrites the client's) and `X-SBC-ASN
  $http_x_cf_asn` (only meaningful once a Cloudflare transform rule sets
  `X-CF-ASN` = `ip.src.asnum`; the gateway now overwrites it from the free IP files, below). Keep the range list in step with
  https://www.cloudflare.com/ips (the vhost was missing 173.245.48.0/20).
- **Gateway** `activity-signals.middleware.ts` (off unless
  `ACTIVITY_SIGNALS_ENABLED=true`): counts each authenticated request in memory
  per member/Douala day/country (sources web/app/api from `X-SBC-Client`,
  device `X-SBC-Device`, /24 range, ASN), no DB or await on the request,
  flushes every 30 s / 500 keys to `POST /users/internal/activity/batch`; a
  failed flush is dropped. No Redis needed: counts are `$inc`-merged.
- **user-service** `activity-signals.service.ts`: stores only for members whose
  `consents.privacy.version` ≥ `SIGNALS_POLICY_VERSION` (default `2026-12`, the
  policy still to be published, so nothing is stored yet); `user_geo_days`
  (one doc per member/day/country, lists capped at 5, TTL 180 days);
  `users.lastActiveAt`, `lastLoginAt` (sign-ins recorded in `verifyOtp`),
  `geo.lastCountry`, nightly `geo.usualCountry`/`usualShare` (≥ 15 distinct active days in
  30, 03:30 Douala). In the data export; erased on account deletion.
- **Web app:** `utils/deviceSignals.ts` wraps `fetch` for same-origin `/api/`
  calls only (a cross-origin custom header would trigger a CORS preflight).
- **To switch on:** Rufus approves `docs/security-plan/privacy-signals-draft.md`
  → publish it and bump `PRIVACY_POLICY_VERSION` to `2026-12` (backend + app) →
  `ACTIVITY_SIGNALS_ENABLED=true` in gateway `.env`.
- **Sign-in attempts (2026-11-22, plan item 3):** `signin_attempts` (TTL 180 days,
  `services/signin-attempts.service.ts`).
  - **What is recorded:** every `POST /users/login` with its outcome (`code_sent`,
    `unknown_account`, `wrong_password`, `blocked`, `invalid`, `error`), and the `verify-otp`
    that follows within 30 min (`signed_in` / `wrong_code`). Sign-up codes are left out:
    `signup_attempts` has them.
  - **How it is stored:** buffered and written after the answer. The typed email/number is kept
    masked plus an HMAC; country from Cloudflare, source from `X-SBC-Client`.
  - **On the boards:** rolled up into `activity_days.signins` and shown on both boards
    (« Connexions réussies », refusals by reason).
  - **Fraud engine:** a member's 10th wrong password within an hour sends `signin_failures` to
    risk-service once (rule `password_guessing`, 15 points, 7 days).
  - Check: `src/scripts/check-signin-attempts.ts`.
- **Country and network from free IP files (2026-11-22, instead of GeoLite2: no keyed services).**
  - **Data:** sapics/ip-location-db's own datasets `user-country` + `origin-asn` (public domain,
    daily). `scripts/security-plan/update-ip-geo.sh` downloads them nightly into `IPGEO_DIR`
    (checksums and a size floor checked; nothing replaced on any failure, previous kept as `.prev`).
  - **Gateway** `services/ip-geo.ts` + `ip-geo.middleware.ts`:
    - Sorted ranges in typed arrays (about 35 MB), a lookup under a microsecond. Reloaded when the
      files change (checked every 10 min); a truncated or missing file keeps the previous tables.
    - It always sets `X-SBC-ASN` from its own lookup. nginx's copy of `X-CF-ASN` could be sent by
      any client: no Cloudflare transform rule sets it.
    - It fills `X-SBC-Geo` only when Cloudflare gave none or `XX` (marked `X-SBC-Geo-Source: ipdb`).
    - Off while `IPGEO_DIR` is unset or empty. `/health` shows `ipGeo`.
  - **Fraud engine:** the sign-up event carries the network (with the same consent gate as the
    other signals); a hosting/VPN network at sign-up adds `datacenter_network` (15, 7 days).
  - Check: `gateway-service/src/scripts/check-ip-geo.ts`.
- Not done: mobile-app install ID.
- Checks: `gateway-service/src/scripts/check-activity-signals.ts`,
  `user-service/src/scripts/check-activity-signals.ts`.

### Browser-only access: signed requests (Security plan Phase 9, part 1, 2026-11-21)

Design and outcomes: `docs/security-plan/phase9-browser-only.md`. **Log-only**: nothing is refused.
- **Web app** (`SBC-WEB-UI/src/utils/requestSigning.ts`):
  - At sign-in it makes an ECDSA P-256 key pair; the private key is non-extractable, in IndexedDB.
  - The public key is sent as `devicePublicKey` with `verify-otp`.
  - Each same-origin `/api` call is signed (`X-SBC-Signature`) in the device-signals `fetch` wrapper.
  - Signing has a 300 ms budget and never blocks a request.
- **user-service:**
  - `session_keys` maps the token's SHA-256 to its public key; rows expire with the token, and
    logout revokes.
  - `POST /users/me/session-key` binds a key once for tokens issued before this release (`late`).
  - Internal routes `GET /users/internal/session-keys/:tokenHash` and
    `POST /users/internal/browser-checks/batch` (counts into `browser_check_days`).
- **Gateway** `browser-checks.middleware.ts` (`BROWSER_CHECKS=off|log`, default off):
  - It checks after `next()`, so members see no delay.
  - Outcomes: valid / missing / stale / replay / bad_sig / no_key …, plus Origin,
    Sec-Fetch-Site and tool user-agents.
  - Counts are flushed every minute. Webhooks, SSO, partners and the support desk are exempt.
- Report: `user-service/dist/scripts/report-browser-checks.js --days 14`.
- Checks: `gateway-service/src/scripts/check-browser-checks.ts`,
  `user-service/src/scripts/check-session-keys.ts`, UI `requestSigning.test.ts`.
- **Part 2 (2026-11-22), still log-only:**
  - **Body check:** the signed body hash is compared with the bytes received (`body`: match /
    mismatch / unsigned / too_large / unknown). `watchBody` hashes the stream as the proxy reads
    it: it attaches to the first `data` consumer, never buffers.
  - **Automation feed:** members seen with a bad signature, replay, changed body or tool
    user-agent go to risk-service as `automation_seen` every minute (gateway `RISK_SERVICE_URL`),
    giving the live rule `automation` (20 points, 7 days).
  - Check: `gateway-service/src/scripts/check-browser-body.ts` (real HTTP through
    express-http-proxy, both modes).
- **Part 3 (2026-11-22): anti-robot check, ALTCHA instead of Turnstile** (no keyed services).
  - **Gateway** `robot-check.middleware.ts` (`ROBOT_CHECK=off|log|enforce` + `ALTCHA_HMAC_KEY`):
    - `GET /api/altcha/challenge` hands out signed proof-of-work challenges (204 while off).
    - The answer (`X-SBC-Altcha`) is checked on sign-in, sign-up, password reset, contact and
      payout changes, authenticator setup, withdrawal initiate, desk login and the public
      support form: one HMAC, used once.
    - `log` counts into user-service `robot_check_days` (report:
      `dist/scripts/report-robot-checks.js`); `enforce` answers 403 `ROBOT_CHECK_FAILED`.
      **Run it in `log`**: Phase 9 stays log-only (decided 2026-11-22). Exception (2026-11-23):
      `ROBOT_CHECK_ENFORCE=login,signup` refuses those two actions under `log`, since sign-up no
      longer sends a code (see "Email verified after payment").
    - A member's forged or replayed answer feeds `automation_seen` (`robot`).
  - **Apps:** the web app (`utils/robotCheck.ts`) and the desk (`auth/robotCheck.ts`) solve one
    answer while the page opens (about 1.4 s on a very slow phone) and send it. Turnstile is
    gone from support-service, both frontends and the desk CSP.
  - Check: `gateway-service/src/scripts/check-robot-check.ts`.

### Daily activity board (Security plan Phase 11, 2026-11-21)

Admin « Activité » (`/`, the admin now opens on it; the old overview is
`/dashboard`, « Vue d’ensemble ») and the support desk home panel show the same
figures per country, for today / 7 / 30 days, web or app: members connected,
sign-ups started / completed / failed (with the reason) / in progress,
activations, unfinished payments. Each admin number opens the list behind it.
- **Sign-up attempts** (user-service `signup_attempts`, TTL 180 days,
  `services/signup-attempts.service.ts`): every `POST /users/register` is one
  attempt with one outcome, written after the answer (1 s buffer). Country =
  declared (form) else Cloudflare's else `XX`; source from `X-SBC-Client` (the web
  app sends `app` when installed on the home screen). Email/phone stored masked
  only. Reasons (`SIGNUP_REASONS`, groups as payments): already used, sponsor code,
  invalid phone/email/form → member; `server_error` → SBC code. `verify-otp`
  completes it (and counts wrong codes). After 24 h a never-verified attempt is
  closed from notification-service's delivery records (`POST
  /notifications/internal/otp-delivery`, never the code): no channel sent the code
  → `code_not_received` (provider), else `wrong_code` / `never_verified`. A late
  verification still turns it completed. So started = completed + failed + in
  progress, per day and country.
- **Rollup** (`jobs/activity-rollup.job.ts` → `activity_days`, one doc per Douala
  day × country; `ACTIVITY_ROLLUP_DISABLED=true` stops it): every minute today's
  sign-ups + connected; every 5 min activations (first CLASSIQUE/CIBLE
  subscription, by its `_id` time) and unfinished payments (payment-service `GET
  /api/internal/activity/payments`, failure groups + waiting + never sent);
  00:15 Douala yesterday in full. The dashboards only read `activity_days`
  (`GET /users/admin/activity`, gateway module `dashboard`; support reads
  `/users/internal/activity/board`), cached 30 s.
- **Connected members** come from the Phase 1 signals, so they stay at 0 until
  that collection is switched on (policy 2026-12). Live: Redis HyperLogLog fed by
  the activity ingest (`activity-hll.service.ts`, needs `REDIS_URL`; without it,
  or with empty keys, the exact count is used). Exact: from `user_geo_days`, each
  member once, in the country of most of their requests that day, so country rows
  add up to the total.
- **Support:** permission `activity.read` (every role but verifier); an agent's
  `countries` (Administration → Agents → « Pays suivis ») limits the panel.
- Not done: session replay link on attempts (field `replayUrl`, the replay branch
  is not merged), anti-robot reason (sign-ups refused by the robot check in enforce mode never reach user-service; `robot_check_days` has them), payments
  split web/app (no signal on payment requests).
- Checks: `user-service/src/scripts/check-activity-dashboard.ts` (local Mongo +
  Redis), support `src/tests/activity.test.ts`.

### Second ledger: Blnk (Security plan Phase 2, 2026-11-21)

Design, inventory and rollout: `docs/security-plan/phase2-ledger.md`. Blnk runs on the
**secondary server** (`ubuntu@169.58.159.177`, `/opt/blnk-preprod`, PostgreSQL 19 there),
behind nginx `preprod-blnk.sniperbusinesscenter.com`, which only lets in the main server's IP
(`blnk.` is kept for prod). The ledger is created once under a claim in `blnk_state`.
Preprod worker: pm2 `blnk-sync-preprod`.
- Blnk 0.15.9 (`ghcr.io/blnkfinance/blnk`), local stack `infra/blnk/docker-compose.local.yml`
  on 127.0.0.1:5101. **`"server": {"secure": true}` is required**, or Blnk ignores the key.
- user-service: `services/blnk/` (client, sync), models `blnk_balances`, `blnk_syncs`,
  `blnk_state`; worker `workers/blnk-sync.worker.ts` (own pm2 process); internal
  `GET /users/internal/:id/ledger-check?currency=` (A, B, C). The walletmovements journal is
  B and the source posted to Blnk (`mv:<reference>:<direction>`, replay-proof).
- payment-service `assertLedgerAgrees` inside `assertWithdrawalsNotLocked`:
  `LEDGER_TRIPLE_CHECK=off|log|enforce` (default off).
- Checks: `user-service/src/scripts/check-blnk-ledger.ts` (needs local Blnk),
  `payment-service/src/scripts/check-ledger-triple-check.ts`.

### Dormant accounts (Security plan Phase 7, part 1, 2026-11-21)

Design, limits, deploy: `docs/security-plan/phase7-dormant-accounts.md`. Admin « Comptes dormants »
(`/comptes-dormants`, module finance).
- **Nightly pass:** user-service `services/dormancy.service.ts` + `jobs/dormancy.job.ts` (03:45 Douala; at start if
  the snapshot is missing; `DORMANCY_JOB_DISABLED=true` stops it).
  - **Who gets a status:** every account holding at least `DORMANCY_MIN_XAF` (500 F, all six balances converted;
    smaller ones count only in the member total, `belowMin` in the snapshot) gets `dormancy.status`
    (active < 90 j, inactive, dormant ≥ 180, long_dormant ≥ 365; `DORMANCY_*_DAYS`) and `dormancy.heldXaf`
    (USD at `DORMANCY_XAF_PER_USD`, 660). The same pass sets the flags and writes one `dormancy_snapshots` doc.
    The page reads only snapshots for its numbers.
  - **Flags:** commissions without sign-in; authenticator; fraud (frozen or risk-service `require_code`/`hold`
    via `POST /api/risk/internal/members/flags`, needs `RISK_SERVICE_URL`).
- **Last sign of life:** `dormancy.lastSignInAt` is written on every member sign-in (`verify-otp` →
  `noteSignIn`). Before this release only the stored token's issue time (cleared by logout) and `ipLastUpdated`
  (set at sign-up, **never at member sign-in**) exist, so the figures are weak until 30 days of sign-ins.
- **Coming back:** `DORMANCY_REACTIVATION_HOLD=off|log|on`, default **log** (recorded in `dormancy_returns`,
  nothing held).
  - With `on`, the first sign-in of a dormant/long_dormant account sets `dormancy.holdUntil` (+72 h).
  - `withdrawalLockStatus` returns `dormant_reactivation`; it is kept apart from the timed lock, so a contact
    change can't shorten it.
  - A new country, new device or recent contact change opens a `dormant_reactivation` case.
  - A contact change during the hold opens one too.
- **Actions:** « Vérifié » (note); « Geler… » files a `dormant_review` case in support's « Fraude » queue (the
  admin never freezes). CSV export is built in the background into GridFS `dormancy_exports`, deleted after 24 h.
- **Réactivation campaign (part 2, 2026-11-23):** « Message de réactivation » on the same page: email + push to
  the filtered list, **once per member per 30 days** (`dormancy_contacts`, claimed by one conditional upsert, so
  the database refuses a second claim). Only the **approved** text is sent (super admin edits + approves;
  `{{nom}}` only, no link; the email adds one « Ouvrir SBC » button, the "never asks for codes" line and the
  unsubscribe link). Left out: deleted/blocked, frozen, fraud flag, contacted < 30 days, unreachable, came back.
  user-service `services/dormancy-campaign.service.ts` (outbox `dormancy_campaign_targets`, sender every minute)
  → notification-service `POST /notifications/internal/reactivation/send` (daytime only, relance's mail
  budget and daily total, never Cloudflare, suppression list incl. unsubscribes; push = announcements; one
  delivery per member per campaign). Sending needs finance write + the admin's code. **`REACTIVATION_SEND_MODE=live`
  is required to send to everyone; otherwise only `REACTIVATION_TEST_RECIPIENTS`** (preprod stays so: it holds
  real members' addresses). A return within 30 days is counted; the return hold still applies.
  Check: `src/scripts/check-dormancy-campaign.ts`; notification `src/tests/reactivation.test.ts`.
- **Not done:** the four other balances in Blnk; Rufus's approval of the réactivation wording.
- Checks: `user-service/src/scripts/check-dormancy.ts`, `check-dormancy-scale.ts`, admin `DormantAccountsPage.test.tsx`.

### Fraud engine: risk-service (Security plan Phase 4, part 1, 2026-11-21)

Design, look-back figures, deploy: `docs/security-plan/phase4-risk.md`. pm2 `risk-service` on 3013 and
`risk-preprod` on 6013 (databases `sbc_risk`, `sbc_risk_preprod`). Internal only: no gateway route.
- **Links:** phone numbers (payout, profile MoMo, paying number: one identifier whatever the role)
  and devices. Numbers compare on their last 9 digits. More than 50 accounts on one identifier = a
  hub, which links nothing. Stored as an HMAC (`RISK_HASH_KEY`, never rotate) plus a 3-digit tail.
- **Rules:**
  - shared payout number in a referral tree: 40;
  - self-referral in a linked group: 50;
  - multi-account: 20–40;
  - quick withdrawal: 10.
  - inactive recruits (2026-11-22): 25. A sponsor whose level-1 recruits were activated (first
    CLASSIQUE/CIBLE) and never signed in again after the day of activation: at least 5 such
    recruits, and at least 70 % of those activated 30 days ago or more. Only activations since
    2026-11-21 count, when member sign-ins started being recorded (`lastLoginAt`,
    `dormancy.lastSignInAt`), so it can fire from late December 2026 at the earliest. It files a
    `multi_account` case.
  - Score 40 = `require_code`, 70 = `hold`.
- **Look-back:** `dist/scripts/lookback.js` (dry run; `--apply`). It only reads the source
  databases. Its cases are sent to support with `alert: false` (new support intake option: filed
  without notifying anyone).
- **payment-service:** `RISK_MODE=off|silent|enforce` + `RISK_SERVICE_URL`. The engine is asked
  inside `assertWithdrawalsNotLocked`, so on every path that takes a member's money out.
  - **silent:** 100 ms budget; logs, never refuses.
  - **enforce (decided 2026-11-22):** a member marked `hold` cannot take money out (member and
    admin paths alike, 403 with a support message). `require_code` passes, because the app code
    is already asked.
  - **No answer within `RISK_ENFORCE_TIMEOUT_MS` (1500):** refused (503), never paid blind,
    unless `RISK_FAIL_OPEN=true`.
  - **Each refusal** files a critical `abnormal_behavior` case (`risk:withdrawal_held:<user>:<day>`)
    in support's Fraude queue.
  - **Release:** support « Risque » → « Libérer le compte » (`risk.decide` + reauth, a second
    finance manager approves, approval type `risk_release`). risk-service records it in
    `riskreleases`; the member is allowed while the score stays ≤ the score at release. A new
    reason above it holds them again. Ending a release keeps the record (`endedAt`). The other
    answer is the freeze.
  - **Prod impact (look-back dry run on prod data, 2026-11-22):** 439 members would be held,
    244 `require_code`. risk-service is not on prod yet; review those holds before enforcing there.
- Checks: `risk-service/src/scripts/check-risk.ts`, `payment-service/src/scripts/check-risk-silent.ts`
  (silent + enforce), support `src/tests/risk-card.test.ts` (release).
- **Part 2 (2026-11-22): live events.** Still silent.
  - **Sources:**
    - user-service `utils/risk-event.ts` sends hints (signup, contact_change,
      authenticator_change, dormant_reactivated), fire-and-forget 1 s, to
      `POST /api/risk/internal/events`. It replaces Phase 8's `kyc-hint.ts`: risk-service queues
      the KYC check from those events. `RISK_EVENTS_DISABLED` (or `KYC_HINTS_DISABLED`) stops it.
    - payment-service sends `balance_mismatch` from the ledger triple check.
    - **Withdrawals and paid payments are read by risk-service from the payment database**
      (`PAYMENT_MONGODB_URI`, read-only watcher). They are never sent.
  - **Engine:** `riskevents` queue, one batch a second. The identifier index holds every number
    and device seen. A new link rescores the linked group with the look-back's own `analyse()`
    on that group's facts.
  - **Live rules** (points until expiry): contact change → withdrawal ≤ 72 h 30; new device +
    new country + new number the same day 40; hosting/VPN network 15; sign-up burst under one
    sponsor (sponsor 30, recruits 20); sign-up from a hosting/VPN network 15; dormant back 15; ledger mismatch 30; automation seen by
    the gateway (Phase 9) 20; 10 wrong passwords in an hour (Phase 1) 15.
    **Tor (2026-11-22):** `tor_network` 20 points, 7 days. Cloudflare marks Tor exit nodes with the
    country `T1`, which the gateway keeps.
    - **At sign-up:** the event carries `tor`, under the same consent gate as the network number.
    - **On a protected action** (the robot-check list: sign-in, withdrawal, payout or contact change,
      authenticator setup): the gateway's always-on `torSignal` adds a `tor` count to the per-minute
      `automation_seen` feed.
    - It is its own rule, not `automation`. Checks: risk `check-live.ts`, gateway
      `check-robot-check.ts`. Score = structural +
    live (`structuralScore`, `liveReasons`).
  - **Weekly rebuild:** Sunday 01:00 Douala.
  - **Support member card « Risque »:** `GET /desk/members/:id/risk` (`risk.read`), needs
    `RISK_SERVICE_URL` in support-service.
  - **Off** unless `USERS_MONGODB_URI` and `PAYMENT_MONGODB_URI` are set
    (`RISK_LIVE_DISABLED=true`).
  - Checks: `risk-service/src/scripts/check-live.ts`, `user-service/src/scripts/check-risk-events.ts`.

### KYC level 1 (Security plan Phase 8, part 1, 2026-11-21)

Design, points, measures, deploy: `docs/security-plan/phase8-kyc.md`.
- **kyc-worker** (`kyc-worker/`, Python FastAPI, Docker): runs on the **secondary server** behind nginx
  `preprod-kyc.sniperbusinesscenter.com` (main server IP only) on 127.0.0.1:5201. Every request is
  signed: `X-KYC-Timestamp` + `X-KYC-Signature` = HMAC-SHA256(`KYC_SHARED_SECRET`, `ts.body`), ±5 min.
  Level 1 is local computation (libphonenumber, a disposable-domain list, Gmail dots/+tag, a
  random-looking test) plus one DNS query per domain, cached in its SQLite. It stores no member data.
  Tests: `pytest` (CI job `test-kyc-worker`).
- **user-service** sends a `signup` / `contact_change` event (`utils/risk-event.ts`, Phase 4 part 2;
  was `kyc-hint.ts`) after `register` and in `alertContactChange`; risk-service queues the check
  (not for crypto). `KYC_HINTS_DISABLED=true` or `RISK_EVENTS_DISABLED=true` stops it.
- **Runs entirely on the secondary server since 2026-11-22** (Sterling). kyc-worker (`app/store.py`)
  holds the queue (fields deleted once checked, `secure_delete`) and the results (signals, reasons,
  score, band, HMACs only; 12 months) in its SQLite; **kyc-runner** (second container, `python -m
  app.runner`) checks one batch a second (`KYC_PER_SECOND`, 50), backfill 02:00–05:00 Douala only,
  and finds mailbox variants. Signed endpoints: `/v1/enqueue`, `/v1/needed`, `/v1/results`,
  `/v1/status` (and `/v1/level1`).
- **risk-service** `services/kyc.service.ts` is only a feeder: `kycqueue` is an outbox (no
  fields) forwarded every second with the members' fields read **read-only** from
  `USERS_MONGODB_URI`; the nightly sync (02:05 Douala) sends ids + fingerprints, then the fields
  of the members the secondary needs. The member view reads `/v1/results` (1.5 s); the old main
  `kycresults` is kept, no longer written, shown (`source: 'archive'`) only while the secondary
  has nothing. Off unless `KYC_WORKER_URL`, `KYC_SHARED_SECRET` (≥ 32 chars) and
  `USERS_MONGODB_URI` are set.
  - Routes: `POST /api/risk/internal/kyc/hint`, `GET /api/risk/internal/kyc/status`, and `kyc` in
    the member view.
- The score feeds no decision yet. Level 2 (SEON/Holehe) waits for a decision.
- **Level 3: ID document + selfie (2026-11-22, open source, not Smile ID).**
  - **Asked on:** a fraud-engine hold, a lost authenticator phone, or lost account details (also
    from a guest request). Not for large withdrawals.
  - **Who decides:** any support agent, in support « Identités » (`identity.review`).
  - **Where things live:** images only on the secondary server, encrypted with `KYC_L3_KEY`
    (never rotate). They are deleted 30 days after the decision; the decision is kept 12 months.
  - **Hints, never a verdict:** kyc-runner runs OpenCV YuNet + SFace (models in
    `/opt/kyc-<env>/models`): face match, blur/darkness, the same face or image on another account.
  - **What approving does:** it proves identity only. Release, authenticator reset and contact
    change keep their own approvals; the reset request cites the accepted check.
  - **support-service:** `KYC_WORKER_URL` + `KYC_SHARED_SECRET`.
  - **Member app (part 2):** `/aide/identite` and, without an account, `/signaler-un-probleme/identite/:id`.
    A withdrawal held by the fraud engine answers 403 `RISK_HOLD` (payment-service, member paths
    only), and the app offers the identity check from it.
  - Details: `docs/security-plan/phase8-kyc.md` « Level 3 ».
- Checks: `risk-service/src/scripts/check-kyc.ts` (fake secondary; `KYC_REAL_WORKER_URL` for a real one), kyc-worker `pytest`.

### Support integration (Security plan Phase 5, 2026-11-21)

Contract: `docs/support/CONTRACT.md` (« Phase 5 » in §3.1, routes in §2.1, permissions §4).
- **Country teams:** tickets and cases carry `country`; an agent's `countries` filters every
  list and 404s anything else. Backfill: `support-service/dist/scripts/backfill-country-teams.js`
  (dry run, `--apply`).
- **Conflict rule:** an agent linked to their own member account (`memberUserId`, Agents →
  « Compte membre lié ») can never act on it or its referral tree (user-service
  `/users/internal/support/related`, levels 1–3 up or down; fails closed).
- **super_manager:** max 2; approves alone with reauth + a 20-character reason; every other
  manager is alerted (desk, e-mail, ntfy). Rufus/Sterling name the 1–2 accounts.
- **Freeze** (`users.frozen`, user-service `/support/freeze`): withdrawals and transfers
  refused (`account_frozen` in the lock check, before the timed lock, so a later contact
  change cannot lift it; payment-service says « suspendus pendant une vérification »). The
  member is not told automatically.
- **Authenticator reset** and **MoMo change** by support: approvals executed by user-service
  (`/support/authenticator-reset`, `/support/momo-change`), same locks and alerts as the
  member's own flows.
- **Fraud queue** (« Finance → Fraude », `risk.read`): six fraud case types, worst first then
  amount; Phase 4's risk-service will open them (`country`, `amount` accepted at intake).
- **Case outbox** (user-service and payment-service `support.service.client.ts`): a case
  refused on the network / 5xx / 429 is kept in `support_case_outbox` and resent every 30 s
  (1–30 min backoff) until support answers; delivered rows expire after 30 days.
- **Member card:** declared / usual / last country, frozen, balance A vs B (ledger); C waits
  for Phase 2. Linked accounts and the risk score: « Risque » panel (Phase 4 part 2, `risk.read`).
- Not done (need Phase 4 / 2): release of a held withdrawal, commission reversal approvals.
- Checks: `user-service/src/scripts/check-support-phase5.ts`, support `src/tests/phase5.test.ts`,
  support-frontend `MemberSecurityPanel.test.tsx`.

### Email verified after payment, not at sign-up (Sterling, 2026-11-23)
The code at sign-up lost people before they paid. `services/email-verification.service.ts`:
- **Sign-up:** a member sign-up gets its token at once (no code; `register` answers `token` +
  `user`, the controller's `startSession` binds the browser key and notes the sign-in, and
  `markSignupCompleted` fires at sign-up). An annonceur sign-up keeps the code (no pack to pay).
- **Sign-in while unpaid and unverified** (`codeFreeAccess`: never had a subscription, no XAF/USD/
  activation balance, role user, not annonceur): the password is enough (`login` answers a token,
  sign-in attempt outcome `signed_in`). Once paid or verified, every sign-in sends a code as before.
- **After payment:** `getUserProfile` adds `emailVerificationRequired` (paid, never verified, account
  created from `EMAIL_VERIFY_GATE_SINCE`, default 2026-11-23). The member app blocks on it.
  `POST /users/me/verify-email/request` (code with purpose `verifyEmail`, e-mail channel only, same
  per-account send limit), `…/confirm {code}`, `…/correct {email, password}` (only while unverified;
  domain, uniqueness and password checked; no withdrawal lock, it was never verified).
- **Not gated:** on prod 22,181 of the 63,610 active subscribers were unverified on 2026-11-23 (older
  sign-ups); their next e-mailed sign-in code verifies them, as before.
- Switch back: `SIGNUP_EMAIL_CODE=at_signup`. Check: `src/scripts/check-email-verify-after-payment.ts` (23).
- Gateway: `ROBOT_CHECK_ENFORCE=login,signup` (sign-up no longer filters robots with a code).

### Member authenticator (Security plan Phase 3, Sterling 2026-11-20)

Rule: a member must set up an authenticator app (Google Authenticator,
Microsoft Authenticator, 2FAS) before withdrawing or changing where money goes;
its code replaces the e-mailed code for those actions.
- **user-service** `services/member-auth.service.ts`, collection `memberauths`
  (secret AES-256-GCM with `MEMBER_TOTP_ENC_KEY`, 32 bytes base64 in `.env`, one
  per environment, never rotate; without it every setup/check answers 503).
  Setup: `POST /users/me/authenticator/setup/request {password}` → code to the
  account's own e-mail/WhatsApp (purpose `setupAuthenticator`) → `setup/start
  {code}` → QR + secret → `setup/confirm {code}` → 10 backup codes shown once.
  `GET /users/me/authenticator` = status. No subscription needed to set it up.
- **Checks:** 6-digit app code, accepted once (`lastUsedStep`; a replay gets
  "Ce code a déjà servi", not counted as a failure); backup code once each
  (e-mail alert). 5 wrong codes in 24 h lock checks 15 min, then 1 h, then 24 h.
  `AuthenticatorRequiredError` → 403 `AUTHENTICATOR_REQUIRED` (the app opens setup).
- **payment-service** (`MEMBER_AUTHENTICATOR_REQUIRED`, default on;
  `false` = back to the e-mailed withdrawal code): MoMo and crypto initiate call
  `assertMemberAuthenticator` (fails closed); no withdrawal code is e-mailed
  (a random never-sent placeholder fills `verificationCode`); `verifyWithdrawal`
  checks the code through `POST /users/internal/:id/authenticator/verify` and
  refuses a transaction that is not the caller's. Admin approval and
  admin-initiated paths are unchanged. The old `/payments/crypto/payout` and
  `/payments/crypto-payment` (paid any address from the request, no code) now
  answer 410.
- **Lost phone:** support checks ID + selfie, then
  `scripts/reset-member-authenticator.ts <email|phone|id> --reason "<ticket>" --apply`:
  removes it, locks withdrawals 72 h (reason `authenticator_reset`), e-mails the member.
- **Part 2 (2026-11-22), for members who set up the app:**
  - **The app code is also required to:**
    - change the e-mail (`request-change-email {…, authCode}`);
    - change the phone (`request-change-phone {…, authCode}`);
    - reset the password (`reset-password {…, authCode}`).
  - A missing code answers 403 `AUTHENTICATOR_CODE_REQUIRED` and the app shows the field. The
    reset token survives it, and a resend for the same target needs none.
  - Members without the app are asked nothing new.
  - The plain profile save cannot change their phone: 409 `PHONE_CHANGE_NEEDS_CODE`. The web app
    then saves the rest and links to « Changer de numéro ».
  - The global error handler now passes `code` through.
- **Setup:**
  - **Rate limit:** 5 a minute per member (Redis, fails open).
  - **Lock after setup:** none. Decided 2026-11-22: the member uses the app fully at once.
    `AUTHENTICATOR_SETUP_LOCK_HOURS` stays 0. If ever set, it never shortens a longer lock.
  - **Risky setup** (`AUTHENTICATOR_SETUP_REVIEW=log`): seen from another country, a
    contact/payout change in the last 7 days, or flagged by the fraud engine. It notifies support
    (`abnormal_behavior` case, alerting) and records `memberauths.setupReview`. The member keeps
    using the app; support freezes or closes the case as fine. Decided 2026-11-22, no hold.
- **Adoption:** a daily snapshot (03:55 Douala, `authenticator_adoption_days`) of members above
  5,000 F who set it up. Admin `GET /users/admin/security/authenticator-adoption` (module
  dashboard).
- Check: `user-service/src/scripts/check-authenticator-part2.ts` (run with `REDIS_URL` for the
  rate limit).
- Admin withdrawals with the admin's own code + the risk decision: done 2026-11-22, see
  "Money actions need the admin's own code" under Admin sign-in.
- Checks: `user-service/src/scripts/check-member-authenticator.ts`,
  `payment-service/src/scripts/check-withdrawal-authenticator.ts`.

### Metrics and alerts: Prometheus + Grafana → ntfy (Security plan items 10–11, 2026-11-22)

Design, alert table, deploy: `docs/security-plan/metrics.md`.
- **Services:** `src/utils/metrics.ts` (identical in gateway, user, payment, risk, support; only
  the service name differs) times every request by its route pattern. It also gives `timeJob()`
  for scheduled jobs (label `task`, never `job`) and the Node process metrics.
  - `GET /metrics` needs `Authorization: Bearer <METRICS_TOKEN>`; without the variable it answers 404.
  - The gateway adds the main server's disk and memory (`utils/host-metrics.ts`); user-service adds
    MongoDB's cache and connections (`utils/mongo-metrics.ts`).
  - **A new scheduled job:** wrap it in `timeJob('<name>', fn)`.
  - **A new route:** nothing to do. Never put an id or an amount in a label.
- **Reaching the main server:** its nginx `infra/metrics/nginx-main-metrics.conf` listens on port
  9101 with a self-signed certificate that Prometheus pins. Only the secondary's IP is allowed,
  path `/<env>/<service>`. It does not go through Cloudflare.
- **Secondary, `/opt/metrics`:** `infra/metrics/docker-compose.yml`, Prometheus v3.16.0 (30 days)
  and Grafana 13.3.0, both on 127.0.0.1 only. Grafana is opened through an SSH tunnel to port 3300.
  - **Alerts:** Grafana sends them to ntfy (`NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` in
    `/opt/metrics/.env`).
  - **Rules and dashboard:** generated by `infra/metrics/make-grafana.py`.
- Check: `user-service/src/scripts/check-metrics.ts`.

### Backups and restore tests (Security plan Phase 0 item 4, 2026-11-22)

Design, schedule, prod install: `docs/security-plan/backups.md`. Scripts are in `scripts/backup`,
installed in `/opt/sbc-backup` on both servers, cron in `/etc/cron.d/sbc-backup`.
- **What is backed up:**
  - prod Mongo by the existing `/root/mongodb-backup.sh` (02:00);
  - preprod Mongo by `mongo-preprod-backup.sh` (02:40, R2 `preprod-mongodb-backups/`);
  - Blnk `blnk_preprod` on the secondary (`blnk-backup.sh`, 02:30). The main server pulls it
    (`blnk-pull.sh`, 03:30) through the `sbcbackup` forced command and copies it to R2
    `blnk-backups/`, so no R2 key ever goes to the secondary.
- **Restore tests:** every backup carries before/after counts.
  - `mongo-restore-test.sh` downloads from R2, restores into a throwaway mongod one database at a
    time, compares the counts, deletes everything.
  - `blnk-restore-test.sh` restores into a temporary database.
  - Both run weekly for preprod. Prod Mongo needs Sterling's OK: `install-mongo-hooks.sh`, then the
    commented cron line.
- **Status:** `/var/lib/sbc-backup/status.json` → gateway `utils/backup-metrics.ts` → Grafana rules
  (late, failed, restore failed, restore older than 35 days) → ntfy.
- **Not backed up:** KYC's SQLite, on purpose (level 3 images must go after 30 days).
- Tests: `scripts/backup/tests/test-mongo.sh`, `test-blnk.sh`, gateway `check-backup-metrics.ts`.

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

### Video uploads answer before they are compressed (2026-10-25)

`POST /api/settings/files/upload` used to re-encode a video (ffmpeg, 2 at a time,
shared with every diffuseur proof) **inside the request**. A 40–60 MB video took
about a minute plus queue time; past **100 s Cloudflare drops the connection**
(nginx logs 499) and the app shows "Le visuel n'a pas pu être envoyé". That was
~35% of all uploads every day in October. Videos are now stored as they arrived
under a `.mp4` name with `PENDING_CACHE_CONTROL` (60 s), the id is returned at
once, and the compressed copy replaces the object in place with the one-year
cache. The file proxy sends 60 s instead of a year while an object is pending,
so Cloudflare never pins the big version. Images are still compressed inline
(about 1 s). The bucket has versioning suspended, so an overwrite leaves nothing behind.
Measure upload health from nginx: `POST /api/settings/files/upload` 200 vs 499
per day. The route itself takes no login.

### File storage is Cloudflare R2 since 2026-11-02 (Google Cloud dropped)

The Google Cloud project `snipper-c0411` was suspended for unpaid billing on
2026-11-01 (shared billing account with another app), and every image, video and
status stopped loading. Everything moved to **Cloudflare R2**, in the Cloudflare
account that also holds the `sniperbuisnesscenter.com` zone (Georgesyvan12's;
R2 custom domains only work in the zone's own account). The Google sections above
are history: their egress lessons still apply, their bucket names do not.

| R2 bucket | Use | Served at |
|---|---|---|
| `sbc-media` | public files (was `sbc-file-storage`) | `https://media.sniperbuisnesscenter.com/<key>` (custom domain, Cloudflare-cached) |
| `sbc-status-private` | statuses, chat documents | presigned URLs only |
| `sbc-db-backups` | nightly mongodump (`mongodb-backups/`) | private |
| `sbc-media-preprod`, `sbc-status-private-preprod` | created, **unused**: preprod shares the prod buckets, as it shared the Google ones | `media-preprod.sniperbuisnesscenter.com` |

- **Code:** settings-service `services/r2.client.ts` (S3 client, `publicUrl`,
  `publicObjectKey`, `listAllObjects`) behind the unchanged `CloudStorageService`.
  Env in settings-service `.env`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `MEDIA_PUBLIC_BASE_URL`.
- **Old URLs still resolve:** `publicObjectKey` strips the old
  `storage.googleapis.com/sbc-file-storage/` prefix; private references keep the
  `gs://bucket/path` format on purpose (chat-service parses it), any bucket name.
  Presigned URLs keep the hour snap (signing date AND expiry), so they stay cacheable.
- **Stored URLs were rewritten** (prod 26,858 docs: users.avatar, products.images,
  settings files; preprod 18,002). Originals are in each DB's
  `media_url_rewrite_backup` collection. `users.incident_20261022_backup` was left
  untouched on purpose (evidence).
- **rclone 1.60 (Ubuntu's) + R2 needs `--s3-no-head`.** Otherwise every upload
  "fails" with 501 NotImplemented: the upload succeeds, then rclone re-reads it by
  versionId, which R2 does not implement.
- **Backups:** `/root/mongodb-backup.sh` (root cron, 02:00 server time) uploads to
  `sbc-db-backups` with rclone, reading the R2 key from settings-service `.env`,
  and keeps the last 3 dumps in `/var/backups/sbc-mongodb`. Old GCS version:
  `/root/mongodb-backup.sh.bak-gcs-20261102`.
- **Full copy of the old Google buckets** on the server: `/home/sterling/gcs-mirror/`
  (~95 GB, verified file-for-file 2026-11-01). `upload-r2.sh` there pushed it to R2.

### Ads Network: replacing a live campaign's creative goes through review

A live (active/paused) campaign's `mediaFileId` cannot be edited directly.
The annonceur posts `POST /api/advertising/campaigns/:id/media-change`; the new
file waits in `pendingMedia` while the old creative keeps running, and an admin
approves or refuses it ("Nouveaux visuels à valider" on the admin's Ads review
page). On approval the old perceptual hash moves to
`previousMediaPerceptualHashes`, and verification compares a posted status
against every one of them, so a diffuseur who already posted the old creative is
not refused for it. Diffuseurs in progress are emailed + pushed about the new
creative. `src/scripts/check-creative-replacement.ts` asserts it.

### Pack Winner, PRO, MISE_EN_AVANT, extra numbers, Contacts webhook (2026-11-07)

Sold beside CLASSIQUE/CIBLE; prices and commissions live in one file,
`user-service/src/config/subscription-products.ts`, and the logic is in
`services/products.service.ts`. Assertions: `src/scripts/check-products.ts`.
- **Pack Winner** (`WINNER`, lifetime marker):
  - Price: 15,900 F (15,000 + fees) or $37.1. From Ciblé 10,600 F, from
    Classique 13,650 F (Rufus quoted 10,000 / 12,850 + fees).
  - Grants CIBLE, 12 months of PRO, 1 month of MISE_EN_AVANT, 3 extra-number slots and 1,000 relance
    credits (notification-service `BUNDLED_PACKS`, never sold alone,
    `findSellablePack`).
  - Commissions: 5,000/2,500/1,250; from Ciblé 2,500/1,250/625; from Classique
    4,000/2,000/1,000 (USD at 500 F/$).
  - The VIP group link is set by the admin in Settings → General
    (`settings.winnerVipGroupUrl`, WhatsApp links only, read by user-service via
    `GET /settings/internal/winner-vip-link`, cached 1 min).
    `WINNER_VIP_GROUP_LINK` (user-service `.env`) is only the fallback. The
    button is hidden while both are empty. The public `GET /settings` leaves the
    link out (admins only), and `PUT /settings` is admin-only since 2026-11-15:
    before that, any signed-in member could rewrite the community group links.
- **PRO and MISE_EN_AVANT** are for members only (an active CLASSIQUE/CIBLE),
  so the "any active subscription" gates can't be opened by an add-on alone.
  - Prices: PRO 2,000/month or 12,000/year; MISE_EN_AVANT 3,000/month.
  - Commission: 20% to the direct parrain only.
  - Renewal is manual and extends from the current end date.
  - `contacts-webhook.job` marks ended periods `expired`; nothing else ever
    sets EXPIRED.
- **Each product payment is applied once:** `productpayments` holds a unique
  `sessionId`, claimed first and released if applying fails. Monthly products
  extend from the end date, so a replayed callback would otherwise give a free
  month.
- **Sales page** (`GET /api/users/sales-page/:referralCode`, public; web `/p/<code>`):
  Winner members only, 404 for anyone else. It sends prospects to
  `/signup?affiliationCode=` and to the member's WhatsApp.
- **Featured number** (`featuredWhatsappNumber`, `PUT /me/extra-numbers/featured`):
  - It is the number shown on SBC Network (SSO `whatsappNumber`) and on the
    sales page, and comes first on the contact card.
  - It exists for members whose main number is banned on WhatsApp (Rufus).
  - It never changes the login number.
- **Extra WhatsApp numbers:**
  - Stored in `users.extraWhatsappNumbers`; slots in `extraNumberSlots`
    (500 F each).
  - Added as more `TEL` lines on the member's card in both contact exports.
  - Routes: `/api/users/me/extra-numbers`.
- **SBC Network app:**
  - SSO `userinfo` and `token` carry `subscriptions: [{type, status,
    startedAt, expiresAt}]` (CLASSIQUE, CIBLE, PRO, MISE_EN_AVANT; lifetime has
    `expiresAt: null`).
  - `isActivated` now means a paid pack, not any subscription.
  - Every change is POSTed to `CONTACTS_WEBHOOK_URL` and signed with
    `SBC_WEBHOOK_SECRET` (HMAC-SHA256 hex of the raw body, header
    `X-SBC-Signature`).
  - Delivery goes through an outbox (`contactswebhookevents`): retried after
    1/5/30/120 min until a 202, with the same event id and body.
  - Off unless both env vars are set: set them on **prod only**, since preprod
    would send test events to the real app.
- **Crypto:** user-service puts the USD price in `metadata.cryptoUsdAmount`,
  and payment-service uses it instead of guessing from the XAF amount.
- **Activation balance (2026-11-12):** a sponsor can activate Winner for a
  filleul (`POST /activation-balance/sponsor {subscriptionType:'WINNER'}`) at
  the Mobile Money price for the filleul's current pack (`ACTIVATION_PRICES.WINNER*`).
  It runs the same `handleProductPayment` as a paid Winner under a
  `sponsored_winner_<id>` reference, so grants and commissions are identical and
  applied once; the balance is given back if it fails. The referral list carries
  `canUpgradeToWinner`, and "À upgrader" includes Ciblé filleuls without Winner.
  `src/scripts/check-activation-winner.ts`.

### Advertisers need no SBC pack (2026-11-13, Rufus)

Rufus: requiring the SBC pack to run an Ads Network campaign meant fewer
campaigns. An account opened with `signupIntent: 'annonceur'` (register body;
any other value is ignored) may have no parrain (a member's code is still used
when given, and a wrong code is still refused) and runs campaigns without a
pack: the Ads backend only ever checked the login, the paywall was the web
app's `RequireSubscription`. Advertisers are left out of both relance
endpoints (`unpaid-referrals`, `referrals-for-campaign`, via the sparse
`signupIntent` index). Sign-up still accepts personal email domains only
(`isValidEmailDomain`), so a company address is refused.
`src/scripts/check-annonceur-signup.ts`.

### Data protection: APDP Benin authorisation (deliberation 2026-523, 27 Aug 2026)

APDP authorised SBC's processing under the Code du numérique, **on condition**
that within 2 months of notification (received ~2026-11-08) the site:
- asks for consent;
- updates its legal notices and privacy policy (rights, the authorisation
  reference, consent to the transfer of data);
- informs users about cookies, which may last 60 days at most;
- lets members exercise access, portability, objection, rectification and
  erasure.

Otherwise the authorisation is void. The data controller is Mme Adèle
AGONGNON, Directrice of ETS SNIPER BUSINESS CENTER (Bénin, RCCM
RB/PNO/25/A/113290). Servers (app, DBs, mail) are at Contabo, Germany, so the
data leaves Benin and that transfer needs consent.

- **Consents:** `users.consents.{privacy,dataTransfer}` hold `{acceptedAt,
  version, ip}`.
  - Recorded at sign-up (`consents` in the register body) or through
    `POST /api/users/me/consents`.
  - `config/privacy.ts` `PRIVACY_POLICY_VERSION` must match the web app's: a
    member whose version differs is asked again.
- **Member rights:**
  - Download: `GET /api/users/me/data-export`, JSON with no password, OTP or
    token.
  - Erasure: `POST /api/users/me/delete-account {password}`, the same soft
    delete as the admin one, plus `shareContactInfo:false`.
  - Objection: `shareContactInfo` (`PUT /me`). The cached contacts file
    (vcf-cache) now honours it too.
- **Cookies:** the web app sets none and has no analytics; it uses
  localStorage only. The cookie banner says so and is shown again after 60
  days.
- Assertions: `src/scripts/check-privacy.ts`.

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

### Forensics traps (learned in the 2026-10-22 incident)

- **`referrals.referredUserName/Email/Phone` is NOT a sign-up snapshot.** A
  member's own profile save re-syncs it ("Synced denormalized fields on N
  referrals"); an admin edit does not. The 10-22 attacker's referral record
  showed the payout number because he set it on his profile mid-attack. For
  pre-incident values use the daily dump (02:00 server time; R2
  `sbc-db-backups/mongodb-backups/` since 2026-11-02, the last 3 also in
  `/var/backups/sbc-mongodb`; older ones on `gs://db-backups-vps/`) restored
  into a scratch DB.
- **OTP codes are no longer logged** (since 2026-11-17): the log shows
  `fp=<10 hex>`, an HMAC of the lower-cased code keyed with `SERVICE_SECRET`
  (`otpFingerprint`, `user-service/src/utils/otp.utils.ts`; payment-service's
  withdrawal OTP uses the same formula). To prove who validated a code, compute
  the fingerprint of the code you have and search for it. Before that date the
  logs held every code in clear (`Generated OTP <code> …`), so anyone with log
  access could sign in as a member while a code was valid.
- **The admin panel has no direct-payout screen.** `POST /api/withdrawals/admin/direct`
  is API-only, so any direct payout was sent by a hand-made request (curl/Postman).
- Logs: `~/.pm2/logs`, ~3 days kept. Access-log lines (IP + user agent) are in
  the gateway/user/payment `-out` files. Times there are UTC; app lines are
  server time (UTC+2 in summer); MoneyFusion's dashboard is Cameroon time (UTC+1).

### Member debts (`users.debt`) come from the old system's March 2025 restore

`debt` is carried over from the old backend (`TambongStercy/sniper_backend`,
private). Every credit pays it off first, and the member app never shows it,
so an indebted member sees commissions arrive by email but a balance of 0.
Most of the debt total traces to one event:
- **10 Mar 2025:** deleted accounts were restored with balance = lifetime
  earnings (past withdrawals ignored).
- **11 Mar, 02:35–10:09 UTC:** that restore sat on the public
  `GET /api/user/test` and **added** the balance again each time it was opened.
- **"placed debt":** the excess was recorded as debt. That created 11 debts
  (1.2 M F); 10 were still open on 2026-11-05.

Cancelling a debt is Rufus's call; record it in `sbc_users.debt_adjustments`
(before/after, reason, who decided). First one: Mr DOPÉ, 531,691 F, 2026-11-06.

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

### Payment intents and payment callbacks are service-only (2026-10-22)

`POST /api/payments/intents` requires the service secret (`requireServiceCaller`
accepts `Authorization: Bearer <secret>` or `x-service-secret: <secret>`). The body's
`metadata.callbackPath`/`originatingService` decide where payment-service later
POSTs the result **with the service secret**, and receivers trust that metadata
(`planId`, `userId`). While it was public, anyone could set their own amount and
callback: pay 100 F for any subscription, or point the callback at their own server
to receive the secret. Five empty 100 F probes hit it on 2026-10-03. Members never
call it; each service creates intents for them. Every receiver of a callback
(user-service subscriptions, advertising, events, tombola, relance) must require
the service secret. The subscription webhook was the last one open until this date.

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

### Password reset finds the account by email OR phone, in any format (2026-11-05)

The forgot-password form takes "email ou numéro". The web app then sends that same
text as `email` to verify and reset. Until 2026-11-05 the request matched the
typed text exactly against `email`/`phoneNumber`, and verify/reset looked up by
email only. So ~70% of requests answered 404: `+226 70000001` against the stored
`22670000001`, emails typed with a capital letter. A member who did get a code by
phone was then always refused at verify. Request, resend, verify and reset now
all use `userRepository.findByIdentifier` (`phoneLookupCandidates` in
`utils/phone.utils.ts`). Several accounts matching a number typed without its
dialling code is treated as not found. Replaying the 1,366 identifiers refused
over 3 days found 571 accounts. `src/scripts/check-reset-lookup.ts`.

### Email / phone change codes are bound to the change (2026-11-14)

Until 2026-11-14 changing the email never sent a code to the new address: the
web page called `/users/request-email-change`, a route that does not exist
(the real one is `/users/request-change-email`), ignored the 404 and opened
the code screen anyway. Its "password check" was a full sign-in, which emailed
a sign-in code to the OLD address, and confirm accepted any live code on the
account, so the few changes that went through were confirmed with a sign-in
code. Now:
- `request-change-email` takes `{ newEmail, password }` and checks the
  password itself (strictLimiter). A resend with no password is allowed only
  while a code for that same address is live.
- Change codes carry `purpose` (`changeEmail`/`changePhone`) and `target` (the
  lowercased new email / normalized number). Confirm matches both; sign-in,
  password reset and the sign-in resend ignore tagged codes.
- Phone change still mails its code to the account email while WhatsApp OTP
  is off (proves control of the account, not of the new number).
`src/scripts/check-contact-change-otp.ts`.

### OTP delivery: what the codes look like, and what "sent" means

Investigated 2026-09-19 after Rufus reported "les mails OTP dérangent". Two
independent faults, neither visible from success logs.

**1. The compare was case-sensitive and the keyboard isn't.** `generateSecureOTP`
returns six mixed-case characters (`Fj9EYB`) and the verify screen is six
separate single-character `<input>`s, so a phone keyboard capitalises each box.
Classifying one day of refusals against the codes actually generated for those
same users:

| bucket | share |
|---|---|
| case-only mismatch | **20.8%** |
| exact code, refused (expired / already used) | 20.2% |
| digits only typed (user expected a numeric code) | 11.3% |
| one character off | 5.3% |
| no match at all | 41.7% |

Fixed by `otpMatches()` in `user-service/src/utils/otp.utils.ts` — **use it for
every OTP comparison**, there were six hand-rolled `otp.code === provided` sites.
The alphabet excludes `0` and `1`, so folding case removes the `l`/`I`, `o`/`O`
confusion rather than creating any, and `strictLimiter` bounds brute force.
`src/scripts/check-otp-matching.ts` asserts this with real refused pairs.

**2. `notificationService.sendOtp` returning `true` means QUEUED, not
delivered.** notification-service answers 200 as soon as the job is on the
queue; the actual send fails later, in the worker. Any fallback keyed on that
return value is dead code — the WhatsApp→email fallback in
`requestPasswordResetOtp` never once fired. That is how WhatsApp OTP stayed
100% broken since at least 12 September (`(#132001) Template name does not
exist in the translation`, for both `connexionfr`/fr and `connexion`/en_US)
while 822 people a day asked for a code over WhatsApp and got nothing.

`sendAccountAccessOtp` now mirrors any WhatsApp OTP to the user's email for
the four account-access paths (register, login, resend, password reset),
without depending on an outcome we can't observe. **The two proof-of-control
OTPs — new email, new phone — must never be mirrored**, or they stop proving
anything.

To check OTP health quickly, compare these two counts in user-service logs:
`OTP validation failed` vs `validated successfully`. A ~50/50 split is the
symptom that started this.

**3. Our own resend storm was choking the mail server (2026-09-26).** 62,165 OTP
emails in six days to 13,553 people; 56% sent while that person's previous code
was still valid; one address got 100 over three days. "Renvoyer" had no cooldown
and every limit was per IP, so late mail → more taps → more mail → later mail.
Sign-in codes now go through `issueAccountAccessOtp`: **per account, 1 send per
60s and 5 per rolling 20 min**, claimed atomically (`reserveOtpSend`), and a code
with ≥3 min left is resent rather than replaced. The window is 20 min, not an
hour, on purpose — the mail server is unstable and a genuine user may need
several tries (Sterling's call). Throttled resend/reset → 429 with
`retryAfterSeconds`; a throttled **login still succeeds** and lands on the code
screen, because they were sent a code moments ago. The app counts the wait down.
`src/scripts/check-otp-throttle.ts` asserts it — run it under **Node 20** (prod's
version): on Node 25 `jsonwebtoken`'s `buffer-equal-constant-time` crashes on
load because `SlowBuffer` was removed.

### Relance (notification-service): the two products and what broke

Two different things share the name. Keep them apart in code, UI and talk:
- **Relance des nouveaux** (targets with `campaignId: null`, "default"): a new
  filleul who registered and hasn't paid is enrolled ~15 min after signup and
  gets one message a day for 7 days, until they pay (exit `paid`) or day 7 ends.
  Enrollment only looks at referrals from the **last 2 hours** — by design, it
  is for newcomers.
- **Campagnes de relance** (`campaignId` set): the parrain picks filters and
  pushes his *older* filleuls through the same 7 days. Used 4 times ever (one
  user, March 2026) before the redesign.

Credits (`emailBalance`/`smsBalance` on RelanceConfig) are what relance runs on.
The retired monthly RELANCE subscription must not gate anything any more.

**What was broken until 2026-09-30** (fixed; tests in `src/tests/relance-*.test.ts`):
- **No pack was ever credited.** `creditPack` read `userId` from metadata that
  the purchase never set → 400 on every callback. 31 paid packs (29 customers +
  Rufus twice, ~93k FCFA, May → Sept) left everyone on 0 credits, so the sender
  skipped every parrain ("has no credits … skipping") and relance went silent
  from early May. It had delivered 738 messages in April–May.
- **`/api/relance/internal/credit-pack` was public and unauthenticated** — the
  gateway proxies `/api/relance/*` verbatim. Now service-secret only.
  `/internal/exit-user` takes the service secret or an admin login.
- **All 23 `/api/relance/admin/*` routes accepted any logged-in user** (all
  filleuls' contact details readable, email/SMS templates rewritable). Now
  `requireAdmin`. JWT roles are lowercase `'admin'` — a check against `'ADMIN'`
  refuses real admins.
- **Credits were written back from memory** (`config.save()`) and lost any
  purchase that landed mid-run; emails went out with 0 email credit if the
  parrain had SMS credit. Now `reserveRelanceCredit` takes one credit atomically
  before each send and `refundRelanceCredit` returns it on failure. Never add a
  `config.save()` back to the sender.
- The per-parrain daily email limit (`maxMessagesPerDay`) was **removed on
  2026-10-07** at Sterling's request, from the backend, the member app and the
  admin. The shared per-minute budget on the mail server (see "Email routing:
  the smart sender") paces relance now. `messagesSentToday` is still counted
  (UTC days) for the admin list, but it limits nothing.
- Paused campaigns kept sending; a J0 with no credit skipped the welcome email
  for good; a filleul who had paid via activation balance kept getting "pay
  now" emails (only SMS checked). All fixed.

**Packs can be paid with the SBC balance (2026-10-25, Rufus).** Full price only,
via `POST /relance/packs/purchase { packId, useBalance: true, requestId }`. It
uses the same payment-service calls as Ads campaigns (`/internal/balance-spend`
and `/balance-refund`, Bearer secret). The order is claim → debit → credit:
a `relancebalancepurchases` row is written first under a unique reference
`relance-pack:<userId>:<requestId>`, so a repeated tap is one purchase. That same
reference is the wallet line's `balanceSpendRef` and the `RelancePackCredit.sessionId`.
Anything not credited is refunded on the spot. A row still `pending` after 10 min
(restart, payment-service down) is settled by a 10-min cron: kept if the credit
row exists, otherwise refunded. Tests: `src/tests/relance-balance-purchase.test.ts`.

**Relance throughput is a shared daily total, not credits (2026-11-05).**
`RELANCE_DAILY_EMAIL_CAP` (notification-service `.env`, code default 2000) is
for the whole platform. It was hit every day from 10-13 while ~23,000 targets
were active (one email each per day), so journeys crawled: a parrain with 2,600
due targets got ~80 a day, and a campaign launched 10-30 had sent nothing a week
later. Raised to 6000 on 2026-11-05, when OTP/transactional mail was down to
3.5–7k a day (it was ~16k when the cap was set). Before raising it further,
compare user-service `OTP validation failed` vs `validated successfully`. Within a
parrain, journeys (relance des nouveaux and each campaign) now take turns, oldest
due first (`jobs/relance-journey-order.ts`); in database order the default
backlog used his whole share. `src/tests/relance-sender.test.ts` does not load
(pre-existing `reading 'prototype'` error), so its tests have not been running.

**A paid filleul leaves every journey at once (2026-11-17).** A new filleul can
sit in relance des nouveaux AND a running campaign of the same parrain (4,837
did on 2026-11-17). `exit-user` used to close one journey (`findOne`); the
other stayed open until the sender saw the payment days later and pushed
« X vient de payer » again, with no commission behind it (Le Futuriste: 57 such
late pushes in a week). `exitPaidReferral` (`services/relance-paid-exit.service.ts`)
closes active and paused journeys together and pushes once per parrain, never
to one already told. Both `exit-user` and the sender's paid check use it.
`src/tests/relance-paid-exit.test.ts`.

**Data facts that mislead:** `relancemessages` holds the admin's **7 day
templates**, not sent messages — sends live in `relancetargets.messagesDelivered`.
Relance pack payments are PaymentIntents whose `metadata.callbackPath` contains
`relance/internal/credit-pack`; their `userId` is a **string**, while
`sbc_users.users._id` is an ObjectId — wrap it in `ObjectId()` to join.
`RelancePackCredit` (unique `sessionId`) is the record that a payment was credited.

Scripts (dry run by default, `--apply` to act):
`close-relance-backlog.ts` (closes relance-des-nouveaux targets enrolled over
30 days ago with exitReason `expired`) and `credit-unpaid-relance-packs.ts`.
**Close the backlog before crediting**, or the first run after crediting sends
day 1 to everyone waiting, however old.

**Rules and mechanisms added 2026-10-01:**
- **SMS relance is for Cameroonian parrains only** (Rufus): the purchase is
  refused unless the buyer's `country` is CM, and crediting an SMS pack sets
  `smsEnabled`. Country comes from `POST /users/internal/relance-details`.
- **Campaign budget:** the preview returns `budget`. A month of relance des
  nouveaux (new filleuls in the last 30 days × 7) stays reserved, and
  `targetFilter.maxTargets` caps enrollment, newest first. Preview and
  enrollment share `matchCampaignReferrals`; never fork the filter code again.
- **One journey per filleul per campaign.** The "already enrolled?" check must
  match any status: an active/paused-only check re-enrolled finished filleuls
  at J1 every 15 min.
- **Campaign completion** (`checkAndCompleteCampaigns`) now runs on idle sender
  passes too. It used to run only when some unrelated target was due.
- **Commissions** are `deposit` transactions in `sbc_payment.transactions`, and the
  filleul is at **`paymentProvider.metadata.sourceUserId`** (a string), not
  top-level `metadata`. `POST /api/internal/user/:userId/commissions-from` sums
  them for `/api/relance/earnings`.
- **SMS is sent only to +237 numbers** (`isCmNumber`, every send path), so a
  non-CM parrain's SMS credit was unusable. 2026-10-05: the 5 non-CM parrains
  who had paid for `sms_250` (4000 FCFA) got it converted at paid value — 250
  SMS → 4800 email (1.2 email credits per FCFA, the `email_3k` rate), and
  `smsEnabled: false`. Each conversion is a row in
  `sbc_notifications.relancecreditadjustments` (`kind: 'sms_to_email'`, the
  pack `sessionIds`, country). Any future manual credit change goes there too.
- **Campaign suggestion:** `GET /api/relance/campaigns/suggestion` returns
  `{ period, from, to, count, affordable }` or `null`: unpaid filleuls not
  already in a journey, in the last 30 days, else the busiest calendar month of
  the past year. `null` when there is no email credit, a campaign is
  running/scheduled/paused, or nobody qualifies (Rufus: "don't do anything").
  Cached 10 min per parrain. The web app shows it as a card that opens the
  wizard with that period.

### Email routing: the smart sender (2026-10-07, SMART-SENDER-OVERFLOW-SPEC)

Our own mail server (iRedMail, 81.17.100.244) is primary for **all** email.
Cloudflare Email Sending is only the **OTP overflow**. Cloudflare refused to
raise its 1,000/day quota, so it can't carry relance.

- **Per-minute budget** (`send-budget.service`, collection `emailsendminutes`):
  at most `EMAIL_RATE_PER_MINUTE` (25) sends a minute on our server. Contabo
  throttles a server above ~25/min, and bursts are what made Gmail defer our IP.
  - **OTP** (Bull priority 1) and **other email** (priority 10) each take a send
    while any is left in the minute.
  - **Relance** only gets `rate − (busiest high-priority minute of the last 5) − 2`.
    It fills quiet minutes and stands aside at peak.
- **The queue worker** (`queue.service` → `processEmailNotification`) acts when
  the minute is full:
  - An **OTP** that would wait more than 30s goes to **Cloudflare**.
  - Otherwise the email is re-queued for the next minute (OTP first).
  - After 3 waits for an OTP, or 60 for other email, it is sent anyway: it
    queues on the mail server, so nothing is lost.
- **Relance sends in the daytime only, 07:00–19:00 Douala** (Sterling, 2026-10-07):
  never at night, and never in the 20:00–23:00 OTP peak. Change it with
  `RELANCE_SEND_FROM_HOUR` / `RELANCE_SEND_TO_HOUR` (`inRelanceSendingHours`).
  A night sign-up's first message waits for the morning.
- **Relance** (`email.relance.service`) gets `deferred` when there's no room:
  nothing is sent and nothing charged. The sender waits for room minute by
  minute, up to `RELANCE_SPARE_WAIT_MINUTES` (14, one cron cycle). The rest of
  that parrain's targets stay due, untouched, with no "failed" entry. Relance
  **never** goes to Cloudflare.
- **Cloudflare** (`cloudflare-email.service`):
  - **Account:** Georgesyvan12@gmail.com's, which also holds the zone.
  - **Sender:** OTP overflow goes out as `CLOUDFLARE_OTP_FROM`, by default
    `noreply@noreply.sniperbuisnesscenter.com`. That's the subdomain onboarded in
    Cloudflare for OTPs (2026-10-07). Its records are `cf-bounce.noreply` (MX +
    SPF), `cf-bounce._domainkey.noreply` (DKIM) and `_dmarc.noreply` (p=reject).
    The main domain is **not** onboarded, so Cloudflare refuses
    `@sniperbuisnesscenter.com` senders. Never send OTPs from the relance identity.
  - **Caps:** counted per day (`emailproviderusages`, `cloudflare:YYYY-MM-DD`,
    cap `CLOUDFLARE_EMAIL_DAILY_CAP`=900) and per month (to compare with the bill).
  - **Refusals:** a 401/403/429 pauses Cloudflare for an hour.
  - **Logo:** the inline `cid:sbc-logo` is stripped, because the REST API
    documents no inline content-id.
  - **On/off:** on whenever credentials are set; `CLOUDFLARE_OTP_OVERFLOW=false`
    turns it off.
  - **Pricing:** Workers Paid, $5/month for 3,000 emails, then $0.35 per 1,000.
- **IPv4 only:** the token is a custom token (Account → Email Sending → Edit),
  IP-locked to the server's IPv4 `207.180.242.122`. The server reaches
  api.cloudflare.com over **IPv6** by default, and Cloudflare refuses an
  IPv4-locked token from there ("Cannot use the access token from location
  2a02:…"). The client therefore forces IPv4 (`https.Agent({ family: 4 })`).
- **Probing the token:** `/user/tokens/verify` ignores the IP filter, so it
  passing proves nothing about sending. Probe with an empty POST to
  `…/email/sending/send` instead: 400 `invalid_request_schema` means the account
  ID and token are good. The token *ID* that verify returns is not the account ID.
- **The relance subdomain:** `relance.sniperbuisnesscenter.com` is also onboarded
  in Cloudflare (`cf-bounce.relance` SPF + DKIM, `_dmarc.relance` p=reject). It's
  unused since relance moved back to iRedMail; harmless.
- **Root DNS:** the root SPF (`ip4:81.17.100.244 include:sendgrid.net -all`) and
  root DMARC (`p=quarantine`) are iRedMail's. **Never add a second root SPF record,
  and never let Cloudflare replace the root DMARC.**
- **Unsubscribe:** every relance email's footer carries a signed link,
  `/api/relance/unsubscribe?e=&t=` (HMAC of the address with the service secret).
  A GET only shows a confirm button, because link scanners open every link. The
  button POSTs, which adds the address to the suppression list the sender already
  honours. Until this change the footer linked to `<frontend>/unsubscribe`, a page
  that never existed.
- **One suppression list, two scopes.** `relancebouncesuppressions` holds bounces,
  complaints *and* unsubscribes. The relance sender skips all of them. The
  `BounceHandlerService` blacklist gates **every** email, OTP codes included, so it
  loads everything **except `source: 'unsubscribe'`**. Someone who unsubscribes
  from relance must still get their login codes. A Cloudflare bounce uses `$set`,
  so it upgrades an earlier unsubscribe to a full block. An unsubscribe uses
  `$setOnInsert`, so it never downgrades a bounce.

### Hard bounces on our own mail server: the bounce-mailbox reader

iRedMail delivers asynchronously, so a dead address comes back as a bounce
report (DSN) in the `noreply@` mailbox, not as an SMTP error. The reader
(`bounce-mailbox.service`, every 15 min, 2,000 a pass) suppresses the hard ones
(`source: smtp_dsn`), which blocks every email to them. It marks every report
read and never deletes mail.

- **It was off on prod until 2026-10-07.** A read-only dry run that day found
  **29,946 unread bounce reports**. The latest 3,000 alone held **908 dead
  addresses**, none suppressed, that were still being sent OTP, Ads and relance
  emails.
- **IMAP host must be `mail.sbcprecom.com`.** The mail server's TLS certificate
  covers only that name (same IP as `mail.sniperbuisnesscenter.com`), and the
  default host fails certificate verification.
- **To enable:** in the notification-service `.env`, set
  `BOUNCE_MAILBOX_ENABLED=true` and `BOUNCE_IMAP_HOST=mail.sbcprecom.com`. User
  and password default to the sending account.
- **Cloudflare bounces are separate.** Immediate permanent bounces are suppressed
  in code. Later bounces only land on Cloudflare's own suppression list, which
  stops Cloudflare from resending to that address.
- **The queue worker checks first.** It runs `passesPreflight` (blacklist,
  address validity, spam check) before either server, so a known-dead address
  gets nothing and doesn't use up a send in the minute's budget.

### No `List-Unsubscribe` header on our emails: Gmail → Promotions (measured 2026-10-06)

Gmail files any mail carrying a `List-Unsubscribe` header under the
**Promotions** tab, and Promotions sends no phone notification. Relance exists
to be noticed, so that defeats it. Measured on two Gmail inboxes, one of which
had never opened anything from us:

| Email | Header | Tab |
|---|---|---|
| Full relance design (emojis, money claims, big button), Cloudflare | yes | Promotions |
| Same design, prod wording, Cloudflare | no | **Primary** |
| Full design, iRedMail | yes | Promotions |
| Full design, iRedMail, clean inbox | no | **Primary** |
| Plain personal note "Marie (SBC)", iRedMail, clean inbox | no | **Primary** |

So it's the header, not the provider and not the wording. Both send paths in
`email.service.ts` used to add `List-Unsubscribe: <mailto:…>` to **every** email,
OTP codes included. It's gone everywhere now; the footer link stays. That OTP
codes also went to Promotions because of it is a strong inference, not measured.
Gmail only *requires* one-click unsubscribe above 5,000 marketing emails a day to
Gmail. Relance is about 500–900 a day. Revisit if it nears that.

Also measured: **opening one email trains Gmail for that sender in that inbox**.
Later mail goes to Primary, but only for that person, so filleuls can't be relied on.

### Web push (VAPID)

`/api/notifications/push/{public-key,subscribe,unsubscribe}`. It is off until
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` are in notification-service `.env`. They
are set on preprod (generated on the server, 2026-10-01); prod needs its own pair:
`node -e "console.log(require('web-push').generateVAPIDKeys())"`. **Never
rotate them casually**: every existing subscription is tied to the public key.
Relance pushes credits low/out and a filleul paying (`relance-alerts.service`).

Push works directly in Android browsers. On iPhone it works only once SBC is
on the home screen (iOS 16.4+), and the app says so. `public/sw.js` must stay
registered: `cacheBuster` spares it on purpose, and unregistering it kills
every push subscription.

**Sending a push from a service:** `POST /api/notifications/push/internal/send`
with the service secret and `{ userId | userIds, category, title, body, url?,
tag?, icon?, renotify? }`. Every push has a **category** (`push-categories.ts`):
money, chat, filleuls, relance, events, tombola, ads, subscription, or
announcements.
- Each user can turn each category off (`/notifications` in the web app).
- **Only announcements wait for the morning** (`holdAtNight`). Sent between
  22:00 and 07:00 Douala time, they wait in `PendingPush` and go at 07:00,
  keeping only the latest per `tag`. The admin can override this with "send now".
  Every other kind goes out at once, at high urgency (Sterling, 2026-10-03).
  A personal push is about something that just happened, and some go stale
  if held: an event reminder for "dans moins d'une heure" is useless at 07:00.
  Don't bring back a night hold for personal kinds.
- `/internal/create` with `channel: 'push'` also delivers now. It takes its
  category and url from `data.relatedData.{pushCategory, url, pushTag}`.
- Before 2026-10-01 it marked the notification sent and delivered nothing.

**Who sends what:**
- event-service: tickets, cancellations, reminders, resales, disputes, refunds.
- tombola: winners.
- user-service: commissions (chained on the deposit), new filleul, Visibilité
  Max ending in 3 days (daily job).
- advertising-service: every email also pushes.
- chat-service: new messages with the sender's photo.
- relance alerts.
- payment-service: withdrawal results (PR #289).
- Admin announcements: `/push/admin/announce` with an optional `filter`
  (`countries`, `subscription`, `sex`). It is resolved through
  user-service `POST /users/internal/filter-for-announcement`, which skips
  deleted and blocked users. Only one announcement to EVERYONE per 24 h;
  targeted ones are unlimited. `/push/admin/audience` gives the live count.
  Each announcement has its own tag (`announcement-<id>`): a shared tag made the
  night queue keep only the last one.

Chat-service needs `NOTIFICATION_SERVICE_URL` in its env: the default is prod's port 3002.

**Two Cloudflare traps, both met while shipping this:**
- **`.js` files are cached for a month.** nginx sends `expires 1M` for every `.js`
  file, so Cloudflare served a weeks-old `/sw.js` without the push handler. The
  app now registers `/sw.js?v=<build>`, a new URL on every deploy (`cacheBuster.ts`).
- **Chrome's own notification-icon fetch failed through Cloudflare**, showing a
  grey "P" instead of our icon. So the SBC icon is inlined in `sw.js`, and a
  sender's photo is fetched by the service worker itself and inlined. Pass
  photos as same-origin `/api/settings/files/<id>?w=128` paths (`avatarIcon` in
  chat-service).

### Bounces from our own mail server

Since mail moved off SendGrid/SES, refusals arrive as bounce emails in
`noreply@`'s inbox. `bounce-mailbox.service` reads them over IMAP every 15 min
and suppresses only "the address is bad" statuses (5.1.x, 5.2.1, 5.4.4).
**5.7.x means they blocked US**: never suppress on it. The suppression list
also blocks OTP mail, so a false positive locks someone out.

It is off until `BOUNCE_MAILBOX_ENABLED=true` (IMAP creds default to `EMAIL_*`).
**Enable it on prod only.** Preprod sends from the same mailbox, so a preprod
reader would mark prod's bounces read and record them in the preprod DB.

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

### SBC Love on prod was outside the deploy (found 2026-11-15)

`sbclove-service` answered on prod (`/api/sbclove/*`) but was in neither
`ecosystem.config.js` nor `scripts/deploy-prod.sh`: it had been started by hand
and was never rebuilt. Reported symptoms: the admin was signed out as soon as
they opened SBC Love, and members saw « La session est fermée » on a Wednesday
at 18h. A sbclove-service whose `JWT_SECRET` differs from user-service's causes
both (every token gets a 401; the admin client logged out on any 401, and the
member page took a failed status for "closed"), and reproduced them locally.
Now: sbclove is in both deploy files (port 3009, health `/api/health`), boots
only with a `JWT_SECRET` (no default), the admin logs out only when
user-service also refuses the token, and the member page says it cannot check
the session instead of "fermé". **First deploy:** check `pm2 ls` for the
hand-started process (it holds port 3009) and stop it, make sure
`sbclove-service/.env` has the same `JWT_SECRET` as `user-service/.env`, and run
`npm install` there if `node_modules` is missing (see the section above).

### SBC Support (support-service, 2026-11-17)

Agent desk + member « Aide » + internal case/view-task intake. Contract:
`docs/support/CONTRACT.md` (routes, roles, settings, env).
- **Ports / PM2:** 3012 `support-service` (prod, DB `sbc_support`), 6012
  `support-preprod` (DB `sbc_support_preprod`). Health `/health` (200 only when
  Mongo and Redis answer; dependencies listed, never fatal).
- **Gateway:** `/api/support/*` → `SUPPORT_SERVICE_URL` (path kept). It is marked
  `public` in `admin-routes.ts`: the desk has its own agents, TOTP, cookies and
  CSRF, and must never go through `ADMIN_ALLOWLIST`.
- **Front:** `support-frontend/dist` on `support.` / `preprod-support.`
  (`nginx/support-sniper`, `nginx/preprod-support-sniper`); `REBUILD_SUPPORT`
  in the deploy scripts.
- **Env (support-service/.env, see `.env.example`):** required
  `SUPPORT_JWT_SECRET` (≠ `JWT_SECRET`), `TOTP_ENC_KEY` (`openssl rand -base64 32`;
  never rotate without re-enrolling every agent), `SERVICE_SECRET`, `JWT_SECRET`
  (same as user-service), `MONGODB_URI`, `SUPPORT_PUBLIC_URL`; then the four
  service URLs, `DEEPSEEK_API_KEY`, `R2_*` +
  `R2_PRIVATE_BUCKET` (default `sbc-support-private`). It refuses to start
  without the required ones. Without the R2 keys (or with the bucket missing) every
  attachment upload answers 503; locally, `R2_ENDPOINT` points at a MinIO instead.
- **First deploy:** the usual new-service traps apply (section above): the
  deploy script picks the service up only on the 2nd run, run `npm install` in
  `support-service/` by hand, set `SUPPORT_SERVICE_URL` in `gateway-service/.env`
  and `pm2 reload gateway-service --update-env`. Then DNS (Cloudflare, proxied)
  for `support` / `preprod-support`, the vhosts + certificate, a Cloudflare rate
  rule on `/api/support/desk/auth/*`, the R2
  bucket. Check `curl localhost:3012/health` and `https://support.…/api/support/health`.
- **First admin:** `cd support-service && node dist/scripts/create-support-admin.js
  --email <email> --name "<name>"` prints a one-time activation link (48 h) to
  stdout only: hand it over directly, never paste it in a chat log. The agent
  sets a password (≥ 12 chars, not a common one) and enrols TOTP at first sign-in.
  Lost phone: Administration → Agents → new activation link (wipes password,
  TOTP and backup codes).
- **Help articles (assistant):** the assistant answers only from published
  articles. `node dist/scripts/seed-kb.js` lists the 19 starter articles
  (`src/data/kb-starter.ts`), `--apply` adds the missing ones as drafts,
  `--publish` publishes the seeded drafts nobody has edited. It never
  overwrites an existing slug. Have SBC review them in Contenus first. Article
  text must hold no price, fee or money deadline (the AI's safety check drops
  such answers), and members' own words go in the tags: search ranks an article
  by how many of the question's topic words it covers.
  - How-to questions about money or the account ("comment faire un retrait",
    "j'ai oublié mon mot de passe") get the article word for word, never the AI.
  - Personal problems ("pas arrivé", "bloqué", an amount) keep the secure route.
  - DeepSeek (`DEEPSEEK_API_KEY`) is called only when the member asks again and an
    article covers the question.
- **Live updates (LiveKit):** new messages/status changes reach the agent app and the
  member « Aide » without a refresh. The service sends a data message (ticket id + kind,
  never text) to `support-desk` and `support-member-<userId>`; the apps reload through
  the API. Listen-only tokens from `GET /desk/realtime/token` and `/me/realtime/token`.
  Needs a LiveKit server + `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`; the
  host must also be in the `connect-src` of `nginx/support-sniper` (and preprod) — the
  vhosts list `livekit.sniperbuisnesscenter.com`, change it if LiveKit lives elsewhere.
  Without it both apps poll (5 s ticket, 15 s lists). Local: a `livekit/livekit-server`
  container (`--dev`-style key) on `ws://localhost:7890`.
- **Session replay (OpenReplay, self-hosted):** the member app records every session
  (names, emails, phones visible; passwords and codes never recorded) and sends the session id + link when the member opens a
  ticket. The desk shows « Revoir la session » only for tickets that have one; the link
  comes from `POST /desk/tickets/:id/replay`, audited (`ticket.replay.opened`). Links
  not on `OPENREPLAY_DASHBOARD_URL` are dropped. Needs its own server (not the prod box):
  see `docs/support/OPENREPLAY.md`.
- **Requests without an account:** `POST /api/support/public/tickets` (member app
  `/signaler-un-probleme`, linked from the sign-in page) for people who cannot sign in.
  The gateway's anti-robot check (ALTCHA, see Phase 9 part 3) + hidden field + 3/h and 10/day per IP. The person then chats like a member
  (same WhatsApp-style page) with the request's key (`x-support-guest-key`, kept on the
  device; reply emails carry the link `…/signaler-un-probleme/suivi/<id>#k=<key>`). The
  contact details are unverified: agents must not disclose account details on such a ticket.
  Emails with no member (agents, public requests) carry `userId` `000000000000000000000000`:
  notification-service refuses an email without a userId, which silently dropped every
  agent email (activation, lockout, alerts) until 2026-11-18.
- **Analytique (desk, support administrator):** `GET /desk/analytics` computes the KPIs
  (requests in/handled, median and p90 first response and resolution, SLA breaches, backlog
  and its oldest, reopened, recurring categories, assistant settled without an agent, cases,
  approvals, agent load) against the previous period, daily series, and plain-sentence
  insights. Technical errors come from the member app (`POST /me/client-errors`,
  `clienterror*` collections), each type open / handling / resolved (`errors.manage`); a
  resolved type that recurs is a regression.
- **Phone alerts (ntfy):** every new request (member, assistant, public form) is pushed to
  `NTFY_URL`/`NTFY_TOPIC` (`services/ntfy.service.ts`, JSON publish, `NTFY_TOKEN` for a
  protected topic): number, category, priority (urgent→5 … low→2), name, title, start of
  the message, click → the desk ticket. No phone or email in it. Off without the two vars.
- **Audit:** `auditlogs` is append-only and hash-chained;
  `node dist/scripts/verify-audit-chain.js` exits 1 on any altered or missing
  row. Give the service's Mongo user no update/remove right on it when users
  are introduced.
- **Money:** support never moves money. Activation, regularisation and
  re-checks are calls to payment-service (§2.2) after an approval by a
  different agent; kill switches live in the support `settings` collection.
- **Tests:** `npm test` (Jest + supertest) uses `sbc_support_test` and Redis
  DB 15 only, mocks every outbound call.

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

### MoneyFusion payins are sent in francs, for every country (2026-11-19)

MoneyFusion's payin `totalPrice` is always in **XOF francs** (XAF 1:1). Its
hosted checkout converts it for the payer's country with its own rate
(`GET https://pay.moneyfusion.net/api/v2/payment-methods` → `currency`,
`exchangeRateFromXOF`; on 2026-11-19 RDC 500 F/USD (it divides), Guinée 21 GNF
per F, Ghana 0.03 GHS per F, Cameroun 1.08). Read from their checkout bundle
(`convertCurrency`). We used to convert to the local currency first
(`MF_PAYIN_CURRENCY`), so MoneyFusion converted twice:
- **RDC:** ~$3.84 sent, refused with "Montant doit etre supérieur a 200 F":
  ~5,900 failures June → November, **no RDC MoneyFusion payin ever succeeded**.
- **Guinée:** ~32,000 (meant as GNF) sent, read as francs: payers were asked
  ~700,000 GNF for a 2,150 F pack. Only 3 ever paid (28 Aug, 13–14 Oct;
  sessions ZTNUr6xkT3Cv, FqtodPFJcDf5, Kbw-mjUby3KZ), each ~31,000 F instead
  of 2,150: refund is Rufus's call.
- **Ghana / Centrafrique:** routed to MoneyFusion but refused by
  `validatePaymentDetails` (GHS, GH, CF missing) before reaching it.
Now `submitPaymentDetails` sends the intent's XAF amount to MoneyFusion with no
rate lookup, `initiateMoneyFusionPayment` refuses anything not XAF/XOF, and the
webhook books `paidAmount` (MoneyFusion's `Montant`, net of its fee) in XAF.
`MF_PAYIN_CURRENCY` is informational only. **Payouts are a separate question**:
branch `fix/non-cfa-payout-conversion` is still on hold.
`src/scripts/check-moneyfusion-payin-amount.ts`.

### MoneyFusion IP allow-list (since their 2026-11-03/04 update)

From 2026-11-04 04:42 to 2026-11-05 ~12:00, MF refused every payout with
`Adresse IP server non autorisée (<ip>)`; MF fixed it on their side and payouts
were accepted again from 13:57. If it comes back: The IP it
prints is **not ours**: it is a different Cloudflare address on every call
(172.69/70/71.x, 162.158.x, 104.23.x). Our server reaches `pay.moneyfusion.net`
(135.181.19.210, Hetzner) directly, no proxy, and leaves from **207.180.242.122**
(checked with `curl -4 api.ipify.org`). So MF's API reads its own Cloudflare hop
instead of the caller's IP; whitelisting can only be fixed on their side. A
refused payout fails at initiation (status `failed`, wallet untouched).
MF validates key, then fields (amount 0 counts as missing), then `withdraw_mode`,
and only then the IP, so a probe needs a real operator slug to reach the check.

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

### Burkina Faso goes to CinetPay only when its account is configured (2026-10-26)

Rufus asked to move BF payins and payouts from MoneyFusion to CinetPay.
**CinetPay serves only Orange Burkina** (their support, 2026-10-26), so BF moves
operator by operator (`CINETPAY_OPERATORS_BY_COUNTRY` in payment.service.ts):
- **Orange goes to CinetPay.** The operator arrives in three forms: the withdrawal
  operator `ORANGE_BFA`, the payment-page choice `orange_bf`, and an admin
  direct-payout method `OM_BF`.
- **Moov stays on MoneyFusion.** So does a BF payin that arrives with no operator.
- **The page asks for the operator.** Once BF is split, the payment page shows an
  "Orange Money / Moov Money" choice for BF (`payinOperatorChoices` → `window.operatorChoices`).
  Payins must move too, because CinetPay pays BF out of the BF balance its payins fill.

All of this applies **only while `CINETPAY_BF_API_KEY` and
`CINETPAY_BF_API_PASSWORD` are non-empty** in payment-service `.env`; otherwise
all of BF stays on MoneyFusion and the page asks nothing extra. On 2026-10-26 both keys existed but were **empty**, so
BF was still on MoneyFusion. Fill them in and restart payment-service to switch;
empty them to switch back. Before trusting BF payouts, send one small real payout:
the CinetPay code `OM_BF` (`operatorMaps.ts`) follows the new API's
`OM_CI` pattern but had never been used. The old API's codes were `OMBF`/`MOOVBF`.
Also confirm the BF account's IP whitelist includes `207.180.242.122`.
`src/scripts/check-bf-gateway.ts` asserts both states.

Two CinetPay payout bugs fixed at the same time:
- **Rounding:** the approval paid `amount - fee` unrounded. With the fee stored
  to the centime, 7,995 F became 7,994.999999999999, which CinetPay refused as
  "Amount must be a multiple of 5". This failed 50 withdrawals.
- **Missing payment method:** `adminInitiateUserWithdrawal` never sent
  `paymentMethod`, so CinetPay refused every admin-initiated withdrawal.

### CinetPay top-level `serviceProvider` field is NOT set

**Update 2026-10-26:** the admin-approval path (`processMobileMoneyWithdrawalPayout`)
now sets `serviceProvider: 'CinetPay'` and `metadata.selectedPayoutService:
'CinetPay'` when CinetPay pays. A withdrawal requested under another provider (BF
under MoneyFusion before the switch) is then checked as CinetPay. Older rows
still have it null, so keep the `$or` below.

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

### Payins have a reconciler too now — and most "stuck" ones are not stuck

`TransactionStatusChecker` has always covered **withdrawals**. Money coming **in**
had nothing, so a single dropped payin webhook was permanent by construction: the
payer was debited, the intent sat in `PENDING_PROVIDER` forever, and the app went
on showing "Payer" to someone who had already paid. Georgi (2026-09-05, session
`Mh2-KxbcsQif`) is the canonical case — MTN Benin confirmed the debit by SMS
quoting our own session ref, FeexPay accepted it, and no webhook ever arrived.

`PayinReconciler` (`payment-service/src/jobs/payin-reconciler.job.ts`) re-asks the
provider every 10 min for intents 10 min to 7 days old:

- **FeexPay** reuses `checkFeexpayTransactionStatus` — the same call the live
  webhook handler makes to verify itself, so the two cannot drift apart.
- **MoneyFusion** queries its status endpoint and replays the answer through the
  real payin webhook handler, because completion has side effects
  (subscriptions, campaign settlement, referral commissions) that live there.
- **CinetPay** replays `handleCinetPayWebhook({ merchant_transaction_id: sessionId })`.
  That handler re-queries `GET /v1/payment/{token}` (OAuth, per-country creds) and
  applies only what CinetPay answers. **An earlier version of this note said CinetPay
  had no payin status API — that was wrong**, and the resulting exclusion left 537
  CinetPay payins unchecked for a week, including an annonceur (session
  `pm_CePIUng4q`, 2026-09-14) whose campaign stayed a draft while CinetPay itself
  returned `code=100 SUCCESS`.

It only ever applies what the provider confirms; a 502 leaves the intent untouched.
`src/scripts/reconcile-payins.ts` runs the same pass on demand, or one session by
id (`... reconcile-payins.ts <sessionId>`) when someone is complaining right now.

**Do NOT read the `PENDING_PROVIDER` count as lost money.** Measured 2026-09-05:
of **1,236** intents the reconciler actually asked about, **2** had been paid and
83 were confirmed failed — the rest were abandoned checkouts. The raw backlog was
~4,000, so quoting that number as "stuck payments" overstates the real problem by
roughly 500x. Ask the provider before reporting a figure to Rufus.

Related: FeexPay's status API returned 502 for hours on 2026-09-05 during an MTN
Mobile Money incident (`INTERNAL_PROCESSING_ERROR`). During a provider outage,
manually settling anyone on SMS evidence risks crediting a payment the operator
later reverses.

### Security plan, Step A (2026-11-19, branch feature/security-step-a)

The "SBC Security & Country Plan" (12 phases, P0–P11) starts with these:
- **MoMo lock and country lock:** see "Withdrawals are locked 48 h…" above.
- **Why a payment did not finish (P10):** `paymentintents.failure` `{group,
  code, gateway, providerCode, providerMessage, step, httpStatus, requestId,
  at}`. The group is decided once when recorded (`utils/payment-failure.ts`):
  `sbc_code`, `provider_api`, `member`, `unknown`. It is recorded at every
  initiation failure and in `handlePaymentCompletion` for every provider
  FAILED/EXPIRED/CANCELED. An unknown provider text lands in `unknown` with
  its `providerCode` kept (CinetPay 2010, FeexPay "ECHEC"): add a rule to the
  `RULES` table once its meaning is known.
  `src/scripts/check-payment-failure-reasons.ts`.
- **FeexPay status-check errors no longer set ERROR.** `checkFeexpayTransactionStatus`
  (and its by-session twin) used to set the payment to ERROR whenever FeexPay's
  status API failed, which took it out of the payin reconciler for good, and could
  overwrite a SUCCEEDED when completion threw afterwards. The status is left as it
  was; the error goes to `metadata.feexpayStatusCheckError`.
- **MoneyFusion payin status host.** `www.pay.moneyfusion.net` (their documented
  host) fails the TLS handshake; `pay.moneyfusion.net` answers the same
  `/paiementNotif/<token>` route (`MONEYFUSION_STATUS_URL`). The client returned
  null on the failure and the reconciler counted it as an answer, so MoneyFusion
  payins were never actually reconciled. A transport failure now throws (not
  counted). MoneyFusion keeps an abandoned checkout `pending` forever.
  Read-only audit: `src/scripts/audit-stuck-moneyfusion-payins.ts` (≤ 5 calls/s,
  CSV, flags members who paid again later: crediting those would pay twice).
- **Redis for hot counters:** `utils/redis.ts` in user, gateway and payment
  services (identical but for the service name). Off while `REDIS_URL` is unset;
  down or slower than 150 ms returns the caller's fallback (fail open), every
  key `sbc:<service>:…` with a TTL. No caller yet. `check-redis-fail-open.ts`.
- **Indexes:** `scripts/security-plan/indexes.mongosh.js` (dry run unless
  `APPLY=true`, never drops; reports the redundant `referrals` indexes:
  `referrer_1`, `archived_1`, to remove from the schema first).
- **Load test:** `scripts/security-plan/k6/` (preprod only, README).

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
| sbclove | (runs on prod, DB name unverified) | `sbc_sbclove_preprod` |
| advertising | `sbc_advertising` | (n/a) |

Gotchas:
- **user db is `sbc_users` (plural), not `sbc_users_prod` or `sbc_user_prod`.** Every service uses a no-suffix name on prod.
- `sbc_payment_prod` shows up in `getDBNames()` but is EMPTY (a stale ghost). Real prod payment data lives in `sbc_payment` (no suffix). Verified 2026-07-19.
- Guessing DB names returns null silently — always confirm with `db.getMongo().getDBNames().filter(n=>/sbc/i.test(n))` AND `db.<coll>.countDocuments({})` on a stable collection before running real queries.

### User model quick-reference (`sbc_users.users`)

- `role`: `'user' | 'admin' | 'staff' | 'withdrawal_admin' | 'moderator' | 'tester'` (single string, not array). Enum defined in `user-service/src/database/models/user.model.ts` as `UserRole`. `staff` carries `adminPermissions` (see "Admin access per module").
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