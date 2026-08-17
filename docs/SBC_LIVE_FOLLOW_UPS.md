# SBC Live integration — deferred follow-ups

Batches 1-3 shipped the core: SBC Live can authenticate users via SSO, charge
them, automatically credit creators (75/25 split), auto-create the VM
subscription, notify SBC Live via HMAC webhook, and process refunds via an
admin queue. The items below are deliberate punts — useful but not blocking
v1 launch.

---

## 1. Source-wallet selector for creator withdrawals — HIGH PRIORITY

**Problem.** Creators accumulate earnings in `sbcLiveBalance` (separate from
their main `balance`). The existing withdrawal flow only debits `balance`.
Without this change, creators can see their SBC Live earnings via
`/api/sso/userinfo` but can't self-serve withdraw them — they have to ask
SBC admin to manually move money.

**Why deferred.** Touches `payment.service.ts:initiateWithdrawal` (and the
provider-side debit-on-success branches at `payment.service.ts:5870` and
siblings). Per CLAUDE.md, payment-service changes need every code path traced
and the debit-on-success pattern explicitly verified per provider. That
review-and-test discipline doesn't fit in a multi-batch session; it deserves
its own focused PR.

**Scope when picked up.**

1. Add `sourceWallet: 'main' | 'sbcLive'` optional param to
   `initiateWithdrawal` (default `'main'`).
2. Sufficient-funds check reads the right field on the user.
3. Store `sourceWallet` in transaction `metadata`.
4. In each provider's webhook completion branch (FeexPay, MoneyFusion, CinetPay),
   on success: read `metadata.sourceWallet`; if `sbcLive`, call
   `updateSbcLiveBalance(userId, -netAmount)` instead of `updateBalance`.
5. Decide whether admin paths (`adminInitiateUserWithdrawal`) need the same
   selector or stay main-only. Default position: admin paths get the param
   too so SBC admins can manually pull from a creator's SBC Live wallet when
   needed.
6. Frontend: source-wallet picker on the withdrawal page (SBC main frontend,
   not the admin frontend). Defaults to `main`; sbcLive option appears only
   if `user.sbcLiveBalance > 0`.

**Risk.** This is real-money code. Estimated ~2 days with proper testing
including dry-run on preprod with a tiny amount before promoting.

---

## 2. Admin refund queue UI

**Problem.** Refund backend endpoints exist
(`POST /api/payments/admin/sbc-live-refunds/:id/decision`, etc.) but there's
no UI on `admin.sniperbuisnesscenter.com` for Jamelle to use. Currently she'd
have to hit the API with `curl` to approve a refund.

**Why deferred.** Frontend work in `admin-frontend-ms` is outside this
backend-focused PR sequence. The backend is ready; UI is a separate task.

**Scope when picked up.**

- New page under `/admin/sbc-live-refunds` listing pending requests
- Each row: who, when, amount, creator, reason
- Click row → modal showing full payment details + approve/reject buttons + decision note field
- Use the existing `useToast` + `ConfirmationModal` pattern (no `alert()`)

**Risk.** Low. Pure UI on top of stable endpoints.

---

## 3. SBC Live revenue in admin analytics

**Problem.** `adminGetTotalRevenue` and friends don't differentiate SBC Live
revenue (the 25% commission slice) from regular subscription revenue. Rufus
asked for unified reporting (decision #6 in the design doc).

**Why deferred.** Cosmetic — doesn't affect functionality, just visibility.

**Scope when picked up.**

- Update existing aggregation queries to bucket SBC Live commission separately
- Either add a new field to the existing endpoints' responses (e.g.,
  `revenueBreakdown.sbcLiveCommission`) or a new endpoint
  `/admin/stats/sbc-live-revenue`
- New chart on the admin dashboard showing SBC Live commission revenue over
  time, total VM subscriptions sold, count of paid-live transactions

**Risk.** Low.

---

## 4. Refund state-change webhooks

**Problem.** SBC Live's app currently doesn't get notified when an admin
approves/rejects a refund — they have to poll or get told out-of-band.

**Why deferred.** v1 expectation is that refund volume is low and Jamelle
can email/WhatsApp brother on each decision.

**Scope when picked up.**

- Extend `ssoWebhookService` to fire `refund.approved`, `refund.rejected`,
  `refund.completed`, `refund.failed_insufficient_funds` events
- Same HMAC signing + retry policy as payment events

---

## 5. Durable webhook queue

**Problem.** Current outbound webhook is in-process: if payment-service
restarts mid-retry, the queued attempts are lost. Brother falls back to
polling, but it's not ideal.

**Why deferred.** Volume doesn't justify the infra cost yet (Bull on Redis,
worker process, dead-letter queue). Revisit once SBC Live has steady traffic.

**Scope when picked up.**

- Stand up a `payment-webhook-queue` Bull queue (Redis already used by
  notification-service)
- Move `ssoWebhookService.firePaymentEvent` from inline to enqueue
- Worker process consumes the queue, exponential backoff over hours not
  seconds, dead-letter after 24h
- Admin UI to inspect failed webhooks + manual retry button

---

## 6. Auto-renewal for monthly subscriptions

**Problem.** VM (and any future paid-live subscriptions sold by creators)
require the user to manually re-pay each month per Rufus's v1 decision (Option B
in the design doc). UX is rough.

**Why deferred.** Real auto-renewal requires either tokenized payment methods
(provider-side, not all providers support it for MoMo) or a wallet-based
"pre-load credits, auto-deduct" model. Both are multi-week projects.

**Scope when picked up.**

- Option A: Provider tokenization where available (CinetPay cards support it; MoMo doesn't)
- Option B: Pre-loaded credit pool — user tops up `sbcLiveCredit` separately,
  monthly fee auto-deducts until pool drains. Probably the right model for
  MoMo-heavy markets.

---

## 7. Commission accumulation tracking

**Problem.** Right now the 25% SBC commission is just stamped on each
PaymentIntent's metadata as `splitSbcCommission`. There's no running tally
or dedicated commission "account". Hard to answer "how much did SBC make
from SBC Live this month?" without aggregating across all SSO PaymentIntents.

**Why deferred.** Aggregation works for now via the analytics work in #3.

**Scope when picked up.**

- Either a `sbc_live_commissions` collection (one row per commission slice)
  or a dedicated system "user" whose `balance` accumulates all commissions
- Decision driven by whether we ever want to "pay out" the commission
  (e.g., to a Rufus-owned admin account) or just report on it

---

Last updated 2026-06-19 after Batches 1-3 deployed to preprod.
