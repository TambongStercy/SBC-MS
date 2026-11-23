# Security plan Phase 7: dormant accounts (part 1)

Show the admins how much money sits in accounts nobody uses, and protect those
accounts when they come back. Branch `feature/dormant-accounts`.

## What is built

| Plan item | Where | Status |
|---|---|---|
| 1. Nightly status (active / inactive / dormant / long_dormant), only for accounts holding at least 500 F (`DORMANCY_MIN_XAF`), thresholds as settings | `user-service/src/services/dormancy.service.ts` `runDormancyPass`, `jobs/dormancy.job.ts` (03:45 Douala), `config/dormancy.ts` | done |
| 2. Commissions but no sign-in | same pass: a `commission` credit in the wallet ledger within 90 days, and the account not active | done |
| 3. Reactivation: 72 h hold + `dormant_reactivation` case with a new device / country / contact change | `noteSignIn` (called from `verify-otp`), `watchHolds` (every 10 min), `utils/withdrawal-lock.ts` | done, **log mode** by default |
| 4. Admin page « Comptes dormants » | `admin-frontend-ms/src/pages/DormantAccountsPage.tsx` (Finances → Comptes dormants, module finance) | done |
| 5. Endpoints `GET /api/users/admin/dormant-accounts` and `/summary`, finance read | `api/controllers/dormancy.controller.ts`, gateway `admin-routes.ts` | done |
| Reactivation campaign | user-service `services/dormancy-campaign.service.ts`, notification-service `services/reactivation.service.ts`, admin `components/finance/ReactivationPanel.tsx` | **part 2, done 2026-11-23** (see « Part 2: réactivation campaign ») |

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

## Part 2: réactivation campaign (2026-11-23)

An email + a push to the dormant accounts of the page's list, with the same filters, at most once per
member per 30 days. Admin « Comptes dormants » → « Message de réactivation ».

- **The text.** A super admin edits a draft (objet, message, titre et texte de la notification) and
  approves it; each approval is a new version (who, when). **Only the approved version is ever sent**,
  and each campaign keeps a copy of the one it used. Plain text only: links and placeholders other than
  `{{nom}}` (first name) are refused. The email always adds, outside the editable text, one button
  « Ouvrir SBC » to the app's home, the line « SBC ne vous demandera jamais votre mot de passe ni vos
  codes de connexion… » and the relance unsubscribe link. No amount is ever in the text.
  The default wording is a proposal: **Rufus must read and approve it** before the first real send.
- **Who.** The page's filters, then left out (counted by reason in the preview and the campaign):
  deleted or blocked, frozen, fraud flag (`dormancy.fraudFlag`), contacted in the last 30 days,
  unreachable (no usable email: none, bounced or unsubscribed, and no push device with « Annonces SBC »
  on), and members who came back meanwhile. The same checks run again just before each send.
- **Once per 30 days, in the database.** `dormancy_contacts` (`_id` = member) is claimed with one
  conditional upsert (`lastAt` older than 30 days, or already this campaign's). A second campaign inside
  the window hits the unique `_id` and is refused, however the calls interleave. A member claimed but
  never sent anything (cancel, failure, unreachable) gets the claim back.
- **Sending.** `dormancy_campaign_targets` (unique per campaign + member) is the outbox. The user-service
  job (every minute) leases one member at a time and calls notification-service
  `POST /api/notifications/internal/reactivation/send`, which:
  - sends only 07:00–19:00 Douala (relance's hours, `RELANCE_SEND_FROM_HOUR`/`_TO_HOUR`);
  - takes the email out of **relance's share** of the mail server (`reserveRelanceSend`: the minute's
    leftovers after OTP, and relance's daily total `RELANCE_DAILY_EMAIL_CAP`, which the two now share),
    never Cloudflare, never to an address on the suppression list (bounce, complaint or unsubscribe);
  - sends the push as an announcement (held at night, not sent to members who turned announcements off);
  - records each member once per campaign (`reactivation_deliveries`), so a retried call never sends twice.
  No room → `deferred` with a retry time: the campaign waits (`waitUntil`), no attempt is spent.
  notification-service down → retried with backoff, `failed` after 5 attempts.
- **One campaign at a time**; it can be cancelled (the rest is skipped and gets its 30 days back).
- **Return.** A sign-in within 30 days of the message counts as « revenu » for that campaign
  (`noteSignIn` → `noteCampaignReturn`). The return still goes through the return hold
  (`DORMANCY_REACTIVATION_HOLD`): the campaign changes nothing about withdrawals.
- **Rights.** Reading the text, the preview and the history: finance read. Sending and cancelling:
  finance write; sending also needs the admin's own authenticator code (`requireAdminStepUp`).
  Editing and approving the text: super admin only (`…/reactivation/text/draft|approve`, gateway
  module `staff`).
- **Test mode (default).** `REACTIVATION_SEND_MODE=live` is required to send to everyone; otherwise only
  `REACTIVATION_TEST_RECIPIENTS` (emails or user ids) are sent anything and the rest are skipped as
  `test_mode`. Preprod stays in test mode: it holds copies of real members' addresses and push devices.
- Routes (user-service, `/api/users/admin/dormant-accounts/reactivation/…`): `GET text`,
  `PUT text/draft`, `POST text/approve`, `POST preview`, `GET campaigns`, `POST campaigns`,
  `POST campaigns/:id/cancel`.
- Checks: user-service `src/scripts/check-dormancy-campaign.ts`, notification-service
  `src/tests/reactivation.test.ts`, admin `components/finance/ReactivationPanel.test.tsx`, gateway
  `check-admin-permissions.ts`.

## Waiting for decisions

- **Rufus:**
  - Confirm the thresholds (90 / 180 / 365 proposed).
  - Decide what happens to money in long-dormant accounts. The plan says legal advice first; nothing touches balances today.
  - Read and approve the réactivation wording (admin « Message de réactivation »), then set `REACTIVATION_SEND_MODE=live` on prod.
- **The four other balances in Blnk** (Phase 2 leftover), so the amounts can be cross-checked with C.
