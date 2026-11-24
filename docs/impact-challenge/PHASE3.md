# SBC Impact Challenge v2 — Phase 3 (live final, jury, result)

Spec §10–§12, and the jury parts of §15 and §17. Builds on Phases 1–2 (`PHASE1.md`, `PHASE2.md`).
Code: event-service `modules/impact/services/final.service.ts`, plus the FINAL round in
`stage.service` and the final vote in `vote.service`. user-service only gains the authenticator
action `impact_jury`.

## The flow

| Step | Edition | What happens |
|---|---|---|
| TOP 3 decided (Phase 2) | `FINAL` / stage `TOP3` | The admin builds the jury: SBC accounts, never a finalist, at most 15. |
| « Démarrer la finale » | `FINAL` / `LIVE` | Needs at least one juror. Jurors can score. The FINAL round (final public vote) can open. The admin says who is on stage. |
| « Verrouiller les notes » | `jury.lockedAt` | Every active juror must have marked every finalist. After this, no score or jury change. |
| Close the final vote | `rounds.FINAL` `CLOSED` | Same round controls as weeks 2–3 (`/rounds/FINAL`). It opens only during `LIVE`. |
| « Publier le résultat » (admin code) | `FINISHED` / stage `RESULT` | Winner → `WINNER`. The other finalists stay `FINALIST`, with their final `rank`. |

After the result, the finished edition stays the « current » one for 60 days (`/public/current`,
`/me`, the board), so the result does not vanish when the winner is announced.

## Rules

- **Jurors:** SBC accounts added by the admin. `GET /admin/members/lookup?contact=` finds one by e-mail
  or phone; it returns the name and a masked contact hint.
  - A juror who is removed then added again gets their row back, and their earlier marks count again.
  - The lock needs a mark from every active juror on every finalist (Rufus, 2026-11-24). A juror who
    cannot score (no authenticator app, absent) must be removed first. The admin page lists who has
    not marked whom before the lock.
  - A removed juror keeps their row, but their marks no longer count.
  - Every juror is told by push and e-mail; the notice opens `/impact-challenge/jury`.
- **Scoring:**
  - One mark per criterion of `settings.juryCriteria`, from 0 to the criterion's `max`, by half points.
    `total` = the sum.
  - One score per juror and finalist. A correction keeps every earlier version in `history`.
  - Scoring is only possible while `LIVE` and before the lock.
- **Personal, secured access (§11, §17):**
  - The first save asks for the juror's authenticator-app code (`authCode`), checked by user-service;
    it then holds for 30 minutes.
  - A juror without the app gets 403 `AUTHENTICATOR_REQUIRED`, with a message telling them to set it
    up in Profil → Sécurité.
- **Final public vote:** free, 1 account = 1 vote for the edition, for a FINALIST.
  - The eligibility rules are the week-2 ones (`settings.freeVote`): members only, accounts older than
    the FINAL round's opening, no self-vote by default.
  - The counts stay hidden until the result, so there is no snowball during the live.
- **Result:** each part is put on 0–100, the best finalist of that part getting 100 and the others in
  proportion:
  - paid votes = the week-3 paid votes frozen with the TOP 3;
  - public vote = the final public votes;
  - jury = the average of the active jurors' totals.

  Score = (w_paid × paid + w_public × public + w_jury × jury) / 100, with the edition's weights (Rufus:
  50/30/20). Ties go to the jury part, then the paid votes, then the TOP 3 rank. The formula text is in
  `formula` and must be shown with the result.
- **Publishing** needs the admin's code and `expectedOrder` (the order the admin read); a result that
  changed since gives 409 `STALE`.

## API (gateway `/api/tickets/impact/*`)

### Public

`GET /public/final` (cached 5 s) → `null`, or:

```ts
{
  editionId, name, status, stage,                 // stage TOP3 | LIVE | RESULT
  onStageCandidateId: string | null, phase: 'PRESENTATION' | 'QUESTIONS' | 'SCORING' | null,
  finalVote: { status, opensAt, closesAt } | null,
  weights: { paidVotes, publicVote, jury }, juryCriteria: [{ key, label, max }], formula: string,
  freeVote: { membersOnly, accountsOlderThanRound, selfVote },   // the final vote follows these rules
  finalists: [{ _id, top3Rank, status, profile: { name, photoFileId, city, country, activity, projectName, projectDescription }, video: Submission | null, project: Submission | null }],
  result: null | {
    publishedAt, winnerCandidateId, weights,
    rows: [{ candidateId, name, projectName, paidVotes, finalVotes, juryAverage, juryMax, jurorsCount,
             components: { paidVotes, publicVote, jury },   // each 0–100
             score, rank }],
  },
}
```

### Member

| Route | Body | Answer |
|---|---|---|
| `POST /final-votes` | `{ candidateId }` | `{ candidateId, at }`. Same refusal codes as `/free-votes` |
| `GET /me/votes` | — | now also `finalVote: { candidateId, candidateName, at } \| null` and `canFinalVote: { ok, code?, message? } \| null` (null while the FINAL round is not open) |
| `GET /jury/me` | — | `JuryEdition[]` (empty if the member is no juror) |
| `PUT /jury/editions/:id/candidates/:cid/score` | `{ scores: { [criterionKey]: number }, comment? (≤ 1000), authCode? }` | `{ candidateId, scores, total, comment, updatedAt, edits }` |

