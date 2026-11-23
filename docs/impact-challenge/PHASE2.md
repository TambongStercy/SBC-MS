# SBC Impact Challenge v2 — Phase 2 (weeks 1–3, votes, TOP 3)

Spec §5–§9, the vote and payment parts of §15–§17. Builds on Phase 1 (`PHASE1.md`: editions,
candidates, qualification). Code: event-service `modules/impact` (`stage`, `submission`, `vote`,
`board` services). No payment-service change: Mobile Money uses a normal payment intent
(`paymentType: IMPACT_VOTE`), the SBC balance uses `internal/balance-spend` / `balance-refund`.

## The flow

| Step | Edition | Candidates | What happens |
|---|---|---|---|
| Launch (admin) | `QUALIFICATION_CLOSED` → `COMPETITION`, stage `WEEK1` | `OFFICIAL`, published | Every official profile must be validated first. The waiting list becomes `NOT_SELECTED`. |
| Week 1 | `WEEK1` | `OFFICIAL` | The public board lists the candidates (§5). Videos can already be submitted. |
| Week 2 (admin) | `WEEK2` | `STAGE_2` | Video « Ma vision de SBC »: submit → validate → published. Free vote round `FREE`. |
| Week 3 (admin) | `WEEK3` (only once `FREE` is not open) | `STAGE_3` | Project presentation: submit → validate → published. Paid vote round `PAID`. |
| TOP 3 (admin, with code) | `FINAL`, stage `TOP3` | `FINALIST` / `ELIMINATED`, with `rank` | Ranking by paid votes. |

**Rounds:** each round has `opensAt` and `closesAt`, editable while `SCHEDULED`. The job opens the round on
its date (in its own week only) and closes it on its end date. The admin can also open it now (its end
date must be set) or close it now (reason required). A closed round never reopens.

**Who can be voted for:** in the free round, `STAGE_2` candidates whose video is accepted. In the paid
round, `STAGE_3` candidates whose project is accepted.

## Rules built in (Rufus + defaults, `settings`, locked when the competition starts)

- **TOP 3 = week-3 paid votes only.** A tie goes to the candidate who reached the total first (time of
  their last counted vote), then to the earlier seat. `tieAtCut` tells the admin a tie decided the cut.
- **Vote money is SBC's.** No organizer share, no automatic payout.
- **Free vote:** 1 account = 1 vote per edition, enforced by a unique index.
  - `freeVote.membersOnly` (default true): only accounts with an active pack can vote.
  - `freeVote.accountsOlderThanRound` (default true): only accounts created before the round opened.
  - `freeVote.selfVote` (default false): whether a candidate may vote for themselves.
  - More than 300 free votes an hour from one network are refused. That limit is high on purpose:
    mobile operators share addresses.
- **Paid votes:**
  - Packs come from `settings.votePacks`, chosen by `packIndex`.
  - `paidSelfVote` (default true): a candidate may buy votes for themselves.
  - `balancePayment` (default true): payment from the SBC balance is offered.
  - At most 30 purchases per hour per account.
  - Votes count only once payment-service confirms (the webhook re-reads the intent), exactly once.
- **Late payments:** a payment started before closing counts if confirmed within
  `settlementGraceMin` (15) minutes. After that, or for a removed candidate, or after the TOP 3, the
  money goes back to the buyer's SBC balance and the votes never count.
- **Admin refund** (admin code): the votes are removed and the money returns to the SBC balance. It is
  refused once the TOP 3 is set.

## Money safety

- **Purchases:** one `idempotencyKey` per click, unique per member, so a double tap is one purchase.
- **Settling:** a lease (`settlingAt`) admits one settler, and the votes are added only by the write
  that sets `votesCreditedAt`. A payment of the wrong amount counts nothing and is flagged
  `AMOUNT_MISMATCH`.
- **Balance payments:**
  - The reference is `impact-vote:<txId>`; balance-spend is exactly once per reference.
  - An unknown outcome stays `PENDING`. For 30 minutes the job asks again with the same reference.
    After that it gives back whatever was taken and cancels.
- **Refunds:**
  - Mobile Money purchases are refunded through `internal/deposit` with reference
    `impact-vote-refund:<txId>`; balance purchases through `balance-refund` on the spend reference.
    Both are exactly once.
  - An unknown outcome is marked `refund.uncertain` and retried every minute.
- **Lost callbacks:** Mobile Money purchases still pending after 10 minutes are checked against
  payment-service. After 24 hours without a final answer they are cancelled.
- **Counters:** the ledgers are the truth. A job recounts every 5 minutes, and the TOP 3 decision
  recounts first.

## API (gateway `/api/tickets/impact/*`)

### Public (no login, cached 10 s)

- `GET /public/board` → `PublicBoard | null` (null before the competition):
  `{ editionId, stage, candidates: PublicCandidate[], totals: { freeVotes, paidVotes }, builtAt }`.
  Candidates are sorted for the stage: by seat in week 1, by free votes in week 2, by paid votes in
  week 3, by rank once the TOP 3 is set.
