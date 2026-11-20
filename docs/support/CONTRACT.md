# SBC Support — build contract

Source of truth for every branch that builds SBC Support (CdC SBC-SUP-CdC-001 v1.1 +
addendum 1.2). The full plan (French) is in the session plan; this file fixes the parts
several branches must agree on: service layout, internal APIs, roles, settings, defaults.
If a branch needs to change something here, change this file in the same commit and say so.

## 0. Ground rules (all branches)

- Node 22 via `mise exec node@22 -- …`. Mongo and Redis run in Docker locally.
- **The local dev database holds real member data.** Never run anything that moves money,
  sends notifications, approves, deletes or rewrites existing documents in `sbc_*` dev
  databases. Tests use their own databases named `sbc_<service>_<feature>_test` and drop
  only those. Never print secrets, OTPs, tokens or the contents of `COMPTES_TEST_LOCAL.md`.
- Commits: no co-author line, no "Generated with" line. Never merge into develop/master,
  never push, never open PRs — the lead does that.
- Money code (payment-service, user-service balances) follows the 7-point checklist in
  `server/CLAUDE.md`. Every balance or status change is a single conditional write
  (`updateOne({_id, status: expected}, …)` / `findOneAndUpdate` with a guard) and acts
  only when it actually modified a document.
- Messages shown to members and agents are in French. Code, comments, logs in English.
- Every new behaviour gets tests (Jest/Vitest, or a `scripts/check-*.ts` against a test DB).

## 1. Layout

| Piece | Where | Port (prod / preprod) | DB |
|---|---|---|---|
| support-service | `server/support-service/` | 3012 / 6012 | `sbc_support` / `sbc_support_preprod` |
| support-frontend | `server/support-frontend/` | static, nginx | — |
| member "Aide" | `ui/src/pages/help/*` | — | — |

Public URLs: `support.sniperbuisnesscenter.com` (prod), `preprod-support.sniperbuisnesscenter.com`.
Both serve `support-frontend/dist` and proxy `/api/` to the gateway (same origin, no CORS).

Gateway: `/api/support/*` → `SUPPORT_SERVICE_URL` (default `http://localhost:3012`), path kept.
`/api/support/desk/*` is **not** in `admin-routes.ts`; support-service authenticates it.

## 2. Service-to-service calls

Every internal call carries:

```
Authorization: Bearer ${SERVICE_SECRET}
x-service-name: <caller>                # e.g. support-service
x-request-id: <uuid>                    # propagated, logged by both sides
x-support-actor: <agentId>|<role>       # on calls made for an agent action (owner logs it)
```

Owner services compare the secret in constant time (`secretEquals`, phase 0). If
`SUPPORT_SERVICE_URL` is unset in an owner service, its outbound calls to support are
skipped with a warning (never thrown into the money path).

All responses: `{ success: boolean, data?: …, message?: string, code?: string }`.

### 2.1 user-service (`/api/users/internal/…`, existing `serviceRouter`)

| Method & path | Body / query | Returns |
|---|---|---|
| `POST /support-details` | `{ userIds: string[] }` (≤ 100) | `data: SupportMember[]` |
| `POST /support-search` | `{ q: string, limit?: number }` (≤ 20) — exact `_id`, email, phone (any format, normalised), or name prefix | `data: { _id, name, country, role, createdAt }[]` |
| `POST /support/contact-change` | `{ userId, field: 'email'\|'phoneNumber', newValue, step: 'send-code'\|'apply', code?, approvalId }` | `send-code`: OTP to the **new** contact; `apply`: verifies code, applies `withdrawalLockFields()` and `contact-change-alert` to the old contact. Value used by another account → `400 code=CONTACT_UNAVAILABLE` (neutral message). |

`SupportMember` (never password, otps, tokens, device secrets):
```
{ _id, name, email, phoneNumber, country, city, sex, language, role, createdAt, lastLogin,
  isVerified, blocked, deleted, referrerId, referrerName,
  balance, usdBalance, reservedBalance, debt, withdrawalLockedUntil,
  subscriptions: [{ type, category, status, startDate, endDate }] }
```

Owner-side notes (feature/support-owner-apis):
- `lastLogin` is `users.ipLastUpdated` (last authenticated request); the user model has no
  login timestamp. `language` is the first of `users.language`. Deleted accounts are
  returned by details and search.
