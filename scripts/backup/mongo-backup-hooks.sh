#!/bin/bash
# Sourced by /root/mongodb-backup.sh (main server, 02:00) — three calls added to it:
#   sbc_hook_before            before mongodump : counts of every prod collection
#   sbc_hook_after_dump <dir>  after mongodump  : counts again, both written into the backup as
#                              sbc-manifest.json (the restore test checks the restored counts
#                              fall between them: mongodump is not a point-in-time snapshot)
#   sbc_hook_done ok|fail [file]  outcome → /var/lib/sbc-backup/status.json (→ metrics → ntfy)
# Uses the script's own MONGO_HOST/PORT/USER/PASSWORD; never prints them.
. "${SBC_BACKUP_HOME:-/opt/sbc-backup}/lib.sh"

_sbc_mongosh() {
    if [ -n "$MONGO_USER" ]; then
        mongosh --quiet --host "$MONGO_HOST:$MONGO_PORT" --username "$MONGO_USER" --password "$MONGO_PASSWORD" --authenticationDatabase admin "$@"
    else
        mongosh --quiet --host "$MONGO_HOST:$MONGO_PORT" "$@"
    fi
}

sbc_hook_before() {
    SBC_MANIFEST_BEFORE="$(_sbc_mongosh --file "${SBC_BACKUP_HOME:-/opt/sbc-backup}/mongo-manifest.js" 2>/dev/null | tail -1)"
    SBC_STARTED_AT=$(sbc_now)
    sbc_status_set mongo "{\"lastRunAt\": $SBC_STARTED_AT, \"running\": true}"
}

sbc_hook_after_dump() {
    local dir="$1" after
    after="$(_sbc_mongosh --file "${SBC_BACKUP_HOME:-/opt/sbc-backup}/mongo-manifest.js" 2>/dev/null | tail -1)"
    python3 -I - "$dir/sbc-manifest.json" "${SBC_MANIFEST_BEFORE:-null}" "${after:-null}" "$SBC_STARTED_AT" <<'PY'
import json, sys, time
def parse(s):
    try: return json.loads(s)
    except Exception: return None
json.dump({"startedAt": int(sys.argv[4] or 0), "dumpedAt": int(time.time()),
           "before": parse(sys.argv[2]), "after": parse(sys.argv[3])}, open(sys.argv[1], "w"))
PY
}

sbc_hook_done() {
    local outcome="$1" file="$2" size=0
    [ -n "$file" ] && [ -f "$file" ] && size=$(stat -c %s "$file")
    if [ "$outcome" = ok ]; then
        sbc_status_set mongo "{\"running\": false, \"lastOk\": true, \"lastSuccessAt\": $(sbc_now), \"sizeBytes\": $size, \"file\": \"$(basename "${file:-}")\"}"
    else
        sbc_status_set mongo "{\"running\": false, \"lastOk\": false, \"lastFailureAt\": $(sbc_now)}"
    fi
}
