#!/bin/bash
set -e

# ============================================
# SBC Backend - Preprod Deployment Script (Incremental)
# ============================================
# Only rebuilds and restarts services that changed.
# Pass --full to force a full rebuild of everything.
# ============================================

PREPROD_DIR="/var/www/SBC-MS-preprod"
ADMIN_DIR="$PREPROD_DIR/admin-frontend-ms"
LOG_PREFIX="[PREPROD-DEPLOY]"
FULL_DEPLOY=false

# Parse flags
for arg in "$@"; do
  [ "$arg" = "--full" ] && FULL_DEPLOY=true
done

echo "$LOG_PREFIX Starting preprod deployment at $(date)"
[ "$FULL_DEPLOY" = true ] && echo "$LOG_PREFIX Mode: FULL (all services)"

cd "$PREPROD_DIR" || { echo "$LOG_PREFIX ERROR: Directory $PREPROD_DIR not found"; exit 1; }

# Capture current HEAD before pulling
OLD_HEAD=$(git rev-parse HEAD)

echo "$LOG_PREFIX Pulling latest develop branch..."
git fetch origin develop
git reset --hard origin/develop

NEW_HEAD=$(git rev-parse HEAD)

# Map: service directory -> PM2 app name
declare -A PM2_NAME=(
  [gateway-service]="gateway-preprod"
  [user-service]="user-preprod"
  [notification-service]="notification-preprod"
  [payment-service]="payment-preprod"
  [product-service]="product-preprod"
  [tombola-service]="tombola-preprod"
  [settings-service]="settings-preprod"
  [chat-service]="chat-preprod"
)

CHANGED_SERVICES=()
REBUILD_ADMIN=false

if [ "$FULL_DEPLOY" = true ] || [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
  # Full deploy or nothing changed (manual trigger) — do everything
  CHANGED_SERVICES=("${!PM2_NAME[@]}")
  REBUILD_ADMIN=true
else
  CHANGED_FILES=$(git diff --name-only "$OLD_HEAD" "$NEW_HEAD")
  echo "$LOG_PREFIX Changed files:"
  echo "$CHANGED_FILES" | sed 's/^/    /'

  for SERVICE in "${!PM2_NAME[@]}"; do
    if echo "$CHANGED_FILES" | grep -q "^$SERVICE/"; then
      CHANGED_SERVICES+=("$SERVICE")
    fi
  done

  if echo "$CHANGED_FILES" | grep -q "^admin-frontend-ms/"; then
    REBUILD_ADMIN=true
  fi

  # Shared files that affect all services
  if echo "$CHANGED_FILES" | grep -qE "^(build-all\.sh|ecosystem\.preprod\.config\.js|package\.json)$"; then
    echo "$LOG_PREFIX Shared config changed — switching to full deploy"
    CHANGED_SERVICES=("${!PM2_NAME[@]}")
    REBUILD_ADMIN=true
  fi
fi

if [ ${#CHANGED_SERVICES[@]} -eq 0 ] && [ "$REBUILD_ADMIN" = false ]; then
  echo "$LOG_PREFIX Nothing to deploy."
  exit 0
fi

# Build and restart changed backend services
if [ ${#CHANGED_SERVICES[@]} -gt 0 ]; then
  echo "$LOG_PREFIX Services to update: ${CHANGED_SERVICES[*]}"

  for SERVICE in "${CHANGED_SERVICES[@]}"; do
    NEEDS_INSTALL=false
    if git diff --name-only "$OLD_HEAD" "$NEW_HEAD" | grep -qE "^$SERVICE/package(-lock)?\.json$" || [ "$FULL_DEPLOY" = true ]; then
      NEEDS_INSTALL=true
    fi

    if [ "$NEEDS_INSTALL" = true ]; then
      bash ./build-all.sh --install --build "$SERVICE"
    else
      bash ./build-all.sh --build "$SERVICE"
    fi

    pm2 restart "${PM2_NAME[$SERVICE]}" --update-env
    echo "$LOG_PREFIX  ${PM2_NAME[$SERVICE]} restarted"
  done
fi

# Rebuild admin frontend if changed
if [ "$REBUILD_ADMIN" = true ]; then
  echo "$LOG_PREFIX Rebuilding admin frontend..."
  cd "$ADMIN_DIR"
  if git diff --name-only "$OLD_HEAD" "$NEW_HEAD" | grep -qE "^admin-frontend-ms/package(-lock)?\.json$" || [ "$FULL_DEPLOY" = true ]; then
    npm install
  fi
  npm run build
  cd "$PREPROD_DIR"
  echo "$LOG_PREFIX Admin frontend rebuilt"
fi

pm2 save

# Health check
echo "$LOG_PREFIX Running health checks..."
sleep 5

PORTS=("6001" "6002" "6003" "6004" "6006" "6007" "6008")
FAILED=0

for PORT in "${PORTS[@]}"; do
  if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    echo "$LOG_PREFIX  Port $PORT: OK"
  else
    echo "$LOG_PREFIX  Port $PORT: FAILED"
    FAILED=1
  fi
done

if [ $FAILED -eq 1 ]; then
  echo "$LOG_PREFIX WARNING: Some services failed health check. Check PM2 logs."
  exit 1
fi

echo "$LOG_PREFIX Preprod deployment completed successfully at $(date)"