- contact-change error codes: `INVALID_INPUT`, `APPROVAL_REQUIRED`, `INVALID_VALUE`,
  `SAME_VALUE`, `CONTACT_UNAVAILABLE` (also for values held by deleted accounts),
  `CODE_COOLDOWN` (429, one code per minute), `CHANNEL_UNAVAILABLE` (503: a new phone number
  can only be reached on WhatsApp; while `WHATSAPP_OTP_ENABLED` is off the code is **not**
  sent anywhere else), `DELIVERY_FAILED` (502), `INVALID_CODE`, `STATE_CHANGED` (409,
  contact changed meanwhile), `USER_NOT_FOUND` (404, deleted accounts too). Codes live 15 min,
  are bound to the change (`purpose` `supportChangeEmail`/`supportChangePhone`, `target`) and
  never sign in. `apply` clears every code on the account.

Subscription activation idempotency (phase 3, owner side, no API): collection
`subscriptionactivations` with unique `sessionId`; reserve before applying, release on failure
(same mechanism as product-service `productpayments`). A delivery that finds the same
sessionId still being applied gets `409 code=ACTIVATION_IN_PROGRESS` from
`/api/subscriptions/webhooks/payment-confirmation` (not acknowledged); an applied one gets 200
and does nothing; a reservation stuck `applying` for 15 min (crash) is taken over.

### 2.2 payment-service (`/api/internal/support/…`, new `support.routes.ts`) — built on `feature/support-money`

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /members/:userId/payins` | `?limit=20` | recent payment intents: `{ sessionId, gateway, amount, currency, status, purpose, createdAt, gatewayRef }[]` |
| `GET /members/:userId/withdrawals` | `?limit=20` | `{ transactionId, amount, currency, status, businessStatus, method, createdAt, updatedAt }[]` |
| `GET /payins/lookup` | `?ref=<sessionId or provider ref>&userId=` | the intent if it exists **and** belongs to `userId` (if given), else 404 |
| `POST /payins/:sessionId/recheck` | — | `RecheckResult`; on `confirmed` replays the real webhook handler (idempotent) |
| `POST /withdrawals/:transactionId/recheck` | — | `RecheckResult` (no state change unless provider confirms a final state, then conditional transition) |
| `POST /withdrawals/:transactionId/regularize` | `{ action: 'complete'\|'fail', reason, evidence: string[], approvalId }` | conditional transition; `409 code=STATE_CHANGED` if not in an allowed state |
| `POST /activation/manual` | `{ userId, gateway, externalRef, plan, approvalId }` | verifies `externalRef` at the provider; unique `{gateway, gatewayPaymentId}`; `409 code=REF_ALREADY_USED`, `422 code=PROVIDER_NOT_CONFIRMED` |
| `GET /finance/summary` | `?from&to&country` | counts and sums per business status, ages bucketed `<24h`, `24-48h`, `48-72h`, `>72h` |
| `GET /finance/withdrawals` | `?status&ageBucket&gateway&country&page&limit` | paginated list for the finance board |

```
RecheckResult = { result: 'confirmed'|'pending'|'not_found'|'failed'|'provider_unavailable',
                  provider, providerStatus, providerRef, amount?, currency?, checkedAt,
                  requestId }
