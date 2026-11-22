#!/usr/bin/env bash
# Downloads the free IP → country / network files (sapics/ip-location-db, own datasets,
# public domain PDDL, rebuilt daily) for the gateway's lookup (gateway-service/src/services/ip-geo.ts).
# They replace GeoLite2, which needs a MaxMind key (decided 2026-11-22: no keyed services).
#
#   IPGEO_DIR=/home/sterling/sbc-ipgeo scripts/security-plan/update-ip-geo.sh
#
# Each file's SHA-256 is checked against the project's published checksum, and its size against a
# floor (a truncated or empty download is refused). Only when all four pass are they moved into
# IPGEO_DIR (the previous ones kept as *.prev). The gateway notices the new files within 10 min.
# One copy serves the prod and preprod gateways. Nightly, e.g. in sterling's crontab:
#   30 4 * * * IPGEO_DIR=/home/sterling/sbc-ipgeo /var/www/SBC-MS/scripts/security-plan/update-ip-geo.sh >> /home/sterling/logs/ip-geo.log 2>&1
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
    echo "ip-geo: $f checksum mismatch (want ${want:0:12}…, got ${got:0:12}…): nothing replaced" >&2
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
