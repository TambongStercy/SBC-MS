# SBC Impact Challenge v2 — Phase 1 (editions, candidates, qualification)

Spec: « SBC Impact Challenge — Cahier des charges fonctionnel » v1.0, with Rufus's answers of
2026-11-23. Phase 1 covers spec §3 (qualification), §4 (candidate space), part of §15
(administration: editions, candidates), §16 (qualification notifications), §18 (published,
locked rules) and §19 (settings). Later phases (stages, votes, final, tombola, SBC Impact
showcase) reuse the event-service Animation engine.

The old monthly Impact Challenge (tombola-service, `/api/challenges`) is untouched and keeps
running until v2 replaces it.

## Rules decided by Rufus (2026-11-23)

| Point | Decision |
|---|---|
| Valid invitation | A **level-1 filleul who paid their pack** (first CLASSIQUE/CIBLE subscription) during the qualification window. A pack the candidate paid from the activation balance **counts**. |
| TOP 3 | Week-3 paid votes only (Phase 2). |
| Final score | Paid votes 50 %, final public vote 30 %, jury 20 % (Phase 3). |
| Vote money | All to SBC; SBC shares it as it decides (no automatic payout). |
| Tombola | 1 paid vote = 1 ticket. A member's tickets weigh 1 (tickets 1–10), ½ (11–50), ¼ (51+). 3 prizes (cash, computer, phone) editable by the admin; nobody wins the same prize category twice within 365 days (Phase 4). |
| Legal check of the paid tombola | None: launched as is (Rufus). |

## How qualification works

- **Counting** (user-service `services/impact-invitations.service.ts`): a candidate's valid
  invitations = level-1, non-archived referrals whose **first live** CLASSIQUE/CIBLE
  subscription was created inside `[qualificationOpensAt, qualificationClosesAt]`, the filleul
  not blocked, banned or deleted. A member who joined before the window and upgrades during it
  does not count; a reversed (cancelled) activation does not count. `reachedAt` = creation time
  of the N-th such subscription: **the order of arrival is the order of the payments**, not of
  our detection. `pending` = filleuls who signed up in the window and have not paid.
- **Polling** (event-service `modules/impact/jobs.ts`, every `IMPACT_TICK_MS` = 10 s, leader lock
  `impact-leader`): asks user-service only for candidates whose filleuls paid since the last
  pass (`changedSince`, by subscription `_id`, which is indexed), recounts everyone every 30 min
  (catches reversals), and a member can ask for a recount from their space (once per 20 s).
- **Seats** are handed out only by the job (single writer): first the waiting list by rank (a
  seat freed by a withdrawal or disqualification), then candidates who reached the count,
  oldest `reachedAt` first. Seat and waiting-list numbers are arrival-order counters, never
  reused, unique in the database.
- **Seats full** → no new profiles (`registrationClosedReason: seats_full`); candidates still
  counting can enter the waiting list (`waitlistSize`, default 5; our addition to §3.3).
  **Seats and waiting list full**, or **the closing date passed**, or **the admin closed it** →
  `QUALIFICATION_CLOSED`, and everyone who never reached the count becomes `NOT_SELECTED`.
- A suspended candidate keeps their seat; a disqualified or withdrawn one frees it.

## Statuses

Edition: `DRAFT` → `QUALIFICATION` → `QUALIFICATION_CLOSED` → (`COMPETITION` → `FINAL` →
`FINISHED`, later phases); `CANCELLED` from any non-final state.

Candidate (spec §4 + qualification outcomes):

| Status | Label (`statusLabel`) |
|---|---|
| `QUALIFYING` | En qualification |
| `WAITLIST` | Qualification débloquée — liste d’attente |
| `OFFICIAL` | Candidat officiel |
| `STAGE_2`, `STAGE_3`, `FINALIST`, `WINNER`, `ELIMINATED`, `FINISHED` | later phases |
| `NOT_SELECTED` | Inscriptions fermées |
| `SUSPENDED` | Suspendu (`suspendedFrom` = status to return to) |
| `DISQUALIFIED` | Disqualifié |
| `WITHDRAWN` | Retiré |

Profile review (`review.status`): `PENDING` → `APPROVED` (« Candidature validée ») or
`CHANGES_REQUESTED` (with `reason`). A member's edit of a reviewed profile puts it back to
`PENDING`.

## Locks (spec §12, §18)

