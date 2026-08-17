# SBC Live ↔ SBC Payment Service — Design Decisions for Rufus

## Context

SBC Live (Sterling's brother's app, on `live.sniperbuisnesscenter.com`) needs to
charge users for paid lives and the Visibilité Maximale subscription (50,000 FCFA /
month per the cahier). The plan is to route those charges through SBC's existing
payment-service so the same providers (CinetPay, MoneyFusion, FeexPay) are reused
and the money lands somewhere we control.

Before I build the new generic-payment endpoint + outbound webhook, a few product
decisions need to be locked in. Rufus has already answered the first one; the rest
are open.

---

## ✅ Already decided

### 1. Money flow + commission

Rufus, 2026-06-17 voice msg:

> *"je pense en fait que l'idéal c'est que ça parte dans un wallet SBC Live, non ?
> Puisque sur l'argent qu'il va recevoir, nous on va prendre les 25 %. Donc,
> l'argent qu'il reçoit, il reçoit directement ses 75 %."*

Decisions captured:

- **SBC commission: 25%** on every SBC Live charge (paid-live access, Visibilité
  Maximale, etc.)
- **Creator gets 75%** routed to a **dedicated SBC Live wallet** (separate from
  the main SBC wallet and the activation balance)

---

## ❓ Still open — please confirm before we build

### 2. Where does the SBC Live wallet actually live?

Three implementation options, ranked by how invasive they are:

| Option | What it means | Pros | Cons |
|---|---|---|---|
| **A.** New field on the user model — `sbcLiveBalance: number` | Mirrors the existing `balance` + `activationBalance` pattern | Familiar pattern, queries are simple, admin UI extends naturally | Touches the User schema in `user-service`, requires migration |
| **B.** Separate collection (`sbc_live_wallets`) keyed by userId | Cleaner separation between SBC's books and SBC Live's books | Easier to roll back SBC Live without touching User docs, cleaner reporting | More plumbing, two collections to keep consistent on transfer flows |
| **C.** Same `balance` field, tagged via transaction history | All money in one wallet; reporting derives SBC Live earnings from tx metadata | Zero schema change | Rufus said "wallet destiné à SBC Live" — sounds like he wants a separate pool; this would mean money is fungible with main wallet |

Rufus's wording ("un wallet destiné à SBC Live") leans toward **A** or **B**.
**A** is what I'd build by default. Confirm?

### 3. Creator payouts — does the SBC Live wallet use the existing withdrawal flow?

When a creator wants to take their 75% out:

- **A. Same withdrawal flow as main wallet.** Creator opens existing withdrawal
  page, picks "SBC Live wallet" as the source, picks their MoMo number, gets OTP,
  admin approves, money goes out via CinetPay/MF/etc. — same code path,
  same fees, same approvals.
- **B. SBC Live builds its own payout flow.** Separate UI, possibly direct to
  bank account, possibly auto-payout at a threshold instead of admin approval,
  possibly different fee structure.

**A** reuses everything. **B** is more flexible but means we build a second
withdrawal flow in payment-service.

### 4. Refunds — when a paid live doesn't happen, who eats the cost?

A user pays 3,000 FCFA for a live tomorrow. Creator doesn't show up.

- **A. Auto-refund full amount to user.** Creator's wallet was credited at
  purchase time; refund reverses that (creator goes -2,250, SBC eats the 750
  commission OR claws it back from the creator's wallet).
- **B. Auto-refund the user, creator keeps their 75%.** SBC eats the 750 + 2,250 = 3,000.
- **C. Manual review.** A new "refund request" admin queue, decided case-by-case.
- **D. No refunds — caveat emptor.** Users accept the risk when buying.

**C** is safest legally; **D** is simplest. **A** and **B** assume we can
unilaterally debit the creator's wallet, which gets messy if they've already
withdrawn.

### 5. Recurring subscriptions — how are monthly paid lives renewed?

Monthly paid-live subscriptions (per the cahier) auto-renew. SBC's existing
payment flow is one-shot — every charge requires the user to enter the OTP /
re-enter the MoMo PIN. For true monthly auto-renewal we'd need:

- **A. Stored payment method.** Provider-side tokenisation (CinetPay supports
  this for cards but not all MoMo flows). Significant engineering, provider-
  dependent.
- **B. Manual renewal.** SBC Live notifies the user at expiry, user re-enters
  the payment. Less smooth UX but ships immediately.
- **C. Hybrid.** Wallet-based — user keeps a credit balance in the SBC Live
  wallet, monthly fees deducted automatically until balance hits zero.

The cahier section 5 implies monthly subs are a real product requirement.
Decide before MVP.

### 6. Reporting — does SBC Live revenue show up in SBC admin analytics?

- **A. Yes**: SBC's existing admin analytics (total subscriptions sold, revenue
  by country, etc.) includes SBC Live charges as a new category. Single
  reporting surface for Rufus.
- **B. No**: SBC Live has its own dashboard. SBC's existing analytics only
  counts traditional SBC subscriptions.

**A** is more work but Rufus probably wants a unified view of all the money
flowing through "his" platforms.

---

## Default assumptions I'd make if Rufus stays silent

If we need to ship and can't get answers, I'd default to:

- 2: **Option A** — new `sbcLiveBalance` field on user model
- 3: **Option A** — same withdrawal flow with a source-wallet selector
- 4: **Option C** — manual refund admin queue, no auto-refunds in v1
- 5: **Option B** — manual renewal in v1, real auto-renewal in v2
- 6: **Option A** — unified reporting

These match the "ship something defensible quickly" mode. We can revisit later
when SBC Live has real usage.

---

## What this unblocks once decided

- Add `sbcLiveBalance` to user model + migration
- New endpoint `POST /api/payments/sso/intents` for arbitrary-amount payments
  on behalf of an SSO-authenticated user with payments.write scope
- 75/25 split logic on payment success (credit creator's sbcLiveBalance with
  75%, accumulate SBC's 25% in a known commission account or float)
- Outbound webhook from payment-service to brother's app on success/failure,
  signed with HMAC-SHA256(body, sharedSecret) — secret stored as
  `webhookSecret` on `SsoClient`
- Source-wallet selector in the existing withdrawal flow so creators can pull
  from `sbcLiveBalance` instead of `balance`
- Refund admin tool (Option C)

Total work: roughly 1 to 1.5 weeks once decisions land.

---

Sterling — please run #2-#6 by Rufus and write the answers back here. I'll
build against them.
