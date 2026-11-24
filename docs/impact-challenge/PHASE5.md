# SBC Impact Challenge v2 — Phase 5 (« SBC Impact » showcase)

Spec §14: after the final, the finalists stay visible in a « SBC Impact » space for at least 12
months, with their profile, project, result, video, a podcast, a YouTube link, their SBC Shop or
website, and news of the project. Code: event-service
`modules/impact/services/showcase.service.ts`, models `ImpactShowcase` and `ImpactShowcaseUpdate`.

## How it works

- **The pages** are created when the final's result is published, one per finalist (winner included).
  - They hold a snapshot of the profile and the result (rank, score, « Gagnant »), the presentation
    video (the accepted week-2 video, else the project's) and the shop link from the profile.
  - For an edition whose result came before this phase, the admin creates them with
    `POST /admin/editions/:id/showcase/create`. It is idempotent.
- **Visible** from the result for `settings.showcaseMonths` (12). The admin can extend the end date,
  never shorten it under the minimum. Past the end date a page moves to the archive; nothing is
  deleted.
- **Admin links:** podcast (`{ url, title?, platform? }`, https), YouTube (https on youtube.com or
  youtu.be), shop or website (https).
- **Hiding:** the admin can hide a page with a reason (≥ 10); it then appears nowhere publicly. `archived` means past the end date only; a hidden page has `hidden: true` (admin answers).
- **News (§14.3), kinds `STEP | PRODUCT | ACHIEVEMENT | NEWS | RESULT`:**
  - The admin publishes at once.
  - A finalist proposes from their space (at most 5 pending), and the admin approves, or rejects with
    a reason the finalist reads (≥ 10).
  - The admin can remove a published one (reason ≥ 5).
  - Title 3–120 characters, text 20–3000, optional image (`fileId`) and https link.
  - No news on an archived page.

## API (gateway `/api/tickets/impact/*`)

### Public (cached 60 s)

- `GET /public/showcase` → `{ active: Card[], archived: Card[] }`, winner first, newest edition first.
- `GET /public/showcase/:id` → `Page`: a `Card` plus `updates: Update[]`, the published news, newest
  first.
- **`Card`** = `{ _id, editionId, candidateId, profile: { name, photoFileId, activity, category, country, city, presentation, projectName, projectDescription, sbcId }, result: { rank, score, winner, editionName, decidedAt }, videoFileId, podcast: { url, title, platform } | null, youtubeUrl, shopUrl, visibleFrom, visibleUntil, archived, updates (count), lastUpdateAt }`.
- **`Update`** = `{ _id, kind, title, body, imageFileId, link, publishedAt, byFinalist }`.
- No member id anywhere.

### Finalist (signed in)

| Route | Body | Answer |
|---|---|---|
| `GET /me/showcase` | — | the member's pages, each with `hidden` and every news they proposed, with `status` (`PENDING`/`PUBLISHED`/`REJECTED`) and `review.reason` |
| `POST /me/showcase/:id/updates` | `{ kind?, title, body, imageFileId?, link? }` | the news (`PENDING`). 409 `ARCHIVED`, `TOO_MANY_PENDING`; 400 `INVALID_UPDATE` (`details.field`) |

### Administration (module `impactChallenge`)

| Route | Body | Answer |
|---|---|---|
| `GET /admin/showcase?editionId=` | — | pages with `userId`, `hiddenAt`, `hiddenReason`, `pendingUpdates` |
| `GET /admin/showcase/:id` | — | a page with every news (status, author, review), `hidden` and `minVisibleUntil` (the earliest end date allowed) |
| `PATCH /admin/showcase/:id` | `{ podcast?: { url, title?, platform? } \| null, youtubeUrl?, shopUrl?, visibleUntil?, hidden?, hiddenReason? }` (`''`/`null` removes a link) | the page. 400 `INVALID_URL`, `TOO_EARLY`, `REASON_REQUIRED` |
| `POST /admin/showcase/:id/updates` | as the finalist's | the news, published at once. 409 `HIDDEN`, `ARCHIVED` |
| `GET /admin/showcase/updates/pending` | — | finalists' pending news, oldest first, with the finalist's name and project |
| `POST /admin/showcase/updates/:uid/review` | `{ decision: 'approve' \| 'reject' \| 'remove', reason? }` | the news. 409 `ALREADY_REVIEWED` |
| `POST /admin/editions/:id/showcase/create` | — | `{ created }`. 409 `NO_RESULT` |

## Notifications

- `impact-showcase-live` (page online) opens `/impact`.
- `impact-showcase-update-published` opens `/impact`.
- `impact-showcase-update-rejected` opens `/impact` (the finalist's « Ma page SBC Impact » is there).

## Checks

event-service `src/scripts/check-impact-showcase.ts`: 32 checks. They cover:
- the pages created at the result (idempotent), the snapshot and the 12-month window;
- the archive and the public view without member ids;
- link validation, the minimum duration, hiding;
- news: admin publishing, the finalist's proposal and review, removal, bounds, archived pages.

Phase 3's check still passes with the pages created at publication.
