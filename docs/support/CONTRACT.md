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
| `GET /activity/board` | `?range=today\|7d\|30d&source=web\|app\|api&countries=CM,BJ` | Security plan Phase 11: the day's activity board, the same object as the admin `GET /api/users/admin/activity` (rows per country, total, daily series, sign-up failure reasons). Computed by user-service's rollup, never by the caller. |
| `POST /support/related` | `{ userId, otherUserId }` | Phase 5 conflict rule: `{ related }` = same account, or one in the other's referral tree (levels 1–3, up or down). |
| `POST /support/authenticator-reset` | `{ userId, reason, approvalId }` | Phase 5: removes the member's authenticator (lost phone), locks withdrawals 72 h, e-mails the member. `409 NO_AUTHENTICATOR` when they have none. |
| `POST /support/freeze` | `{ userId, action: 'freeze'\|'unfreeze', reason, approvalId }` | Phase 5: `users.frozen` set / removed in one conditional write (`409 ALREADY_FROZEN` / `NOT_FROZEN`). The lock check reads it first (`reason: account_frozen`), so no later contact change can lift it. Withdrawals and transfers are refused until the unfreeze. |
| `POST /support/momo-change` | `{ userId, momoNumber, momoOperator, approvalId }` | Phase 5: new Mobile Money details (normalised for the member's country), withdrawals locked (`momo_change`) and the account e-mail alerted when a number is replaced. `400 SAME_VALUE` / `INVALID_VALUE`, `409 STATE_CHANGED`. |
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
`activation`, `finance`, `cases`, `views`, `reports`, `notifications`, `activity`.

Activity (Phase 11): `GET /activity?range&source&country` (`activity.read`) → `{ board, team }`.
An agent's `countries` (country team, `PUT /agents/:id/countries { countries: ['CM'] }`,
`agents.manage` + reauth, audited; `[]` = every country) limits the board to those
countries; asking for another country returns `board: null`.

**Phase 5 (support integration):**
- **Country teams:** tickets and cases carry `country` (the member's declared country,
  looked up when they open; `node dist/scripts/backfill-country-teams.js [--apply]` fills
  older ones). An agent with `countries` sees only those in every list, and gets 404 on any
  `/tickets/:id…` or `/cases/:id…` outside them. Items without a country are for agents
  without a team.
- **Conflict of interest:** `PUT /agents/:id/member-account { userId|null }` (`agents.manage`
  + reauth, audited) links an agent to their own SBC member account. They are then refused
  (`403 CONFLICT_OF_INTEREST`, audited) any request, approval, rejection, execution or case
  action about it or its referral tree (user-service `/support/related`, fails closed).
- **New approvals:** `POST /members/:userId/authenticator-reset { reason (≥ 20) }`
  (`authenticator.reset.request`, approved by `authenticator.reset.approve`);
  `POST /members/:userId/freeze { action, reason (≥ 20) }` (`risk.decide`, approved by another
  `risk.decide`); `POST /members/:userId/contact-change { field: 'momo', momoNumber,
  momoOperator, reason }` (same permissions as contact changes, applied at approval, no code).
  Release of a held withdrawal and commission reversal wait for Phase 4 (holds, reversal API).
- **super_manager** (at most 2 accounts, `409 SUPER_MANAGER_LIMIT`): every finance manager
  permission plus `approvals.override`: approves alone, own requests included, with the
  reauth code, a note of 20 characters at least (`400 REASON_REQUIRED`), and an instant alert
  (desk + e-mail to finance managers, support admins, super managers; ntfy). Audited
  `approval.super_override`.