| When | Locked |
|---|---|
| Qualification opens | `rulesText`, qualification dates, `maxCandidates`, `invitationsRequired`, `waitlistSize`, `categories`, `profileFields` |
| Competition starts | `finalistsCount`, `votePrice`, `votePacks`, `weights`, `juryCriteria`, `ticketTiers`, `prizeCooldownDays`, `showcaseMonths`, `competitionStartsAt` |
| Never (Rufus) | `prizes` (lock at the draw, Phase 4), `name`, `description` |

A locked change answers `409 RULES_LOCKED` with `details.fields` (e.g. `["settings.maxCandidates"]`).

## API (gateway `/api/tickets/impact/*` → event-service)

Responses are `{ success: true, data }` or `{ success: false, message, code?, details? }`.
Messages are French and can be shown as they are.

### Public (no login)

`GET /api/tickets/impact/public/current` → `PublicEdition | null` (cached 15 s):

```ts
interface PublicEdition {
  _id: string; name: string; slug: string; description: string; rulesText: string;
  status: 'QUALIFICATION' | 'QUALIFICATION_CLOSED' | 'COMPETITION' | 'FINAL';
  schedule: { qualificationOpensAt: string; qualificationClosesAt: string; competitionStartsAt?: string; finalAt?: string };
  registrationOpen: boolean;
  registrationClosedReason: 'seats_full' | 'date' | 'admin' | 'full' | null;
  seats: { taken: number; max: number };
  settings: {
    maxCandidates: number; invitationsRequired: number; waitlistSize: number; finalistsCount: number;
    votePrice: number; votePacks: { votes: number; price: number }[];
    weights: { paidVotes: number; publicVote: number; jury: number };
    juryCriteria: { key: string; label: string; max: number }[];
    ticketTiers: { upTo: number | null; weight: number }[];
    prizes: { key: string; label: string }[];
    prizeCooldownDays: number; showcaseMonths: number;
    categories: string[];
    profileFields: { key: string; label: string; required: boolean; maxLength: number }[];
  };
}
```

### Member (signed in)

