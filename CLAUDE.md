# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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