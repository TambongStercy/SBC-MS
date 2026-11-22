#!/bin/bash
# Nightly backup of the PREPROD MongoDB databases (*_preprod), on the main server (Security plan
# Phase 0 item 4). The prod backup (/root/mongodb-backup.sh) leaves them out on purpose; this one
# covers them, with the same counts manifest, an R2 copy under preprod-mongodb-backups/ (14 days)
# and the last 3 kept in /var/backups/sbc-mongodb-preprod. Outcome → status.json key mongo_preprod.
set -uo pipefail
. "${SBC_BACKUP_HOME:-/opt/sbc-backup}/lib.sh"
KEEP_DIR="${KEEP_DIR:-/var/backups/sbc-mongodb-preprod}"
WORK="${WORK:-/var/tmp/sbc-preprod-backup}"
R2_PATH="${R2_PATH:-r2:sbc-db-backups/preprod-mongodb-backups}"
MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017}"
export SBC_MANIFEST_SCOPE=preprod
name="mongodb_preprod_backup_$(date +%Y%m%d_%H%M%S)"
started=$(sbc_now)
fail() { sbc_log "PREPROD BACKUP FAILED: $*"; sbc_status_set mongo_preprod "{\"running\": false, \"lastOk\": false, \"lastFailureAt\": $(sbc_now)}"; rm -rf "$WORK"; exit 1; }
sbc_status_set mongo_preprod "{\"lastRunAt\": $started, \"running\": true}"
rm -rf "$WORK"; mkdir -p "$WORK/$name" "$KEEP_DIR"
before=$(mongosh --quiet "$MONGO_URI" --file "${SBC_BACKUP_HOME:-/opt/sbc-backup}/mongo-manifest.js" 2>/dev/null | tail -1)
dbs=$(mongosh --quiet "$MONGO_URI" --eval 'db.adminCommand({listDatabases:1, nameOnly:true}).databases.map(d=>d.name).filter(n=>/_preprod$/.test(n)).join(" ")' | tail -1)
[ -n "$dbs" ] || fail "no *_preprod database"
for d in $dbs; do
    nice -n 10 mongodump --uri "$MONGO_URI" --db "$d" --out "$WORK/$name" --quiet || fail "mongodump of $d"
done
after=$(mongosh --quiet "$MONGO_URI" --file "${SBC_BACKUP_HOME:-/opt/sbc-backup}/mongo-manifest.js" 2>/dev/null | tail -1)
python3 -I - "$WORK/$name/sbc-manifest.json" "${before:-null}" "${after:-null}" "$started" <<'PY'
import json, sys, time
p = lambda s: json.loads(s) if s and s != "null" else None
json.dump({"startedAt": int(sys.argv[4]), "dumpedAt": int(time.time()), "scope": "preprod",
           "before": p(sys.argv[2]), "after": p(sys.argv[3])}, open(sys.argv[1], "w"))
PY
tar -czf "$WORK/$name.tar.gz" -C "$WORK" "$name" || fail "compression"
sbc_r2 copyto "$WORK/$name.tar.gz" "$R2_PATH/$name.tar.gz" >/dev/null 2>&1 || fail "upload to R2"
mv "$WORK/$name.tar.gz" "$KEEP_DIR/"
ls -1t "$KEEP_DIR"/mongodb_preprod_backup_*.tar.gz | tail -n +4 | xargs -r rm -f
sbc_r2 delete --min-age 14d "$R2_PATH/" >/dev/null 2>&1 || true
size=$(stat -c %s "$KEEP_DIR/$name.tar.gz")
rm -rf "$WORK"
sbc_status_set mongo_preprod "{\"running\": false, \"lastOk\": true, \"lastSuccessAt\": $(sbc_now), \"sizeBytes\": $size, \"file\": \"$name.tar.gz\", \"durationS\": $(( $(sbc_now) - started ))}"
sbc_log "Preprod backup done: $name.tar.gz ($size bytes)"