| Route | Body | Answer |
|---|---|---|
| `GET /me` | — | `{ edition: PublicEdition \| null, candidacy: Candidate \| null, canApply: boolean, blocker: { code, message } \| null, canEdit: boolean, canWithdraw: boolean }` (`canEdit`/`canWithdraw` = the server's own rule: status QUALIFYING, WAITLIST or OFFICIAL and the edition not yet in competition) |
| `POST /me/candidacy` | `ProfileInput & { consent: true }` | `Candidate` (5/min) |
| `PATCH /me/candidacy` | any `ProfileInput` fields | `Candidate` (20/min) |
| `POST /me/candidacy/refresh` | — | `Candidate` (1 per 20 s, else 429) |
| `POST /me/candidacy/withdraw` | — | `Candidate` |

```ts
interface ProfileInput {
  name: string;               // 2–80
  photoFileId: string;        // `data.fileId` of POST /api/settings/files/upload
  country: string;            // 2–60
  city: string;               // 2–80
  activity: string;           // 2–120, activité professionnelle
  category: string;           // one of settings.categories (free text if the list is empty)
  projectName: string;        // 2–120
  projectDescription: string; // 20–1500
  presentation: string;       // 50–4000, présentation du projet
  link?: string;              // http(s) URL, ≤ 300 (activité ou SBC Shop)
  extra?: Record<string, string>; // answers to settings.profileFields, by key
}

interface Candidate {
  _id: string; editionId: string; userId: string;
  sbcId: string | null;                         // the member's referral code
  profile: ProfileInput & { extra: Record<string, string> };
  status: CandidateStatus; statusLabel: string; suspendedFrom: CandidateStatus | null;
  invitations: { valid: number; pending: number; required: number; reachedAt: string | null; checkedAt: string | null };
  seatNumber: number | null; seatAt: string | null; waitlistRank: number | null;
  review: { status: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED'; reason?: string; at?: string };
  profileUpdatedAt: string;
  statusHistory: { from: string; to: string; at: string; reason?: string }[];
  createdAt: string; updatedAt: string;
}
```

Member error codes: `NO_EDITION`, `NOT_OPEN_YET`, `REGISTRATION_CLOSED`, `CONSENT_REQUIRED`,
`NOT_A_MEMBER` (no active pack), `ACCOUNT_UNAVAILABLE`, `ALREADY_CANDIDATE`, `INVALID_PROFILE`
(`details.field` = the `ProfileInput` key, `extra.<key>` for an extra question), `PROFILE_LOCKED`,
`NO_CANDIDACY`, `TOO_LATE`, `BAD_STATUS`, `MEMBER_CHECK_UNAVAILABLE`/`COUNTER_UNAVAILABLE` (503,
retry), `TOO_MANY_REQUESTS` (429, `details.retryAfterSeconds`). Server messages say « vous ».

### Administration (gateway module `impactChallenge`; GET = read, the rest = write)

| Route | Body | Answer |
|---|---|---|
| `GET /admin/editions` | — | `Edition[]` (newest first, 100) |
| `POST /admin/editions` | `{ name, description?, rulesText?, schedule: { qualificationOpensAt, qualificationClosesAt, competitionStartsAt?, finalAt? }, settings? }` | `Edition` (`DRAFT`; missing settings take the defaults) |
| `GET /admin/editions/:id` | — | `Edition` |
| `PATCH /admin/editions/:id` | any of `name, description, rulesText, schedule.*, settings.*` (settings are merged, then validated whole) | `Edition`, or 409 `RULES_LOCKED` |
| `POST /admin/editions/:id/open-qualification` | — | `Edition` (needs `rulesText` ≥ 200 chars; one live edition at a time) |
| `POST /admin/editions/:id/close-qualification` | `{ reason }` (≥ 5) | `Edition` (the window ends now; the job closes within ~10 s) |
| `POST /admin/editions/:id/cancel` | `{ reason }` (≥ 10) | `Edition` |
| `POST /admin/editions/:id/recount` | — | `{ updated }` |
| `GET /admin/editions/:id/candidates` | query `status`, `review`, `q`, `page`, `limit` (≤ 100) | `{ items: (Candidate & { belowRequirement: boolean })[], total, page, limit, byStatus: Record<status, n>, seats: { taken, max } }` (seats first, then waiting list, then by progress) |
| `POST /admin/editions/:id/candidates` | `ProfileInput & { userId, consent: true }` | `Candidate` (qualification only; the member still needs the invitations) |
| `GET /admin/editions/:id/audit` | query `limit`, `before` | `AuditEntry[]` |
| `GET /admin/candidates/:id` | — | `{ candidate, edition: { _id, name, status }, audit: AuditEntry[] }` |
| `PATCH /admin/candidates/:id` | `{ profile: Partial<ProfileInput>, reason, profileUpdatedAt? }` | `Candidate` |
| `POST /admin/candidates/:id/review` | `{ decision: 'approve' \| 'changes', reason? (≥ 10 for changes), profileUpdatedAt? }` | `Candidate` (409 `STALE` if the profile changed since `profileUpdatedAt`) |
| `POST /admin/candidates/:id/suspend` | `{ reason }` (≥ 10) | `Candidate` |
| `POST /admin/candidates/:id/reinstate` | `{ reason }` (≥ 5) | `Candidate` |
| `POST /admin/candidates/:id/disqualify` | `{ reason }` (≥ 10) | `Candidate` (final; a freed seat goes to the waiting list) |

`belowRequirement`: a seat holder whose count fell back below the requirement (a filleul's
activation was reversed after the seat was given). The seat is kept; the admin decides.

`Edition` (admin) = the stored document: `_id, name, slug, description, rulesText, status,
statusHistory[], schedule, settings` (full, incl. prize `category`), `registrationClosedAt?,
registrationClosedReason?, seatSeq, waitlistSeq, cancellation?, createdAt, updatedAt`.

`AuditEntry` = `{ _id, editionId?, candidateId?, actorUserId, actorRole: 'admin'|'member'|'system',
action, before?, after?, reason?, at }`.

## Notifications (push + e-mail, opening `/impact-challenge/candidat`)

`impact-unlocked` (spec text « Félicitations ! Tu as atteint les 10 invitations requises… » + seat
n°), `impact-waitlisted`, `impact-promoted`, `impact-seats-full`, `impact-not-selected`,
`impact-profile-approved` (« Candidature validée »), `impact-profile-changes`, `impact-suspended`,
`impact-reinstated`, `impact-disqualified`. Only candidates receive them, so e-mail fits the mail
server's budget.

## Scale

- The public summary is cached 15 s in the process and `Cache-Control: public, max-age=15`.
- The poll touches only candidates whose filleuls just paid; the subscription lookup is by `_id`
  range (indexed), never by `createdAt` (not indexed).
- user-service answers at most 200 referrers per call; event-service batches.

## Checks

- user-service `src/scripts/check-impact-invitations.ts` (13 checks, local Mongo).
- event-service `src/scripts/check-impact.ts` (57 checks, local Mongo, user-service and
  notifications stubbed).
- gateway `src/scripts/check-admin-permissions.ts` (impact admin paths → `impactChallenge`).
