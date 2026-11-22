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
| 5. Level 3 (Smile ID) | — | waits for Rufus |
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

- **kyc-worker:** only `domain → has mail` answers. The request is scored and forgotten.
- **risk-service `kycresults`:**
  - Stored: the signals (validity, country codes, operator families, the email **domain**, flags),
    the reasons, the score and band, an HMAC of the normalised mailbox (`emailKey`, to find
    variants) and an HMAC fingerprint.
  - Never stored: the email, a number or a name. The check scans the stored documents for them.
  - Deleted 12 months after the last check (TTL index on `expiresAt`, `KYC_RETENTION_DAYS`).

### Not quite the plan

- **Private link:** the plan says WireGuard or Tailscale. Blnk already reaches the secondary
  server over HTTPS with an nginx allow-list (main server's IP only) and its own key; the worker
  does the same plus an HMAC on every request (timestamp ±5 min). This avoids changing the network
  setup of both servers. A WireGuard link can replace it later without code changes (only
  `KYC_WORKER_URL`).
- **Queue:** the plan's rule 1 says a Redis stream. user-service has no Redis client, so the hint
  is an HTTP call to risk-service, which keeps the queue in Mongo. The nightly refresh makes a
  lost hint harmless.

## Measured

- **Checks:**
  - `risk-service/src/scripts/check-kyc.ts`: 31 checks, against a fake worker; the same
    checks pass with `KYC_REAL_WORKER_URL` against the real one.
  - `kyc-worker`: `pytest` (13, also in CI).
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
5. **Backfill:** the first nightly refresh queues every preprod member (02:05 Douala), and they
   are checked by 05:00. For a test by day, use `KYC_BACKFILL_ANYTIME=true` for one run.
6. **Prod:** the same steps with `kyc.sniperbusinesscenter.com`, `sbc_users` and the prod
   risk-service. Watch the main server's CPU during the first night (plan: under 70%).

## Waiting for decisions

- **Level 2 (Sterling):** test SEON on 500 accounts first, otherwise Holehe. Holehe asks each
  site's sign-up or reset page, so the plan's "no email or SMS reaches a test member" check
  (20 controlled accounts) must pass first. Level 2 is capped at 500 lookups a day.
- **Level 3 (Rufus):** Smile ID (ID + selfie) above a withdrawal threshold and on authenticator resets.
- **MoMo holder name:** ask CinetPay and MoneyFusion.
- **Gravatar:** add it to the privacy policy (it is a transfer), then switch it on.
- **Using the score in decisions:** with Phase 4 part 2 (live events, enforce mode).
