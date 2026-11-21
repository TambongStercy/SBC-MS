# Security plan Phase 4: fraud engine (risk-service), part 1

Status (2026-11-21): built and tested locally. Look-back dry run on preprod data done (below).
Silent mode only: nothing is refused because of a score.

## What it does

- **Links accounts by strong identifiers only** (plan §2):
  - a phone number, whatever its role: withdrawal number (`metadata.accountInfo.fullMomoNumber`),
    profile MoMo (`users.momoNumber`), or the number that paid (`paymentintents.phoneNumber`,
    SUCCEEDED);
  - a device ID (`user_geo_days.devices`, consenting members only).
  - Numbers compare on their last 9 digits. An identifier shared by more than
    `RISK_HUB_THRESHOLD` (50) accounts is a hub (a shop or family number) and links nothing.
  - Linked accounts form groups (union-find).
- **Rules (first set)**:

  | Rule | When | Points |
  |---|---|---|
  | `shared_payout_number` | a withdrawal number used by accounts in each other's referral tree (levels 1–3) | 40 |
  | `self_referral` | a sponsor and a recruit (levels 1–3) in the same linked group | 50 |
  | `multi_account` | a group of 3 or more accounts (+5 per extra account, max 40) | 20–40 |
  | `quick_withdrawal` | a withdrawal within 30 min of commissions, that empties them and is mostly made of them | 10 |

  - Score = the sum. Decision: `require_code` from 40 (`RISK_REQUIRE_CODE_AT`), `hold` from 70
    (`RISK_HOLD_AT`). `RISK_DISABLED_RULES` switches rules off without a redeploy.
  - A shared withdrawal number in a referral tree also makes the pair self-referral, so it
    scores 90 (hold).
- **Privacy:** identifiers are stored as an HMAC (`RISK_HASH_KEY`, never rotate) plus the last
  3 digits. Cases and the member view show `•••233`, never a full number.
- **Cases** go to the support fraud queue (Phase 5):
  - deduplicated per number or group (`risk:shared_payout:<hash>`, `risk:self_referral:<group>`,
    `risk:multi_account:<group>`, `risk:quick_withdrawal:<user>`);
  - carry country, amount withdrawn and severity, with at most 50 account ids listed;
  - go through an outbox, the same as user-service and payment-service.
  - Look-back cases are sent with `alert: false`, a new option on support's intake: past cases
    fill the queue without ringing the managers once each.
- **Decision API** (service secret):
  - `POST /api/risk/internal/decision {userId, action, amount?, currency?, transactionId?}`
    returns `{decision, score, reasons, groupSize}`. It reads Redis (10 min), then Mongo; a member
    never scored gets `allow`.
  - Every question is kept in `decisionlogs` (90 days), so the silent weeks show what
    enforcement would have done.
  - `GET /api/risk/internal/members/:userId` gives the score, reasons, linked accounts and shared
    identifiers (by their tails), for the support desk's member card (part 2).
- **payment-service:**
  - `RISK_MODE=off|silent` (default off) with `RISK_SERVICE_URL`.
  - In silent mode `assertWithdrawalsNotLocked`, and so every withdrawal and transfer path, asks
    with a 100 ms budget. It logs any answer other than `allow` and never refuses. Risk-service
    slow or down means the withdrawal goes on.

## Look-back

```
SOURCE_USERS_MONGODB_URI=…/sbc_users SOURCE_PAYMENT_MONGODB_URI=…/sbc_payment node dist/scripts/lookback.js   # dry run
… --apply              # writes sbc_risk (identifiers, riskmembers, riskruns), clears the decision cache, opens cases
… --apply --no-cases   # scores only
… --since 2026-01-01
```

- It only reads the source databases.
- A new `--apply` resets members the run no longer flags back to `allow`.

**Preprod dry run (2026-11-21; preprod data ends 2026-10-27):**
- Input: 210,812 members, 47,949 withdrawals, 28,992 commissions, 564,769 referral links.
- 266 shared identifiers (no hubs), forming 191 groups (the largest has 39 accounts).
- **108 withdrawal numbers shared inside a referral tree: 168 accounts, 50,600,283 F withdrawn.**
- 520 members scored: 249 `hold`, 138 `require_code`, 133 `allow`.
- Cases:
  - by type: 108 shared number, 140 self-referral, 50 multi-account, 3 quick withdrawal;
  - by country: CM 109, BJ 85, TG 55, BF 24, CI 16, CG 8, CD 2, GA 1, SN 1.
- The plan's target (at least 137 shared numbers) is measured on prod data, which needs approval.

## Deploy

- pm2: `risk-service` on 3013 (prod) and `risk-preprod` on 6013, with databases `sbc_risk` and
  `sbc_risk_preprod`.
- Internal only: there is no gateway route and no nginx.
- The usual first-deploy traps apply (CLAUDE.md « Deploying a brand-new service »):
  - the deploy script picks the service up on its second run;
  - `npm install` the first time;
  - write `risk-service/.env` first (`.env.example`): `RISK_HASH_KEY=$(openssl rand -base64 32)`,
    generated on the server and never printed.
- Then, in order:
  1. Look-back dry run on preprod.
  2. `--apply`.
  3. payment-service `RISK_MODE=silent` and `RISK_SERVICE_URL=http://localhost:6013`.

## Not done yet (part 2 and decisions)

- Live events (Redis streams) instead of a batch rescoring.
- Device, country, VPN and dormant rules.
- The member card in support (linked accounts, score).
- A weekly rebuild.
- `enforce` mode, which needs Rufus's calls on:
  - the 7-day wait on commissions;
  - what happens to a held withdrawal;
  - the action on confirmed fraud.
- Checks:
  - `risk-service/src/scripts/check-risk.ts` (local Mongo, plus Redis if `REDIS_URL` is set);
  - `payment-service/src/scripts/check-risk-silent.ts`;
  - support `src/tests/internal.test.ts` (`alert: false`).