- **Fraud cases:** types `self_referral`, `shared_payout_number`, `multi_account`,
  `abnormal_behavior`, `geo_anomaly`, `dormant_reactivation`, `dormant_review` (Phase 7: freeze asked from the admin's « Comptes dormants »); `GET /cases?type=fraud`
  (`risk.read`) sorted severity then `amount`; acting on one needs `risk.decide`;
  `type=finance` leaves them out. Intake accepts `country` and `amount`.
- **Member card:** `geo` (declared / usual / last country), `frozen`, `momoNumber`/`momoOperator`
  (masked like the phone), and for money readers `ledger` (balance A against B per currency).

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
| session replay | `POST /tickets/:id/replay` (`tickets.read`) → `{ url }` of the member's OpenReplay session; audited `ticket.replay.opened`. `GET /tickets/:id` only says `ticket.replay: { at } \| null` |
| analytics (`analytics.read`, support administrator) | `GET /analytics?from&to` → `{ period, kpis, series[], categories[], sources[], agents[], errorTypes[], insights[] }`: every KPI of the period with the previous period of the same length; daily series (Douala days): created, handled, backlog, median first response / resolution, errors by class. `POST /analytics/errors/:id/state { state: open\|handling\|resolved, note? }` (`errors.manage`, audited); `POST /analytics/errors/:id/replay` → `{ url }` (audited) |
| live updates | `GET /desk/realtime/token` (`tickets.read`) → `{ enabled:false }` or `{ enabled:true, url, room:'support-desk', token }` (LiveKit, listen-only, 4 h) — see §3.3 |
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
| `POST /me/assistant/:conversationId/escalate` `{ category, replay? }` | creates a ticket with the conversation attached → `{ ticketId, number }` (same ticket on a repeat) |
| `GET /me/tickets/categories` | `[{ key, label }]` |
| `GET /me/tickets`, `POST /me/tickets` `{ category, subject, message, attachmentIds?, replay? }`, `GET /me/tickets/:id`, `POST /me/tickets/:id/messages` `{ message, attachmentIds? }`, `POST /me/tickets/:id/close` | own tickets only; internal notes never returned; message author `{ type, name }` | A ticket carries `agentReadAt` (last time an agent opened it; the member's earlier messages are read). Opening a ticket in the desk sets it and sends a `read` live signal when there was something new.
| `POST /me/client-errors` `{ errors: [{ method, path, status, code?, message?, replay? }] }` | failed API calls the app hit (status 0 or ≥ 400), ≤ 20 per batch, 500/day per member → 202 `{ recorded }`. Grouped per type (`METHOD /api/route/:id STATUS [CODE]`, ids generalised), counted per Douala day with the members touched (kept 400 days); messages stripped of emails and digit runs. A type marked « corrigé » that happens again is reopened as a regression. |
| `POST /me/attachments` (multipart, `file`) | images/PDF ≤ 10 MB → `{ id }` |
| `GET /me/activation/status` | `{ activated, subscription: { type, status, startDate, endDate } \| null, payins: [...] }` |
| `POST /me/activation/check` `{ sessionId?, reference?, moneyDebited? }` | `{ result, message, statusLabel, ticketId, ticketNumber?, canReportDebit? }`; `not_found`/`provider_unavailable` ⇒ activation case + ticket (`ticketId` set). A payment never sent to an operator (no `gatewayRef`, and `PENDING_USER_INPUT` or gateway `none`) answers `not_finished` without asking the operator and without a case (`canReportDebit: true`); sent again with `moneyDebited: true`, it opens the case + ticket |
| `GET /me/withdrawals` / `GET /me/withdrawals/:id` | `{ id, amount, currency, method, businessStatus, statusLabel, explanation, createdAt, updatedAt }` (short French label + one French sentence) |
| `GET /me/guides` | guided-paths tree: nodes `{ id, label, text?, action?, category?, articles?, children? }` (editable from the desk) |

| `GET /me/realtime/token` | `{ enabled:false }` or `{ enabled:true, url, room:'support-member-<userId>', token }` (LiveKit, listen-only, 4 h) — see §3.3 |

`replay` = `{ sessionId, url }` from the member app's OpenReplay tracker (`getSessionID()`, `getSessionURL({ withCurrentTime: true })`). Kept only when `url` is on `OPENREPLAY_DASHBOARD_URL` and contains the session id; ignored otherwise or when that setting is empty.

Rate limits (Redis, per member): assistant 20/day (setting), ticket creation 5/day (incl.
escalations), activation check 10/h. A refusal is HTTP 429 with `code: 'RATE_LIMITED'`.

### 3.4 Public — `/public/*` (no account)

| Route | Notes |
|---|---|
| `POST /public/tickets` `{ contact: { name, phone, email }, category, subject, message, turnstileToken?, website? }` | For people who cannot sign in. All three contact fields required (email: the reply is sent there). Text only, no files. Turnstile required when `TURNSTILE_SECRET` is set (`TURNSTILE_FAILED`); `website` is a hidden field: filled ⇒ fake 201, nothing stored; 3/hour and 10/day per IP (counted after the contact check). → `{ number }` only. The ticket has `memberId: null`, `source: 'public'`; agent replies (not internal notes) are emailed to `contact.email`. |

Creating answers `{ id, number, key }`: the person then **chats with the agent like a member**, sending the key as `Authorization: SupportKey <key>` (browsers: no extra CORS header) or `x-support-guest-key` (wrong or missing key ⇒ 404; 30 failures/hour per IP ⇒ 429):

| Route | Notes |
|---|---|
| `GET /public/tickets/:id` | same shape as `GET /me/tickets/:id` |
| `POST /public/tickets/:id/messages` `{ message, attachmentIds? }` | 60/day per request |
| `POST /public/tickets/:id/attachments` (multipart `file`) | images/PDF ≤ 10 MB, 20/day per request → `{ id }` |
| `POST /public/tickets/:id/close` | |
| `GET /public/tickets/:id/realtime/token` | LiveKit room `support-guest-<id>` (listen-only) |

The server keeps the key's SHA-256 and the key encrypted with `TOTP_ENC_KEY`, so agent reply emails carry the link that reopens the chat: `<MEMBER_APP_URL>/signaler-un-probleme/suivi/<id>#k=<key>` (after `#`: never sent to a server).

The member form (`POST /me/tickets`) also takes an optional `contact` (same checks): how the member wants to be reached, prefilled from the account. The desk returns `ticket.contact` (`verified: false`) and, without an account, `member: { id: null, name }`. **Never treat contact details as identity**: anyone can type someone else's email or number.

### 3.3 Live updates (LiveKit data messages)

New messages and status changes reach both apps without a refresh. support-service publishes
a reliable data message on topic `support` after every ticket change
(`services/realtime.service.ts`): `{ type:'ticket', ticketId, kind: created|message|status|assigned|priority, at }`.
- Rooms: `support-desk` (every agent with `tickets.read`) and `support-member-<userId>` (the
  member). Internal notes, assignments and priority changes go to the desk room only.
- No ticket text ever goes through LiveKit: on a message the apps reload the ticket through the
  normal authenticated API, which still checks every read.
- Tokens only allow subscribing (`canPublish:false`, `canPublishData:false`): only the service
  can send into a room.
- Fire and forget: a LiveKit outage never fails or slows the request.
- Without `LIVEKIT_*` the token routes answer `{ enabled:false }` and both apps keep polling
  (5 s on a ticket, 15 s on a list). Connected, they poll every 60 s as a safety net.

## 4. Roles and permissions

| Permission | support_agent | finance_agent | finance_manager | verifier | views_supervisor | support_admin |
|---|---|---|---|---|---|---|
| *(super_manager: every finance_manager permission, plus `approvals.override`)* | | | | | | |
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
| `activity.read` (Phase 11 activity panel) | ✓ | ✓ | ✓ | | ✓ | ✓ |
| `risk.read` (fraud queue, Phase 5) | | | ✓ | | | ✓ |
| `risk.decide` (act on fraud cases, freeze / unfreeze) | | | ✓ | | | |
| `authenticator.reset.request` | ✓ | | | | | ✓ |
| `authenticator.reset.approve` | | | ✓ | | | |
| `agents.manage`, `settings.manage`, `audit.read` | | | | | | ✓ |

An approver must differ from the requester (except a super_manager, see above). Masking: `+237 6•• •• 34`, `j•••@gmail.com`.

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
`NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` (optional; a phone notification per new request: number, category, priority, name, title, start of the message, link to the desk; never a phone or email),
`OPENREPLAY_DASHBOARD_URL` (optional; self-hosted OpenReplay dashboard, replays on tickets are off without it),
`LIVEKIT_URL` (wss URL the browsers connect to), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`LIVEKIT_HTTP_URL` (optional; server API URL, defaults to `LIVEKIT_URL` with ws→http) —
all optional, live updates are off without them (§3.3),
`R2_*` (reuse the names used by other services; private bucket for attachments:
`R2_PRIVATE_BUCKET`, default `sbc-support-private`, objects under `support/attachments/`).
Without R2 keys every attachment upload answers 503 (« Stockage des fichiers indisponible »).
Local development: `R2_ENDPOINT` points at an S3-compatible store (MinIO), `R2_ACCOUNT_ID` empty;
leave `R2_ENDPOINT` empty on preprod/prod.
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
