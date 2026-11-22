# Security plan Phase 4: fraud engine (risk-service), parts 1 and 2

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

## Part 2: live events, new rules, member card, weekly rebuild (2026-11-22)

Branch `feature/risk-live-events`. Still silent: scores change, nothing is refused.

### Where events come from

| Event | Sent by | How |
|---|---|---|
| `signup` | user-service, after `register` | hint (fire-and-forget, 1 s). Network (/24 + user agent) and device only when the member accepted the signals policy (as Phase 1); risk-service keeps HMACs only |
| `contact_change` {email, phone, momo, crypto} | user-service `alertContactChange` (every path: member, admin, support) | hint |
| `authenticator_change` {setup, reset} | user-service `member-auth.service` | hint |
| `dormant_reactivated` | user-service `noteSignIn` (Phase 7) | hint |
| `balance_mismatch` | payment-service ledger triple check (Phase 2, `log`/`enforce`) | hint, once per difference |
| `automation_seen` | gateway browser checks (Phase 9 part 2), per member, every minute | hint |
| `withdrawal_requested` | **risk-service reads the payment database** (new `transactions` by `_id`, every 15 s) | watcher |
| `payin_succeeded` | **risk-service reads the payment database** (paid intents of the last 24 h, every 5 min) | watcher |

- user-service `utils/risk-event.ts` replaces Phase 8's `kyc-hint.ts`: the same call now feeds
  both the fraud rules and KYC (risk-service queues the KYC check on `signup` and on non-crypto
  `contact_change`). `RISK_EVENTS_DISABLED=true` stops it (`KYC_HINTS_DISABLED` still works).
- Withdrawals are read, not sent: there are at least four withdrawal paths (CLAUDE.md), and the
  watcher sees all of them, admin and scripts included, without touching payment code.
- Every event is a `riskevents` row with a unique key (90 days), handled once, one batch a second
  (`RISK_EVENTS_PER_SECOND`, 50). A failed one is retried with a back-off, 10 times.
- **Departure from the plan:** a Mongo queue fed by HTTP hints and a database watcher, not a Redis
  stream (user-service's Redis is optional and fails open; Phase 8 made the same choice). A lost
  hint costs one live rule; the weekly rebuild re-reads everything.

### What an event does

- Its identifiers join the **identifier index**, which now holds every number and device seen
  (shared or not, hashed). A new account on a known identifier is a new link.
- The member's **linked group** is found through that index (non-hub identifiers, at most
  `RISK_MAX_GROUP` = 500 accounts), its facts are re-read from the source databases for those
  accounts only, and the **same `analyse()` as the look-back** scores it. New or worse cases go to
  support, alerting (they are new). Unchanged cases are not resent (`riskcasessent`).
- **Event rules** add live reasons, each counted until it expires:

  | Rule | When | Points | Counts for |
  |---|---|---|---|
  | `contact_change_withdrawal` | withdrawal ≤ 72 h after an email / phone / MoMo / crypto / authenticator change | 30 | 7 days |
  | `new_device_country_payout` | the same Douala day: a device and a country not seen in the 30 days before, and a withdrawal number new to the member (+ case) | 40 | 7 days |
  | `datacenter_network` | withdrawal on a day the member was seen from a hosting / VPN network (`datacenter-asns.ts`, `RISK_DATACENTER_ASNS`) | 15 | 7 days |
  | `signup_burst` | ≥ `RISK_SIGNUP_BURST` (5) sign-ups under one sponsor from one network or device in 24 h: sponsor 30, each recruit 20 (+ case) | 30 / 20 | 30 days |
  | `dormant_reactivated` | a dormant account signs in again | 15 | 30 days |
  | `balance_mismatch` | the ledger triple check disagrees | 30 | 30 days |
  | `automation` | the gateway saw the member's token used outside the web app: invalid signature, replay, body changed after signing, tool user-agent (Phase 9 part 2) | 20 | 7 days |

- Score = structural points (links, referral rules) + live points. Both are kept on
  `riskmembers` (`reasons` + `structuralScore`, `liveReasons`); the score and decision are
  recomputed in the database from both, so the rebuild never wipes a live reason. Expired live
  reasons are dropped hourly. The decision cache of every member touched is dropped.
- The device, country and network rules read Phase 1's `user_geo_days`: **they fire only for
  members who accepted the 2026-12 policy**, so not before it is published. Tor is not seen
  (the gateway records Cloudflare's `T1` as an unknown country).

### Weekly rebuild

Sunday 01:00 Douala (`RISK_REBUILD_DAY`, `RISK_REBUILD_HOUR`; `RISK_REBUILD_DISABLED=true`): the
look-back with `--apply` inside risk-service, cases filed without alerts. It catches what live
scoring can't: identifiers that became hubs, history before the watcher started.

### Member card in support

`GET /api/support/desk/members/:userId/risk` (`risk.read`: finance managers, support admins),
« Risque » panel on the member page: score and decision, reasons (live ones with their end
date), linked accounts (names, links to their page), shared numbers/devices by their last 3
digits, recent events, KYC level 1. support-service needs `RISK_SERVICE_URL`.

### Measured (local copy: 242,065 members, 186,938 transactions, 610,236 referral links)

- Full rebuild: **8 s**, 797 MB peak memory (12,288 identifiers stored; 561 members scored). The
  plan's 1M-member target extrapolates to under a minute; memory grows with the referral links
  (about 3 GB for 1M members: watch it before prod grows that far).
- Live rescoring: largest group (58 accounts) 710 ms; a pair 26 ms; a group lookup 1.3 ms.
- Checks: `risk-service/src/scripts/check-live.ts` (33: each rule fires on its scenario and stays
  silent on its legitimate twin, watcher, linking, expiry, rebuild, cases),
  `user-service/src/scripts/check-risk-events.ts`, support `src/tests/risk-card.test.ts`,
  support-frontend `MemberRiskPanel.test.tsx`.

### Deploy (preprod)

Each server change with Sterling's OK, `.env` backed up first.
1. risk-preprod `.env`: `PAYMENT_MONGODB_URI=mongodb://localhost:27017/sbc_payment_preprod`
   (`USERS_MONGODB_URI` is already set for KYC), then `pm2 restart risk-preprod --update-env`.
   The log says "live events started"; the watcher starts from now.
2. support-preprod `.env`: `RISK_SERVICE_URL=http://localhost:6013`, then restart.
3. user-preprod already has `RISK_SERVICE_URL`; payment-preprod sends `balance_mismatch` only
   while `RISK_MODE=silent` (it is).
4. Optional: run one rebuild by hand (`node dist/scripts/lookback.js` with the `SOURCE_*` URIs and
   `--apply --no-cases`) so the identifier index holds every number before the first Sunday.

## Not done yet (decisions)

- Recruits activated then never active (plan §3): needs 30 days of sign-in history
  (`dormancy.lastSignInAt`, from 2026-11-21), so ≥ 2026-12-21.
- `enforce` mode, which needs Rufus's calls on:
  - the 7-day wait on commissions;
  - what happens to a held withdrawal;
  - the action on confirmed fraud.
- Checks:
  - `risk-service/src/scripts/check-risk.ts` (local Mongo, plus Redis if `REDIS_URL` is set);
  - `payment-service/src/scripts/check-risk-silent.ts`;
  - support `src/tests/internal.test.ts` (`alert: false`).
