#!/bin/bash
# Adds the SBC hooks to the existing Mongo backup script (default /root/mongodb-backup.sh) without
# rewriting it (it holds the backup user's password): keeps a copy, inserts four kinds of lines,
# idempotent, and checks the result with `bash -n`. A hook that errors never fails the backup.
set -euo pipefail
f="${1:-/root/mongodb-backup.sh}"
grep -q "sbc_hook_before" "$f" && { echo "already installed in $f"; exit 0; }
cp -a "$f" "$f.bak-before-sbc-hooks"
python3 -I - "$f" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
def after(anchor, add):
    global s
    if anchor not in s: sys.exit(f"anchor not found: {anchor}")
    s = s.replace(anchor, anchor + add, 1)
after('log "Starting MongoDB backup process..."',
      '\n# SBC hooks (counts manifest + status for metrics/alerts): /opt/sbc-backup/mongo-backup-hooks.sh\n'
      'if [ -f /opt/sbc-backup/mongo-backup-hooks.sh ]; then . /opt/sbc-backup/mongo-backup-hooks.sh; else sbc_hook_before() { :; }; sbc_hook_after_dump() { :; }; sbc_hook_done() { :; }; fi\n'
      'sbc_hook_before || true')
after('rm -rf $BACKUP_DIR/$BACKUP_NAME/*_preprod', '\n    sbc_hook_after_dump "$BACKUP_DIR/$BACKUP_NAME" || true')
after('log "Backup process completed successfully"', '\n            sbc_hook_done ok "$LOCAL_KEEP_DIR/$BACKUP_NAME.tar.gz" || true')
n = len(re.findall(r'^(\s*)exit 1\s*$', s, flags=re.M))
if n == 0: sys.exit("no exit 1 found")
s = re.sub(r'^(\s*)exit 1\s*$', r'\1sbc_hook_done fail || true\n\1exit 1', s, flags=re.M)
open(p, 'w').write(s)
print(f"hooks installed ({n} failure exits)")
PY
bash -n "$f" || { cp -a "$f.bak-before-sbc-hooks" "$f"; echo "syntax check failed: original restored"; exit 1; }
