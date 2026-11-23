# Security plan Phase 2: second ledger (Blnk)

Status (2026-11-21): tested against a local Blnk; Blnk installed on the secondary server for
preprod (see « Where it runs »). The sync is not started yet.

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
- **Six balances since 2026-11-23** (were two). XAF and USD first (the withdrawable money), then
  activation, advertising, event organiser and SBC Live: `walletmovements.currency` names the
  balance, each has its own Blnk balance (Blnk currency XAF), and the triple check takes
  `?currency=ACTIVATION|ADVERTISING|EVENT_ORGANIZER|SBC_LIVE`. The event organiser keeps
  `eventorganizerledgers` as its claim; its balance may go below zero (resale refunds), so its
  Blnk balance allows it. The withdrawal pre-check still asks XAF and USD only. See « Extra
  balances » below.
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

## Where it runs (Sterling, 2026-11-21)

Blnk runs on the **secondary server** (`ubuntu@169.58.159.177`: Ubuntu 24.04, 8 cores, 23 GB).
It does not run on the main server.

- `/opt/blnk-preprod` (root only):
  - `docker-compose.yml`: Blnk 0.15.9 server and worker, plus Redis 7, all on the host network;
  - `blnk.json` (mode 600, `secure: true`);
  - `.api-key` and `.pgpass-value`, generated on the server and never printed.
- **PostgreSQL 19** (already installed): database and role `blnk_preprod` (`CONNECTION LIMIT 30`).
- **Ports:** Blnk listens on 5101, its worker on 5004, Redis on 127.0.0.1:6390. ufw denies
  everything incoming except 22, 80 and 443. Checked from outside: 5101, 5004, 6390 and 5432
  are all closed.
- **nginx** `preprod-blnk.sniperbusinesscenter.com` → 127.0.0.1:5101 (`blnk.sniperbusinesscenter.com`
  is kept for the future prod instance and answers 444 until then):
  - only `207.180.242.122` (the main server) and 127.0.0.1 are allowed; everyone else gets 403;
  - the ACME path is open;
  - HTTPS comes from certbot, and needs the Cloudflare record set to **DNS only** (grey
    cloud). Behind Cloudflare's proxy every caller would be a Cloudflare address.
- **Main server:** preprod `user-service/.env` gets `BLNK_URL=https://preprod-blnk.sniperbusinesscenter.com`
  and `BLNK_API_KEY`; the pm2 process is `blnk-sync-preprod` (ecosystem.preprod.config.js).
  The deploy restarts it with user-service; the first start is by hand.
- **Prod later:** a second Blnk instance (its own database, port and key) at `blnk.sniperbusinesscenter.com`.

## Rollout steps (each one confirmed with Sterling)

1. Blnk, its database and nginx on the secondary server: **done**.
2. HTTPS (certbot): **done** (DNS-only records; wildcard `*` in the zone).
3. Preprod user-service `.env` and the `blnk-sync-preprod` worker (needs this branch deployed).
4. Openings: `node dist/scripts/blnk-post-openings.js` (dry run), then `--apply`.
5. Shadow run: 14 clean nights in a row, with `LEDGER_TRIPLE_CHECK=log` in payment-service.
6. `LEDGER_TRIPLE_CHECK=enforce`.
7. Backups of `blnk_preprod` (nightly `pg_dump` from the secondary server).
8. Holds in Blnk (inflight at reservation) with enforcement.

## Extra balances (2026-11-23)

What writes them, now journalled (`walletLedger.applyInc`, reference prefix in brackets):

| Balance | Writes |
|---|---|
| ACTIVATION (`act:`) | main → activation (leg of the XAF debit), admin reversal back to main (leg), P2P transfer (`<ref>:out` / `:in`, undo on a missing recipient), sponsor activation (CLASSIQUE/CIBLE/UPGRADE `sponsor-activation:<id>`, WINNER `sponsored_winner_<id>`; undo under the same reference), admin adjust (`admin-adjust-activation:<id>`), leaderboard bonus (`leaderboard-bonus:<user>:<month>`) |
| ADVERTISING (`adv:`) | campaign credits (`advertising-credit:<advertising-service reference>`), transfer to main (leg) |
| EVENT_ORGANIZER (`evt:`) | event-service movements (`<reference>`, claim in `eventorganizerledgers`), transfer to main (leg) |
| SBC_LIVE (`live:`) | paid-live split (`sbc-live-split:<session>`), refund clawback (`sbc-live-refund:<refund>`); without a reference (older payment-service) a generated one |

Counterparts: `@Activation`, `@Advertising`, `@EventOrganizer`, `@SbcLive` (leaderboard → `@LeaderboardBonus`,
admin → `@Adjustments`).

Rollout on an environment whose sync worker already runs:
1. Deploy (user-service, then payment-service).
2. `node dist/scripts/snapshot-opening-balances.js --balances=ACTIVATION,ADVERTISING,EVENT_ORGANIZER,SBC_LIVE`
   (dry run), then `--apply`. Before it starts the sync records these balances' movements
   `skipped_in_opening`; while it runs the sync waits (`opening_snapshot_running`).
3. `node dist/scripts/blnk-post-openings.js --balances=ACTIVATION,ADVERTISING,EVENT_ORGANIZER,SBC_LIVE`
   (dry run), then `--apply`.
4. The nightly shadow comparison then covers them.

## Local

```
cd infra/blnk && cp blnk.local.json.example blnk.local.json   # set secret_key
docker compose -f docker-compose.local.yml up -d              # Blnk on 127.0.0.1:5101
BLNK_URL=http://127.0.0.1:5101 BLNK_API_KEY=… npx ts-node --transpile-only src/scripts/check-blnk-ledger.ts   # user-service
npx ts-node --transpile-only src/scripts/check-ledger-triple-check.ts                                         # payment-service
```
