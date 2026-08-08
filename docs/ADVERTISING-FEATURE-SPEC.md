# SBC Advertising — WhatsApp Status Marketplace

Spec as agreed with Rufus (Facilitateur) across the 06/08 call and the 06–07/08
WhatsApp threads. Open questions are marked **OPEN** and need his answer before the
affected phase is built.

---

## 1. Business model

Two roles, and any SBC member can be both.

- **Annonceur** (advertiser): a business, entrepreneur or seller who pays to get a
  flyer or video onto real people's WhatsApp statuses.
- **Diffuseur**: the member who posts it to their own status and is paid per
  verified view.

### Money

| Side | Rate |
|---|---|
| Advertiser pays | **3 F per unique view** (day 1 only) |
| Diffuseur earns day 1 | **1 F** per view |
| Diffuseur earns day 2 | **0.5 F** per view |
| Diffuseur earns day 3 | **0.25 F** per view |

Minimum campaign: **6,000 FCFA = 2,000 unique views**.

A diffuseur doing 1,000 views/day for 3 days earns 1,000 + 500 + 250 = **1,750 F**.

**The advertiser pays only for day-1 unique views.** Days 2 and 3 are free extra
reach for them, but the diffuseur is still paid. So a 6,000 F campaign delivers
roughly 6,000 total views for the price of 2,000.

Advertiser-facing wording:
> 6 000 FCFA = 2 000 vues uniques + 4 000 vues répétées

**SBC margin:** 3 − 1.75 = **1.25 F per unique view**, i.e. 2,500 F on a 6,000 F
campaign (~41.7%).

### "Unique" views — decided

Unique means *first view of that diffuseur's post*. There is **no cross-diffuseur
deduplication**. If two diffuseurs share a contact, that contact counts once for
each of them.

Rationale: dedup would make a diffuseur's paid count differ from what their own
phone shows, which is a support nightmare, and it slows target fill while
inflating repeat views.

### Targeting is free

The advertiser sets criteria (age, sex, city, country, interests, profession) at no
extra cost. Rufus explicitly rejected charging for filtering:
> « je ne veux pas que l'annonceur paye plus que trois fois »

All targeting fields already exist on the user model: `region`, `country`, `city`,
`sex`, `birthDate`, `language`, `interests`, `profession`. No user-service change
needed.

---

## 2. Campaign lifecycle

**Duration is driven by diffuseurs, not the advertiser.** A campaign runs until its
unique-view target is filled. That may take a day or a week. The "3 days" is
per-diffuseur, not per-campaign.

Per diffuseur:

1. Day 1 — posts the flyer. Views counted here are **unique** and billed to the
   advertiser.
2. Day 2 — reposts. Views are **repeat**. Free to the advertiser, still paid to the
   diffuseur at 0.5 F.
3. Day 3 — reposts. Repeat views at 0.25 F.

Only diffuseurs who posted on day 1 may repost on days 2 and 3.

### Completion gate

**Nothing is credited until all 3 days are done.** Post day 1 and stop, and the
earnings sit uncredited as *campagne non terminée*.

Two independent deadlines, and lateness inside them costs nothing:

Both clocks start at **acceptance**, so a diffuseur knows their whole timeline the
moment they accept:

| Deadline | Rule | Miss it |
|---|---|---|
| Day 1 | post within **24h of accepting** | slot released to another diffuseur |
| Completion | **3 days + 3 grace days from acceptance** | forfeited, nothing paid |

The 24h day-1 rule exists so an unclaimed slot can be reoffered rather than
silently costing the advertiser their views. Forfeiting therefore **triggers
reallocation** of that campaign.

### Advertiser: unfilled campaign

If the target is never reached, the advertiser chooses:

1. bank the remaining balance as credit toward a future campaign, or
2. keep waiting for it to fill.

This choice feeds the recommendation system, so it is recorded either way.

---

## 3. Diffuseur allocation

1. Filter by the advertiser's criteria.
2. Send the offer to matching diffuseurs. **First to accept wins.**
3. Top up progressively: if accepted diffuseurs' projected views don't cover the
   target, admit more until they do.
4. A diffuseur whose average already exceeds the target wins it outright.
5. Once the target is covered, remaining offers are cancelled.

**Max one campaign per diffuseur per day.** Exception: if every matching diffuseur
already has one, a second may be issued so advertisers aren't stuck waiting.

Offers must be spread widely. With 50,000 diffuseurs, people who never receive an
offer will complain, and Rufus called this out directly.

### Eligibility

Incomplete profile means **not eligible**. The UI shows a checklist of the missing
fields required to become a diffuseur.

### Ranking

Diffuseurs self-declare their average status views at signup. The **first campaign
is a test campaign** whose purpose is to replace those declarations with measured
data.

Ranking inputs: average verified views, click-through rate on the tracking link,
trust score.

---

## 4. Verification

**Decided: diffuseurs post manually. SBC reads back and verifies via Baileys.**

