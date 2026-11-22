#!/bin/bash
# Monthly restore test of the prod MongoDB backup (Security plan Phase 0 item 4), on the MAIN server.
# Nothing leaves the server, and prod's MongoDB is never touched:
#   1. downloads the newest backup from R2 (proves the off-site copy) and checks it against the
#      local copy (sha256);
#   2. starts a throwaway mongod on 127.0.0.1:${TEST_PORT:-27999} (own data dir, 0.5 GB cache);
#   3. restores ONE database at a time (the disk is tight), counts every collection, drops it;
#   4. passes when nothing failed to restore and every key collection's count lies between the
#      counts taken just before and just after the dump (sbc-manifest.json); other collections
#      within 1 % (TTL and cleanup collections shrink);
#   5. deletes everything, writes the outcome to status.json (→ metrics → Grafana → ntfy).
# Options (env): BACKUP_SOURCE=r2|local (default r2), KEEP_DIR, WORK_DIR, MIN_FREE_GB (default 15),
# R2_PATH, PATTERN, KEY_COLLECTIONS, STATUS_KEY (the preprod run: see cron.d-main).
set -uo pipefail
. "${SBC_BACKUP_HOME:-/opt/sbc-backup}/lib.sh"

KEEP_DIR="${KEEP_DIR:-/var/backups/sbc-mongodb}"
WORK_DIR="${WORK_DIR:-/var/tmp/sbc-restore-test}"
TEST_PORT="${TEST_PORT:-27999}"
MIN_FREE_GB="${MIN_FREE_GB:-15}"
R2_PATH="${R2_PATH:-r2:sbc-db-backups/mongodb-backups}"
KEY_COLLECTIONS="${KEY_COLLECTIONS:-sbc_users.users sbc_users.referrals sbc_payment.transactions sbc_payment.paymentintents}"
STATUS_KEY="${STATUS_KEY:-restore_mongo}"          # restore_mongo_preprod for the preprod backup
PATTERN="${PATTERN:-mongodb_backup_*.tar.gz}"     # mongodb_preprod_backup_*.tar.gz for preprod
NICE="nice -n 19 ionice -c3"

fail() {
    sbc_log "RESTORE TEST FAILED: $*"
    sbc_status_set "$STATUS_KEY" "{\"at\": $(sbc_now), \"ok\": false, \"detail\": $(python3 -I -c 'import json,sys;print(json.dumps(sys.argv[1][:300]))' "$*")}"
    exit 1
}

