#!/bin/bash
# Failure drills on PREPROD (Security plan, test strategy step 4). Run from an admin machine with SSH
# to both servers. Each drill writes its expected outcome first, breaks one preprod dependency for
# about a minute, probes, restores, and records the result in a Markdown report.
#
# Never touches prod, and never stops MongoDB or Redis: both are shared with prod on the main
# server. Losing Redis is simulated by pointing ONE preprod service at a closed port.
#
#   DRILL_USER=<preprod member id> bash scripts/security-plan/drills/run-drills.sh [drill ...]
#   drills: risk user blnk support kyc redis-user alert   (default: all but alert)
# Needs DRILLS_ENABLED=true in payment-preprod's .env (the probe route answers 404 otherwise).
set -uo pipefail
M="${MAIN:-sterling@207.180.242.122}"
S="${SECONDARY:-ubuntu@169.58.159.177}"
U="${DRILL_USER:?set DRILL_USER to a preprod member who can withdraw}"
REPORT="${REPORT:-drills-report.md}"
DRILLS="${*:-risk user blnk support kyc redis-user}"
quiet() { grep -v "post-quantum\|store now\|upgraded" || true; }
m() { ssh -o BatchMode=yes "$M" "$@" 2>&1 | quiet; }
s() { ssh -o BatchMode=yes "$S" "$@" 2>&1; }
pm2_preprod() { case "$2" in *-preprod) m "pm2 $1 $2 >/dev/null && echo ok";; *) echo "refused: $2 is not a preprod process"; exit 1;; esac; }

# The probe: the check every member withdrawal runs first (lock, ledger, fraud decision).
probe() {
    m "cd /var/www/SBC-MS-preprod/payment-service && S=\$(grep -E '^SERVICE_SECRET=' .env | cut -d= -f2-) && curl -s -m 20 -X POST -H \"Authorization: Bearer \$S\" -H 'Content-Type: application/json' -d '{\"userId\":\"$U\"}' localhost:6003/api/internal/drills/withdrawal-check" \
        | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)["data"]; print(("allowed" if d["allowed"] else f"refused {d.get(\"status\")} {d.get(\"message\",\"\")[:90]}") + f" ({d[\"ms\"]} ms)")
except Exception as e: print("probe failed:", e)'
}
health() { m "for p in 6000 6001 6003 6012 6013; do printf \"\$p=\"; curl -s -o /dev/null -m 5 -w '%{http_code} ' localhost:\$p/health; done"; }
restarts() { m "pm2 jlist" | python3 -c 'import json,sys; print(" ".join(f"{p[\"name\"]}:{p[\"pm2_env\"][\"restart_time\"]}" for p in json.load(sys.stdin) if p["name"] in ("payment-preprod","gateway-preprod","user-preprod","risk-preprod","support-preprod","blnk-sync-preprod")))'; }
gw() { m "curl -s -o /dev/null -m 30 -w '%{http_code} in %{time_total}s' -X POST -H 'Content-Type: application/json' -d '{\"email\":\"drill-nobody@example.invalid\",\"password\":\"x\"}' https://preprod.sniperbuisnesscenter.com/api/users/login"; }

out() { echo "$*" | tee -a "$REPORT"; }
row() { out "| $1 | $2 | $3 |"; }

: > "$REPORT"
out "# Failure drills, preprod, $(date '+%Y-%m-%d %H:%M %Z')"
out ""
out "Probe = the check every member withdrawal runs first (lock, ledger, fraud decision), for one preprod member. Health = /health of gateway, user, payment, support, risk."
out ""
out "Baseline: probe $(probe); health $(health)"
out "Restarts before: $(restarts)"

