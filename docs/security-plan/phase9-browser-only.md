# Security plan Phase 9: browser-only access, part 1 (log-only)

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

## Not done yet (next parts of Phase 9)

- **Body check.** `b` is signed, but not yet compared with the bytes actually sent: the proxies
  stream bodies. This comes with enforcement.
- **Enforcement:** sensitive endpoints first, then all of `/api`. It needs the 14 log-only days
  with false refusals under 0.1% per browser family and Android version.
- **Turnstile** on sign-in, sign-up, withdrawal, contact change and authenticator setup. It
  needs a Turnstile site key for the main domain, and is the fallback for `unsupported`
  browsers.
- **HttpOnly cookie** session instead of localStorage, with refresh rotation.
- **Cloudflare settings** (Sterling): Bot Fight Mode, and a WAF rule blocking tool user-agents
  on `/api`.
- **Admin frontend and support desk** following the same rules.
- **Feeding automation signals** (bad signatures, tool user-agents) to the Phase 4 fraud engine.

## Checks

- `gateway-service/src/scripts/check-browser-checks.ts` (signatures made like the web app's)
- `user-service/src/scripts/check-session-keys.ts` (local Mongo)
- SBC-WEB-UI `src/utils/requestSigning.test.ts`, `deviceSignals.test.ts`
