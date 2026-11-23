# Session replay and live assistance with OpenReplay (self-hosted)

Support can replay what a member saw and did in the app, and (support administrators only) help
them live by taking control of their screen, **only after the member accepts**.

## What runs where (2026-11-23)

- **Server:** the secondary server (`ubuntu@169.58.159.177`), `/opt/openreplay`: the official
  v1.28.0 Docker Compose files (released 2026-09-25), run by hand rather than with their
  installer (which adds the user to the docker group and runs its own Caddy on 80/443):
  - Caddy removed; OpenReplay's own nginx is published on `127.0.0.1:8090` only, behind the
    host nginx vhost `replay.sniperbusinesscenter.com` (certbot TLS; the zone's DNS-only `*`
    wildcard points here). `/ingest` is public (members' browsers); the dashboard is behind
    OpenReplay's login (rate-limited `/api/login`); `/ws-assist` (live assistance websocket)
    goes through the same vhost (upgrade headers).
  - The file store console port (9001) is not published; images pinned (`nginx:1.28.0`,
    `debian:13-slim`, the rest as their `common.env`: OpenReplay v1.28.0, Postgres 17, Valkey 8,
    ClickHouse 26.2, RustFS 1.0.0-beta.1).
  - Secrets: generated on the server into `common.env` / `docker-envs/*.env` (0600), never
    copied anywhere else.
  - Containers reach `https://replay.sniperbusinesscenter.com` through the host's public IP
    (their storage endpoint), which works on this server.
- **Retention 30 days:** a lifecycle rule on the recording buckets (`migration-files/minio.sh`),
  a 30-day TTL on ClickHouse `product_analytics.events`, `experimental.sessions` and
  `experimental.issues`, and a daily belt-and-braces deletion
  (`/opt/openreplay/retention.sh`, cron `/etc/cron.d/openreplay-retention`, 04:20). Session rows in
  OpenReplay's Postgres are not purged (no content: the recording itself is gone).
- **Projects:** `SBC membres` (id 1, for prod later) and `SBC preprod` (id 2). Each has its own
  project key (not a secret: it ships in the app).
- **Accounts:** the owner account (credentials only in Sterling's local
  `admin-auth-local/openreplay-owner.txt`); `support-api@…`, a plain member account used by
  support-service only (`OPENREPLAY_API_EMAIL` / `_PASSWORD`). Sign-up is closed (OpenReplay
  refuses a second organisation).
- **Not backed up** and not in Grafana (recordings are disposable, 30 days); a down OpenReplay
  only removes replays and live assistance, the app keeps working.
- Start/stop: `cd /opt/openreplay && sudo docker compose stop|start`. First start was
  `COMPOSE_PROFILES=migration docker compose up -d` (the 4 migration jobs exit 0).

## Member app (SBC-WEB-UI)

- **Recording** (`src/services/sessionReplay.ts`, `@openreplay/tracker` 19.0.5): every visit from
  the moment the app opens, signed-out pages included; the member's id is added at sign-in (same
  recording) or on a restored session; sign-out starts a new anonymous recording. Names, emails
  and phone numbers stay visible. **Never recorded:** passwords, one-time codes, the
  authenticator key, its QR code and `otpauth` link, backup codes, identity photos
  (`data-openreplay-hidden`; `sessionReplay.test.ts` fails on a missing one). Request and
  response bodies and headers are not kept, except the body of a failed API answer (the error
  message) and `x-request-id`.
- **Build env:** `VITE_OPENREPLAY_PROJECT_KEY` + `VITE_OPENREPLAY_INGEST`
  (`https://replay.sniperbusinesscenter.com/ingest`), in `/var/www/SBC-WEB-UI-preprod/.env` on the
  main server (preprod project). The member app has no CSP, so nothing else to open.
- **Live assistance** (`src/services/remoteAssist.ts`, `@openreplay/tracker-assist` 11.0.21,
  pinned: the guard uses its internals and a test checks them). Privacy policy section 13: every
  step needs the member's agreement, each time.
  1. **Watching live** (`requestConfirm`): nothing leaves the phone before the member taps
     « Autoriser » on « Le support SBC demande à voir votre écran… ». The prompt appears only if
     support-service has an open **desk grant** for this member and this agent's OpenReplay e-mail
     (`GET /api/support/me/assist/grant`); otherwise declined without asking. The agreement ends
     when the agent leaves; a second agent arriving makes the app ask again.
  2. **Remote control:** a grant that allows control, then a second French prompt
     « Autoriser » / « Refuser ». Nothing without it.
  3. While control runs, a red banner « … contrôle votre écran » with « Arrêter », plus the
     plugin's own widget (our French template `public/openreplay-assist.html`; the plugin would
     otherwise fetch one from static.openreplay.com).
  4. **Never on sensitive screens:** `SENSITIVE_ROUTES` (wallet/money/OTP/withdrawal pages,
     sign-in/sign-up/password pages, e-mail and phone change, SSO, identity check,
     `/mes-donnees`) and every component calling `useBlockRemoteControl()` (MoMo and crypto
     change sheets, authenticator setup, VerifyEmailGate, withdrawal forms, identity form). A
     request there is declined; control already running ends when the member arrives there.
     Watching continues, with the hidden fields hidden. A new route whose path looks sensitive
     fails `remoteAssist.test.ts` until it is listed or exempted with a reason.
  5. Calls and screen-recording requests can only be declined (no accept button).
  6. Live assistance only for signed-in members (`ignoreAnonymous`), found by their id.