drill_risk() {
    out ""; out "## risk-service down (RISK_MODE=enforce)"
    out "Expected: withdrawals refused 503 within the 1.5 s budget (never paid blind); every other service healthy; allowed again once it is back."
    out "| step | probe | other |"; out "|---|---|---|"
    pm2_preprod stop risk-preprod >/dev/null; sleep 5
    row "risk stopped" "$(probe)" "health $(health)"
    pm2_preprod start risk-preprod >/dev/null; sleep 20
    row "risk back" "$(probe)" "health $(health)"
}
drill_user() {
    out ""; out "## user-service down"
    out "Expected: withdrawals refused 503 (the lock check fails closed); the gateway answers /api/users with an error quickly; allowed again after."
    out "| step | probe | other |"; out "|---|---|---|"
    pm2_preprod stop user-preprod >/dev/null; sleep 5
    row "user stopped" "$(probe)" "gateway login $(gw)"
    pm2_preprod start user-preprod >/dev/null; sleep 25
    row "user back" "$(probe)" "gateway login $(gw)"
}
drill_blnk() {
    out ""; out "## Blnk (second ledger) down"
    out "Expected: LEDGER_TRIPLE_CHECK=log, so withdrawals still allowed, without waiting much longer; blnk-sync worker does not crash-loop; its backlog drains after."
    out "| step | probe | other |"; out "|---|---|---|"
    local before; before=$(m "pm2 jlist" | python3 -c 'import json,sys; print([p["pm2_env"]["restart_time"] for p in json.load(sys.stdin) if p["name"]=="blnk-sync-preprod"][0])')
    s "sudo docker stop blnk-preprod-server-1 >/dev/null && echo stopped" >/dev/null; sleep 20
    row "blnk stopped" "$(probe)" "movements not yet in Blnk $(m "mongosh --quiet mongodb://127.0.0.1/sbc_users_preprod --eval 'db.walletmovements.estimatedDocumentCount() - db.blnk_syncs.estimatedDocumentCount()'" | tail -1)"
    s "sudo docker start blnk-preprod-server-1 >/dev/null && echo started" >/dev/null; sleep 60
    local after; after=$(m "pm2 jlist" | python3 -c 'import json,sys; print([p["pm2_env"]["restart_time"] for p in json.load(sys.stdin) if p["name"]=="blnk-sync-preprod"][0])')
    row "blnk back" "$(probe)" "movements not yet in Blnk $(m "mongosh --quiet mongodb://127.0.0.1/sbc_users_preprod --eval 'db.walletmovements.estimatedDocumentCount() - db.blnk_syncs.estimatedDocumentCount()'" | tail -1); worker restarts $before → $after"
}
drill_support() {
    out ""; out "## support-service down"
    out "Expected: money paths unaffected (allowed); the gateway answers /api/support with an error quickly; support healthy again after."
    out "| step | probe | other |"; out "|---|---|---|"
    pm2_preprod stop support-preprod >/dev/null; sleep 5
    row "support stopped" "$(probe)" "gateway /api/support/health $(m "curl -s -o /dev/null -m 30 -w '%{http_code} in %{time_total}s' https://preprod.sniperbuisnesscenter.com/api/support/health")"
    pm2_preprod start support-preprod >/dev/null; sleep 20
    row "support back" "$(probe)" "support health $(m "curl -s -o /dev/null -m 5 -w '%{http_code}' localhost:6012/health")"
}
drill_kyc() {
    out ""; out "## kyc-worker (secondary) down"
    out "Expected: risk-service keeps working (health ok, decisions unchanged), its KYC outbox waits and drains after."
    out "| step | probe | other |"; out "|---|---|---|"
    s "sudo docker stop kyc-preprod-kyc-worker-1 >/dev/null" >/dev/null; sleep 20
    row "kyc stopped" "$(probe)" "risk health $(m "curl -s -m 5 localhost:6013/health | head -c 60"); KYC outbox $(m "mongosh --quiet mongodb://127.0.0.1/sbc_risk_preprod --eval 'db.kycqueue.countDocuments({})'" | tail -1)"
    s "sudo docker start kyc-preprod-kyc-worker-1 >/dev/null" >/dev/null; sleep 30
    row "kyc back" "$(probe)" "KYC outbox $(m "mongosh --quiet mongodb://127.0.0.1/sbc_risk_preprod --eval 'db.kycqueue.countDocuments({})'" | tail -1)"
}
drill_redis_user() {
    out ""; out "## Redis unreachable for user-service only"
    out "Expected: fail open: sign-in still answers normally (4xx for a wrong account, not 5xx), withdrawals still allowed; back to normal after."
    out "| step | probe | other |"; out "|---|---|---|"
    m "cd /var/www/SBC-MS-preprod/user-service && cp -a .env .env.bak-drill && (grep -q '^REDIS_URL=' .env && sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://127.0.0.1:6399|' .env || echo 'REDIS_URL=redis://127.0.0.1:6399' >> .env) && pm2 restart user-preprod --update-env >/dev/null && echo ok" >/dev/null; sleep 25
    row "redis cut" "$(probe)" "gateway login $(gw)"
    m "cd /var/www/SBC-MS-preprod/user-service && cp -a .env.bak-drill .env && rm .env.bak-drill && pm2 restart user-preprod --update-env >/dev/null && echo ok" >/dev/null; sleep 25
    row "redis back" "$(probe)" "gateway login $(gw)"
}
drill_alert() {
    out ""; out "## Alert path: risk-service down 4 min"
    out "Expected: Grafana « Service injoignable » fires after 3 min, reaches ntfy, then resolves."
    pm2_preprod stop risk-preprod >/dev/null; sleep 270
    local st; st=$(s "P=\$(sudo grep ^GRAFANA_ADMIN_PASSWORD= /opt/metrics/.env | cut -d= -f2); curl -s -u admin:\$P 127.0.0.1:3300/api/prometheus/grafana/api/v1/rules" | python3 -c 'import json,sys; print([r["state"] for g in json.load(sys.stdin)["data"]["groups"] for r in g["rules"] if r["name"]=="Service injoignable"][0])')
    pm2_preprod start risk-preprod >/dev/null; sleep 120
    local sent; sent=$(s "T=\$(sudo grep ^NTFY_TOPIC= /opt/metrics/.env | cut -d= -f2); curl -s \"https://ntfy.sh/\$T/json?poll=1&since=10m\"" | python3 -c 'import json,sys; print(" / ".join(json.loads(l).get("title","") for l in sys.stdin if l.strip())[:300])')
    out "| state after 4.5 min | $st |"; out "| ntfy messages (last 10 min) | ${sent:-none} |"
}

for d in $DRILLS; do "drill_${d//-/_}"; done
out ""; out "Restarts after: $(restarts)"
out "End: probe $(probe); health $(health)"
