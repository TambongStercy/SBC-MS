#!/bin/bash
# Monthly restore test of the newest Blnk dump, on the SECONDARY server: pg_restore into a
# temporary database on the same PostgreSQL, every table's count must lie between the counts
# taken before and after the dump, then the temporary database is dropped. → restore_blnk_<db>.
set -uo pipefail
. "${SBC_BACKUP_HOME:-/opt/sbc-backup}/lib.sh"
DB="${BLNK_DB:-blnk_preprod}"
KEEP_DIR="${KEEP_DIR:-/var/backups/sbc-blnk}"
PG="${PG_AS-runuser -u postgres --}"
key="restore_blnk_${DB#blnk_}"
tmpdb="sbc_restoretest_$$"
started=$(sbc_now)
cleanup() { $PG dropdb --if-exists "$tmpdb" >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { sbc_log "BLNK RESTORE TEST FAILED: $*"; sbc_status_set "$key" "{\"at\": $(sbc_now), \"ok\": false, \"detail\": $(python3 -I -c 'import json,sys;print(json.dumps(sys.argv[1][:300]))' "$*")}"; exit 1; }
dump=$(ls -1t "$KEEP_DIR/${DB}"_*.dump 2>/dev/null | head -1)
[ -n "$dump" ] || fail "no dump of $DB in $KEEP_DIR"
manifest="${dump%.dump}.manifest.json"
[ -f "$manifest" ] || fail "no manifest for $(basename "$dump")"
$PG createdb "$tmpdb" || fail "createdb"
$PG pg_restore --no-owner --no-acl --exit-on-error -d "$tmpdb" < "$dump" 2>/tmp/sbc-pgrestore.$$ || fail "pg_restore: $(tail -2 /tmp/sbc-pgrestore.$$ | tr '\n' ' ')"
rm -f /tmp/sbc-pgrestore.$$
restored=$($PG psql -X -At -d "$tmpdb" -c "select schemaname||'.'||relname from pg_stat_user_tables order by 1" | while read -r t; do
    printf '%s\t%s\n' "$t" "$($PG psql -X -At -d "$tmpdb" -c "select count(*) from $t")"; done)
verdict=$(printf '%s' "$restored" | python3 -I -c '
import json, sys
m = json.load(open(sys.argv[1])); got = {l.split("\t")[0]: int(l.split("\t")[1]) for l in sys.stdin if "\t" in l}
problems, rows = [], 0
for t, b in m["before"].items():
    a = m["after"].get(t, b); lo, hi = min(a, b), max(a, b); n = got.get(t)
    if n is None: problems.append(f"{t}: missing")
    else:
        rows += n
        if not lo <= n <= hi: problems.append(f"{t}: {n} restored, expected {lo}..{hi}")
print(json.dumps({"ok": not problems and bool(m["before"]), "tables": len(got), "rows": rows, "detail": "; ".join(problems)[:300] or "ok"}))' "$manifest")
python3 -I -c 'import json,sys; sys.exit(0 if json.loads(sys.argv[1])["ok"] else 1)' "$verdict" || fail "$(python3 -I -c 'import json,sys;print(json.loads(sys.argv[1])["detail"])' "$verdict")"
sbc_status_set "$key" "$(python3 -I -c 'import json,sys; v=json.loads(sys.argv[1]); v.update(at=int(sys.argv[2]), durationS=int(sys.argv[3]), file=sys.argv[4]); print(json.dumps(v))' "$verdict" "$(sbc_now)" "$(( $(sbc_now) - started ))" "$(basename "$dump")")"
sbc_log "Blnk restore test passed: $verdict"
