# Security plan Phase 9: browser-only access, parts 1 and 2 (log-only)

Status (2026-11-21): signed requests are built and run in **log-only** mode: every check is
recorded and nothing is refused.

## How a request proves it comes from the SBC web app

1. **At sign-in**, the web app makes an ECDSA P-256 key pair with WebCrypto
   (`SBC-WEB-UI/src/utils/requestSigning.ts`).
   - The private key is created **non-extractable** and kept in IndexedDB. No script,
     extension or copy of localStorage can read it out.
   - The public key goes with the sign-in code (`devicePublicKey` in `POST /users/verify-otp`).
   - user-service binds it to the token it issues (`session_keys`): one row per token, keyed by
     the SHA-256 of the token, expiring with it.
2. **Tokens issued before this release** get a key once, through `POST /users/me/session-key`.
   - The first binding wins; a second one gets 409. Such rows are marked `late`.
   - Late binding is weaker: whoever held the token first could bind it. Enforcement should
     only trust late keys for a short transition, then ask everyone to sign in again.
3. **Every call to our own API** carries a signature, added in the same `fetch` wrapper as the
   Phase 1 device headers:
   - header: `X-SBC-Signature: v1;t=<ms>;n=<nonce>;b=<sha256 of the body | UNSIGNED>;s=<sig>`;
   - signed text: `v1\n<METHOD>\n<path?query>\n<t>\n<n>\n<b>`.
   - File uploads (FormData) are signed without their body.
   - Time comes from the server's `Date` header, so a phone with a wrong clock still signs on time.
   - Signing has a 300 ms budget and never blocks a request: on any failure the request goes
     unsigned.
   - Browsers without WebCrypto or IndexedDB send `none;r=<reason>`.
4. **Logout** revokes the key (`revokedAt`, kept until it expires).

## What the gateway records (`BROWSER_CHECKS=log`)

`gateway-service/src/api/middleware/browser-checks.middleware.ts` checks each `/api/` request
**after** passing it on, so it adds no latency.

**Signature outcome:**
- `valid` or `valid_late`;
- `missing` (a token used without a signature: Postman, curl, scripts);
- `unsupported`, `malformed`;
- `stale` (more than 60 s off);
- `replay` (nonce already seen within 120 s; Redis `SET NX`, or in-memory without Redis);
- `bad_sig`, `no_key`, `lookup_failed`;
- `no_token` (signed out) and `bad_token`.

**Recorded alongside:** Origin (`sbc` / `other` / `none`), Sec-Fetch-Site, and tool user-agents
(Postman, curl, python-requests, insomnia, axios, okhttp, …).

**Counted per:** Douala day, route group, client (web/app), role (member/staff), browser family
and Android version.

**Where counts go:** every minute to user-service `browser_check_days` (counts only, no member
id; kept 180 days).

**Logged as warnings:** member `bad_sig`, `replay` and tool user-agents.

**Exempt:** payment and payout webhooks, `/api/webhook`, `/api/sso`, `/api/partners`, support
desk/public/internal routes, service-secret calls. The `/s/ /a/ /c/ /e/` links never reach the
gateway.

**Report:** `node dist/scripts/report-browser-checks.js --days 14` (user-service, read-only)
shows the share of member requests that would fail, per browser and Android version, with the
reasons.

## Part 2 (2026-11-22, still log-only)

### Body check

- `b` is now compared with the SHA-256 of the bytes the gateway actually received. Each row
  gets a `body` dimension:

  | `body` | Meaning |
  |---|---|
  | `match` | same bytes as signed (an empty GET signs `sha256('')`) |
  | `mismatch` | the body was changed after signing |
  | `unsigned` | an upload signed `UNSIGNED` |
  | `too_large` | over 1 MB, not hashed |
  | `unknown` | never read, aborted, or slower than 30 s |
  | `none` | nothing to compare |
  | `na` | rows from a gateway before this part |

  It is only computed when the signature itself is valid.
