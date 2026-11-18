# Session replay with OpenReplay (self-hosted)

When a member opens a support ticket, the agent can replay what the member saw
and did in the app before and while declaring the problem.

- **Member app** (SBC-WEB-UI, `src/services/sessionReplay.ts`): records every
  signed-in session with the OpenReplay tracker. Names, emails and phone
  numbers stay visible (on screen and in fields), as asked on 2026-11-18.
  **Passwords and one-time codes are never recorded**: every such field carries
  `data-openreplay-hidden` (the tracker alone only hides `type="password"`, which
  the eye icon turns into text), and a test fails if a new one lacks it.
  Request/response bodies and headers are not recorded. The tracker is off unless
  `VITE_OPENREPLAY_PROJECT_KEY` and `VITE_OPENREPLAY_INGEST` are set at build
  time. It stops at sign-out.
- **Tickets:** the member app sends the current session id and link with the new
  ticket (form or assistant escalation). support-service keeps the link only if it
  points at `OPENREPLAY_DASHBOARD_URL`.
- **Agent desk:** a ticket with a recording shows « Revoir la session du
  membre ». The link is fetched from `POST /api/support/desk/tickets/:id/replay`,
  which writes `ticket.replay.opened` to the audit log. The replay opens in
  OpenReplay, which asks for the agent's OpenReplay account.

## Server (to install once)

OpenReplay **does not run on a laptop** and must not share the production box,
which already carries every SBC service. Official requirements (docs, v1.28.0):

- x86 Ubuntu (the docs name 20.04 LTS), public IP, a domain pointing at it.
- At least 2 vCPU, 8 GB RAM, 50 GB disk. More disk means longer replay retention.
- Put it at Contabo Germany, like the other servers. Recordings then stay where
  the privacy policy already says SBC's data is hosted.

Steps:

1. **DNS:** create `replay.sniperbuisnesscenter.com` → the new server's IP
   (Cloudflare). If the installer needs to obtain the certificate itself, leave the
   record "DNS only" during the install.
2. **Install** with the official Docker Compose installer. It installs from the
   `main` branch of github.com/openreplay/openreplay
   (`scripts/docker-compose/docker-install.sh`). Read the script first, then run it
   on the new server and give it `DOMAIN_NAME=replay.sniperbuisnesscenter.com`.
   The member app's tracker is 19.x, which needs **backend 1.28.0 or later**.
3. **Owner account:** open `https://replay.sniperbuisnesscenter.com/signup`
   right after the install and create the owner account before anyone else can.
   Then create a project ("SBC membres") and copy its **project key**.
4. **Retention:** set how long replays are kept (agree a duration with SBC; tickets
   are usually handled within a few days).
5. **Agents:** invite the support agents who may watch replays as OpenReplay
   users. A support agent without an OpenReplay account sees the button but cannot
   open the replay.
6. **Configuration:**
   - member app build env (`SBC-WEB-UI/.env.production` or the CI secret):
     `VITE_OPENREPLAY_PROJECT_KEY=<project key>`,
     `VITE_OPENREPLAY_INGEST=https://replay.sniperbuisnesscenter.com/ingest`;
   - `support-service/.env`:
     `OPENREPLAY_DASHBOARD_URL=https://replay.sniperbuisnesscenter.com`, then
     `pm2 reload support-service --update-env`.
7. **Check:** sign in to the member app, open « Aide » → « Nouvelle demande »,
   send a test request, then open it in the desk and click « Revoir la session du
   membre ».

Preprod: use a second project on the same OpenReplay server with its own key, so
test sessions never mix with members' sessions.

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
