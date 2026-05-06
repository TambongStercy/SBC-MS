#!/bin/bash
set -e

# ============================================
# SBC Backend - Production Deployment Script (Incremental)
# ============================================
# Only rebuilds and restarts services that changed.
# Pass --full to force a full rebuild of everything.
# ============================================

PROD_DIR="/var/www/SBC-MS"
ADMIN_DIR="$PROD_DIR/admin-frontend-ms"
LOG_PREFIX="[PROD-DEPLOY]"
FULL_DEPLOY=false

# Parse flags
for arg in "$@"; do
  [ "$arg" = "--full" ] && FULL_DEPLOY=true
done

echo "$LOG_PREFIX Starting production deployment at $(date)"
[ "$FULL_DEPLOY" = true ] && echo "$LOG_PREFIX Mode: FULL (all services)"

cd "$PROD_DIR" || { echo "$LOG_PREFIX ERROR: Directory $PROD_DIR not found"; exit 1; }

# Capture current HEAD before pulling
OLD_HEAD=$(git rev-parse HEAD)

echo "$LOG_PREFIX Pulling latest master branch..."
git fetch origin master
git reset --hard origin/master

NEW_HEAD=$(git rev-parse HEAD)

# Map: service directory -> PM2 app name
declare -A PM2_NAME=(
  [gateway-service]="gateway-service"
  [user-service]="user-service"
  [notification-service]="notification-service"
  [payment-service]="payment-service"
  [product-service]="product-service"
  [tombola-service]="tombola-service"
  [settings-service]="settings-service"
  [chat-service]="chat-service"
)

CHANGED_SERVICES=()
REBUILD_ADMIN=false

if [ "$FULL_DEPLOY" = true ] || [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
  # Full deploy or manual trigger — do everything
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
  if echo "$CHANGED_FILES" | grep -qE "^(build-all\.sh|ecosystem\.config\.js|package\.json)$"; then
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
  cd "$PROD_DIR"
  echo "$LOG_PREFIX Admin frontend rebuilt"
fi

pm2 save

# Health check
echo "$LOG_PREFIX Running health checks..."
sleep 5

PORTS=("3001" "3002" "3003" "3004" "3006" "3007" "3008")
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

echo "$LOG_PREFIX Production deployment completed successfully at $(date)"