```

Business status mapping (CdC §5): `REQUESTED`=`pending_otp_verification`,
`PENDING_APPROVAL`=`pending_admin_approval`, `RESERVED`=reservation held,
`SUBMITTED`/`PENDING`=`processing`, `SUCCEEDED`=`completed`, `FAILED`=`failed`,
`CANCEL_REQUESTED`, `CANCELLED`=`cancelled` (confirmed), `UNKNOWN`=no final provider answer
after the threshold (case opened, funds stay reserved, never auto-released on a timeout).

Implementation notes (feature/support-money):
- `RESERVED` = `pending` (reserved, not yet acknowledged by the provider); `SUBMITTED` =
  `processing` without provider reference, `PENDING` = `processing` with one; `UNKNOWN` =
  `pending`/`processing` for more than 24 h (since approval), or flagged for review (e.g. a
  MoneyFusion webhook without concordant amount/number). Two extra values: `REJECTED`
  (`rejected_by_admin`) and `EXPIRED` (approval window passed; reservation released).
  `CANCEL_REQUESTED` is never produced (no flow cancels after approval).
- `RecheckResult` also carries `internalStatus` (our status after the recheck) and `applied`.
- `regularize` and `activation/manual` require `x-support-actor`; `regularize` requires 1–20
  `evidence` strings and accepts only `processing`/`pending` withdrawals. `activation/manual`
  accepts `plan` = `CLASSIQUE` | `CIBLE` | `UPGRADE` and an optional `countryCode` (CinetPay);
  it answers `201 { sessionId, status, amount, currency, verified }`.
- `finance/summary` returns `{ byBusinessStatus: {STATUS: {count, amount}}, openByAge:
  {bucket: {count, amount}} }` (XAF gross amounts; `from` defaults to 30 days ago). Admin
  direct payouts (SBC's own money) are excluded from both finance routes.
- Withdrawal initiation (`POST /api/transactions/withdrawal/initiate`) accepts an optional
  idempotency key: header `Idempotency-Key` or body field `idempotencyKey` (8–100 chars,
  `[A-Za-z0-9_.:-]`). Same key for the same member = the first request is returned.
- user-service wallet internals used by payment-service (not for support-service):
  `/api/users/internal/wallet/{reservations, reservations/:txId/{release,convert},
  available/:userId, movements, movements/lookup, plan-prices}`.
- `activation/manual` (and the admin manual paths) also refuse with `422 AMOUNT_TOO_LOW`
  (paid amount below the pack price), `422 AMOUNT_UNVERIFIED`, `422 CURRENCY_MISMATCH`,
  `422 PAID_FOR_ANOTHER_ACCOUNT`; every provider id of the payment (CinetPay token and
  transaction id) is claimed once (`409 REF_ALREADY_USED`).
- `regularize complete` also accepts a `failed` withdrawal (money confirmed out on the
  provider's dashboard): debited once, divergence case opened.
- Member-facing `/api/transactions*` responses never carry provider references.

### 2.3 advertising-service (`/api/advertising/internal/…`)

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /manual-verifications` | `?status=pending_review&updatedSince&limit=200` | ids + `submittedAt` for catch-up sync |
| `GET /manual-verifications/:id` | — | proof detail: presigned video URL, day index, participation, campaign (name, target views), diffuseur (id, name, country), history |
| `POST /manual-verifications/:id/decision` | `{ decision: 'approve'\|'reject', observedViews?, reason?, ban?: boolean, actor: { agentId, name, role } }` | single conditional write `pending_review → approved/rejected`; `409 code=ALREADY_DECIDED` otherwise. `ban` only honoured when `actor.role` is `views_supervisor` or `support_admin`. |

Admin "Vérifications vidéo" page becomes read-only (list paginated); a `super_admin`
override stays possible and is logged.

Owner-side notes (feature/support-owner-apis):
- The video URL is the public media URL the admin already plays (proofs are in the public
  bucket), not a presigned one.
- `ban` from another role is ignored (decision still applied, `banIgnored: true`), not refused.
- "super_admin" in SBC is user role `admin`; `staff`/`moderator`/`withdrawal_admin` get
  `403 code=ADMIN_READONLY` while `VIDEO_VERIFICATION_ADMIN_READONLY` (default true) is on.
- Outbound `POST /view-tasks` needs `SUPPORT_SERVICE_URL` in advertising-service; skipped with a
  warning when unset, never fails the member's upload.

### 2.4 notification-service

Uses existing internal routes: `POST /api/notifications/internal/create` (email; `recipient`
required) and `POST /api/notifications/push/internal/send`. New push category **`support`**
in `push-categories.ts` (feeds the bell). No amounts or financial data in notification text.

### 2.5 support-service internal (`/api/support/internal/…`, service secret)

| Method & path | Body | Notes |
|---|---|---|
| `POST /cases` | `{ type, dedupKey, severity: 'info'\|'warning'\|'critical', subject: { userId?, transactionId?, sessionId?, gateway? }, summary, details? }` | idempotent on `dedupKey` (unique); returns `{ caseId, created }` |
| `POST /view-tasks` | `{ sourceId, submittedAt, campaignId, diffuseurUserId, dayIndex, country }` | idempotent on `sourceId` |

