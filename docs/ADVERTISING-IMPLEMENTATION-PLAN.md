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

## 4. User app — done

Repo `Bahanack-GY/SBC-WEB-UI`, branch `feature/ads-network` (off `develop`).

| Route | What it does |
|---|---|
| `/ads-network` | role choice; both roles on one account |
| `/ads-network/diffuseur/onboarding` | rules, eligibility checklist, enrolment |
| `/ads-network/diffuseur` | offers, campaign in progress, share, verify, earnings |
| `/ads-network/annonceur/onboarding` | what a budget buys, live quote |
| `/ads-network/annonceur/nouvelle-campagne` | creative, caption, contacts, targeting |
| `/ads-network/annonceur` | campaigns, progress, per-diffuseur results |

Reached from an "Ads Network" button on the home screen. Paywalled with the rest
of the member area.

Role model, as researched: one account, separate onboarding per role, separate
dashboards — the Uber driver/rider and Airbnb host/guest pattern. Views delivered
and views bought are different questions and a merged dashboard answers neither.

The landing page « Je m'inscris » is served by advertising-service, not the web
app: `/c/:trackingCode/signup` records the click and redirects to the app's signup
with the diffuseur's `referralCode` attached. Shown only on a diffuseur's tracking
link — `/a/:slug` has nobody to credit.

### Two live bugs this build surfaced

Both fixed in `cd77a13`, both silent:

1. `getUserProfile` called `GET /users/internal/:userId`, **which does not exist**.
   Every call 404'd, and the client maps 404 to null, so diffuseur eligibility
   answered "profil introuvable" for everybody. Enrolment was unreachable.
2. `getUserProfiles` used `POST /internal/batch-details`, whose projection has
   **none of the targeting fields** — no country, city, region, sex, birthDate,
   language, interests or profession. The call succeeded, the objects came back,
   every field the matcher reads was undefined. Any targeted campaign would have
   matched nobody and issued zero offers.

Both now go through `POST /users/internal/advertising-details`, a projection owned
by this module, following the `sbclove-details` precedent.

The lesson worth keeping: a projection endpoint that returns the wrong *fields*
fails silently in a way a missing endpoint does not. Check the `.select()` before
reusing someone else's internal route.

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

## 8. What remains

The feature is end-to-end complete: an annonceur can create, be reviewed, pay,
and see results; a diffuseur can enrol, accept, post, verify and be paid; an
admin can moderate and read the numbers. Outstanding:

1. **Designated test campaign** and Rufus's editor for it — see §3. Today
   `hasCompletedTestCampaign` just flips after a diffuseur's first campaign,
   whatever it was. Needs a product decision from Rufus first.
2. **Run `verify-extraction.ts` against a real WhatsApp account** before preprod.
   The verification path has never run against live data end to end.
3. **Measure peak RSS of one verification** on the real server and set
   `MAX_CONCURRENT_VERIFICATIONS` from it. The cap of 8 is a guess, and Sterling's
   constraint is 5-10 concurrent sessions maximum.
4. **Set `APP_BASE_URL` and `PUBLIC_BASE_URL`** on preprod and prod. Defaults are
   fine for `SELF_BASE_URL` (derived from `$PORT`), but `PUBLIC_BASE_URL` defaults
   to localhost and those URLs get pasted into WhatsApp statuses.
