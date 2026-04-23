#!/bin/bash
set -e

# ============================================
# SBC Backend - Preprod Deployment Script
# ============================================
# Pulls latest develop branch, builds all services,
# rebuilds admin frontend, and restarts PM2 preprod processes.
# ============================================

PREPROD_DIR="/var/www/SBC-MS-preprod"
ADMIN_DIR="$PREPROD_DIR/admin-frontend-ms"
LOG_PREFIX="[PREPROD-DEPLOY]"

echo "$LOG_PREFIX Starting preprod deployment at $(date)"

# Navigate to preprod directory
cd "$PREPROD_DIR" || { echo "$LOG_PREFIX ERROR: Directory $PREPROD_DIR not found"; exit 1; }

# Pull latest develop branch
echo "$LOG_PREFIX Pulling latest develop branch..."
git fetch origin develop
git reset --hard origin/develop

# Install dependencies and build all backend services
echo "$LOG_PREFIX Building backend services..."
bash ./build-all.sh --install --build

# Build admin frontend
echo "$LOG_PREFIX Building admin frontend..."
cd "$ADMIN_DIR"
npm install
npm run build
cd "$PREPROD_DIR"

# Restart PM2 preprod processes
echo "$LOG_PREFIX Restarting PM2 preprod processes..."
pm2 restart ecosystem.preprod.config.js --update-env 2>/dev/null || pm2 start ecosystem.preprod.config.js
pm2 save

# Health check
echo "$LOG_PREFIX Running health checks..."
sleep 5

SERVICES=("6001" "6002" "6003" "6004" "6006" "6007" "6008")
FAILED=0

for PORT in "${SERVICES[@]}"; do
    if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
        echo "$LOG_PREFIX  Service on port $PORT: OK"
    else
        echo "$LOG_PREFIX  Service on port $PORT: FAILED"
        FAILED=1
    fi
done

if [ $FAILED -eq 1 ]; then
    echo "$LOG_PREFIX WARNING: Some services failed health check. Check PM2 logs."
    exit 1
fi

echo "$LOG_PREFIX Preprod deployment completed successfully at $(date)"
