# SBC Ads Network — what building it actually taught us

Companion to `ADVERTISING-FEATURE-SPEC.md` (the rules) and
`ADVERTISING-IMPLEMENTATION-PLAN.md` (the state). This one is the **debugging
history**: every bug that reached preprod, why it was invisible until a human
used the screen, and what to do differently.

Written after the feature was exercised end to end on preprod by Sterling. Most
entries below were found by him using it, not by me reading code — that ratio is
itself the main lesson.

---

## 1. Frontend

### 1.1 Gate a screen during render, never in `useEffect`

An enrolled diffuseur landed on onboarding, saw it for a second, then got thrown
to their dashboard. The redirect was correct; it just ran from an effect, which
fires **after** the wrong screen has painted.

```tsx
// wrong — paints, then corrects
useEffect(() => { if (isDiffuseur) navigate('/dashboard', { replace: true }); }, [...]);

// right — nothing paints
if (isResolved && roles.isDiffuseur) return <Navigate to="/dashboard" replace />;
```

**Corollary:** an early `return` must sit **below every hook**. The first version
of the dashboard guard sat above a `useCallback`, which changes hook order
between renders. ESLint's `rules-of-hooks` caught it; without that rule it would
have been a runtime crash on a state change.

### 1.2 A cached role needs three things, and two were missed

`useAdsRoles` caches `{ isDiffuseur, isAnnonceur }` in localStorage so a
returning user routes correctly on the first frame. Shipping it exposed three
requirements:

1. **Key it per user.** An unkeyed cache survives logout and hands the next
   account the previous one's roles — on a shared phone, a dashboard for a role
   you don't hold.
2. **Clear it on logout.** `AuthContext` clears several keys; it knew nothing
   about this one.
3. **Mark it stale on load.** `initialData` without `initialDataUpdatedAt` is
   treated by react-query as fresh *as of now*, so `staleTime` applied to a value
   read off disk and **no refetch was scheduled on mount**. A role changed
   server-side stayed wrong indefinitely — which is why "log out and back in"
   didn't fix it.

```ts
initialData: cached ?? undefined,
initialDataUpdatedAt: 0,        // the line that makes it revalidate
refetchOnMount: 'always',
staleTime: 30_000,
```

Treat the cache as a *routing hint only*. Every endpoint behind these screens
re-checks server-side, so a stale or hand-edited value costs a wrong redirect and
nothing more. Never let it gate anything that matters.

### 1.3 Don't recompute a server rule in the client

The card decided whether posting was allowed with
`!day?.windowOpensAt || new Date(day.windowOpensAt) <= new Date()`. That reads a
day with **no window** as one with *no restriction* — so it offered "Publier" for
days that had never opened.

The service already answers this as `schedule.canPostNow`. The client's job is to
render the answer, not to re-derive it. Any rule expressed in two places will
disagree, and the client's version is the one users see.

### 1.4 A typed interface is not a contract

The verify screen keyed off `schedule.currentDay.status === 'posted'`. The
service was sending `currentDay` as a **plain number**. The TypeScript interface
said object, so nothing complained, `day.status` was permanently `undefined`, and
the verification screen **could never render**. It looked implemented and wasn't.

When a UI branch never fires, log the actual payload before re-reading the
component. `curl` the endpoint with a real token — the shape is usually the
answer.

### 1.5 Never render a control whose action cannot succeed

Two versions of this in one day:

- "Revérifier mes publications" was added while `applyExtraction` only judged
  `POSTED` days — so on a verified day it reported *zero views, no verdict*.
- The verify button existed for weeks behind a condition that could never be true
  (§1.4).

A button that always fails is worse than no button: it teaches users the feature
is broken.

### 1.6 Don't start expensive work until the user commits

Opening the verification sheet immediately took one of **8 global WhatsApp
session slots** — before the user had chosen anything. The method picker now
starts nothing until they pick, and unmounting cancels the session:

```ts
return () => { if (sessionIdRef.current) sbcApiService.cancelVerification(sessionIdRef.current); };
```

### 1.7 Cross-origin bytes: display works, reading doesn't

The share sheet fetched the creative from the CDN to build a `File` for the Web
Share API. The bucket sends **no `Access-Control-Allow-Origin`**, so reading the
bytes was blocked however the URL was written. Every diffuseur silently fell
through to the download fallback, on the screen the whole flow depends on.

| use | URL |
|---|---|
| `<img src>` | CDN direct — no CORS needed, no bandwidth cost to us |
| `fetch` for share | same-origin `?stream=1`, proxied through settings-service |
| download link | same-origin `?download=1` with `Content-Disposition` |

**A redirect does not fix this.** The proxy 302'd to the CDN and CSP/CORS judge
the *final* URL. The bytes must actually come from our origin.

The `download` attribute is likewise **ignored cross-origin** — the fallback
navigated to the image instead of saving it.

### 1.8 Resolve stored files by shape, not by folder prefix

