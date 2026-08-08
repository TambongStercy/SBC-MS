# SBC Ads Network — implementation plan and handover

Companion to `ADVERTISING-FEATURE-SPEC.md`, which holds the business rules. This
one holds **where the work stands and what to do next**. Read the spec first.

Program name, as Rufus set it: **SBC Ads Network**. In UI text the roles are
**annonceur** and **diffuseur** — never "advertiser". Internally the code stays
English (`advertiserUserId` etc.), agreed with Sterling.

---

## 1. Where things stand

### Done — backend, on `feature/advertising-service` (SBC-MS PR #104)

| Area | State |
|---|---|
| `advertising-service` on 3010 / preprod 6010 | complete |
| Campaigns, quotes, landing pages, tracking links, click events | complete |
| Allocation: targeting, first-to-accept, progressive top-up, 1/day cap | complete |
| WhatsApp verification: QR sessions, capped at 8, media dHash | complete |
| Scheduler: reminders, forfeits, reallocation, suspensions, payouts | complete |
| `advertisingBalance` in user-service + transfer-to-main | complete |
| Payout engine | complete |
| Ranking, trust score, test campaign, leaderboard | complete |
| Referral commission (20% of margin) | complete |

Assertion suites, run from `advertising-service/`:

```
npx ts-node src/scripts/check-day-gap.ts              16 checks, no DB
npx ts-node src/scripts/check-media-hash.ts            8 checks, no DB
npx ts-node src/scripts/check-payout.ts               12 checks, needs Mongo
npx ts-node src/scripts/check-referral-commission.ts  13 checks, needs Mongo
npx ts-node src/scripts/verify-extraction.ts          manual, needs a QR scan
```

### Not started

1. **Campaign moderation gate** — backend, blocks everything else
2. **Admin panel** — `admin-frontend-ms` (React/Vite, in SBC-MS repo)
3. **User-facing app** — `SBC-WEB-UI` (React/Vite, repo `Bahanack-GY/SBC-WEB-UI`, branch `develop`)

---

## 2. Step 1 — campaign moderation gate

**Why:** an annonceur's creative goes onto thousands of people's personal WhatsApp
statuses. Rufus: *« On ne peut pas juste laisser n'importe qui poster n'importe
quoi sur le statut privé de quelqu'un. »* Unreviewed content here is the kind of
thing that ends a product.

**Current flow:** `DRAFT → ACTIVE` on payment, via `activateCampaign`.

**Required flow:**

```
DRAFT ──submit──> PENDING_REVIEW ──admin approves──> APPROVED ──payment──> ACTIVE
                        │
                        └──admin rejects──> REJECTED (annonceur edits, resubmits)
```

### Work

- Add `PENDING_REVIEW`, `APPROVED`, `REJECTED` to `CampaignStatus`
  (`src/database/models/campaign.model.ts`)
- Add `reviewedBy`, `reviewedAt`, `rejectionReason` to the campaign
- `activateCampaign` (`src/api/controllers/internal.controller.ts`) must **refuse
  anything not `APPROVED`**. Payment must never be able to skip review — that is
  the whole guard.
- New admin endpoints: list pending, approve, reject with reason
- Notify the annonceur on approve and reject; rejection must carry the reason or
  they cannot fix it
- **First campaign per annonceur should be reviewed more carefully** — consider a
  flag once an annonceur has an approved history

### Test

Extend `check-payout.ts` style: assert `activateCampaign` refuses `DRAFT`,
`PENDING_REVIEW` and `REJECTED`, and accepts only `APPROVED`.

---

## 3. Step 2 — admin panel (`admin-frontend-ms`)

Follow the existing conventions in that app. **No `alert()`, `confirm()` or
`prompt()`** — use `useToast` and `ConfirmationModal` (see CLAUDE.md).

### Pages

**`/ads-network` — dashboard**

Analytics Rufus asked for:
- new annonceurs this month, new diffuseurs this month
- successful campaigns this month
- total annonceurs, total diffuseurs
- views delivered, clicks generated, revenue, amount paid to diffuseurs
- graphs over time (the app already uses Recharts)

**`/ads-network/review` — moderation queue**

The one that blocks launch. Shows pending campaigns with creative preview,
caption, targeting and annonceur identity. Approve, or reject with a reason.

**`/ads-network/campaigns` — all campaigns**

Filter by status. Drill into per-diffuseur performance
(`GET /campaigns/:id/performance` already returns it).

**`/ads-network/diffuseurs` — leaderboard**

Backed by `GET /campaigns/leaderboard`. Shows measured vs declared averages,
click-through rate, trust score, campaigns completed.

**`/ads-network/test-campaign` — Rufus's own editor**

He configures the test campaign creative, its caption, and the **video shown on
the landing page** with the « Je m'inscris » button. Needs upload via
settings-service, same as other media in the app.

### Backend needed

Admin endpoints do not exist yet. Add an `admin.routes.ts` in advertising-service
guarded by the admin role, exposing the aggregates above. Do **not** compute
analytics in the frontend.

---

## 4. Step 3 — user app (`SBC-WEB-UI`)

Separate repo: `/Users/mac/Projects/Customer/SBC-WEB-UI`, branch `develop`.
React 18 + Vite + Tailwind + react-query + i18next. API layer is
`src/services/SBCApiService.ts`; follow it rather than calling axios directly.

**Research the dual-role UX before building** — Sterling asked for this
explicitly. Prior art: Uber driver/rider, Airbnb host/guest, Fiverr buyer/seller.
The common pattern is one account, an explicit role switcher, and separate
dashboards — not a merged view.

### Pages

