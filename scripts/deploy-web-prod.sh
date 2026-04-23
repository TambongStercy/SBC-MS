#!/bin/bash
set -e

# ============================================
# SBC Web UI - Production Deployment Script
# ============================================
# Pulls latest master branch of the web UI repo,
# installs deps, and builds. Nginx serves the built files.
# ============================================

WEB_DIR="/var/www/SBC-WEB-UI"
LOG_PREFIX="[WEB-PROD-DEPLOY]"

echo "$LOG_PREFIX Starting web UI production deployment at $(date)"

# Navigate to web UI production directory
cd "$WEB_DIR" || { echo "$LOG_PREFIX ERROR: Directory $WEB_DIR not found"; exit 1; }

# Pull latest master branch
echo "$LOG_PREFIX Pulling latest master branch..."
git fetch origin master
git reset --hard origin/master

# Install dependencies
echo "$LOG_PREFIX Installing dependencies..."
npm install

# Build
echo "$LOG_PREFIX Building web UI..."
npm run build

echo "$LOG_PREFIX Web UI production deployment completed successfully at $(date)"
echo "$LOG_PREFIX Nginx serves the built files automatically - no restart needed."
