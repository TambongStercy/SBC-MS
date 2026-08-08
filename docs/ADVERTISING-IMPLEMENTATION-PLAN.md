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
| Campaign moderation: submit / approve / reject | complete |
| Annonceur payment + activation callback | complete |
| Admin analytics, performance and diffuseur endpoints | complete |
| Admin panel in `admin-frontend-ms` (4 pages) | complete |

Assertion suites, run from `advertising-service/`:

```
npx ts-node src/scripts/check-day-gap.ts              16 checks, no DB
npx ts-node src/scripts/check-media-hash.ts            8 checks, no DB
npx ts-node src/scripts/check-payout.ts               16 checks, needs Mongo
npx ts-node src/scripts/check-moderation.ts           30 checks, needs Mongo
npx ts-node src/scripts/check-analytics.ts            17 checks, needs Mongo
npx ts-node src/scripts/check-referral-commission.ts  13 checks, needs Mongo
npx ts-node src/scripts/verify-extraction.ts          manual, needs a QR scan
```

### Not started

1. **User-facing app** — `SBC-WEB-UI` (React/Vite, repo `Bahanack-GY/SBC-WEB-UI`,
   branch `develop`). Nothing exists yet; this is now the only thing between the
   backend and a working product.
2. **Test-campaign editor** — deliberately deferred, see §3 below. There is no
   "test campaign" entity in the backend: `hasCompletedTestCampaign` simply flips
   after a diffuseur's first completed campaign, whatever it was. Giving Rufus an
   editor means first designing a designated test campaign that new diffuseurs are
   offered ahead of paid ones. That is a backend feature, not a form.

---

## 2. Moderation gate and payment — done

```
DRAFT ──submit──> PENDING_REVIEW ──admin approves──> APPROVED ──payment──> ACTIVE
                        │
                        └──admin rejects──> REJECTED (annonceur edits, resubmits)
```

Endpoints:

```
PATCH /campaigns/:id          edit a draft or rejected campaign
POST  /campaigns/:id/submit   send to moderation
POST  /campaigns/:id/pay      open a payment session (APPROVED only)
GET   /admin/campaigns        review queue (defaults to pending_review)
POST  /admin/campaigns/:id/approve
POST  /admin/campaigns/:id/reject   { reason }  — reason mandatory
POST  /webhooks/payment-confirmation  payment-service calls this; activates
```

Payment uses the existing `metadata.originatingService` + `metadata.callbackPath`
mechanism, the same one subscriptions and tombola use, so **payment-service
required no change**. Deliberate: it moves real money and the safest diff there
is none.

Two guards worth not undoing:

- Editing is refused from APPROVED onward. Otherwise a clean creative gets
  approved and a different one swapped in before payment.
- `activateApprovedCampaign` is the single path to ACTIVE, shared by the webhook
  and the internal recovery endpoint, and it refuses anything not APPROVED.

**Still open with Rufus:** whether every campaign is reviewed or only the first
from a new annonceur. The queue exposes `isFirstCampaign` and
`priorApprovedCampaigns` so either policy can be applied without a schema change.

## 3. Admin panel — done

Four pages in `admin-frontend-ms`, wired into the sidebar under "SBC Ads Network":

| Route | What it does |
|---|---|
| `/ads-network` | dashboard: the figures Rufus listed, Recharts graphs, banner linking to the queue when it is non-empty |
| `/ads-network/review` | moderation queue — creative at full size, mandatory rejection reason |
| `/ads-network/campaigns` | every campaign, any status, drill into per-diffuseur performance |
| `/ads-network/diffuseurs` | leaderboard with names and phones resolved |

**Not built: the test-campaign editor.** It is listed in Rufus's asks but there is
nothing behind it yet. `hasCompletedTestCampaign` flips after a diffuseur's *first
completed campaign*, whatever that campaign happened to be — there is no
designated test campaign entity, no creative of its own, and no rule that new
diffuseurs get offered it ahead of paid work. Building the editor means first
building that concept:

- a campaign flagged as the test campaign (one active at a time)
- allocation offering it first to any diffuseur with no completed campaigns
- unpaid to the diffuseur, since its purpose is measuring their real average
- its landing page is the video plus « Je m'inscris », per the spec

Ask Rufus whether the test campaign should also be usable as a normal recruitment
tool before designing this.

## 4. Next — user app (`SBC-WEB-UI`)

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
PATCH  /campaigns/:id                   edit a draft or rejected campaign
POST   /campaigns/:id/submit            send to moderation
POST   /campaigns/:id/pay               open a payment session (APPROVED only)
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

GET    /admin/analytics?months=12            admin role
GET    /admin/campaigns?status=…             admin role, defaults to pending_review
GET    /admin/campaigns/:id/performance      admin role
GET    /admin/diffuseurs                     admin role
POST   /admin/campaigns/:id/approve          admin role
POST   /admin/campaigns/:id/reject           admin role, { reason } required

POST   /webhooks/payment-confirmation        service auth, payment-service only
POST   /internal/campaigns/:id/activate      service auth, manual recovery
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
- **`SELF_BASE_URL` is baked into payment intents** as `metadata.callbackPath`.
  Changing it strands every intent already in flight. It defaults to
  `http://localhost:$PORT`, which is correct for prod (3010) and preprod (6010) —
  do not hardcode 3010 back in.
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

Steps 1-3 and 7's analytics half are done. What remains:

1. Diffuseur flow in SBC-WEB-UI: onboarding, offers, share, verify
2. Annonceur flow: onboarding, create campaign, pay, dashboard
3. Landing page + « Je m'inscris »
4. Designated test campaign (backend) and Rufus's editor for it — see §3
5. Run `verify-extraction.ts` against a real account before preprod
