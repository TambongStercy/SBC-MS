#!/usr/bin/env bash
# Downloads the free IP → country / network files (sapics/ip-location-db, own datasets,
# public domain PDDL, rebuilt daily) for the gateway's lookup (gateway-service/src/services/ip-geo.ts).
# They replace GeoLite2, which needs a MaxMind key (decided 2026-11-22: no keyed services).
#
#   IPGEO_DIR=/home/sterling/sbc-ipgeo scripts/security-plan/update-ip-geo.sh
#
# Each file's SHA-256 is checked against the project's published checksum, and its size against a
# floor (a truncated or empty download is refused). The project's checksum release can lag a day
# behind its files (seen 2026-11-22: checksum of the 21st, files of the 22nd). A mismatch whose
# checksum is OLDER than the file is reported as stale and the file is accepted on its format and
# size alone (both come over HTTPS from the same GitHub host); a mismatch with a checksum as new as
# the file refuses everything. Only when all four pass are they moved into
# IPGEO_DIR (the previous ones kept as *.prev). The gateway notices the new files within 10 min.
# One copy serves the prod and preprod gateways. Nightly, e.g. in sterling's crontab:
#   30 4 * * * IPGEO_DIR=/home/sterling/sbc-ipgeo bash /var/www/SBC-MS/scripts/security-plan/update-ip-geo.sh >> /home/sterling/logs/ip-geo.log 2>&1
set -euo pipefail

DIR="${IPGEO_DIR:-/home/sterling/sbc-ipgeo}"
BASE="${IPGEO_BASE_URL:-https://github.com/sapics/ip-location-db/releases/download}"
# file name : minimum number of lines (a real file is far above; far below means truncated)
FILES=(
  "user-country-ipv4.csv:50000"
  "user-country-ipv6.csv:10000"
  "origin-asn-ipv4.csv:50000"
  "origin-asn-ipv6.csv:10000"
)

# Last-Modified of a URL (after redirects) as epoch seconds, empty if unknown.
modified() {
  local v
  v="$(curl -fsIL --max-time 30 "$1" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} /^last-modified:/ { sub(/^[^:]*: */, ""); m=$0 } END { print m }')"
  [[ -n "$v" ]] && date -u -d "$v" +%s 2>/dev/null || true
}

mkdir -p "$DIR"
TMP="$(mktemp -d "$DIR/.download.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
echo "$(date -u +%FT%TZ) ip-geo: downloading into $TMP"

for entry in "${FILES[@]}"; do
  f="${entry%%:*}"; min="${entry##*:}"
  curl -fsSL --retry 3 --max-time 600 -o "$TMP/$f" "$BASE/latest/$f"
  curl -fsSL --retry 3 --max-time 60 -o "$TMP/$f.sha256" "$BASE/checksum/$f.sha256"
  want="$(awk '{print tolower($1); exit}' "$TMP/$f.sha256")"
  got="$(sha256sum "$TMP/$f" | awk '{print $1}')"
  if [[ ! "$want" =~ ^[0-9a-f]{64}$ ]] || [[ "$want" != "$got" ]]; then
    file_at="$(modified "$BASE/latest/$f")"; sum_at="$(modified "$BASE/checksum/$f.sha256")"
    if [[ -n "$file_at" && -n "$sum_at" ]] && (( sum_at < file_at )); then
      echo "ip-geo: $f checksum is stale (published $(date -u -d @"$sum_at" +%F), file $(date -u -d @"$file_at" +%F)): checked on format and size only"
    else
      echo "ip-geo: $f checksum mismatch (want ${want:0:12}…, got ${got:0:12}…): nothing replaced" >&2
      exit 1
    fi
  fi
  # format: every line a range then a value (IPv4 or IPv6 text), checked on a sample
  if ! head -n 2000 "$TMP/$f" | grep -vE '^ip_range_start' | awk -F, 'NF < 3 || $1 !~ /^[0-9a-fA-F:.]+$/ || $2 !~ /^[0-9a-fA-F:.]+$/ { bad++ } END { exit bad > 0 }'; then
    echo "ip-geo: $f is not in the expected format: nothing replaced" >&2
    exit 1
  fi
  lines="$(wc -l < "$TMP/$f")"
  if (( lines < min )); then
    echo "ip-geo: $f has only $lines lines (< $min): nothing replaced" >&2
    exit 1
  fi
  echo "ip-geo: $f ok ($lines lines, $(du -h "$TMP/$f" | cut -f1))"
done

for entry in "${FILES[@]}"; do
  f="${entry%%:*}"
  [[ -f "$DIR/$f" ]] && mv -f "$DIR/$f" "$DIR/$f.prev"
  mv -f "$TMP/$f" "$DIR/$f"
done
echo "$(date -u +%FT%TZ) ip-geo: updated $DIR"