- `GET /public/candidates/:id` → `PublicCandidate`.
- `PublicCandidate` = `{ _id, seatNumber, sbcId, status, statusLabel, profile: { name, photoFileId,
  country, city, activity, category, projectName, projectDescription, presentation, link }, video:
  Submission | null, project: Submission | null, votes: { free, paid }, rank }`.
  - No member id.
  - `video` and `project` are only the accepted versions.
  - A suspended candidate shows their previous status.
- `GET /public/current` now also has:
  - `stage`;
  - `rounds: { FREE, PAID }`, each `{ status, opensAt, closesAt, openedAt, closedAt } | null`;
  - `settings.freeVote`, `paidSelfVote`, `balancePayment` and `settlementGraceMin`.

`Submission` = `{ _id, candidateId, kind: 'VIDEO'|'PROJECT', version, status:
'PENDING'|'ACCEPTED'|'REJECTED'|'RESUBMIT_REQUESTED', video?: { videoFileId, caption? }, project?: {
problem, solution, howItWorks, targetCustomers, businessModel, expectedImpact, fundingUse, outlook,
videoFileId? }, review: { reason, at } | null, publishedAt, externalUrl, createdAt, updatedAt }`.

### Member (signed in)

| Route | Body | Answer |
|---|---|---|
| `GET /me` | — | as Phase 1, plus `submissions: { VIDEO, PROJECT }` (each `Submission \| null`); the candidacy also carries `votes { free, paid, paidAmount }`, `rank` and `publishedAt` |
| `POST /me/submissions/video` | `{ videoFileId, caption? (≤ 500) }` | `Submission` |
| `POST /me/submissions/project` | `{ problem, solution, howItWorks, targetCustomers, businessModel, expectedImpact, fundingUse, outlook }` (20–2000 characters each) `+ videoFileId?` | `Submission` |
| `POST /free-votes` | `{ candidateId }` | `{ candidateId, at }` |
| `POST /vote-purchases` | `{ candidateId, packIndex, method: 'MOBILE_MONEY' \| 'BALANCE', idempotencyKey }` | `{ transaction: Purchase, sessionId: string \| null }` |
| `GET /me/votes` | — | `{ freeVote: { candidateId, at } \| null, purchases: Purchase[] }` |
| `GET /me/vote-purchases/:id` | — | `Purchase` |

- **`idempotencyKey`:** 8–100 characters from `[A-Za-z0-9_-]`, a NEW one per click. Resending the same
  key returns the same purchase.
- **`MOBILE_MONEY`:** open the payment page for `sessionId` the same way the app does for other payments.
- **`BALANCE`:** the answer is already final. `status: SUCCESS` with `counted: true` means it's done;
  `PENDING` means the outcome is not known yet (show "en cours de vérification", then check
  `/me/vote-purchases/:id`).
- **`Purchase`** = `{ _id, candidateId, votes, amount, method, status:
  'PENDING'|'SUCCESS'|'FAILED'|'CANCELLED'|'REFUNDED', counted, lateSettlement, paymentSessionId,
  refund: { reason, at } | null, createdAt, settledAt }`.
- **Submission rules:**
  - The video can be submitted by OFFICIAL and STAGE_2 candidates until the free round closes; the
    project by OFFICIAL, STAGE_2 and STAGE_3 candidates until the paid round closes.
  - A PENDING submission is replaced in place.
  - After RESUBMIT_REQUESTED, a new version is created.
  - ACCEPTED and REJECTED are final.
- **Error codes:**
  - Submissions: `NO_COMPETITION`, `NO_CANDIDACY`, `NOT_ALLOWED`, `SUBMISSIONS_CLOSED`,
    `ALREADY_ACCEPTED`, `SUBMISSION_REJECTED`, `INVALID_SUBMISSION` (with `details.field`), `STALE`.
  - Votes:
    - Refusals: `VOTE_CLOSED`, `CANDIDATE_NOT_VOTABLE`, `SELF_VOTE`, `ALREADY_VOTED`, `MEMBERS_ONLY`,
      `ACCOUNT_TOO_RECENT`, `ACCOUNT_UNAVAILABLE`, `IDEMPOTENCY_MISMATCH`.
    - Bad request: `BAD_PACK`, `BAD_METHOD`, `BALANCE_DISABLED`.
    - Balance: `INSUFFICIENT_BALANCE` (409).
    - Limits (429): `PURCHASE_LIMIT`, `TOO_MANY_REQUESTS`.
    - Retry later (503): `MEMBER_CHECK_UNAVAILABLE`.

### Administration (module `impactChallenge`)

