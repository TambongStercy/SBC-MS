#!/bin/bash
# Forced command of the sbcbackup user on the SECONDARY server (authorized_keys: command=…,
# from="207.180.242.122", restrict). The main server's pull key can do exactly two things:
#   latest  → tar of the newest Blnk dump + its manifest, on stdout
#   status  → the backup status (no secret)
KEEP_DIR="${KEEP_DIR:-/var/backups/sbc-blnk}"
case "${SSH_ORIGINAL_COMMAND:-}" in
    latest)
        d=$(ls -1t "$KEEP_DIR"/blnk_*.dump 2>/dev/null | head -1)
        [ -n "$d" ] || { echo "no dump" >&2; exit 2; }
        exec tar -cf - -C "$KEEP_DIR" "$(basename "$d")" "$(basename "${d%.dump}.manifest.json")" ;;
    status)
        exec cat "${SBC_BACKUP_STATUS:-/var/lib/sbc-backup/status.json}" ;;
    *)
        echo "not allowed" >&2; exit 1 ;;
esac
