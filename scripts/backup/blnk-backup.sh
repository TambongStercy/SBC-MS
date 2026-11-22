#!/bin/bash
# Nightly backup of a Blnk ledger database (PostgreSQL on the SECONDARY server), Security plan
# Phase 0 item 4: pg_dump -Fc with the row counts of every table taken just before and just after
# (restore test bounds), the last 7 kept in /var/backups/sbc-blnk (readable by the sbcbackup user,
# which the main server uses to pull them off this server: blnk-serve.sh). → status.json blnk_<db>.
set -uo pipefail
. "${SBC_BACKUP_HOME:-/opt/sbc-backup}/lib.sh"
DB="${BLNK_DB:-blnk_preprod}"
KEEP_DIR="${KEEP_DIR:-/var/backups/sbc-blnk}"
KEEP="${KEEP:-7}"
PG="${PG_AS-runuser -u postgres --}"   # empty in tests (PG* env instead)
key="blnk_${DB#blnk_}"
name="${DB}_$(date +%Y%m%d_%H%M%S)"
started=$(sbc_now)
fail() { sbc_log "BLNK BACKUP FAILED: $*"; sbc_status_set "$key" "{\"running\": false, \"lastOk\": false, \"lastFailureAt\": $(sbc_now)}"; rm -f "$KEEP_DIR/$name.dump.part"; exit 1; }
counts() {
    $PG psql -X -At -d "$DB" -c "select schemaname||'.'||relname from pg_stat_user_tables order by 1" | while read -r t; do
        printf '%s\t%s\n' "$t" "$($PG psql -X -At -d "$DB" -c "select count(*) from $t")"
    done | python3 -I -c 'import json,sys; print(json.dumps({l.split("\t")[0]: int(l.split("\t")[1]) for l in sys.stdin if "\t" in l}))'
}
sbc_status_set "$key" "{\"lastRunAt\": $started, \"running\": true}"
mkdir -p "$KEEP_DIR"
before=$(counts) || fail "counts"
$PG pg_dump -Fc -d "$DB" > "$KEEP_DIR/$name.dump.part" || fail "pg_dump"
after=$(counts) || fail "counts"
mv "$KEEP_DIR/$name.dump.part" "$KEEP_DIR/$name.dump"
python3 -I -c 'import json,sys,time; json.dump({"db": sys.argv[1], "startedAt": int(sys.argv[2]), "dumpedAt": int(time.time()), "before": json.loads(sys.argv[3]), "after": json.loads(sys.argv[4])}, open(sys.argv[5], "w"))' \
    "$DB" "$started" "$before" "$after" "$KEEP_DIR/$name.manifest.json" || fail "manifest"
chmod 640 "$KEEP_DIR/$name.dump" "$KEEP_DIR/$name.manifest.json"
chgrp sbcbackup "$KEEP_DIR/$name.dump" "$KEEP_DIR/$name.manifest.json" 2>/dev/null || true
ls -1t "$KEEP_DIR/${DB}"_*.dump | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old" "${old%.dump}.manifest.json"; done
size=$(stat -c %s "$KEEP_DIR/$name.dump")
sbc_status_set "$key" "{\"running\": false, \"lastOk\": true, \"lastSuccessAt\": $(sbc_now), \"sizeBytes\": $size, \"file\": \"$name.dump\"}"
sbc_log "Blnk backup done: $name.dump ($size bytes)"
