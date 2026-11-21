# Security plan Phase 2: second ledger (Blnk)

Status (2026-11-21): built and tested **locally only** (Sterling: image download approved
for this machine, not yet for the server). Nothing runs on preprod or prod.

## What it does

A withdrawal is paid only when three balances agree:

| | What | Where |
|---|---|---|
| A | `users.balance` / `usdBalance` | user-service MongoDB |
| B | opening snapshot + Σ wallet movements since | `walletopeningbalances` + `walletmovements` |
| C | the member's balance in Blnk | Blnk (its own PostgreSQL), written only by the sync worker |

- **Sync worker** (`user-service/src/workers/blnk-sync.worker.ts`, its own pm2 process):
  - every 2 s it posts the next wallet movements to Blnk, 200 at a time, in `_id` order from a cursor;
  - every minute it raises a lag alert (a `ledger_mismatch` case) when a movement has waited more than 5 min;
  - between 02:00 and 05:00 Douala time it runs the shadow comparison of A, B and C over every member with a Blnk balance, in batches of 1,000 with a pause.
- **Outbox state** lives in `blnk_syncs` (one row per movement), not on the movement:
  the journal's rule is that nothing changes a row once it is APPLIED.
- **References:** each movement is posted as `mv:<reference>:<direction>`. Blnk refuses a
  reference it has already seen (409 `TXN_DUPLICATE_REFERENCE`), so a replay moves nothing.
  The opening is `opening:<userId>:<currency>`.
- **Accounts:** one ledger "SBC members". Each member has one balance per currency, with
  `meta_data.userId` only and no personal data. Member balances may never go below 0 in
  Blnk (`allow_overdraft: false`); the internal accounts may.
- **Internal accounts:** `@OpeningBalances`, `@Commissions`, `@Deposits`, `@Withdrawals`,
  `@Purchases`, `@Transfers`, `@Conversions`, `@Adjustments`, `@LeaderboardBonus`,
  `@Activation`, `@Unclassified`. `counterpartFor()` picks one from the movement's source
  and reference.
- **Pre-check before a withdrawal** (payment-service `assertLedgerAgrees`, called from
  `assertWithdrawalsNotLocked`, so all 7 withdrawal and transfer paths get it). It asks
  user-service `GET /users/internal/:id/ledger-check?currency=` for XAF and USD.
  `LEDGER_TRIPLE_CHECK` sets the mode:
  - `off` (default): no check.
  - `log`: a difference opens a case; nothing is refused. This is for the shadow weeks.
  - `enforce`:
    - a difference refuses the withdrawal (409);
    - a sync still running refuses it too (409, "réessayez dans une minute");
    - a ledger that cannot answer refuses it (503). Nothing is ever paid blind.

## Departures from the plan (and why)

- **B uses `walletmovements`, not payment-service `transactions`.** Since support phase 2,
  every balance change writes a movement with a unique reference. `transactions` does not
  cover them all (admin adjustments, refunds). So the "custom ledger" stays: it is the
  Mongo journal that feeds Blnk. Plan step 9 (retire it) is dropped.
- **Every call is immediate (`skip_queue`).** With Blnk's queue, a credit still waiting
  there could make a later debit fail for "insufficient funds".
- **Two balances, not six.** XAF and USD now; they are the withdrawable money. Still to add:
  the activation balance, advertising, SBC Live, and the event organiser (event-service's
  own ledger).
- **The opening posted is the 2026-11-21 snapshot, not a corrected value.** The historical
  reconciliation (step 5) is still to do. It is a read-only recomputation from the
  transaction history, and on prod data it needs your approval. Corrections will then go
  through `@Adjustments` with an approval.
- **No Blnk identities.** Each balance carries the userId; an identity adds nothing without personal data.

## Inventory (plan step 1): what changes a balance

All of these go through `userService.updateBalance` / `updateUsdBalance` / `spendBalance` / the
reservation settlement, so all write a movement. The ones below have **no reference or
source**. Their movements get a generated reference and land on `@Unclassified` until each
is named:

| Where | What |
|---|---|
| payment-service `processInternalWithdrawal` (payment.service.ts ~493) | internal withdrawal |
| payment-service `verifyWithdrawal` (~1224, ~1317) | old USD debit / refund path |
| payment-service `createCryptoPayout` (~2434) | deprecated crypto payout (answers 410 since Phase 3) |
| payment-service `sbc-live-refund.service.ts` `processApprovedRefund` | SBC Live refund credit |
| product-service `user.service.client.ts` `updateUserBalance` | product flows (no reference) |

## Rollout on the server (waits for your OK)

1. **PostgreSQL (the one already running, 16):**
   - database `blnk_preprod` (later `blnk`), with its own role and `CONNECTION LIMIT 20`;
   - add the database to the nightly backup (`pg_dump` next to the mongodump, to R2).
2. **Blnk 0.15.9 server and worker in Docker:**
   - listening on 127.0.0.1 only;
   - `blnk.json` with `"server": {"secure": true, "secret_key": …}`. **Without `secure: true`
     Blnk accepts any request, key or not** (checked locally);
   - Redis: the server's own, on a database number of its own.
3. **user-service `.env`:** `BLNK_URL`, `BLNK_API_KEY`, `BLNK_LEDGER_NAME`.
4. **Start the worker:** pm2 `blnk-sync-preprod` running `node dist/workers/blnk-sync.worker.js`.
5. **Openings:** `node dist/scripts/blnk-post-openings.js` (dry run), then `--apply`.
6. **Shadow run:** 14 clean nights in a row (no unexplained difference), with
   `LEDGER_TRIPLE_CHECK=log` in payment-service.
7. **Enforcement:** `LEDGER_TRIPLE_CHECK=enforce`.
8. **Holds in Blnk** (inflight at reservation, commit or void with the Mongo reservation):
   with enforcement.

## Local

```
cd infra/blnk && cp blnk.local.json.example blnk.local.json   # set secret_key
docker compose -f docker-compose.local.yml up -d              # Blnk on 127.0.0.1:5101
BLNK_URL=http://127.0.0.1:5101 BLNK_API_KEY=… npx ts-node --transpile-only src/scripts/check-blnk-ledger.ts   # user-service
npx ts-node --transpile-only src/scripts/check-ledger-triple-check.ts                                         # payment-service
```
