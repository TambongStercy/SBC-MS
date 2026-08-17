# WhatsApp own-status retrieval — SOLVED (2026-08-06)

## THE ANSWER — read this first, ignore the archaeology below

Baileys **can** fetch the account's own statuses posted *before* connecting,
with captions, media and full historical viewer counts, in one ephemeral link.
Three separate gates had to be opened together; each one hid the next, which is
why every single-fix attempt looked like a dead end.

| File | Fix | Symptom without it |
|---|---|---|
| `Utils/validate-connection.js` | send `DeviceProps.historySyncConfig` | server never offers `INITIAL_STATUS_V3` |
| `Defaults/index.js` | add `INITIAL_STATUS_V3` to `PROCESSABLE_HISTORY_TYPES` | phase offered, blob never downloaded (`chats.js:755` ANDs this whitelist with `shouldSyncHistoryMessage`, so a caller **cannot** opt in) |
| `Utils/history.js` | `case INITIAL_STATUS_V3` reading `statusV3Messages` | blob downloaded, decodes to nothing |

Shipped as `patches/@whiskeysockets+baileys+6.7.18.patch` with a
`postinstall: patch-package` hook. Verified on 6.7.18.

Proof (`whatsapp-own-status-probe.ts`, fresh link, no status posted during run):

```
[BLOB] syncType=1 fields: statusV3Messages[508], phoneNumberToLidMappings[130], syncType
[history-set] INITIAL_STATUS_V3(1) isLatest=true messages=1473
[history] B9405B5C60 fromMe=true viewers=266 caption="."
[history] FEADDE5341 fromMe=true viewers=267 caption="C'est quoi comme ça?"
[history] 420CBBF564 fromMe=true viewers=267 caption=""
```

Own statuses come through with `fromMe=true` and the full `userReceipt` viewer
list embedded — so the per-view payout evidence arrives in-band, no persistent
session and no live-receipt listening required.

**Corrections to what is written below.** §1's "`statusV3Messages` is never
populated by WhatsApp" was wrong: it was empty because we never declared the
capability, never fetched the blob, and never parsed the field. §6's senderKey
decryption hypothesis and §7's `fromMe` mislabelling hypothesis were both wrong
too. The sections are kept only as a record of what was ruled out.

## Posting a status DOES work (2026-08-07) — parked, not blocked

Baileys issues #1196, #2118, #619 and #32 all report that posting to
`status@broadcast` silently fails. **It works.** Verified: a text status and an
image status both published and appeared on the phone.

The failures in those issues are an empty `statusJidList`. A status is fanned out
to an explicit recipient list; with no list the server accepts the send, returns a
message id, and shows it to nobody — indistinguishable from "posting is broken".

```ts
const jids = [...]                       // real @s.whatsapp.net contact JIDs
await sock.sendMessage('status@broadcast', { text: 'hello' }, { statusJidList: jids })
await sock.sendMessage('status@broadcast', { image: buf, caption: 'hi' }, { statusJidList: jids })
```

Harvest the JIDs from `messaging-history.set` on `INITIAL_BOOTSTRAP`. Probe is
`whatsapp-post-status.ts`.

**Deliberately not used, and the bar for revisiting it is now much higher.**

### It ignored the user's status privacy settings (observed 2026-08-08)

Sterling ran the probe, then reported that people he had **blocked from his
status still received it**, and that statuses he deleted from his phone **remained
visible and repliable** for recipients.

Both come from the same mistake in `whatsapp-post-status.ts`: `statusJidList` was
built from every contact in the history sync. WhatsApp's own client builds that
list from the user's status privacy settings — « Mes contacts sauf… » — and
honours exclusions. Ours did not, so it published to an audience the user had
explicitly excluded.

The failed deletion is the same cause. Deleting a status sends a revoke to the
recipients the *phone* believes received it. A send that bypassed that bookkeeping
leaves recipients the revoke never reaches, holding a copy the user thinks is gone.

**Anything that revives auto-posting must first read the account's status privacy
settings and honour them**, including exclusion lists and any "only share with"
list, and must ensure deletions propagate. Posting to people a user deliberately
excluded is worse than a ban risk — it is a privacy breach we caused.

The campaign feature ships with diffuseurs posting manually through their own
WhatsApp client, which sidesteps all of this: WhatsApp itself decides the audience.

Two unknowns if it is ever revived:
- whether `INITIAL_STATUS_V3` is re-sent on a *reconnect* with saved creds, or only
  on a fresh QR link (untested; the whole store-creds-and-reconnect-daily design
  depends on it)
- stored auth state measured at **2.4 MB / 621 files** after one bootstrap sync,
  85% of it peer `session-*` files. Pruning those should give ~420 KB, untested.

---

# Original investigation notes (superseded)

Context: the SBC Live / advertising feature wants to verify that a *diffuseur*
actually posted a partner's flyer to their WhatsApp status, and count how many
people viewed it, so we can pay 1 XAF per verified view.

Question investigated: **can a server-side library (Baileys) fetch a user's own
WhatsApp statuses + view counts, given a short-lived companion link?**

## TL;DR