Automated posting on the user's behalf was proven to work (see
`notification-service/src/scripts/WHATSAPP-STATUS-FINDINGS.md`) but is **parked**:
higher WhatsApp ban risk and more invasive. Revisit later, possibly as a paid
convenience tier.

### How it works

The diffuseur links WhatsApp; SBC reads their own statuses from the last 24h and
extracts, per status:

- caption — must contain that diffuseur's tracking link
- media bytes and `fileSha256` — must match the advertiser's upload
- **view count** = number of read receipts, matching what WhatsApp shows
- per-viewer phone number and read timestamp

Sessions are ephemeral: link, extract, unlink. Concurrency capped (~8, to be set
from measured peak memory).

This required a 3-part Baileys patch, shipped as
`notification-service/patches/@whiskeysockets+baileys+6.7.18.patch`. Upstream PR:
WhiskeySockets/Baileys#2756.

### Timing

Views accumulate across the 24h a status is live, so verification runs **near the
end of the window** (~1h to 1h30 before expiry), not right after posting.

### Anti-fraud

| Layer | Mechanism |
|---|---|
| One WhatsApp per SBC account | unique index on `whatsappLid` (stable; phone numbers get recycled) |
| One post claimed once | unique index on `days.statusMessageId` |
| Right campaign posted | caption contains the diffuseur's tracking link (**primary**) |
| Right creative posted | perceptual hash of the image (**secondary**) |

**Viewer identities are not stored at all**, not even hashed. They would only serve
shared-audience detection, and at 1 F/view an attacker needs real WhatsApp accounts
to make that pay — the economics don't justify it. These are third parties who
never signed up for SBC, so the right amount to retain is none. Only counts are
kept.

### Media matching — decided

`fileSha256` exact matching **will not work**. WhatsApp recompresses images on
upload, so the advertiser's original and the bytes read back off the status are
different files.

- **Primary proof is the tracking link in the caption.** It is unique per diffuseur
  per campaign and unguessable — obtainable only from that campaign's page.
- **Secondary is a perceptual hash** (dHash) on images, which survives
  recompression and resizing. Catches someone pasting the link onto an unrelated
  photo.
- **Video: caption check only** initially. Frame hashing needs ffmpeg, a heavier
  dependency than is justified before fraud is observed.

`mediaSha256` is retained as a free exact-match fast path for the cases where it
does hit.

---

## 5. Landing page and tracking links

Every annonce gets an auto-generated landing page: the media, the advertiser's
text, and action buttons — **contact on WhatsApp**, **call**, **visit site** (if
they have one). Every button click is tracked.

Each diffuseur gets a **unique tracking link** to that landing page, which they
must include in the status post. It serves two purposes at once:

1. campaign tracking (which diffuseur drove which views and clicks)
2. **SBC affiliate link** — signups through it credit the diffuseur normally

The advertiser sees per-diffuseur performance: 1,000 views → 5 WhatsApp clicks.
That drives both the ranking and their picks for the next campaign.

For the test campaign specifically: the landing page is a video plus a single
**"Je m'inscris"** button, and diffuseurs earn their normal SBC commission on
conversions.

---

## 6. Referral commission (20%)

- Unlocks after **100 completed campaigns** as a diffuseur.
- Then: whenever someone the diffuseur **directly invited** launches a campaign as
  an advertiser, they earn **20% of SBC's margin** on it.
- **Paid whether or not the referrer participates in that campaign** — confirmed
  07/08: « qu'il participe ou pas, il gagne les 20 % ». The commission rewards
  having brought the advertiser in, not doing the work.
- On a 6,000 F campaign SBC's margin is 2,500 F, so the referrer gets **500 F**.
  100 such campaigns in a month = 50,000 F, which matches Rufus's own figures.

### Suspension

Purpose: stop people coasting on referral income and abandoning campaigns.

Rule: over a rolling **30 days**, if the diffuseur **was offered at least one
campaign and completed none**, the 20% is **suspended**.

- Offered zero campaigns that month → **no penalty**. They can't be punished for
  something never offered.
- **Suspension, not revocation.** It resumes once they complete a campaign again.
  No need to redo the 100.
- Applies to **future commissions only**. Nothing already credited is clawed back.

---

## 7. Balance and withdrawals

Advertising earnings sit in a **separate balance** from the main SBC wallet.

- Minimum withdrawal: **2,000 FCFA** + fees.

---

## 8. Notifications

Email for now. Other channels later.

**Diffuseur**
- campaign offer received
- acceptance confirmed
- reminder to post (per day)
- **verification window open** — 1h to 1h30 before the status expires, "link
  WhatsApp now so your views are counted"
- verification result (counted / failed, with the reason)
- day completed
- campaign completed, earnings credited
- warning before grace-period expiry
- earnings cancelled
- **congratulations on completing the test campaign**
- 20% unlocked at 100 campaigns
- 20% suspended / reinstated

**Advertiser**
- campaign live
- progress milestones
- target reached
- campaign stalled, with the bank-or-wait choice

---

## 9. Frontend: posting flow

The diffuseur opens the campaign in the app. The media (image or video) loads in
the page. Once it has finished loading, a **Share** button becomes enabled.

