# Security plan Phase 7: dormant accounts (part 1)

Show the admins how much money sits in accounts nobody uses, and protect those
accounts when they come back. Branch `feature/dormant-accounts`.

## What is built

| Plan item | Where | Status |
|---|---|---|
| 1. Nightly status (active / inactive / dormant / long_dormant), only for accounts holding at least 500 F (`DORMANCY_MIN_XAF`), thresholds as settings | `user-service/src/services/dormancy.service.ts` `runDormancyPass`, `jobs/dormancy.job.ts` (03:45 Douala), `config/dormancy.ts` | done |
| 2. Commissions but no sign-in | same pass: a `commission` credit in the wallet ledger within 90 days, and the account not active | done |
| 3. Reactivation: 72 h hold + `dormant_reactivation` case with a new device / country / contact change | `noteSignIn` (called from `verify-otp`), `watchHolds` (every 10 min), `utils/withdrawal-lock.ts` | done, **log mode** by default |
| 4. Admin page « Comptes dormants » | `admin-frontend-ms/src/pages/DormantAccountsPage.tsx` (Finances → Comptes dormants, module finance) | done except the reactivation campaign |
| 5. Endpoints `GET /api/users/admin/dormant-accounts` and `/summary`, finance read | `api/controllers/dormancy.controller.ts`, gateway `admin-routes.ts` | done |
| Reactivation campaign through relance | — | **part 2** (see below) |

### The status

The last sign of life is the latest of:
- `dormancy.lastSignInAt`: every member sign-in from this release;
- the issue time of the stored token, which is the previous sign-in until a logout clears it;
- `lastActiveAt` / `lastLoginAt`: the Phase 1 signals, for consenting members only;
- `ipLastUpdated`: in practice the sign-up date, because member sign-in never updated it;
- `createdAt`.

The account then gets a status by how long ago that was:

| Days since | Status |
|---|---|
| Under 90 | active |
| 90 to 180 | inactive |
| 180 to 365 | dormant |
| Over 365 | long_dormant |

The « Total dormant » card is every account at 90 days or more.

**Minimum.** An account holding less than `DORMANCY_MIN_XAF` (default 500 F, all balances converted) gets no status: it is never listed, held or exported. It still counts in the member total that the « Part des soldes membres » card divides by. The snapshot keeps their number and amount (`belowMin`), and the page says how many were left out.

Each row stores which date it used (`dormancy.basis`), and the list shows it.

**Data limit.** Before this release, the only real sign-in record is the stored token, and a logout erases it. So a member who signs in and out regularly can show as dormant until they sign in again. The page says so until the sign-in dates cover 30 days, which is why the hold starts in log mode.

### Amounts

- **Balances:** the six balances (`balance`, `usdBalance`, `activationBalance`, `advertisingBalance`, `eventOrganizerBalance`, `sbcLiveBalance`), as stored on the user. Only the first two are in Blnk yet (Phase 2).
- **USD:** converted at `DORMANCY_XAF_PER_USD`, default 660, SBC's USD price. The card shows XAF and USD separately, plus the converted total.
- **Debt:** `debt` is shown on the row, not subtracted.
- **Sorting:** the list sorts by `dormancy.heldXaf`, the converted total. The plan says "balance"; one sort across currencies needs a single number.

### Snapshot and check

- **Snapshot:** each night writes one `dormancy_snapshots` document. It holds totals by status, by balance, by country (the country names that some members store are mapped to their codes), by size (< 5k, 5–50k, 50–200k, > 200k), and the flags.
- **What the page reads:** the card, the breakdowns, the monthly trend (last snapshot of each month) and the month-on-month change come only from snapshots.
- **Nightly check:** the card total must equal the list's own aggregation over the stored fields. A gap is allowed only for members who signed in during the pass, and the result is shown under the page.
- **Sign-ins during the pass:** a member who signs in while the pass runs keeps "active". The pass never overwrites a sign-in that is newer than the pass's start.

### Coming back (`DORMANCY_REACTIVATION_HOLD`)

- **`off`:** only the sign-in date is recorded.
- **`log` (default):**
  - The first sign-in of a dormant or long_dormant account makes it active again.
  - It writes a row in `dormancy_returns` (with signals), which is kept 1 year.
  - Nothing is held and no case is opened.