| Approach | Result |
|---|---|
| Baileys — history sync (`statusV3Messages`) | ❌ field is **never populated** by WhatsApp |
| Baileys — live push (`messages.upsert`) | ⚠️ other people's statuses only; not your own |
| Baileys — view receipts (`message-receipt.update`) | ✅ **works** — but only while connected |
| Baileys — IQ queries (guessed shapes) | ❌ all timed out |
| WhatsApp Web (browser) | ✅ **full data available** via internal JS modules |

Conclusion (**CORRECTED 2026-08-06, see §5**): statuses **do** arrive live over
the socket on link — they are pushed to a handler called `handleStatusUpdate`,
not delivered via the history-sync blob. Baileys receives the frames but has no
route for them. This is a solvable gap, not a hard limit.

An earlier version of this doc concluded "the server doesn't send statuses to
companions". That was **wrong** — it over-generalised from the history-sync
evidence. WhatsApp Web is itself a companion and demonstrably receives them.

## What was proven, and how

### 1. `statusV3Messages` is never sent (decisive)

`proto.HistorySync` has `repeated WebMessageInfo statusV3Messages = 3`, and
Baileys never reads it (grep for `statusV3Messages` in the package: zero hits).
That looked like the bug. It isn't.

Patching `lib/Utils/history.js` to log every decoded blob's populated fields
showed, across every sync type on a fresh link:

```
[BLOB] syncType=0 fields: conversations[500], phoneNumberToLidMappings[598], accounts[4], ...
[BLOB] syncType=4 fields: pushnames[1000], phoneNumberToLidMappings[979], syncType
[BLOB] syncType=3 fields: conversations[27],  phoneNumberToLidMappings[31],  ...
[BLOB] syncType=2 fields: conversations[274], phoneNumberToLidMappings[631], ...   (×many chunks)
```

`statusV3Messages` appears in **none** of them. The `INITIAL_STATUS_V3` sync
phase (syncType=1) never fires at all. Reading the field would therefore change
nothing — there is nothing in it.

### 2. Full-frame dump confirms the server sends nothing

Tapping `ws.on('frame')` (every decoded frame, pre-dispatch, see
`lib/Socket/socket.js` ~line 221) for 120s on a fresh link: 81 frames,
**0 containing any known own-status id**, no unhandled frame tags.

### 3. View receipts DO work

`message-receipt.update` fires for our own statuses with `fromMe: true`, and the
raw frame carries the viewer's real phone number:

```json
{"tag":"receipt","attrs":{"from":"status@broadcast","type":"read",
 "id":"ACC2699E21CA422500F1E8FEADDE5341",
 "participant":"1649317789879@lid",
 "participant_pn":"237679544031@s.whatsapp.net","t":"1786023948"}}
```

Useful, but only captures views that happen **while we are connected** — it does
not recover the historical count.

### 4. WhatsApp Web has everything (browser only)

WA Web uses Facebook's Haste module system (`require`, `__d`), not webpack.
Reachable from the DevTools console:

```js
const SC  = require('WAWebStatusCollection').StatusCollection; // live, ~137 reels
const Me  = require('WAWebUserPrefsMeUser');
const Col = require('WAWebCollections');

const myLid = Me.getMeLidUserOrThrow();          // reels are keyed by LID, NOT phone jid
const reel  = SC._models.find(s => s.id?.user === myLid.user);
// reel.msgs._models -> posts (type, caption, t, directPath, mimetype, filehash)
// Col.MsgInfo._models -> per-message { read: [...], delivery: [...], played: [...] }
```

This yields captions, media refs, and per-post viewer lists with phone numbers
and timestamps — verified against the phone UI ("61 views" ⇒ `delivery: 61`).

**But** `StatusCollection.findQueryImpl` → `WAWebContactStatusBridge.queryStatusAll()`
→ `WAWebApiStatus.getAllStatuses()`, which chains into `WAWebDbEncryptionKey` /
`WAWebModelStorageUtils.getStorage()` / `messageFromDbRow` — i.e. **an IndexedDB
read**, not a network query. There is no server endpoint to port to Baileys.

### 5. Statuses arrive LIVE via `handleStatusUpdate` (the actual answer)

Trapping `StatusCollection.add` in WA Web *before* linking, then linking, fired
**137 times** with this stack:

```
★ StatusCollection.add
    at i.handleUpdate          (Qt6bOoK_n5w.js:1597)
    at Object.handleStatusUpdate (xft4scOqWmcw…js:1764)
    at t                        (MA9ttIi8…js:532)
```

