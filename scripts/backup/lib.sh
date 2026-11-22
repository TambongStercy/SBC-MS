#!/bin/bash
# Shared helpers for the SBC backup scripts (Security plan Phase 0 item 4, 2026-11-22).
# Installed in /opt/sbc-backup on both servers. Never prints a secret.

SBC_BACKUP_STATUS="${SBC_BACKUP_STATUS:-/var/lib/sbc-backup/status.json}"

sbc_log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# sbc_status_set <key> <json object>: merges the object into status.json under <key> (atomic, locked).
# The gateway turns this file into sbc_backup_* metrics; Grafana alerts from them (ntfy).
sbc_status_set() {
    local key="$1" json="$2"
    mkdir -p "$(dirname "$SBC_BACKUP_STATUS")"
    (
        flock -w 30 9 || exit 1
        python3 -I - "$SBC_BACKUP_STATUS" "$key" "$json" <<'PY'
import json, os, sys, tempfile
path, key, patch = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
try:
    data = json.load(open(path))
except Exception:
    data = {}
entry = data.get(key, {}) if isinstance(data.get(key), dict) else {}
entry.update(patch)
data[key] = entry
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
with os.fdopen(fd, "w") as f:
    json.dump(data, f, indent=1, sort_keys=True)
os.chmod(tmp, 0o644)
os.replace(tmp, path)
PY
    ) 9>"${SBC_BACKUP_STATUS}.lock"
}

sbc_now() { date +%s; }

# sbc_r2 <rclone args>: Cloudflare R2 with the credentials read at run time from settings-service
# (the same way /root/mongodb-backup.sh does), never copied anywhere.
R2_ENV_FILE="${R2_ENV_FILE:-/var/www/SBC-MS/settings-service/.env}"
sbc_r2() {
    ( set -a; . <(grep -E "^R2_(ACCOUNT_ID|ACCESS_KEY_ID|SECRET_ACCESS_KEY)=" "$R2_ENV_FILE"); set +a
      RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true \
      RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}" \
      RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com" \
      rclone "$@" --s3-no-head )
}