- **`on`:**
  - Withdrawals are held `DORMANCY_HOLD_HOURS` (72) through `dormancy.holdUntil`.
  - The lock check returns `dormant_reactivation`, and payment-service tells the member why.
  - The hold is kept apart from the timed lock, so a later email/MoMo change cannot shorten it. A longer timed lock still shows.
  - A `dormant_reactivation` case opens when the return comes with any of these signals:
    - **New country:** the Cloudflare country differs from the declared, usual, last and IP countries.
    - **New device:** `X-SBC-Device` isn't among the devices known from `user_geo_days` or `session_keys`. With none known, this signal does not count.
    - **Contact change:** a contact change in the 30 days before the return.
  - A contact change during the hold opens its own case, once (`watchHolds`).
  - Cases go through the user-service case outbox. Severity is `critical` from 200,000 F.
- An inactive account (90–180 days) is never held.

### Admin page

- **Cards:**
  - Total dormant, shown as XAF + USD + the total at the rate, with the change over a month.
  - Share of all member balances.
  - Accounts concerned.
  - "Commissions sans connexion" (a click filters the list).
- **Breakdowns:** by status, balance, country and size.
- **Monthly trend.**
- **List filters:** status, country, minimum held, authenticator, last withdrawal, fraud, checked.
  - **Last withdrawal** comes from the wallet ledger, so only withdrawals since Phase 2 (November 2026) count.
  - **Fraud** means frozen by support, or risk-service decision `require_code`/`hold`, through the new `POST /api/risk/internal/members/flags`.
- **CSV export:**
  - It is a read-only POST, and built in the background into GridFS (`dormancy_exports` bucket), one at a time per admin.
  - The file is downloaded through the API, because the token stays in the header.
  - Files are removed after 24 h.
  - Spreadsheet formulas are neutralised.
- **Actions (finance write):**
  - « Vérifié » takes an optional note.
  - « Geler… » takes a reason of 10+ characters. It files a `dormant_review` case in support's « Fraude » queue. The admin does not freeze: support does, through its approval (Phase 5).
- **Member export (APDP):** it shows only `dormancy.lastSignInAt`. Account deletion clears `dormancy`.

## Checks

- `user-service/src/scripts/check-dormancy.ts`: the pass, snapshot, list, filters, actions, export, and returns in log and on mode, with a fake support. All pass.
- `user-service/src/scripts/check-dormancy-scale.ts`: run with 150,000 accounts, of which 100,000 are inactive 90+ days (about 35× today). Results:
  - the pass takes 23 s;
  - the summary has a p95 of 3 ms;
  - the four first-page lists take 420 ms;
  - a 100,000-row export finishes in 2 s in the background, and the list's p95 during it is 38 ms vs 27 ms.
- `gateway-service/src/scripts/check-admin-permissions.ts` (dormant routes → finance), `risk-service/src/scripts/check-risk.ts` (flags), admin vitest `DormantAccountsPage.test.tsx`.
- Existing checks still pass: withdrawal-lock, support-phase5, activity-signals, privacy, support jest (96).
- Local admin (dev DB copy): 9,375 accounts holding money, a 2.4 s pass, the check ok, and a 9,372-row export.

## Deploy

- user-service `.env` (optional): `RISK_SERVICE_URL` (preprod `http://localhost:6013`) for the fraud flags. Without it, the flags only reflect frozen accounts.
- Indexes `dormancy_list` and `dormancy_list_all` are partial (only accounts with a status), so they are small. Mongoose builds them at start.
- The first pass runs 1 minute after the deploy when no snapshot exists for yesterday or today.
- **Switching the hold on:** set `DORMANCY_REACTIVATION_HOLD=on` after 30+ days of sign-in dates (≥ 2026-12-21 on preprod). Look at `dormancy_returns` first: how many returns, and how many would have opened a case.

## Part 2 / waiting for decisions

- **Rufus:**
  - Confirm the thresholds (90 / 180 / 365 proposed).
  - Decide what happens to money in long-dormant accounts. The plan says legal advice first; nothing touches balances today.
  - Approve the reactivation message wording.
- **Reactivation campaign:** relance today is sponsor → filleuls and cannot target arbitrary members. Part 2 adds an admin "reactivation" send, by email and push with a fixed approved text, at most once per member per 30 days, for the filtered list.
- **The four other balances in Blnk** (Phase 2 leftover), so the amounts can be cross-checked with C.
