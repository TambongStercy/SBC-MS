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
- **Advertising Service** (port 3005): Advertisement management
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

### MoneyFusion never sends payout webhooks

This is permanent until MF builds them. Symptoms:
  - Withdrawal sits in `PROCESSING` indefinitely after admin approval
  - `metadata.payoutMessage` stays the default "Votre retrait est en cours de
    traitement..." — would normally be overwritten on real success
  - `metadata.payoutCompletedAt` set well after `createdAt` = manual reconciliation

For NEW transactions, the admin can mark them completed/failed via the buttons
PR #72 added to the Withdrawal Approval modal — that stamps
`metadata.manualCompletion: { by, at, reason }` for audit. For OLD transactions
(pre-PR #72), the gap between `createdAt` and `payoutCompletedAt` is the only
clue that it was manually marked rather than webhook-confirmed; ALWAYS verify
against MF dashboard before trusting the `completed` status on those.

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
  1. Pull the tx — confirm `serviceProvider: 'MoneyFusion'`, status
     `completed`, and grab `metadata.accountInfo.fullMomoNumber`, `amount`,
     `externalTransactionId`
  2. Ask admin to search MF dashboard for that recipient number AND/OR amount
     (gross, rounded to integer). NOT `netAmountRequested` — MF shows our gross.
  3. If absent from MF dashboard → refund full gross `amount` to user's
     `balance`, insert a RECONCILIATION transaction citing the original tx,
     update the original tx's status to `refunded` with metadata trail. Rhinansou
     case 2026-06-29 is the canonical example.
  4. If present in MF dashboard → push it to MF support / Orange CM (whichever
     network); the money left our hands successfully.

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
- Development databases: `sbc_{service}_dev` (e.g., `sbc_user_dev`)
- Models use Mongoose schemas with TypeScript interfaces
- Repository pattern for data access

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