**`/ads-network`** — program landing for signed-in users. Two cards: *Devenir
annonceur* / *Devenir diffuseur*, each with a short description. This is where
« Je m'inscris » sends an existing user.

**`/ads-network/annonceur/onboarding`** — explains the role, the dashboard, the
pricing (`6 000 F = 2 000 vues uniques + 4 000 vues répétées`, from
`GET /campaigns/quote`), and that **creatives are reviewed before going live**.

**`/ads-network/annonceur`** — dashboard: campaigns, progress, per-diffuseur
performance, create campaign, bank-or-wait on an unfilled campaign.

**`/ads-network/diffuseur/onboarding`** — explains the role, the 3-day commitment,
the 24h day-1 rule, how payment works. Ends by collecting
`declaredAverageViews` and enrolling, then **runs the test campaign** (unpaid —
its purpose is measuring their real average).

**`/ads-network/diffuseur`** — dashboard: current offers, active campaign with its
schedule, earnings, balance and transfer-to-main.

**Share flow** — the highest-risk screen:
- media preview and pre-filled caption from `POST /participations/:id/accept`
- **prominent warning not to edit the caption, above all the link.** Removing it
  means the day cannot be verified. This is the single most likely way a diffuseur
  loses earnings through no bad intent.
- Web Share API with `files` + `text`; download fallback for older browsers
- after sharing, call `POST /participations/:id/mark-posted`, and restate the
  warning plus the 24h verification deadline

**Verify flow** — QR polling:
- `POST /verification/participations/:id/start` → `sessionId`
- poll `GET /verification/sessions/:sessionId` for `state` then `qr`, then verdicts
- handle **503 + `Retry-After`** — that means all 8 verification slots are busy,
  and the UI should say so rather than showing a generic error

**Landing page** — `/a/:slug` and `/s/:trackingCode`, public, no auth. Fetches
campaign content from advertising-service. Action buttons must route through the
service's `/c/...` endpoints so clicks are tracked. « Je m'inscris » signs new
users up carrying the diffuseur's referral code, and sends existing users to
`/ads-network`.

### Role switching

Once a user holds a role, a button appears on the home page taking them straight
to that dashboard. Holding both shows both. Taking the second role means going
through its onboarding.

---

## 5. API surface

All under `/api/advertising` via the gateway (already proxied).

```
GET    /campaigns/quote?amount=6000
GET    /campaigns/leaderboard
POST   /campaigns
GET    /campaigns
GET    /campaigns/:id
GET    /campaigns/:id/performance
POST   /campaigns/:id/decide            { decision: 'bank' | 'wait' }

GET    /diffuseurs/eligibility
POST   /diffuseurs/enroll               { declaredAverageViews }
GET    /diffuseurs/me
GET    /diffuseurs/me/participations
POST   /diffuseurs/participations/:id/accept
POST   /diffuseurs/participations/:id/decline
POST   /diffuseurs/participations/:id/mark-posted

GET    /verification/capacity
POST   /verification/participations/:id/start
GET    /verification/sessions/:sessionId
DELETE /verification/sessions/:sessionId

POST   /internal/campaigns/:id/activate      service auth
POST   /internal/campaigns/:id/reallocate    service auth
```

Balance, in user-service under `/api/advertising-balance`:

```
GET  /                        balance + minimum transfer
POST /transfer                { amount }  advertising -> main
POST /internal/credit         service auth
```

---

## 6. Things that will bite

- **Gateway proxying.** Any new top-level `/api/x` prefix must be added to
  `gateway-service/src/server.ts` or it 404s **silently**. This has caused three
  separate incidents (PRs #60, #66, #67).
- **Views are read receipts.** Never `userReceipt.length` — that is delivery reach
  and roughly 4x higher. Getting this wrong overpays every diffuseur.
- **Advertising balance is never withdrawn directly** and is **never transferable
  between users** (BEAC). The only exit is transfer-to-main.
- **Annonceur money never comes back as cash.** Credit toward a future campaign or
  wait. Do not add a refund path.
- **Baileys is pinned to exactly `6.7.18`**, no caret. The patch filename carries
  the version, so a bump fails the install rather than silently skipping.
  `postinstall: patch-package` reapplies it.
- **WhatsApp creds never touch disk** (`in-memory-auth-state.ts`). Do not swap in a
  disk-backed store without encrypting at rest.
- **Payment-service does not call `activateCampaign` yet.** Nothing activates a
  campaign, so an annonceur cannot actually pay. Shortest path to a working demo.
- **Auto-posting is not just parked, it is unsafe as previously written.** The
  probe ignored the account's status privacy settings and published to contacts
  the user had blocked from their status, and deletions did not propagate. Anything
  reviving it must read and honour those settings first. Diffuseurs posting through
  their own WhatsApp client avoids the whole class of problem.
- **Concurrency cap of 8 is a guess.** Measure peak RSS of one verification on the
  real server and set `MAX_CONCURRENT_VERIFICATIONS` from that.

---

## 7. Still open with Rufus

1. **Test campaign video** — does not exist. Who produces it?
2. **Trust score numbers** — +5 / −15 / −10 from a base of 50 are ours, not his.
   Tune once there is real behaviour.
3. **Annonceur verification depth** — every campaign reviewed, or only the first
   from a new annonceur?

---

## 8. Suggested order

1. Moderation gate (backend, blocks the rest)
2. Admin review queue — Rufus cannot approve anything without it
3. Payment-service → `activateCampaign` wiring — makes a demo possible
4. Diffuseur flow in SBC-WEB-UI: onboarding, offers, share, verify
5. Annonceur flow: onboarding, create campaign, dashboard
6. Landing page + « Je m'inscris »
7. Admin analytics and test-campaign editor
8. Run `verify-extraction.ts` against a real account before preprod
