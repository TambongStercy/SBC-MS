# Phase 0 item 5: indexes (2026-11-22)

`scripts/security-plan/indexes.mongosh.js` (dry run by default, `APPLY=true` to build, never drops).

**Preprod, applied 2026-11-22 23:03 CET.** The 7 planned indexes were missing; each one was built
in 0.2–0.6 s (users 223k docs, transactions 179k, paymentintents 198k), 2.3 MB in total, with no
visible load:
`secplan_momoNumber`, `secplan_geo_lastActiveAt`, `secplan_dormancy_status` (users);
`secplan_payout_number`, `secplan_blnk_status` (transactions); `secplan_failure_group`,
`secplan_status_gateway_updated` (paymentintents).

**Duplicate `referrals` indexes.**
- **Removed from the schema:** `referrer_1` (prefix of three compound indexes) and `archived_1`
  (prefix of `archived_1_referralLevel_1_createdAt_-1_referrer_1`; 0 uses since the last restart).
- **Then dropped on preprod**, once the code without them was running, since Mongoose never drops
  an index:
  ```
  db.getSiblingDB('sbc_users_preprod').referrals.dropIndex('referrer_1')
  db.getSiblingDB('sbc_users_preprod').referrals.dropIndex('archived_1')
  ```

**Prod (needs Sterling's OK, at night 02:00–05:00):**
1. Run the script with `USERS_DB="sbc_users", PAYMENT_DB="sbc_payment"`, first dry, then
   `APPLY=true`.
2. Only after the release that removes the two fields' `index: true`, drop the two indexes with
   the same commands on `sbc_users`.