- **`JuryEdition`:**
  - `edition { _id, name, status, stage }`, `canScore` (LIVE and not locked), `lockedAt`,
    `codeWindowOpen` (no code needed right now);
  - `criteria`, `maxTotal`, `onStageCandidateId`;
  - `finalists: [{ _id, rank, profile, project, video, myScore: { scores, total, comment, updatedAt, edits } | null }]`.
- **Score error codes:** `AUTH_CODE_REQUIRED` (403: ask for the code), `AUTH_CODE_INVALID` (400),
  `AUTHENTICATOR_REQUIRED` (403: set up the app), 429 (too many wrong codes), `INVALID_SCORE`
  (`details.field` = `scores.<key>`), `JURY_LOCKED`, `NOT_A_JUROR`, `NOT_A_FINALIST`, `WRONG_STAGE`,
  `STALE`.

### Administration (module `impactChallenge`)

| Route | Body | Answer |
|---|---|---|
| `GET /admin/members/lookup?contact=` | — | `{ found, ambiguous?, userId?, name?, avatar?, contactHint? }` (the contact hint is masked, the name is not) |
| `GET /admin/editions/:id/jury` | — | `{ lockedAt, criteria, maxTotal, finalists: [{ _id, name }], jurors: [{ _id, userId, name, addedAt, removedAt, scored, scores: [{ candidateId, total, updatedAt, edits }] }] }` |
| `GET /admin/editions/:id/jury/scores` | — | `[{ candidateId, jurorUserId, jurorName, jurorRemoved, scores, total, comment, updatedAt, history }]` (every mark and its history) |
| `POST /admin/editions/:id/jury` | `{ userId }` | the juror. 409 `CONFLICT_OF_INTEREST`, `ALREADY_JUROR`, `TOO_MANY_JURORS`, `JURY_LOCKED`, `WRONG_STAGE` |
| `POST /admin/editions/:id/jury/:jurorId/remove` | `{ reason }` (≥ 5) | the juror. 409 `JURY_LOCKED` |
| `POST /admin/editions/:id/final/start` | — | `Edition`. 409 `NO_JURY`, `WRONG_STAGE` |
| `POST /admin/editions/:id/final/on-stage` | `{ candidateId \| null, phase? }` | `Edition`. 409 `NOT_A_FINALIST` |
| `POST /admin/editions/:id/jury/lock` | — | `Edition`. 409 `MISSING_SCORES` (`details.missing: [{ candidateId, name, scoredBy, notScoredBy: [names] }]`), `JURY_LOCKED` |
| `PUT/POST /admin/editions/:id/rounds/FINAL[/open\|/close]` | as Phase 2 | the final public vote round; it opens only in stage LIVE |
| `GET /admin/editions/:id/result` | — | before publication: `{ published: false, weights, rows, missing, blockers, warnings, formula }` (a `MISSING_SCORES` blocker carries `details: { missing }`, the same shape as the lock's refusal). After: `{ published: true, result, formula }` |
| `POST /admin/editions/:id/result` **(admin code)** | `{ expectedOrder: candidateId[] }` | `Edition`. 409 `STALE`, `ALREADY_PUBLISHED`, or a blocker code (`JURY_NOT_LOCKED`, `ROUND_OPEN`, `MISSING_SCORES`, `WRONG_STAGE`) |

The admin `Edition` now carries `jury { lockedAt, lockedBy }`, `live { onStageCandidateId, phase,
startedAt, updatedAt }` and `result { publishedAt, by, weights, rows, winnerCandidateId }`.

## Notes for the apps

- `/public/current` `rounds` now also has `FINAL`.
- **`rank` on a candidate:** before the result it is the TOP 3 rank (`JuryEdition.finalists[].rank` is
  that one too); after the result the finalists carry their final rank. The frozen TOP 3 order stays in
  `edition.top3`.
- **Jury figures:** `juryAverage` is out of `juryMax` (the sum of the criteria maxima);
  `components.jury` is out of 100.
- **Too many wrong codes:** a juror gets the authenticator lock as a plain 429 with user-service's
  message (no `code`, no wait time).

## Notifications

- `impact-jury-invited` (juror) opens `/impact-challenge/jury`.
- `impact-final-started` (finalists).
- `impact-winner` and `impact-final-result` (finalists) open `/impact-challenge/finale`.
- The FINAL round reuses `impact-votes-open` / `impact-votes-closed`.

## Checks

event-service `src/scripts/check-impact-final.ts`: 42 checks. They cover:
- the jury rules and the authenticator code window;
- score bounds and history;
- removed jurors not counting;
- the final vote rules;
- the lock;
- the result computed against hand-worked numbers (A 79.76, B 75, C 24.12);
- STALE and publication once;
- the finished edition staying current.

The Phase 1 and 2 checks still pass.
