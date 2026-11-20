# Load-test baseline (Security plan, Phase 0 item 6)

Preprod only. `baseline.js` refuses a production URL.

## Before the first run (preprod)

1. **Copy of production with personal data scrambled** (the plan's preprod rule). Names, emails and phones replaced; balances, transactions and referrals kept.
2. **No email or WhatsApp leaves preprod during the run.** The login journey asks for a sign-in code every time. Point the preprod notification-service at a sink, or leave `LOGIN_RPS` at 0.
3. **`PAYMENT_SANDBOX_ENABLED=true`** in preprod payment-service, so no payment reaches a provider. The deposit journey stops at the payment page anyway.
4. **The users file.** Pick active members of the scrambled copy (with a pack, some filleuls and some history):

   ```
   mongosh --quiet mongodb://localhost:27017/sbc_users_preprod --eval '
     print(JSON.stringify(db.users.aggregate([
       { $match: { deleted: { $ne: true }, blocked: { $ne: true }, role: "user" } },
       { $sample: { size: 2000 } },
       { $project: { _id: 0, id: { $toString: "$_id" }, email: 1 } }
     ]).toArray()))' > users.json
   ```

   For the login journey, add `"password"` to a few test accounts whose password you set on preprod. Accounts without one are skipped.

## Today's peak (1x)

Read it from prod's nginx access log: requests per second at the busiest minute of a normal evening (20:00–23:00 Douala) for each journey's endpoints. Pass the numbers as `BROWSE_RPS`, `LOGIN_RPS`, `DEPOSIT_RPS` and `WITHDRAW_RPS`. The defaults (20 / 2 / 3 / 1) are placeholders.

## Run

```
k6 run -e BASE_URL=https://preprod.sniperbuisnesscenter.com -e JWT_SECRET=... \
       -e USERS_FILE=./users.json -e MULT=1  --summary-export=baseline-1x.json  scripts/security-plan/k6/baseline.js
k6 run ... -e MULT=10 --summary-export=baseline-10x.json scripts/security-plan/k6/baseline.js
```

- **Partial runs:** `SCENARIOS=browse,deposit` runs only those journeys.
- **Duration:** `DURATION=10m` for a longer run.
- **Results:** keep both JSON summaries with the date and the commit deployed. The plan's gate is p95 per endpoint recorded at 1x and 10x, and an error rate below 0.5% at 10x.
- **What counts as an error:** 400/401/403/409/429 answers are expected member refusals (no pack, limit, lock), not platform errors.
- **Server side:** watch CPU, RAM and the Mongo working set on the server during the 10x run. Preprod shares the box with prod, so run it at night.
