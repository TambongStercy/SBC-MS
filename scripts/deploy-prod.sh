#!/bin/bash
set -e

# ============================================
# SBC Backend - Production Deployment Script
# ============================================
# Pulls latest master branch, builds all services,
# rebuilds admin frontend, and restarts PM2 prod processes.
# ============================================

PROD_DIR="/var/www/SBC-MS"
ADMIN_DIR="$PROD_DIR/admin-frontend-ms"
LOG_PREFIX="[PROD-DEPLOY]"

echo "$LOG_PREFIX Starting production deployment at $(date)"

# Navigate to production directory
cd "$PROD_DIR" || { echo "$LOG_PREFIX ERROR: Directory $PROD_DIR not found"; exit 1; }

# Pull latest master branch
echo "$LOG_PREFIX Pulling latest master branch..."
git fetch origin master
git reset --hard origin/master

# Install dependencies and build all backend services
echo "$LOG_PREFIX Building backend services..."
bash ./build-all.sh --install --build

# Build admin frontend
echo "$LOG_PREFIX Building admin frontend..."
cd "$ADMIN_DIR"
npm install
npm run build
cd "$PROD_DIR"

# Restart PM2 production processes
echo "$LOG_PREFIX Restarting PM2 production processes..."
pm2 restart ecosystem.config.js --update-env
pm2 save

# Health check
echo "$LOG_PREFIX Running health checks..."
sleep 5

SERVICES=("3001" "3002" "3003" "3004" "3006" "3007" "3008")
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

echo "$LOG_PREFIX Production deployment completed successfully at $(date)"