| Route | Body | Answer |
|---|---|---|
| `POST /admin/editions/:id/launch-competition` | — | `Edition`. 409 `PROFILES_TO_REVIEW` (`details.candidates: [{ _id, name }]`), `NOT_ENOUGH_CANDIDATES`, `SUSPENDED_CANDIDATES` |
| `POST /admin/editions/:id/advance-stage` | — | `Edition` (WEEK1 → WEEK2 → WEEK3). 409 `ROUND_OPEN` |
| `PUT /admin/editions/:id/rounds/:key` (`FREE` or `PAID`) | `{ opensAt, closesAt }` | `Edition`. 409 `ROUND_STARTED`; 400 `INVALID_SCHEDULE` (`details.field` = `rounds.<KEY>.closesAt`) |
| `POST /admin/editions/:id/rounds/:key/open` | — | `Edition`. 409 `WRONG_STAGE`, `ROUND_NOT_SCHEDULED`, `ROUND_NOT_OPENABLE` |
| `POST /admin/editions/:id/rounds/:key/close` | `{ reason }` (≥ 5) | `Edition` |
| `GET /admin/editions/:id/top3` | — | `{ ranking: Row[], finalistsCount, tieAtCut, blockers: [{ code, message }], flaggedPurchases, decided }` |
| `POST /admin/editions/:id/top3` **(admin code)** | `{ expectedOrder: candidateId[] }` (the order the admin saw) | `{ edition, ranking }`. 409 `STALE`, `ALREADY_DECIDED`, or the code of the first blocker |
| `GET /admin/editions/:id/submissions` | query `kind`, `status` | `(Submission & { candidate: { name, projectName, photoFileId, seatNumber, status } })[]` (current versions; pending first) |
| `POST /admin/submissions/:id/review` | `{ decision: 'accept' \| 'reject' \| 'resubmit', reason (≥ 10 unless accept), updatedAt? }` | `Submission`. 409 `ALREADY_REVIEWED`, `STALE` |
| `PATCH /admin/submissions/:id` | `{ externalUrl }` (https, or `''` to remove) | `Submission`. 409 `NOT_PUBLISHED` |
| `GET /admin/editions/:id/free-votes` | query `candidateId`, `page`, `limit` | `{ items: [{ _id, candidateId, voterUserId, voterName, at }], total, page, limit }` |
| `GET /admin/editions/:id/purchases` | query `status`, `method`, `candidateId`, `flagged=1`, `page`, `limit` | `{ items: (Purchase & { userId, buyerName, flags, refundUncertain, providerStatus })[], total, page, limit, totals: { byStatus: { [status]: { count, amount, votes, countedVotes } }, revenue, countedVotes } }` |
| `POST /admin/purchases/:id/refund` **(admin code)** | `{ reason }` (≥ 10; the buyer reads it) | `Purchase & { refundCompleted }`. 409 `NOT_REFUNDABLE`, `REFUND_IN_PROGRESS`, `ALREADY_DECIDED` |
| `GET /admin/editions/:id/anomalies` | — | `{ freeVotes: { sharedNetworks, sharedDevices, bursts }, paidVotes: { topBuyers, flagged, uncertainRefunds } }` |
| `GET /admin/editions/:id/candidates.csv` | — | CSV of the official candidates (flyers, Facebook posts) |

**Admin code:** a route marked "admin code" answers 403 `ADMIN_CODE_REQUIRED` without it. The admin
app's `apiClient` interceptor asks for it and sends the request again. One code is valid for 10 minutes.

**Admin answers:**
- `Row` = `{ candidateId, name, projectName, seatNumber, status, paidVotes, paidAmount, freeVotes,
  lastPaidAt, rank, finalist }`.
- The admin `Edition` now carries `stage`, `stageHistory`, `competitionStartedAt`,
  `rounds { FREE, PAID }` and `top3 { decidedAt, by, ranking }`.
- Admin candidate items add `votes`, `rank` and `publishedAt`.

## Notifications

Candidates (push + e-mail, opening `/impact-challenge/candidat`):
- **Competition and stages:** `impact-competition-started`, `impact-video-requested`,
  `impact-project-requested`, `impact-votes-open`, `impact-votes-closed`.
- **Submissions:** `impact-{video|project}-{accepted|rejected|resubmit}`.
- **Result:** `impact-finalist`, `impact-not-finalist`.

Buyers (push only, since e-mail is the mail server's scarcest resource):
- `impact-votes-bought` opens `/impact-challenge/candidats`.
- `impact-votes-refunded` opens `/wallet`.

## Checks

event-service `src/scripts/check-impact-phase2.ts` has 71 checks (real Mongo; user-, payment- and
notification-service stubbed with the same exactly-once-per-reference behaviour). It covers:
- launch, publication, submissions and versions;
- free-vote rules and 10 simultaneous votes;
- Mobile Money (10 duplicate confirmations, wrong amount, late success, lost callback);
- balance payments (insufficient, unknown outcome retried once);
- admin refund, grace period, late refund;
- TOP 3 (recount, tie, stale order, freeze);
- CSV.