`getFileUrl` decided "Cloud Storage" by prefix (`avatars/`, `products/`). Uploads
via `/settings/files/upload` land at the **bucket root with a plain filename**,
matched nothing, and took the legacy Drive path.

On the admin host that failed in the worst available way: nothing proxies `/api`
there, so the URL resolved to the SPA's own `index.html` and the browser received
**200 text/html where it expected an image** — a broken `<img>` and no error
anywhere.

Rule: an extension or a path separator means Cloud Storage; Drive ids are opaque
and extensionless.

### 1.9 Layout and copy — what Rufus and Sterling actually pushed back on

Every one of these came back as "boring", "too much text", or "looks like a
wallet, not a dashboard":

- **Numbers belong in cards, not sentences.** `0 campagne(s) terminée(s) ·
  Moyenne 75 vues (déclarée) · Confiance 50` became three stat cards. Same data,
  read at a glance.
- **State belongs in a shape.** Three lines describing campaign progress became a
  three-segment bar. Grey / amber / green — and **no fourth colour**: a blue
  "in progress" competed with amber for the same meaning.
- **Relative dates.** `10/08/2026 10:08:36` → `demain 10:08`, `dans 3 jours`. A
  timestamp to the second was the longest thing on the card.
- **One idea per step card**, not a five-item numbered paragraph.
- **Illustrations, not walls.** Hero image on each onboarding; the empty state and
  the share sheet carry one too.
- **Skeletons, not spinners.** A spinner says "wait"; a skeleton shaped like the
  incoming screen sets expectations — and gives the honest "we don't know your
  role yet" state a home that isn't one of the two real screens.
- **Grids don't centre a partial last row.** Five items in `grid-cols-3` leaves
  two pinned left. `flex-wrap` + `justify-center` with fixed item widths does.
- **Match existing motion.** The profile page springs its header down and slides
  items in from the right, staggered. Two shared helpers (`adsHeaderMotion`,
  `adsItemMotion(i)`) so a screen added later moves like the rest.

### 1.10 Long operations need visible progress

After the pairing code was accepted, the sheet kept showing the code while the
account was already being read. A successful connection looked like a dead
screen. The `reading` state now replaces it with "Appareil connecté — lecture de
vos statuts".

### 1.11 Multi-input OTP: `preventDefault` or the paste is undone

Pasting a code on mobile filled only the first box. `handlePaste` wrote all six
digits, then **the browser's own paste followed**, `maxLength={1}` truncated it to
one character, and the resulting `onChange` rebuilt state from a stale closure —
wiping the five just written.

Also needed: functional state updates (two updates can land in one batch), and
handling a multi-character `onChange` because Android keyboards and password
managers deliver the whole code to one input **without firing a paste event**.
`autoComplete="one-time-code"` lets the OS offer it directly.

The same three handlers had been copy-pasted into three screens, bug included.

---

## 2. Backend traps worth remembering

### 2.1 Protobuf Longs are objects — and an unset one is truthy

The single most expensive bug. A status with **13 real views was recorded as
216**:

```ts
receipts.filter(r => r.readTimestamp)          // matches every recipient
receipts.filter(r => epochOf(r.readTimestamp) > 0)   // correct
```

`readTimestamp` arrives as `{ low: 0, high: 0 }` — a present object holding zero.
`viewCount` came out identical to `deliveredCount` **every time**, and that
equality appeared in an earlier test run and was noted as "worth checking" rather
than recognised as the symptom. This is the number diffuseurs are paid on and
annonceurs are billed for: it was inflating both by ~16x.

**Any `filter(x => x.someTimestamp)` on protobuf data is a bug.**

### 2.2 Internal service URLs must never reach public HTML

The landing page shipped `src="http://localhost:6007/api/settings/files/..."` to
the internet. Every image and video on every landing page was broken since
launch. Server-rendered public pages must build URLs from the **public origin**
(`appBaseUrl`), never from `services.*`. Encode them too — uploaded filenames
contain spaces.

### 2.3 CSP judges the final URL, and helmet's defaults are strict

Once the URLs were right, the page blocked its own media: `img-src 'self'` while
the file proxy 302s to the CDN. Video had no `media-src` and fell back to
`default-src`. The inline player script was refused.

Name the CDN in `img-src`/`media-src`, and give inline scripts a **per-response
nonce** rather than `'unsafe-inline'` — this page renders advertiser-supplied
text.

### 2.4 WhatsApp validates the device tuple during pairing

`browser: ['SBC', 'SBC Ads Network', '1.0.0']` was refused with **"Couldn't link
device"**. Moving the branding to the platform slot
(`['SBC Ads Network', 'Chrome', '1.0.0']`) was refused too.

**Both fields are validated. The linked-device name cannot be branded.** Default
is `Ubuntu,Chrome,22.04.4`; `WHATSAPP_DEVICE_BROWSER` exists purely as a rollback
lever. Don't retry this — each attempt costs a real failed pairing, and a tuple
WhatsApp half-accepts could break history sync in a way that's harder to notice
than a refused code.

### 2.5 Unlink on every teardown path