Case types: `activation`, `withdrawal_divergence`, `debit_missing`, `paid_not_debited`,
`duplicate_callback`, `unknown_status`, `amount_mismatch`, `ledger_mismatch`.

## 3. support-service public API (`/api/support/…`)

### 3.1 Agent desk — `/desk/*`

Session: access JWT (15 min, `SUPPORT_JWT_SECRET`, `aud=sbc-support`) in httpOnly cookie
`sbc_sup_at` (`Path=/api/support/desk`); refresh token in httpOnly cookie `sbc_sup_rt`
(`Path=/api/support/desk/auth`), server-side session in `agentsessions`, rotated on every use,
reuse ⇒ revoke all sessions of the agent. Cookies `Secure; SameSite=Strict`. CSRF: readable
cookie `sbc_sup_csrf` + header `x-csrf-token` on every non-GET; `Origin` must match.
Idle 30 min, absolute 12 h.

| Route | Body | Result |
|---|---|---|
| `POST /desk/auth/login` | `{ email, password, turnstileToken? }` | `{ step: 'totp'\|'enroll', challengeId }` — same error and timing whatever the reason |
| `POST /desk/auth/totp` | `{ challengeId, code? , backupCode? }` | sets cookies, `{ agent }` |
| `POST /desk/auth/enroll/start` | `{ challengeId }` | `{ otpauthUrl, qrDataUrl }` |
| `POST /desk/auth/enroll/confirm` | `{ challengeId, code }` | sets cookies, `{ agent, backupCodes: string[10] }` (shown once) |
| `POST /desk/auth/activate` | `{ token, password }` | one-time activation link set by an admin |
| `POST /desk/auth/refresh` | — | rotates |
| `POST /desk/auth/logout` | — | revokes session |
| `GET /desk/auth/me` | — | `{ agent: { id, name, email, roles, permissions } }` |
| `POST /desk/auth/reauth` | `{ code }` | `{ reauthToken }` valid 5 min, single use, required by sensitive actions (`x-reauth-token`) |

Modules (all under `/desk`, each route checks a permission server-side; refusals audited):
`agents`, `settings`, `audit`, `approvals`, `members`, `tickets`, `templates`, `kb`,
`activation`, `finance`, `cases`, `views`, `reports`, `notifications`.

### 3.2 Member — `/me/*` (member JWT from the app, verified with `JWT_SECRET`, any role)

| Route | Notes |
|---|---|
| `GET /me/kb/categories`, `GET /me/kb/search?q=`, `GET /me/kb/articles/:slug` | published articles only |
| `GET /me/guides` | guided-paths tree (FAQ flows) |
| `POST /me/assistant/ask` `{ question, conversationId? }` | `{ conversationId, answer, source: 'faq'\|'ai'\|'route', articles: [{slug,title}], route?: 'activation'\|'withdrawal'\|'ticket', canEscalate }` |
| `POST /me/assistant/:conversationId/escalate` `{ category }` | creates a ticket with the conversation attached |
| `GET /me/tickets`, `POST /me/tickets`, `GET /me/tickets/:id`, `POST /me/tickets/:id/messages`, `POST /me/tickets/:id/close` | own tickets only; internal notes never returned |
| `POST /me/attachments` (multipart, `file`) | images/PDF ≤ 10 MB → `{ id }` |
| `GET /me/activation/status` | own recent payins + subscription state |
| `POST /me/activation/check` `{ sessionId?, reference? }` | recheck; `not_found`/`provider_unavailable` ⇒ activation case + ticket |
| `GET /me/withdrawals` / `GET /me/withdrawals/:id` | real status in plain French (business status mapping) |

Rate limits (Redis, per member): assistant 20/day, ticket creation 5/day, activation check 10/h.

## 4. Roles and permissions

