#!/bin/bash
# On the MAIN server, nightly after the secondary's Blnk backup: pulls the newest dump through the
# sbcbackup forced command (blnk-serve.sh), keeps the last 7 in /var/backups/sbc-blnk, uploads to
# R2 (blnk-backups/, 30 days) with the credentials the Mongo backup already uses — no R2 key on the
# secondary. Also copies the secondary's backup and restore-test status into this server's
# status.json, which the gateway exposes as metrics.
set -uo pipefail
. "${SBC_BACKUP_HOME:-/opt/sbc-backup}/lib.sh"
KEEP_DIR="${KEEP_DIR:-/var/backups/sbc-blnk}"
REMOTE="${REMOTE:-sbcbackup@169.58.159.177}"
KEY="${KEY:-/root/.ssh/sbc_backup_pull}"
R2_PATH="${R2_PATH:-r2:sbc-db-backups/blnk-backups}"
SSH="${SSH_CMD:-ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=yes}"
fail() { sbc_log "BLNK PULL FAILED: $*"; sbc_status_set blnk_offsite "{\"running\": false, \"lastOk\": false, \"lastFailureAt\": $(sbc_now)}"; rm -rf "$tmp"; exit 1; }
tmp=$(mktemp -d)
sbc_status_set blnk_offsite "{\"lastRunAt\": $(sbc_now), \"running\": true}"
$SSH "$REMOTE" latest > "$tmp/latest.tar" || fail "ssh latest"
tar -xf "$tmp/latest.tar" -C "$tmp" || fail "unreadable tar"
dump=$(ls "$tmp"/blnk_*.dump 2>/dev/null | head -1)
[ -n "$dump" ] && [ -s "$dump" ] || fail "no dump in the answer"
[ -f "${dump%.dump}.manifest.json" ] || fail "no manifest"
head -c 5 "$dump" | grep -q PGDMP || fail "not a pg_dump custom archive"
name=$(basename "$dump")
mkdir -p "$KEEP_DIR"; chmod 700 "$KEEP_DIR"
if [ ! -f "$KEEP_DIR/$name" ]; then
    sbc_r2 copyto "$dump" "$R2_PATH/$name" >/dev/null 2>&1 || fail "upload of $name to R2"
    sbc_r2 copyto "${dump%.dump}.manifest.json" "$R2_PATH/${name%.dump}.manifest.json" >/dev/null 2>&1 || fail "upload of the manifest"
    mv "$dump" "${dump%.dump}.manifest.json" "$KEEP_DIR/"
fi
ls -1t "$KEEP_DIR"/blnk_*.dump | tail -n +8 | while read -r old; do rm -f "$old" "${old%.dump}.manifest.json"; done
sbc_r2 delete --min-age 30d "$R2_PATH/" >/dev/null 2>&1 || true
size=$(stat -c %s "$KEEP_DIR/$name")
# the secondary's own records (backup and restore test), merged under their keys
remote=$($SSH "$REMOTE" status 2>/dev/null) || remote="{}"
python3 -I -c '
import json, sys
r = json.loads(sys.argv[1] or "{}")
for k, v in r.items():
    if k.startswith(("blnk_", "restore_blnk_")): print(k + "\t" + json.dumps(v))' "$remote" | while IFS=$'\t' read -r k v; do sbc_status_set "$k" "$v"; done
sbc_status_set blnk_offsite "{\"running\": false, \"lastOk\": true, \"lastSuccessAt\": $(sbc_now), \"sizeBytes\": $size, \"file\": \"$name\"}"
rm -rf "$tmp"
sbc_log "Blnk dump $name pulled and copied to R2"
