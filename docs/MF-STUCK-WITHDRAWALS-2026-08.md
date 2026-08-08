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