`handleStatusUpdate` is a **stanza handler**, not a DB read. So on link the
server pushes every status reel (all 137 contacts', including our own) straight
to the client. That is the channel Baileys lacks.

This also explains why §1 and §2 came back empty: the burst happens in the first
seconds after `connection: open`, and the frame dump in §2 ran with
`shouldSyncHistoryMessage: () => false` and started sampling after the window.

### 6. `handleStatusUpdate` is a bridge callback — statuses are ordinary messages

Reading the bundle (`WAWebStatusBridgeApi`) shows:

```js
handleStatusUpdate: function(t) {
  var e = t.isMsgUpdate, n = t.rawMsg;
  return StatusCollection.handleUpdate(n, e);
},
handleReadStatus: function(t) { /* view receipts, per msgKeys */ }
```

`*BridgeApi` modules are the seam between WA Web's **WASM/worker** layer (which
owns the socket and crypto) and the JS UI layer. `handleStatusUpdate` receives an
**already-decrypted `rawMsg`**. There is no special stanza type: status posts
arrive as normal `message` stanzas from `status@broadcast`, and the worker routes
decrypted ones here.

**Implication — Baileys is already on the right channel.** Every run showed
`CB:message` frames from `status@broadcast`, and Baileys surfaced *other
people's* statuses correctly while never surfacing our own.

**Leading hypothesis (untested):** own-status broadcasts are encrypted with our
own senderKey, which a freshly-linked companion may not yet possess. Baileys
fails to decrypt and drops them silently; WA Web's WASM layer performs the key
retrieval. Consistent with the session churn seen in Baileys debug logs during
connect (`Closing open session in favor of incoming prekey bundle`).

**Next step:** run the harvest script with `BAILEYS_LOG_LEVEL=debug` during the
first ~30s after `connection: open`, and grep for decryption failures on
`status@broadcast` frames (`failed to decrypt`, `No session record`,
`senderKey`). If own-status frames are arriving and failing to decrypt, the fix
is a senderKey/session issue in Baileys, not a missing handler — a different and
more involved patch than originally assumed.

### 7. DECISIVE (2026-08-06): receipts arrive, message bodies do not

Re-read the captured frames in `harvest-output/2026-08-06T14-53-38-639Z/raw-frames.jsonl`
instead of running more probes. The split is exact and it **kills the
mislabelling and the senderKey-decryption hypotheses**:

| What the server sends us | Arrives? | `fromMe` |
|---|---|---|
| `receipt` on our own statuses | ✅ yes | `true` — **correct** |
| `message` body of our own statuses | ❌ never | — |
| `message` body of other people's statuses | ✅ yes | `false` |

```json
{"key":{"remoteJid":"status@broadcast","id":"ACC2699E21CA422500F1E8FEADDE5341",
        "fromMe":true,"participant":"145711144390838@lid"},
 "receipt":{"userJid":"145711144390838@lid","readTimestamp":1786028119}}
```

Baileys' `decodeMessageNode` resolves `fromMe` correctly on the receipt path, so
**§6's leading hypothesis was wrong** — nothing is being mislabelled, and nothing
is failing to decrypt. The bodies simply are not sent to us.

Own-status ids observed: `AC96F3A9…`, `ACFE201C…`, `ACC2699E…` — the same ids the
§2 frame dump searched for and found zero message frames for. Consistent.

**What this means for the feature:** view counting is already solved — receipts
give us our own status ids plus each viewer's LID, phone (`participant_pn`) and
`readTimestamp`. Only the *content* (caption/media, needed to verify the right
flyer was posted) is missing.

**Untried, and now newly viable:** `sock.requestPlaceholderResend(messageKey)`
asks our own phone to re-send a specific message by key. We only just learned the
exact own-status keys from the receipts, so this was not testable before. It is a
different mechanism from `fetchMessageHistory`, which upstream issues report
WhatsApp silently drops for companion devices.

## Practical options for the feature

1. **Manual verification** (Rufus's original design): diffuseur records a short
   video of their status screen with a server-issued code visible. No ToS risk,
   works today, needs admin review.
2. **Puppeteer + WhatsApp Web**: ephemeral link, run the console extraction
   above via `page.evaluate`, unlink. Gets full data. Costs ~150–250MB RAM per
   concurrent session (vs ~10MB for a Baileys socket).
3. **Paid API** (Whapi.cloud etc.): exposes status view data; per-number cost;
   same ToS exposure.

All of 2 and 3 carry WhatsApp ToS/ban risk for the linked account.

## Do not repeat

- Don't look for a Baileys "get my statuses" query — there isn't one, and the
  history-sync field is empty. Both were checked empirically, not assumed.
- Don't set `syncFullHistory: true` casually — it pulls ~30k messages and
  contains no statuses.
- Baileys ≥ 6.7.24 is **ESM-only**; a CommonJS service must load it with a
  dynamic `await import(...)`. 6.7.18 gets HTTP 405 (stale hardcoded WA version).
- `printQRInTerminal` is deprecated; pin the WA version via
  `fetchLatestBaileysVersion()` and use `Browsers.ubuntu('Chrome')`.
- Disconnect reason **515 is success**, not an error — it means pairing worked
  and the socket must be recreated with the saved creds.

## Scripts

- `whatsapp-status-harvest.ts` — link, harvest statuses/receipts, save media +
  metadata, unlink. Works; returns statuses only for the live path.
- `whatsapp-status-fetch-probe.ts` — fires candidate IQ queries (all time out).
- `whatsapp-frame-dump.ts` — dumps every protocol frame; used for finding 2.

`harvest-output/` is gitignored — it contains real phone numbers.