Tapping it opens the device's native share sheet (Web Share API), from which the
user picks WhatsApp → Status.

The share sheet carries the caption text through to WhatsApp (confirmed). The
caption is pre-filled with the campaign text plus the diffuseur's tracking link.

**The UI must warn, prominently and before sharing, that the caption must not be
edited — above all the link.** Removing it means the post cannot be verified and
the day does not count. This is the single most likely way a diffuseur loses
earnings through no bad intent, so the warning belongs on the share screen itself,
not buried in help text. Restate it in the post-share confirmation.

Also needs a plain download fallback for browsers without Web Share Level 2.

---

## 10. Build phases

| Phase | Scope | Status |
|---|---|---|
| 1 | service skeleton, campaign CRUD, criteria matching, landing pages, tracking links, click events | **done** |
| 2 | allocation: matching, first-to-accept, progressive top-up, 1/day cap | **done** |
| 3 | WhatsApp verification (queued, capped at 8), media hash, scheduler | **done** |
| 4 | advertising balance, payout engine, 3-day gate, transfer-to-main | **done** |
| 5 | ranking, trust score, test campaign, leaderboard | **done** |
| 6 | 20% referral commission + suspension | **done** |

All backend code is on `feature/advertising-service` (PR #104). **No frontend
exists yet** — every endpoint below needs UI.

### Assertion suites

Run from `advertising-service/`. The last two need a local Mongo.

```
npx ts-node src/scripts/check-day-gap.ts             8 checks, no DB
npx ts-node src/scripts/check-media-hash.ts          8 checks, no DB
npx ts-node src/scripts/check-payout.ts             12 checks, needs Mongo
npx ts-node src/scripts/check-referral-commission.ts 13 checks, needs Mongo
npx ts-node src/scripts/verify-extraction.ts        manual, needs a WhatsApp scan
```

`verify-extraction.ts` is the one that has NOT been run end to end — it needs a
real QR scan. The in-memory Baileys auth state is our own implementation of a
library interface, so a structural mistake there would only surface against a live
server.

---

## 11. Open questions for Rufus

Everything is built and asserted. These are product and compliance calls that
nobody but Rufus can make, and two of them can change money.

1. ~~**BEAC compliance.**~~ **ANSWERED 08/08.** The transfer-to-main design holds.
   Diffuseurs may withdraw because it is payment for work (posting 3 days).
   Annonceurs may never take money back out as cash. And advertising money
   **cannot be transferred between users** — no P2P on this balance, ever.

2. ~~**Grace budget.**~~ **ANSWERED 08/08.** Not a quota. Day 1 within 24h of
   accepting or the offer is dropped; then 3 days plus 3 grace days from the day-1
   post to finish everything. Being late inside that window costs nothing.

3. ~~**Referral commission base.**~~ **ANSWERED 07/08.** « 20 % sur ce que la SBC
   doit gagner sur ses filleuls » — 20% of SBC's margin, as built. He also
   clarified a point the code already got right: the referrer earns
   **« qu'il participe ou pas »** to the filleul's campaign. Nothing in
   `payReferralCommission` looks at participation.

4. ~~**Advertiser refund.**~~ **ANSWERED 08/08.** No cash refund, ever. Credit
   toward a future campaign or wait for the target. This is also a BEAC point:
   annonceur money cannot come back out as cash, while diffuseur earnings can
   because they are payment for work performed.

5. ~~**Trust score effects.**~~ **ANSWERED 07/08.** Rufus confirmed the mechanic
   and left the numbers to us: « quand un diffuseur ne respecte pas tel truc ou
   quand le gars respecte, ça lui donne un certain score de confiance ». Built as
   +5 completion, −15 forfeit, −10 media mismatch, starting at 50. Still worth
   tuning once real behaviour exists.

6. **Test campaign content.** He described a landing page with a video and a
   « Je m'inscris » button, and said diffuseurs earn their normal SBC commission on
   conversions. The generic landing page is built; the test-campaign variant with
   the video is not, and the video does not exist yet.

7. **Concurrency cap.** Set to 8 simultaneous WhatsApp verifications by env
   (`MAX_CONCURRENT_VERIFICATIONS`). Not derived from measurement — peak memory per
   socket should be measured on the real server before launch.

## 12. Not built

- **All frontend.** Every endpoint needs UI: advertiser campaign creation and
  dashboard, diffuseur offers/share/verify flow, leaderboard, balance and transfer.
- **Admin tooling.** No moderation of campaign creatives, no manual verification
  override, no view into stuck participations. Every other SBC feature ended up
  needing these.
- **Campaign payment.** `activateCampaign` is service-authenticated and ready, but
  nothing in payment-service calls it yet. An advertiser cannot actually pay.
- **Video creative matching.** Perceptual hashing covers images only; video would
  need ffmpeg frame extraction.

---

## 12. Parked for later

- **Automatic posting.** Proven working. Deferred for ban risk and invasiveness.
  Possible paid tier (the 5,000 CIBLE was floated) once there are paying
  advertisers.