| Permission | support_agent | finance_agent | finance_manager | verifier | views_supervisor | support_admin |
|---|---|---|---|---|---|---|
| `members.read` (masked) | ✓ | ✓ | ✓ | | ✓ | ✓ |
| `members.read.full` (unmasked contact) | | | ✓ | | | ✓ |
| `members.contact.request` | ✓ | | | | | ✓ |
| `members.contact.approve` | | | ✓ | | | ✓ |
| `tickets.read`, `tickets.reply` | ✓ | ✓ | ✓ | | ✓ | ✓ |
| `tickets.assign` | | | ✓ | | ✓ | ✓ |
| `activation.check` | ✓ | ✓ | ✓ | | | ✓ |
| `activation.manual.request` | ✓ | ✓ | ✓ | | | ✓ |
| `activation.manual.approve` | | | ✓ | | | ✓ |
| `finance.read`, `finance.recheck`, `cases.work` | | ✓ | ✓ | | | ✓ |
| `finance.regularize.request` | | ✓ | ✓ | | | |
| `finance.regularize.approve` | | | ✓ | | | |
| `views.verify` | | | | ✓ | ✓ | |
| `views.supervise` (assign, reassign, ban, settings, QA) | | | | | ✓ | ✓ |
| `kb.edit` | ✓ | | ✓ | | ✓ | ✓ |
| `kb.publish`, `templates.manage` | | | ✓ | | ✓ | ✓ |
| `reports.read` | | ✓ | ✓ | | ✓ | ✓ |
| `export` | | | ✓ | | ✓ | ✓ |
| `agents.manage`, `settings.manage`, `audit.read` | | | | | | ✓ |

An approver must differ from the requester. Masking: `+237 6•• •• 34`, `j•••@gmail.com`.

## 5. Settings (collection `settings`, editable by `settings.manage`) and defaults

Defaults pending SBC (Rufus) validation — CdC §15.1. All are settings, not code.

| Key | Default |
|---|---|
| `approval.regularization` | always double approval |
| `approval.manualActivation` | always |
| `approval.contactChange` | always |
| `approval.withdrawalManualCompleteAbove` | 50 000 XAF |
| `finance.alertHours` | `[24, 48, 72]` (alert, case to finance_manager, critical) |
| `views.assignmentMode` | `round_robin` (`round_robin` \| `load` \| `manual`) |
| `views.unstartedRequeueMinutes` | 10 |
| `views.idleAlertMinutes` | 15 |
| `views.qaSamplePercent` | 5 |
| `tickets.autoCloseResolvedDays` | 7 |
| `assistant.dailyQuestionsPerMember` | 20 |
| `assistant.monthlyBudgetUsd` | 30 |
| kill switches `killswitch.autoActivation`, `killswitch.autoWithdrawalFinalize`, `killswitch.reconciliation`, `killswitch.deepseek`, `killswitch.autoAssignment` | all **off** (automation enabled) except `killswitch.deepseek` **on** until DEEPSEEK_API_KEY is set |

## 6. Environment variables (support-service)

`PORT`, `MONGODB_URI`, `REDIS_URL`, `SUPPORT_JWT_SECRET` (required), `TOTP_ENC_KEY` (32-byte
base64, required), `SERVICE_SECRET` (required), `JWT_SECRET` (member tokens, required),
`USER_SERVICE_URL`, `PAYMENT_SERVICE_URL`, `ADVERTISING_SERVICE_URL`,
`NOTIFICATION_SERVICE_URL`, `SUPPORT_PUBLIC_URL`, `SUPPORT_ALLOWED_ORIGINS`,
`TURNSTILE_SECRET` (optional; login skips Turnstile when unset, logs a warning in prod),
`DEEPSEEK_API_KEY` (optional), `DEEPSEEK_MODEL` (default `deepseek-chat`),
`R2_*` (reuse the names used by other services; private bucket for attachments).
The service refuses to start without the required ones.

## 7. Branches

| Branch | Content |
|---|---|
| `feature/support-phase0-hardening` | phase 0 (done) + this contract |
| `feature/support-service` | support-service + gateway proxy + deploy/nginx files |
| `feature/support-frontend` | support-frontend |
| `feature/support-money` | phase 2 in payment-service and user-service balances + **all** payment-service support routes (§2.2) |
| `feature/support-owner-apis` | §2.1 user-service endpoints + activation idempotency, §2.3 advertising, §2.4 notification category |
| `ui: feature/support-aide` | member "Aide" section |

All branch from `feature/support-phase0-hardening`.