cleanup() {
    if [ -f "$WORK_DIR/db/mongod.lock" ]; then mongod --dbpath "$WORK_DIR/db" --shutdown >/dev/null 2>&1 || true; fi
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

started=$(sbc_now)
sbc_log "Restore test started"
rm -rf "$WORK_DIR"; mkdir -p "$WORK_DIR/db" "$WORK_DIR/x"

free_gb=$(df -P --block-size=1G "$(dirname "$WORK_DIR")" | awk 'NR==2 {print $4}')
[ "${free_gb:-0}" -ge "$MIN_FREE_GB" ] || fail "only ${free_gb} GB free (needs $MIN_FREE_GB)"

local_file=$(ls -1t "$KEEP_DIR"/$PATTERN 2>/dev/null | head -1)
[ -n "$local_file" ] || fail "no local backup in $KEEP_DIR"
name=$(basename "$local_file")

if [ "${BACKUP_SOURCE:-r2}" = r2 ]; then
    sbc_log "Downloading $name from R2"
    sbc_r2 copyto "$R2_PATH/$name" "$WORK_DIR/$name" >/dev/null 2>&1 || fail "download of $name from R2 failed"
    a=$(sha256sum "$WORK_DIR/$name" | cut -d' ' -f1); b=$(sha256sum "$local_file" | cut -d' ' -f1)
    [ "$a" = "$b" ] || fail "R2 copy of $name differs from the local copy"
    archive="$WORK_DIR/$name"
else
    archive="$local_file"
fi

sbc_log "Extracting"
$NICE tar -xzf "$archive" -C "$WORK_DIR/x" || fail "archive $name is unreadable"
[ "$archive" = "$WORK_DIR/$name" ] && rm -f "$archive"
dump=$(find "$WORK_DIR/x" -mindepth 1 -maxdepth 1 -type d | head -1)
[ -n "$dump" ] || fail "archive $name holds no dump"
manifest="$dump/sbc-manifest.json"
[ -f "$manifest" ] || sbc_log "no sbc-manifest.json in this backup (made before 2026-11-22): counts not compared"

sbc_log "Starting a throwaway mongod on 127.0.0.1:$TEST_PORT"
$NICE mongod --dbpath "$WORK_DIR/db" --port "$TEST_PORT" --bind_ip 127.0.0.1 --wiredTigerCacheSizeGB 0.5 \
    --fork --logpath "$WORK_DIR/mongod.log" >/dev/null || fail "throwaway mongod did not start"

results="$WORK_DIR/results.jsonl"; : > "$results"
for dbdir in "$dump"/*/; do
    db=$(basename "$dbdir")
    sbc_log "Restoring $db"
    out=$($NICE mongorestore --port "$TEST_PORT" --nsInclude "$db.*" --dir "$dump" --numInsertionWorkersPerCollection 1 2>&1)
    rc=$?
    restored=$(echo "$out" | grep -oE '[0-9]+ document\(s\) restored successfully' | grep -oE '^[0-9]+' | tail -1)
    failed=$(echo "$out" | grep -oE '[0-9]+ document\(s\) failed to restore' | grep -oE '^[0-9]+' | tail -1)
    counts=$(mongosh --quiet --port "$TEST_PORT" --eval "
        const s = db.getSiblingDB('$db'); const o = {};
        for (const c of s.getCollectionNames()) if (!c.startsWith('system.')) o[c] = s.getCollection(c).countDocuments({});
        print(JSON.stringify(o));" 2>/dev/null | tail -1)
    echo "{\"db\": \"$db\", \"rc\": $rc, \"restored\": ${restored:-0}, \"failed\": ${failed:-0}, \"counts\": ${counts:-null}}" >> "$results"
    mongosh --quiet --port "$TEST_PORT" --eval "db.getSiblingDB('$db').dropDatabase()" >/dev/null 2>&1
done

verdict=$(python3 -I - "$results" "$manifest" "$KEY_COLLECTIONS" <<'PY'
import json, os, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
man = json.load(open(sys.argv[2])) if os.path.exists(sys.argv[2]) else None
keys = set(sys.argv[3].split())
problems, docs, checked = [], 0, 0
for r in rows:
    docs += r["restored"]
    if r["rc"] != 0 or r["failed"]:
        problems.append(f'{r["db"]}: mongorestore rc={r["rc"]}, {r["failed"]} failed')
    if r["counts"] is None:
        problems.append(f'{r["db"]}: could not count'); continue
    if not man or not man.get("before") or not man.get("after"):
        continue
    for c, n in r["counts"].items():
        ns = f'{r["db"]}.{c}'
        b = (man["before"].get(r["db"]) or {}).get(c); a = (man["after"].get(r["db"]) or {}).get(c)
        if b is None or a is None:
            continue
        lo, hi = min(a, b), max(a, b)
        checked += 1
        if ns in keys:
            if not lo <= n <= hi:
                problems.append(f'{ns}: {n} restored, expected {lo}..{hi}')
        elif not lo - max(10, lo * 0.01) <= n <= hi + max(10, hi * 0.01):
            problems.append(f'{ns}: {n} restored, expected about {lo}..{hi}')
if not rows:
    problems.append("no database in the dump")
print(json.dumps({"ok": not problems, "databases": len(rows), "documents": docs, "collectionsChecked": checked,
                  "detail": "; ".join(problems)[:300] or "ok"}))
PY
)
sbc_log "Verdict: $verdict"
python3 -I -c 'import json,sys; sys.exit(0 if json.loads(sys.argv[1])["ok"] else 1)' "$verdict" || fail "$(python3 -I -c 'import json,sys;print(json.loads(sys.argv[1])["detail"])' "$verdict")"
sbc_status_set "$STATUS_KEY" "$(python3 -I -c 'import json,sys; v=json.loads(sys.argv[1]); v.update(at=int(sys.argv[2]), durationS=int(sys.argv[3]), file=sys.argv[4]); print(json.dumps(v))' "$verdict" "$(sbc_now)" "$(( $(sbc_now) - started ))" "$name")"
sbc_log "Restore test passed"
