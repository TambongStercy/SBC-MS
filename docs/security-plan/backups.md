# Backups and restore tests (Security plan Phase 0 item 4)

Built 2026-11-22. A backup counts only once it has been restored. Each backup now records what it
should contain, a scheduled test restores it and checks it, and a failure reaches the phone (ntfy)
through the metrics stack (`docs/security-plan/metrics.md`).

## What is backed up

| What | Where it runs | When (CET) | Copies |
|---|---|---|---|
| Prod MongoDB (every DB but `*_preprod`) | main, `/root/mongodb-backup.sh` (existing) | 02:00 | R2 `sbc-db-backups/mongodb-backups/` 30 days, last 3 on the server |
| Preprod MongoDB (`*_preprod`) | main, `mongo-preprod-backup.sh` | 02:40 | R2 `preprod-mongodb-backups/` 14 days, last 3 in `/var/backups/sbc-mongodb-preprod` |
| Blnk ledger (`blnk_preprod`, PostgreSQL) | secondary, `blnk-backup.sh` | 02:30 | last 7 on the secondary |
| … off the secondary | main, `blnk-pull.sh` | 03:30 | last 7 on main (`/var/backups/sbc-blnk`, mode 700), R2 `blnk-backups/` 30 days |

Every backup carries the counts of each collection or table, taken just before and just after the
dump (`sbc-manifest.json` / `.manifest.json`). Neither mongodump nor pg_dump without a replica set
is a point-in-time snapshot, so the restored count must fall between the two.

**The Blnk copy leaves the secondary without an R2 key there.**
- The main server pulls the copy with its own SSH key (`/root/.ssh/sbc_backup_pull`).
- The secondary's `sbcbackup` user only accepts that key from the main server's IP, with a forced
  command (`blnk-serve.sh`) that can do two things: `latest` (the newest dump and its manifest) and
  `status`.
- The main server uploads to R2 with the credentials the Mongo backup already reads from
  settings-service at run time.

KYC's SQLite on the secondary is not backed up, on purpose. Level 1 results are rebuilt by the
nightly sync. Level 3 images must be gone 30 days after the decision, and a backup would keep them
longer. The level 3 decisions are also kept in support's `identityverifications`.

## Restore tests

- **Mongo (`mongo-restore-test.sh`, main server)**:
  1. Downloads the newest backup from R2, proving the off-site copy, and compares its sha256 with
     the local copy.
  2. Starts a throwaway `mongod` on 127.0.0.1:27999 with its own data directory and a 0.5 GB cache,
     at `nice 19` / `ionice idle`.
  3. Restores one database at a time (the disk is tight) and counts every collection, then drops it.
  4. Fails on:
     - any document that failed to restore;
     - a key collection (users, referrals, transactions, payment intents) outside the before/after
       counts;
     - another collection more than 1 % outside them (TTL collections shrink);
     - an R2 copy that differs from the local one;
     - less than `MIN_FREE_GB` free.
  5. Deletes everything, whatever happens. Personal data never leaves the main server.
- **Blnk (`blnk-restore-test.sh`, secondary)**: pg_restore into a temporary database on the same
  PostgreSQL. Every table must fall between the before/after counts. The database is then dropped.
- **Schedule:** preprod Mongo on Sundays 04:30, Blnk on Sundays 04:00. Prod Mongo runs on the first
  Sunday of the month, once installed on prod (below).

## Status → metrics → alerts

The scripts write `/var/lib/sbc-backup/status.json` (no secret). The secondary's records reach the
main server with each pull. The gateway exposes the file (`utils/backup-metrics.ts`):
- `sbc_backup_last_success_timestamp_seconds`, `sbc_backup_last_ok`, `sbc_backup_running` and
  `sbc_backup_size_bytes`, with `kind` = mongo, mongo_preprod, blnk_preprod or blnk_offsite;
- `sbc_restore_test_timestamp_seconds`, `sbc_restore_test_ok` and `sbc_restore_test_documents`.

Prometheus labels them `env="shared"`: it is the same file for both gateways.

Grafana alerts to ntfy:

| Alert | Fires when |
|---|---|
| Sauvegarde en retard | no success for 26 h |
| Sauvegarde en échec | the last run failed |
| Test de restauration en échec | the last test failed |
| Test de restauration trop ancien | no test for 35 days |

A kind missing from the file has no series and so no alert. Prod Mongo appears only once its hooks
are installed.

## Prod Mongo: installing the hooks (needs Sterling's OK, prod)

`install-mongo-hooks.sh /root/mongodb-backup.sh` changes the script without rewriting it (it holds
the backup user's password):
- it keeps `…bak-before-sbc-hooks`;
- it adds four kinds of lines: source the hooks, counts before the dump, the manifest after it, and
  the outcome;
- it checks the result with `bash -n` and puts the original back on any error;
- a hook that errors never fails the backup.

Then uncomment the prod restore test in `/etc/cron.d/sbc-backup`.

## Tests

- `scripts/backup/tests/test-mongo.sh` (`PYTHON_HOME=<a standalone python>`) runs in a `mongo:8.0`
  container against a reconstruction of `/root/mongodb-backup.sh`, with a fake R2. 16 checks:
  - the hooks install, once, and keep the syntax valid;
  - the manifest's before/after counts;
  - the status records;
  - the restore test from R2 passes;
  - it fails on missing users, on an R2 copy that differs, and on too little disk;
  - prod's mongod is untouched and the throwaway mongod is stopped;
  - the preprod backup and its restore test.
- `scripts/backup/tests/test-blnk.sh` runs against a throwaway `postgres:17-alpine`. 11 checks:
  - dump, manifest and kept count;
  - the restore test passes, drops its database, and fails on missing rows;
  - the forced command answers `latest` and `status` and refuses anything else;
  - the pull: main's copy, R2 with the manifest, merged status, a private directory.
- Gateway: `src/scripts/check-backup-metrics.ts`.