- **How, without slowing or buffering anything:**
  - The gateway's proxies stream bodies (`parseReqBody: false` on `/api/users` and others), so
    the hash is taken from the same stream as it flows.
  - `watchBody` is installed before `next()`. The first consumer that adds a `data` listener
    (express-http-proxy's `pipe`, or `raw-body` in buffered mode) gets ours attached in the same
    synchronous call, so both see every chunk.
  - Checked over real HTTP in both modes: JSON, chunked and 2 MB bodies arrive byte for byte.
  - express-http-proxy answers 400 to a chunked body in buffered mode, with or without the check
    (measured with `BROWSER_CHECKS=off`). This was already the case: the web app never sends
    chunked bodies.
- The report (`report-browser-checks.js`) counts a `mismatch` as a would-be refusal and prints
  the body outcomes.

### Automation signals → fraud engine (plan item 8)

- A member token seen with any of the following is counted per member per Douala day:
  - an invalid signature;
  - a replayed request;
  - a body changed after signing;
  - a tool user-agent.
- `missing` signatures are **not** counted: tokens issued before the key binding still race it.
- Every minute the gateway sends risk-service one `automation_seen` event per member
  (`RISK_SERVICE_URL` in the gateway `.env`; empty = off). Each request has a 2 s budget; a
  failed send is dropped.
- risk-service adds the live reason `automation`: 20 points for 7 days. The reason text sums
  the member's last 24 h, e.g. « 2 signature(s) invalide(s), 1 requête(s) depuis un outil… ».
  It shows on the support « Risque » card. Silent: nothing is refused.

### Checks

- `gateway-service/src/scripts/check-browser-body.ts` (real HTTP, both proxy modes, automation feed)
- `user-service/src/scripts/check-session-keys.ts` (body dimension)
- `risk-service/src/scripts/check-live.ts` (automation rule)

## Not done yet (next parts of Phase 9)

- **Enforcement:** sensitive endpoints first, then all of `/api`. It needs the 14 log-only days
  with false refusals under 0.1% per browser family and Android version.
- ~~Turnstile~~: done as ALTCHA (part 3, below).
- **HttpOnly cookie** session instead of localStorage, with refresh rotation.
- **Cloudflare settings** (Sterling): Bot Fight Mode, and a WAF rule blocking tool user-agents
  on `/api`.
- **Admin frontend and support desk** following the same rules.
- ~~Feeding automation signals to the fraud engine~~: done in part 2.

## Checks

- `gateway-service/src/scripts/check-browser-checks.ts` (signatures made like the web app's)
- `user-service/src/scripts/check-session-keys.ts` (local Mongo)
- SBC-WEB-UI `src/utils/requestSigning.test.ts`, `deviceSignals.test.ts`

## Part 3 (2026-11-22): anti-robot check (rule 3), with ALTCHA instead of Turnstile

Decision 2026-11-22: no paid or keyed third-party services. Turnstile needs a Cloudflare key, so
rule 3 uses **ALTCHA** (`altcha-lib` 2.8.0, MIT, self-hosted proof of work: no third party, no
cookie, no CDN script).

- **Gateway** `robot-check.middleware.ts`:
  - `GET /api/altcha/challenge`: a challenge signed with `ALTCHA_HMAC_KEY`, 10 min, `no-store`.
    It answers 204 while the check is off, so the apps send nothing.
  - The protected actions (POST), with the action name the counts use:
    - `login`, `signup`, `password_reset`;
    - `contact_change` (email, phone);
    - `payout_change` (MoMo, crypto wallet);
    - `authenticator_setup`;
    - `withdrawal` (`/transactions/withdrawal/initiate`);
    - `desk_login` (support desk);
    - `public_ticket` (« Signaler un problème » without an account).
  - **Answer:** `X-SBC-Altcha` = base64 JSON `{challenge, solution}`. It is checked with one HMAC
    (deterministic mode: the derived key is signed, the server never redoes the work) and
    accepted once (Redis `SET NX`, else this process's memory).
  - **Outcomes:** valid / missing / malformed / invalid / expired / replay.
  - `ROBOT_CHECK=off|log|enforce`. `log` counts into user-service `robot_check_days` (per Douala
    day × action × outcome × client × browser × Android version; no member id; TTL 180 days),
    flushed every minute. `enforce` answers 403 `ROBOT_CHECK_FAILED` to anything but `valid`.
  - A signed-in member who sends a forged or replayed answer feeds the fraud engine through
    part 2's `automation_seen` (`robot` count). The live rule `automation` names it.
- **Member web app** (`src/utils/robotCheck.ts`):
  - One answer is solved ahead of time when a page leading to these actions opens (sign-in,
    sign-up, forgot password, « Signaler un problème », e-mail/phone change, wallet, profile).
  - The fetch wrapper adds it to the protected calls; each answer is used once.
  - On a 403 `ROBOT_CHECK_FAILED`, the wrapper retries once with a fresh answer.
- **Support desk:** the same on the agent login (`auth/robotCheck.ts`). Turnstile was removed
  from support-service (agent login and public tickets), support-frontend, the member app's form
  and the desk CSP. It had never been configured on preprod (no `TURNSTILE_SECRET`).
- **Cost:** SHA-256, one round per try. The answer is a random number between max/4 and max
  (`ALTCHA_MAX_COUNTER`, 20,000):
  - desktop Chrome: 69 ms on average;
  - Chrome slowed down 20× (a very cheap phone): 1.4 s on average, 2.2 s at worst.
  - It is solved while the page opens, so the action does not wait.
- **Limit:** it proves the client did the work, not that a person is there. A headless browser or
  a paid solving service still passes; rate limits stay. Its value is: no script without running
  the solver, one answer per action, and the counts.
- **Rollout:** `log` only. Decided 2026-11-22: Phase 9 stays log-only, never enforced on a date.
  `enforce` exists if that decision changes. Read `user-service/dist/scripts/report-robot-checks.js
  --days 14`: `missing` comes from old app versions still open and from scripts.
- **Checks:**
  - `gateway-service/src/scripts/check-robot-check.ts` (real HTTP, both modes, 23 checks);
  - SBC-WEB-UI `src/utils/robotCheck.test.ts`;
  - support `src/tests/public-tickets.test.ts`, `auth.test.ts`.
