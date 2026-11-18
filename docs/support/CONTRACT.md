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

Subscription activation idempotency (phase 3, owner side, no API): collection
`subscriptionactivations` with unique `sessionId`; reserve before applying, release on failure
(same mechanism as product-service `productpayments`).

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
| `GET /finance/withdrawals` | `?status&ageBucket&gateway&country&from&to&page&limit` | `{ items, total, page, limit }`; items `{ transactionId, userId, amount, currency, status, businessStatus, method, gateway, country, createdAt, updatedAt, ageBucket }`. `status=non_final` = every withdrawal without a final provider answer (used by support's 24/48/72 h job) |

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

### 2.3 advertising-service (`/api/advertising/internal/…`)

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /manual-verifications` | `?status=pending_review&updatedSince&limit=200` | ids + `submittedAt` for catch-up sync |
| `GET /manual-verifications/:id` | — | proof detail: presigned video URL, day index, participation, campaign (name, target views), diffuseur (id, name, country), history |
| `POST /manual-verifications/:id/decision` | `{ decision: 'approve'\|'reject', observedViews?, reason?, ban?: boolean, actor: { agentId, name, role } }` | single conditional write `pending_review → approved/rejected`; `409 code=ALREADY_DECIDED` otherwise. `ban` only honoured when `actor.role` is `views_supervisor` or `support_admin`. |

Admin "Vérifications vidéo" page becomes read-only (list paginated); a `super_admin`
override stays possible and is logged.

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
| `GET /desk/auth/csrf` | — | 204; sets the readable `sbc_sup_csrf` cookie (`Path=/`) when missing (sign-in needs it too) |
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

Desk shapes follow `support-frontend/src/api/types.ts` (feature/support-frontend). Lists are
`{ items, total, page, limit }` unless noted; sensitive routes need `x-reauth-token`.

| Area | Routes |
|---|---|
| agents (`agents.manage`) | `GET /agents` (array), `GET /roles`, `POST /agents` → `{ agent, activationUrl }` (link shown once; `delivery:'email'` emails it instead), `PUT /agents/:id/roles`, `POST /agents/:id/disable\|enable\|activation-link\|revoke-sessions`, `GET /agents/:id/sessions` |
| settings / audit | `GET /settings`, `PUT /settings/:key { value, reason }`; `GET /audit?actor&action&objectId&from&to&page&limit`, `POST /audit/verify` → `{ ok, checked, firstBrokenSeq, verifiedAt }` |
| approvals | `GET /approvals?status&mine=1` (array), `GET /approvals/:id`, `POST /approvals/:id/approve { note }`, `/reject { reason }`, `/execute` (retry after an owner outage), `/cancel` |
| members | `POST /members/search { q }` (body, never a query string: emails and phones stay out of access logs), `GET /members/:id` → `{ member }`, `GET /members/:id/payins\|withdrawals\|tickets`, `POST /members/:id/contact-change` → `{ approvalId }`, `POST /members/contact-change/:approvalId/send-code`, `POST /members/contact-change/:approvalId/apply { code }` |
| tickets | `GET /tickets?queue&status(new…closed\|active)&priority&assignee&memberId&number&slaBreached&page&limit` (filters only; a `q` in the URL is ignored), `POST /tickets/search { q, …same filters }` (the free text, never in a URL), `GET /tickets/queues`, `GET /tickets/assignees`, `GET /tickets/:id` → `{ ticket, messages, events }`, `POST /tickets/:id/messages { body, internal, attachmentIds? }`, `/status { status, reason }`, `/assign { agentId }`, `/priority`, `/take`, `GET /tickets/:id/attachments/:aid/url`, `POST /attachments` (multipart `file` → `{ id }`) |
| templates / kb / guides | `GET\|POST /templates`, `PUT\|DELETE /templates/:id`; `GET /kb/categories`, `GET\|POST /kb/articles`, `GET\|PUT /kb/articles/:id`, `POST /kb/articles/:id/publish { version }\|unpublish`; `GET\|PUT /guides { nodes }` |
| activation / finance / cases | `POST /activation/check { userId?, sessionId?, reference? }` → RecheckResult, `POST /activation/manual-requests { userId, gateway, externalRef, plan, reason, caseId? }` → `{ approvalId }`; `GET /finance/summary`, `GET /finance/withdrawals`, `POST /finance/withdrawals/:tx/recheck`, `POST /finance/withdrawals/:tx/regularization-requests { action, reason, evidence[], caseId? }`; `GET /cases?type(…\|finance)&status&severity&assignee`, `GET /cases/:id`, `POST /cases/:id/assign\|comments\|status\|recheck` |
| views | `GET /views/current`, `POST /views/next`, `POST /views/availability`, `GET /views/mine`, `GET /views/tasks/:id`, `POST /views/tasks/:id/start\|heartbeat\|decision { decision: approve\|reject\|review\|technical_error, observedViews?, reason?, ban?, version }`; supervisor: `GET /views/board`, `GET /views/tasks?state`, `GET /views/verifiers`, `POST /views/tasks/:id/reassign { agentId\|null, reason }`, `GET\|PUT /views/settings`, `GET /views/qa`, `POST /views/qa/:taskId { verdict: confirmed\|corrected, decision?, observedViews?, reason }`, `GET /views/stats` |
| reports / bell / meta | `GET /reports/agents?from&to&agentId` → `{ from, to, rows }`, `GET /reports/agents/export` (CSV, `export`, audited), `GET /reports/summary`, `GET /reports/export?type=tickets\|cases\|views`; `GET /notifications`, `POST /notifications/:id/read\|read-all`; `GET /meta` |

Ticket statuses are stored with the CdC keys (`nouveau`, `ouvert`, `en_attente_membre`,
`en_attente_interne`, `resolu`, `ferme`, used as is by `/me/*`); the desk reads and writes the
English keys `new`, `open`, `waiting_member`, `waiting_internal`, `resolved`, `closed`.

### 3.2 Member — `/me/*` (member JWT from the app, verified with `JWT_SECRET`, any role)

| Route | Notes |
|---|---|
| `GET /me/kb/categories`, `GET /me/kb/search?q=`, `GET /me/kb/articles/:slug` | published articles only |
| `GET /me/guides` | guided-paths tree (FAQ flows) |
| `POST /me/assistant/ask` `{ question, conversationId?, level?: 'faq'\|'ai' }` | `{ conversationId, answer, source: 'faq'\|'ai'\|'route', articles: [{slug,title}], route?: 'activation'\|'withdrawal'\|'ticket', canEscalate }`. Default level `faq`; the app re-sends the same question with `level:'ai'` when the member clicks « Ça ne répond pas ». Only `ai` may call DeepSeek (money routing, caps and kill switch still apply) |
| `POST /me/assistant/:conversationId/escalate` `{ category }` | creates a ticket with the conversation attached → `{ ticketId, number }` (same ticket on a repeat) |
| `GET /me/tickets/categories` | `[{ key, label }]` |
| `GET /me/tickets`, `POST /me/tickets` `{ category, subject, message, attachmentIds? }`, `GET /me/tickets/:id`, `POST /me/tickets/:id/messages` `{ message, attachmentIds? }`, `POST /me/tickets/:id/close` | own tickets only; internal notes never returned; message author `{ type, name }` |
| `POST /me/attachments` (multipart, `file`) | images/PDF ≤ 10 MB → `{ id }` |
| `GET /me/activation/status` | `{ activated, subscription: { type, status, startDate, endDate } \| null, payins: [...] }` |
| `POST /me/activation/check` `{ sessionId?, reference?, moneyDebited? }` | `{ result, message, statusLabel, ticketId, ticketNumber?, canReportDebit? }`; `not_found`/`provider_unavailable` ⇒ activation case + ticket (`ticketId` set). A payment never sent to an operator (no `gatewayRef`, and `PENDING_USER_INPUT` or gateway `none`) answers `not_finished` without asking the operator and without a case (`canReportDebit: true`); sent again with `moneyDebited: true`, it opens the case + ticket |
| `GET /me/withdrawals` / `GET /me/withdrawals/:id` | `{ id, amount, currency, method, businessStatus, statusLabel, explanation, createdAt, updatedAt }` (short French label + one French sentence) |
| `GET /me/guides` | guided-paths tree: nodes `{ id, label, text?, action?, category?, articles?, children? }` (editable from the desk) |

Rate limits (Redis, per member): assistant 20/day (setting), ticket creation 5/day (incl.
escalations), activation check 10/h. A refusal is HTTP 429 with `code: 'RATE_LIMITED'`.

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
| `approval.regularization` | `always` (requester + a different finance_manager); only value accepted for now |
| `approval.manualActivation` | always |
| `approval.contactChange` | always |
| `approval.withdrawalManualCompleteAbove` | 50 000 XAF (stored; no effect while every regularization needs approval) |
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
`R2_*` (reuse the names used by other services; private bucket for attachments:
`R2_PRIVATE_BUCKET`, default `sbc-support-private`, objects under `support/attachments/`).
Optional: `REDIS_KEY_PREFIX` (default `sbc-support:<NODE_ENV>:`), `MEMBER_APP_URL`,
`COOKIE_SECURE=false` (local http only; ignored in production), `LOGIN_MIN_MS` (700),
`JOBS_ENABLED`, `DEEPSEEK_PRICE_IN_PER_M` / `DEEPSEEK_PRICE_OUT_PER_M` (budget accounting).
The service refuses to start without the required ones (and in production without
`MONGODB_URI` and `SUPPORT_PUBLIC_URL`).

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