## Support desk

- **Tickets:** the session sent with a request; « Revoir la session du membre » through
  `POST /desk/tickets/:id/replay` (audited `ticket.replay.opened`).
- **Member page « Sessions »** (`replay.read`: every role but verifier): live sessions and the
  last 30 days of recordings, read by support-service from OpenReplay (`GET
  /desk/members/:id/sessions`, audited `member.sessions.listed`); each « Revoir » / « Regarder »
  goes through `POST /desk/members/:id/sessions/:sessionId/open` (only a session of that member;
  audited `member.replay.opened` / `member.live.watched`). « Regarder » on a live session opens a
  **watch-only grant** for that agent (the member is still asked).
- **« Assistance en direct »** (`assist.control`: support administrators only), on the member
  page and on a ticket: `POST /desk/members/:id/assist {ticketId?}` opens a grant for
  `ASSIST_GRANT_MINUTES` (30) for this agent that also allows asking for control, audited `assist.started` (and a note on the ticket),
  and opens the member's live view; there the agent clicks « Remote control ». « Terminer »
  → `POST /desk/members/assist/:grantId/end` (`assist.ended`). Country teams and the conflict rule
  apply as for every member action.
- **support-service env:** `OPENREPLAY_DASHBOARD_URL=https://replay.sniperbusinesscenter.com`,
  `OPENREPLAY_PROJECT_ID` (2 on preprod), `OPENREPLAY_API_EMAIL`, `OPENREPLAY_API_PASSWORD`.

### Giving an agent access (one OpenReplay account per agent, never shared)

1. Sign in to `https://replay.sniperbusinesscenter.com` as the owner (or an OpenReplay admin).
2. Preferences → Team → « Add member »: the agent's name and **the same e-mail as their desk
   account** (the member app matches the grant on it). Leave « Admin » off.
3. OpenReplay has no mail server here: copy the invitation link it shows and hand it to the agent
   directly (not in a group chat). They set their own password.
4. Remove the OpenReplay account the day the desk account is deactivated (Preferences → Team).

In the community edition every OpenReplay user can watch replays and live sessions and press
« Remote control »; what stops control outside the desk is the grant check in the member app (no
grant → declined without a prompt) and the member's consent. So give OpenReplay accounts only to
support staff, and the `support_admin` role only to people allowed to help remotely.

## Local install (developer machine, 2026-11-18)

Their one-line installer reconfigures the machine (sudo, docker group, TLS), so the
local copy runs the same files by hand, from `scripts/docker-compose` of the
**v1.28.0** tag, in `~/Projects/SBC/openreplay-local/compose`:

- `common.env`: `COMMON_DOMAIN_NAME=openreplay.localhost`, `COMMON_PROTOCOL=http`,
  every `change_me_*` replaced by a random secret; `envsubst` over `docker-envs/*.env`
  and `docker-compose.yaml`, as their installer does; `SKIP_H_SSL=True` in `chalice.env`.
- `Caddyfile`: `http://{$CADDY_DOMAIN} { reverse_proxy nginx-openreplay:80 }`;
  Caddy published on `127.0.0.1:80` only (no 443); the storage console port removed.
- **Caddy has the network alias `openreplay.localhost`**: the services reach the
  file storage through `http://openreplay.localhost` (`AWS_ENDPOINT`), which only
  browsers resolve to this machine.
- Start: `COMPOSE_PROFILES=migration docker compose up -d` (the 3 migration jobs exit 0).
- Owner account and first project created through `POST /api/signup`; credentials and
  the project key in `owner-account.txt` / `project-key.txt` (0600, never in git).
- Apps: `ui/.env.local` `VITE_OPENREPLAY_PROJECT_KEY` +
  `VITE_OPENREPLAY_INGEST=http://openreplay.localhost/ingest` (http is allowed only in
  dev builds: `__DISABLE_SECURE_MODE`); `support-service/.env`
  `OPENREPLAY_DASHBOARD_URL=http://openreplay.localhost`.
- Traps met: Node's `fetch` drops a hand-set `Host` header (use curl to call it through
  `127.0.0.1`); the member profile carries `_id`, not `id`; a session becomes
  replayable only after OpenReplay closes it (inactivity), live sessions are separate.
- Stop / start: `docker compose stop` / `start` in that folder.

## Privacy (to be validated by SBC)

Recording every member without asking, with names, emails and phone numbers
visible, was decided on 2026-11-18. It is a new processing purpose. The privacy
page (`/confidentialite#enregistrement`), the cookie notice and the legal notice
now say so, and promise automatic deletion "after a limited time": set the
retention in OpenReplay and put the exact duration in that text. **Rufus must validate that text** before the tracker is switched on
in production, and check whether the APDP authorisation (délibération
2026-523) needs a declaration update.

## Data used

The tracker sends the page structure once, then the changes as they happen,
compressed. This uses members' mobile data while the app is open. If members
complain, record only Aide pages and the pages just before them.
