# Security plan Phase 8: KYC enrichment, part 1 (level 1)

Check members' email and phone in the background, on the secondary server, and give the fraud
engine (risk-service) signals and a score. Nothing runs on the member's request and nothing
contacts the member. Branch `feature/kyc-level1`.

## What is built

| Plan item | Where | Status |
|---|---|---|
| 1. Second server, private link + shared secret | the **existing secondary server** (`ubuntu@169.58.159.177`, Blnk's: 8 cores, 23 GB, 282 GB free); HTTPS + main-server-IP allow-list + HMAC per request | done differently (below) |
| 2. kyc-worker (Python, Docker), own database, results to risk-service as signals + score | `kyc-worker/` (FastAPI); SQLite for DNS answers only; risk-service `kycresults` | done |
| 3. Level 1: phone, countries, operator, email domain, disposable, variants, random-looking | `kyc-worker/app/checks.py` | done, except Gravatar and the MoMo holder name (below) |
| 4. Level 2 (Holehe / SEON) on risk triggers | — | waits for the decision (SEON test on 500 vs Holehe) |
| 5. Level 3 (ID + selfie) | `kyc-worker/app/l3_*.py` (secondary) + support « Identités » | done 2026-11-22, open source instead of Smile ID (below) |
| 6. Throttled night backfill of level 1 | risk-service nightly refresh, 02:05–05:00 Douala, 50/s | done |

### Flow

```
user-service  sign-up / email, phone or MoMo change ──hint (fire-and-forget, 1 s)──▶ risk-service
risk-service  kycqueue ──1 batch/s (≤ 50)──▶ HTTPS, signed ──▶ kyc-worker (secondary server)
              kycresults ◀── signals + reasons + score ◀──────────┘
nightly 02:05 Douala: every member never checked or whose checked fields changed → queue (backfill rows,
processed 02:00–05:00 only; live hints any time and first)
```

- **user-service** `utils/risk-event.ts` (was `kyc-hint.ts` until Phase 4 part 2): a `signup` /
  `contact_change` event to risk-service, which queues the check, after `register` and inside
  `alertContactChange` (every real email / phone / MoMo change: member, admin, support). A first
  MoMo number raises no alert, so the nightly refresh picks it up. The call is never awaited.
- **risk-service** `services/kyc.service.ts`:
  - Route: `POST /api/risk/internal/kyc/hint {userId, reason}` (service secret) writes the queue.
  - The queue row is the member (`_id` = userId). `v` grows with each hint, so a hint during a
    check makes it run again with the newest details.
  - Members are read **read-only** from the users database (`USERS_MONGODB_URI`), as the
    Phase 4 look-back does: email, phone, declared country, `ipCountry`, `geo.lastCountry`,
    MoMo number and operator.
  - A member whose fields are unchanged since their last check (`fingerprint`: an HMAC of the
    fields and the checks' version) is not sent again.
  - Worker down: the batch stays queued, with a back-off from 30 s to 30 min.
  - `GET /api/risk/internal/members/:userId` now carries `kyc` (score, band, reasons, signals);
    `GET /api/risk/internal/kyc/status` gives the queue and band counts.

### Checks and points (level 1)

| Reason | When | Points |
|---|---|---|
| `email_disposable` | throwaway domain (disposable-email-domains list, ~10,400 domains) | 40 |
| `phone_invalid` | the number is not valid anywhere (libphonenumber) | 20 |
| `email_syntax` | not an address (space inside, no @…) | 15 |
| `email_no_mx` | the domain takes no mail (no MX, no A record, or null MX) | 15 |
| `momo_invalid` | the MoMo number is not valid | 15 |
| `phone_country_vs_declared` | the phone's country ≠ the declared country | 15 |
| `momo_country_vs_declared` | the MoMo number's country ≠ the declared country | 10 |
| `momo_operator_mismatch` | the MoMo number's operator ≠ the declared operator (Wave never compared) | 10 |
| `network_country_elsewhere` | IP / Cloudflare country matches none of declared, phone, MoMo | 10 |
| `email_random` | generated-looking address (`xk7q2m9z4p@…`) | 10 |
| `email_variant_shared` (risk-service) | another account's address reaches the same mailbox (Gmail dots, `+tag`) | 20 |

Score = the sum, capped at 100: low < 20, medium < 50, high ≥ 50. The score is **not used in any
decision yet**: Phase 4's engine is silent, and these points join its rules with part 2 (live events).

Details that matter:
- **Old numbering plans:** Benin 2024 (01 + old 8 digits) and Gabon (0 + old 8) are converted,
  operator included. Côte d'Ivoire 2021 is valid but its operator is unknown (the prefix depends
  on the old operator). These numbers are marked `legacy`; 1,143 of 20,000 sampled accounts have one.
- **Operators** compare by family: "MTN Cameroon" = `MTN_MOMO_CMR`; Yas = Free (Senegal) or
  Togocel (Togo); Vodacom / Safaricom = M-Pesa.
- **DNS:** one query per domain, cached 7 days in the worker's SQLite, and 1 hour on failure. A
  failed lookup is "unknown", never scored.
- **Not done:**
  - Gravatar: it sends a hash of the address to a third party, so it needs the privacy policy first.
  - MoMo holder name: CinetPay and MoneyFusion have not said they can return it (Sterling asks).

### What is stored

Since 2026-11-22 (Sterling: "The KYC should run entirely on the secondary server"), everything
below lives on the secondary server, in the worker's SQLite (`/opt/kyc-<env>/data/kyc.sqlite`).
- **`queue`:** a member waiting, with the fields to check (email, numbers, countries, operator).
  The row is deleted once checked, with `PRAGMA secure_delete` so the freed pages are zeroed.
  Live members first; backfill rows only 02:00–05:00 Douala.
- **`results`:**
  - Stored: the signals (validity, country codes, operator families, the email **domain**, flags),
    the reasons, the score and band, an HMAC of the normalised mailbox (`email_key`, key derived
    from `KYC_SHARED_SECRET`, to find variants) and risk-service's HMAC fingerprint of the fields.
  - Never stored: the email, a number or a name (`tests/test_store_runner.py` scans the file).
  - Deleted 12 months after the last check (the runner's hourly pass, `KYC_RETENTION_DAYS`).
- **`domains`:** `domain → has mail` answers (DNS cache).
- **Main server:** only `kycqueue`, now an outbox (member id, reason, priority; no field), emptied
  every second. The old `kycresults` collection is no longer written; it is kept (its TTL ends it
  within 12 months) and the member view shows a row from it, marked `source: 'archive'`, only
  while the secondary has no result for that member or cannot be reached.

### How the two servers talk

All calls are main → secondary, HTTPS through nginx (main server's IP only), each body signed
(HMAC, ±5 min):
- **Every second:** the outbox's due rows → the members' fields read (read-only) → `POST
  /v1/enqueue` (≤ 500). The secondary skips a member whose result has the same fingerprint.
  Secondary down: the rows stay, retried with a back-off (30 s → 30 min).
- **Nightly sync, 02:05 Douala:** the users are read 1,000 at a time; only `{id, fingerprint}` is
  sent (`POST /v1/needed`); the fields of the members the secondary answers (never checked,
  changed, or result expired) are then submitted as backfill. A member who changed nothing
  crosses the network as an id and an HMAC only.
- **Member view (support desk):** `POST /v1/results`, 1.5 s budget. **Status:** `POST /v1/status`.
- **kyc-runner** (second container, same image, `python -m app.runner`): one batch a second
  (`KYC_PER_SECOND`, 50), level 1 in-process, mailbox variants, results. 0.5 CPU / 256 MB.

### Not quite the plan

- **Private link:** the plan says WireGuard or Tailscale. Blnk already reaches the secondary
  server over HTTPS with an nginx allow-list (main server's IP only) and its own key; the worker
  does the same plus an HMAC on every request (timestamp ±5 min). This avoids changing the network
  setup of both servers. A WireGuard link can replace it later without code changes (only
  `KYC_WORKER_URL`).
- **Queue:** the plan's rule 1 says a Redis stream. user-service has no Redis client, so the hint
  is an HTTP call to risk-service, which keeps an outbox in Mongo and forwards it; the queue
  itself is on the secondary. The nightly sync makes a lost hint harmless.

## Measured

- **Checks:**
  - `risk-service/src/scripts/check-kyc.ts`: 24 checks of the feeder, against a fake secondary;
    with `KYC_REAL_WORKER_URL` the hint, forward and sync checks run against a real worker.
  - `kyc-worker`: `pytest` (21, also in CI): queue, runner, results, signed API.
  - End to end (2026-11-22, local worker + runner + risk-service): Gmail variants found, a
    disposable address scored, the sync submitted only the 2 members needed, and the SQLite
    file held no address or number afterwards.
- **20,000 real accounts** (local copy of the users database, real DNS):
  - Speed:
    - 150 members/s back to back;
    - a 50-member batch takes 72 ms at p50 and 1.3 s at p95, when new domains are queried;
    - the refresh scan of 20,000 members takes 1.4 s.
    - So 386,000 members take about 2.1 h at the production pace of 50/s.
  - Bands: 19,099 low, 890 medium, 11 high.
  - Reasons:
    - unusable address: 554 (198 with a space inside, 195 with no @);
    - invalid phone: 232;
    - no mail server: 119, almost all Gmail typos (gmail.con, gmail.cm, glail.com, g.com);
    - MoMo operator mismatch: 94 (66 are an Orange number declared as MTN in Cameroon);
    - random-looking: 68;
    - disposable: 3;
    - shared mailbox: 2.
  - **By-product for support:** about 670 members in 20,000 (3.4%) have an address that cannot
    receive mail, so emailed codes never reach them.

## Level 3: ID document + selfie (2026-11-22)

Decided 2026-11-22: no paid or keyed service, so not Smile ID.
- **When it is asked:** a fraud-engine hold, an authenticator reset (lost phone), and someone who
  says they lost their account details (also without an account, from a guest request). It is not
  asked for large withdrawals.
- **Who decides:** any support agent (`identity.review`; the WhatsApp-views verifiers are left out).
  The decision proves identity, nothing more: the release, the reset or the contact change keeps
  its own approval.
- **Storage, on the secondary server only** (`kyc-worker/app/l3_store.py`, same SQLite file):
  - images encrypted (Fernet, key derived from `KYC_L3_KEY`, never rotated);
  - deleted 30 days after the decision (`KYC_L3_IMAGE_DAYS`), or 60 days after sending when nobody
    decided (`KYC_L3_UNDECIDED_DAYS`);
  - the decision and the check results (no image) kept 12 months (`KYC_L3_RECORD_DAYS`);
  - `secure_delete` on.
  The main server keeps no image: support-service streams them to the agent and keeps only
  `identityverifications` (who, why, status, hints, decision).
- **Automatic checks = hints** (`l3_checks.py`, run by `kyc-runner`). They use OpenCV YuNet (face
  detection) and SFace (face recognition) from opencv_zoo (Apache 2.0), from `KYC_MODELS_DIR`.
  They report:
  - sharpness, brightness and faces found per image;
  - selfie vs ID photo, cosine similarity with OpenCV's threshold 0.363;
  - the same exact image sent by another person;
  - the same face behind another account (0.45, selfies still kept).
  There is no OCR or MRZ: the agent reads the document. Without the models, requests are still
  stored and decided ("engine_unavailable").
- **Endpoints** (signed like level 1): `/v1/l3/submit` (≤ 4 MB per image, magic bytes checked; one
  open request per person, 3 a day), `/v1/l3/get`, `/v1/l3/image`, `/v1/l3/decide` (once).
- **Limits:** nginx lets 18 MB through on `/v1/l3/submit` only. The runner refuses images above
  40 Mpx (`OPENCV_IO_MAX_IMAGE_PIXELS`) and scales them to 1600 px before detection.
- **Deploy additions:**
  - secondary `.env`: `KYC_L3_KEY` (`openssl rand -hex 32`);
  - the two `.onnx` files in `/opt/kyc-<env>/models`;
  - the nginx location;
  - support-service `.env`: `KYC_WORKER_URL` + `KYC_SHARED_SECRET` (the same as risk-service's).
- **Member app (SBC-WEB-UI, part 2):**
  - `/aide/identite?motif=…`: camera photos, scaled to 1600 px JPEG on the phone.
  - `/signaler-un-probleme/identite/:id`: the same for a guest request.
  - Linked from:
    - a withdrawal refused with 403 `RISK_HOLD` (payment-service, member paths);
    - the authenticator's lost-phone note;
    - « Changer mon email ou téléphone »;
    - open « Compte & accès » chats.
- Tests: `kyc-worker/tests/test_l3.py` (fake face engine; a real-model test runs when
  `KYC_MODELS_DIR` holds the models), support `src/tests/identity.test.ts`, support-frontend
  `IdentityPage.test.tsx`.

## Deploy (preprod)

Each step needs Sterling's OK. The secrets are generated on the servers and never printed.
1. **Secondary server:**
   - copy `kyc-worker/` to `/opt/kyc-preprod/src` and `docker-compose.yml` to `/opt/kyc-preprod`;
   - write `/opt/kyc-preprod/.env` (`KYC_SHARED_SECRET`), mode 600;
   - `sudo docker compose up -d --build` pulls `python:3.12-slim` and the Python packages in
     `requirements.txt`;
   - check `curl 127.0.0.1:5201/health`.
2. **nginx:** `infra/kyc/nginx-preprod-kyc.conf`, then `certbot --nginx -d
   preprod-kyc.sniperbusinesscenter.com`. The zone's DNS-only `*` record already points there.
   Check that the main server gets 200 and any other IP 403.
3. **Main server, risk-preprod `.env`:**
   - `KYC_WORKER_URL=https://preprod-kyc.sniperbusinesscenter.com`;
   - `KYC_SHARED_SECRET` (copied server to server);
   - `USERS_MONGODB_URI=mongodb://localhost:27017/sbc_users_preprod`;
   - then `pm2 restart risk-preprod --update-env`.
4. user-preprod already has `RISK_SERVICE_URL`, so hints start with the deploy.
5. **Backfill:** the first nightly sync submits every preprod member (02:05 Douala), and they
   are checked by 05:00. For a test by day, use `KYC_BACKFILL_ANYTIME=true` in the secondary's
   `.env` for one run.
6. **Prod:** the same steps with `kyc.sniperbusinesscenter.com`, `sbc_users` and the prod
   risk-service.

**Moving an environment that ran the old version (preprod, 2026-11-22):** nothing to migrate.
Pull the new image on the secondary (`docker compose up -d --build` starts `kyc-runner` next to
the worker; both use `data/`), then deploy risk-service. Its first nightly sync submits every
member again (the secondary has no result yet); until then the member view shows the archived
main-server result. Main-server load drops: no more checks or variant lookups there.

## Waiting for decisions

- **Level 2 (Sterling):** test SEON on 500 accounts first, otherwise Holehe. Holehe asks each
  site's sign-up or reset page, so the plan's "no email or SMS reaches a test member" check
  (20 controlled accounts) must pass first. Level 2 is capped at 500 lookups a day.
- **MoMo holder name:** ask CinetPay and MoneyFusion.
- **Gravatar:** add it to the privacy policy (it is a transfer), then switch it on.
- **Using the score in decisions:** with Phase 4 part 2 (live events, enforce mode).
