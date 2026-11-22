# Failure drills (Security plan, test strategy step 4)

Runner: `scripts/security-plan/drills/run-drills.sh` (preprod only, from an admin machine with SSH
to both servers). Probe: payment-service `POST /api/internal/drills/withdrawal-check` (service
secret, 404 unless `DRILLS_ENABLED=true`, set on preprod only): the check every member withdrawal
runs first (lock, ledger, fraud decision), without any payout.

Never drilled on purpose: MongoDB and Redis on the main server (shared with prod). A Redis loss is
simulated by pointing one preprod service at a closed port.

## Outcome, 2026-11-22

Every drill matched its expected outcome; no service crash-looped (the only restarts are the
drill's own). One defect found and fixed: with a service down, the gateway answered **500** (looks
like a bug); it now answers **503 `SERVICE_UNAVAILABLE`** with `Retry-After: 30` (gateway
`error.middleware.ts`, check `src/scripts/check-proxy-unreachable.ts`).

The report of the run:

### Run, 2026-11-22 11:07 GMT

Probe = the check every member withdrawal runs first (lock, ledger, fraud decision), for one preprod member. Health = /health of gateway, user, payment, support, risk.

Baseline: probe allowed (39 ms); health 6000=200 6001=200 6003=200 6012=200 6013=200 
Restarts before: user-preprod:66 payment-preprod:29 gateway-preprod:23 support-preprod:14 blnk-sync-preprod:16 risk-preprod:11

#### risk-service down (RISK_MODE=enforce)
Expected: withdrawals refused 503 within the 1.5 s budget (never paid blind); every other service healthy; allowed again once it is back.
| step | probe | other |
|---|---|---|
| risk stopped | refused 503 Les retraits sont momentanément indisponibles (vérification de sécurité). Réessayez dans q (37 ms) | health 6000=200 6001=200 6003=200 6012=200 6013=000  |
| risk back | allowed (65 ms) | health 6000=200 6001=200 6003=200 6012=200 6013=200  |

#### user-service down
Expected: withdrawals refused 503 (the lock check fails closed); the gateway answers /api/users with an error quickly; allowed again after.
| step | probe | other |
|---|---|---|
| user stopped | refused 503 Les retraits sont momentanément indisponibles. Veuillez réessayer dans quelques minutes. (6 ms) | gateway login 500 in 0.151589s |
| user back | allowed (56 ms) | gateway login 404 in 0.188508s |

#### Blnk (second ledger) down
Expected: LEDGER_TRIPLE_CHECK=log, so withdrawals still allowed, without waiting much longer; blnk-sync worker does not crash-loop; its backlog drains after.
| step | probe | other |
|---|---|---|
| blnk stopped | allowed (58 ms) | movements not yet in Blnk 0 |
| blnk back | allowed (57 ms) | movements not yet in Blnk 0; worker restarts 16 → 16 |

#### support-service down
Expected: money paths unaffected (allowed); the gateway answers /api/support with an error quickly; support healthy again after.
| step | probe | other |
|---|---|---|
| support stopped | allowed (57 ms) | gateway /api/support/health 500 in 0.062258s |
| support back | allowed (68 ms) | support health 200 |

#### kyc-worker (secondary) down
Expected: risk-service keeps working (health ok, decisions unchanged), its KYC outbox waits and drains after.
| step | probe | other |
|---|---|---|
| kyc stopped | allowed (87 ms) | risk health {"status":"ok","service":"risk-service","mongo":true,"redis"; KYC outbox 0 |
| kyc back | allowed (41 ms) | KYC outbox 0 |

#### Redis unreachable for user-service only
Expected: fail open: sign-in still answers normally (4xx for a wrong account, not 5xx), withdrawals still allowed; back to normal after.
| step | probe | other |
|---|---|---|
| redis cut | allowed (122 ms) | gateway login 404 in 0.158986s |
| redis back | allowed (70 ms) | gateway login 404 in 0.160029s |

Restarts after: user-preprod:68 payment-preprod:29 gateway-preprod:23 support-preprod:14 blnk-sync-preprod:16 risk-preprod:11
End: probe allowed (47 ms); health 6000=200 6001=200 6003=200 6012=200 6013=200 