`logout()` was only called on the success path. Cancelling, failing or timing out
left **a live WhatsApp session on the diffuseur's account**, visible in their
Linked devices, indefinitely. Unlink whenever the socket ever reached
`connected`, however the session ends, and log when it can't.

### 2.6 The claimed-status set must exclude the day's own match

A status can back only one campaign day — but "one day" must include *the same
day checked again*. Folding a day's own previous match into the off-limits set
made re-verification impossible: the status sat on the account and the service
reported it found nothing.

Re-verifying a validated day needs two guards, and **missing either takes money
off a diffuseur**:

- finding nothing must not downgrade it (statuses expire after 24h)
- a lower count must not replace a higher one (views only accumulate)

### 2.7 `currentDay` vs `nextUnpostedDay`

One function meant two things and caused three bugs. Now explicit:

- `currentDay` — first day **not verified**. The day in progress. Drives the UI.
- `nextUnpostedDay` — first day **not posted**. Drives posting, reminders,
  forfeits.

They coincide only when nothing is awaiting verification, which is why the
confusion looked correct until someone posted.

### 2.8 The test campaign needs exclusions everywhere

It carries `targetUniqueViews: 1` (schema minimum), so the completion sweep
closed it after the first verification. Once it isn't `ACTIVE`,
`getTestCampaign()` returns null: new diffuseurs stop being measured, the
eligibility gate silently opens, and the editor creates a **second** one because
the unique index only constrains live ones.

It must be excluded from: the completion sweep, the annonceur's campaign list,
the admin campaign list, and the top-up sweep. It pays nothing by carrying
`ratePerView: 0` on every day — arithmetic, not a special case in the payout
engine.

### 2.9 Allocation: big first, but fit the tail

Pure descending order fits the bulk well and the tail badly — with 200 views
still needed, the next 1000-view diffuseur was taken anyway, so a 2000-view
purchase could deliver 3000. The overshoot comes out of SBC's margin and spends
diffuseurs a later campaign needs (one campaign per diffuseur per day).

Take the largest who **fits inside** what's left; when nobody fits, the smallest
who overshoots — so a campaign always completes by the narrowest margin.
Measured overshoot went from ~20% to 0%.

### 2.10 The deadlock that made every new diffuseur invisible

Offers required `whatsappLid` on the profile. WhatsApp links during the
**verification of a participation**. No offer → no verification → no LID → no
offer. Every brand-new diffuseur was stuck, for every campaign.

The test campaign is where that first link happens, so it must not require one.

---

## 3. Infrastructure

- **A service must be added in four places** or it silently never runs:
  `ci.yml` matrix, `build-all.sh`'s `ALL_SERVICES`, the deploy script's PM2 map,
  and the health-check port list. `advertising-service` was in none of them; the
  deploy went green and the service never started.
- **`pm2 restart` fails on an app that was never started** — and the script
  carried on and reported success. Falls back to `pm2 start ecosystem --only`.
- **The deploy script `git reset --hard`s itself before running**, so a fix to
  the script only takes effect on the *next* deploy.
- **The scheduler runs on a 10-minute interval and not at boot.** Anything
  waiting on a sweep waits up to 10 minutes after a deploy.
- **nginx must route `/s/ /a/ /c/`** to the advertising service, or tracking links
  fall through to the SPA and return a 200 that looks fine and isn't.
- **`config.jwt.secret` empty under PM2**: `loadEnv` fell back to `.env` only
  `if (!process.env.PORT)` — but PM2 always injects `PORT`. Load both files
  unconditionally; dotenv never overwrites what's already set.
- **`POST /users/internal/batch-details` carries no demographic fields.** Using it
  for targeting returns objects where every field the matcher reads is
  `undefined` — no error, just nothing ever matching. Modules needing profile
  data add their own projection endpoint (`advertising-details`,
  `sbclove-details`).

---

## 4. How to test this feature

- **Assertion scripts, not unit tests.** `src/scripts/check-*.ts` run against a
  real Mongo, drop their own database, and print PASS/FAIL. Run them before every
  push; they take under a minute.
- **Test the sequence, not the services.** Every suite passed while three days
  could be posted in thirteen seconds, because each service was correct in
  isolation. `check-day-flow.ts` drives the **real controller** through
  post → blocked post → verify → next day, and would have caught it.
- **A failing test is not proof the code is wrong.** Two fixtures here were wrong
  while the service was right (a day never saved; a "no match" case that fed a
  matching status). Check which one is lying before changing production code.
- **Verify on the box, not in the PR.** `curl` the real endpoint, read the real
  document, check `pm2 list`. A green deploy proved nothing several times.

---

## 5. What has still never run against reality

- **An annonceur paying.** No real payment has been taken; activation via webhook
  is only asserted.
- **Payout crediting at completion** — no diffuseur has finished three days.
- **The referral commission**, which needs 100 completed campaigns to unlock.
- **`MAX_CONCURRENT_VERIFICATIONS = 8`** is still a guess. Measure peak RSS of one
  verification on the real box; Sterling's ceiling is 5–10 concurrent sessions.
