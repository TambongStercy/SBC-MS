# MoneyFusion stuck withdrawals — investigation 2026-08-08

Nine withdrawals stuck in `processing`, some since June. Triggered by Rufus
reporting « une transaction en cours » on snipertradebusiness@gmail.com blocking
him.

## Reconciliation — verified against Rufus's MF dashboard export

| Our record | Amount | Phone | MF dashboard | Action |
|---|---|---|---|---|
| 09/06 07:40 | 3 075 | 650384125 | **Validé** 09/06 08:41 | Mark Completed → debits wallet |
| 24/06 20:24 | 3 177.5 | 769084413 | **Validé** 24/06 22:46 (3 193) | Mark Completed → debits wallet |
| 12/07 00:08 | 3 075 | 768623600 | **Validé** 12/07 22:24 (3 090) | Mark Completed → debits wallet |
| 02/08 14:02 | 2 460 | 659204765 | **En attente** | Leave, may still complete |
| 07/08 16:15 | 12 300 | 696921761 | **En attente** | Leave, may still complete |
| 17/06 21:12 | 2 972.5 | 65431477 (BF) | absent | Mark Failed, no debit |
| 03/07 15:44 | 6 150 | 699732105 | absent | Mark Failed, no debit |
| 18/07 11:55 | 2 460 | 04407313 (BF) | absent | Mark Failed, no debit |
| 04/08 16:17 | 2 255 | 688067614 | absent | Mark Failed, no debit |

**Three were actually paid — 9 327.5 XAF that left the account but was never
debited from the users' wallets.** Those users have been able to spend it.

The two Wave amounts differ by a consistent ~0.5% (3 193 vs 3 177.5; 3 090 vs
3 075), so Wave adds a fee. Phone and date match exactly on both.

All of this goes through `/fix-moneyfusion-withdrawals`, which stamps the audit
marker.

## Root cause — partially identified

7 of 9 have **no `tokenPay` stored at all**, so the payout webhook has nothing to
match (`findByExternalId` returns null) and they sit in `processing` forever.

This is NOT the race documented in CLAUDE.md, which assumed the token was stored
just too late. Here it is never stored.

Two distinct failure modes found:

**1. Axios timeout (1 of 9 — 03/07, 6 150).** `moneyfusion.service.ts` uses
`timeout: 30000`. When MF is slower than that, the catch in
`processMobileMoneyWithdrawalPayout` detects a timeout, sets `awaitingWebhook` and
returns — correctly refusing to assume failure, but with no token stored, so the
webhook can never match it. Identifiable by `metadata.timeoutOccurred: true`.

**2. Outcome never recorded (6 of 9). UNEXPLAINED.** For the 07/08 12 300 case:

```
18:16:58  [MoneyFusionService] Initiating MoneyFusion payout: 12000 to 696921761
          ...nothing...
23:35:08  [TransactionStatusChecker] Reconciling status for withdrawal ...
```

Between those, no success log (`MoneyFusion payout initiated: tokenPay=`), no
failure log, no error log. The `catch` logs with the transaction id and never
fired. `serviceProvider` was never set, so the success block never ran either.

Ruled out: process restart. `pm2` shows payment-service up since 07/08 03:01 with
**0 restarts**, so it was alive throughout.

MF received the request regardless — it is on their dashboard at the matching
time. So the request left us, MF processed it, and our side recorded nothing.

**Still to determine:** how an awaited axios call with a 30s timeout produces
neither a resolution nor a rejection in a live process. Worth checking whether
error-level logs go to a file not covered by `payment-service-*.log`, and whether
anything upstream swallows the rejection.

## Recommended fix

The webhook depends entirely on `tokenPay`, which is exactly the thing missing
whenever the response is lost. That coupling is the real fault.

- Record a payout attempt **before** calling MF (`payoutAttemptedAt`, the phone
  and net amount), so every attempt is traceable even when the response is never
  seen.
- Give the payout webhook a **fallback match** on phone + amount + time window
  when `tokenPay` finds nothing, instead of returning 200 and dropping it.
- Raise the 30s axios timeout, or on timeout schedule a follow-up rather than
  relying on a webhook that cannot match.

## Unrelated noise

`TransactionStatusChecker` logs three lines per stuck MF transaction every five
minutes, forever. With 9 stuck that is ~7 800 lines a day saying an admin must
reconcile. Worth rate-limiting or skipping MF once flagged.

---

## How to actually clear one (verified procedure)

The admin page at `/fix-provider-issues` still shows **0 stuck withdrawals** even
after the PR #105 fix deployed. Verified on prod: the `$or` filter IS in the
running `dist`, payment-service restarted with it, and running that exact filter
against Mongo returns **9**. The endpoint is live (401 without a token). So the
break is between the endpoint and the render — check the Network tab on that page
for the `stuck-moneyfusion` response to see which side returns 0.

Until that is fixed, use the webhook simulation pattern CLAUDE.md documents. This
runs the REAL handler, so the debit and bookkeeping are identical to a genuine
webhook, and `handleMoneyFusionPayoutWebhook` checks `status !== COMPLETED` first
so it cannot double-debit.

**Step 1 — plant a sentinel token.** These transactions have no `tokenPay`, which
is exactly why no webhook could ever match them.

```bash
mongosh --quiet --eval '
db.getSiblingDB("sbc_payment").transactions.updateOne(
  {transactionId:"<TX_ID>"},
  {$set:{
    externalTransactionId:"MANUAL-RECONCILE-<TX_ID>",
    serviceProvider:"MoneyFusion",
    "metadata.manualReconciliation":{by:"<admin>",at:new Date().toISOString(),reason:"<MF dashboard evidence>"}
  }}
)'
```

Setting `serviceProvider` also makes the transaction visible to the admin page
from then on.

**Step 2 — fire the event.**

```bash
curl -s -X POST 'http://localhost:3003/api/payments/webhooks/moneyfusion/payout' \
  -H 'Content-Type: application/json' \
  -d '{"event":"payout.session.completed","tokenPay":"MANUAL-RECONCILE-<TX_ID>"}'
```

- `payout.session.completed` → marks COMPLETED **and debits the wallet**
- `payout.session.cancelled` → marks FAILED, **no wallet movement** (correct: with
  debit-on-success nothing was ever taken, so there is nothing to refund)

Any other event string is treated as pending and does nothing.

**Step 3 — verify.**

```bash
mongosh --quiet --eval '
const t=db.getSiblingDB("sbc_payment").transactions.findOne({transactionId:"<TX_ID>"});
print("status: "+t.status);
print("balance: "+db.getSiblingDB("sbc_users").users.findOne({_id:t.userId},{balance:1}).balance);'
```

### Outstanding

`hC8NgERB4Oa3LC_1` (Rufus, snipertradebusiness@gmail.com, 3 075) was **not yet
run** as of 08/08. He cannot initiate a new withdrawal until it clears — the app
blocks it by name:

> « Vous avez une demande de retrait en cours (ID: hC8NgERB4Oa3LC_1) qui est
> actuellement en traitement. »

Expect his balance to drop by 3 075 afterwards. That is correct — MoneyFusion paid
that recipient on 09/06 and it was never deducted — but warn him first or it looks
like money vanishing.

Use `payout.session.completed` for the three marked Validé above, and
`payout.session.cancelled` for the four marked absent.
