#!/bin/bash
set -e

# ============================================
# SBC Web UI - Preprod Deployment Script
# ============================================
# Pulls latest develop branch of the web UI repo,
# installs deps, and builds. Nginx serves the built files.
# ============================================

WEB_DIR="/var/www/SBC-WEB-UI-preprod"
LOG_PREFIX="[WEB-PREPROD-DEPLOY]"

echo "$LOG_PREFIX Starting web UI preprod deployment at $(date)"

# Navigate to web UI preprod directory
cd "$WEB_DIR" || { echo "$LOG_PREFIX ERROR: Directory $WEB_DIR not found"; exit 1; }

# Pull latest develop branch
echo "$LOG_PREFIX Pulling latest develop branch..."
git fetch origin develop
git reset --hard origin/develop

# Install dependencies
echo "$LOG_PREFIX Installing dependencies..."
npm install

# Build
echo "$LOG_PREFIX Building web UI..."
npm run build

echo "$LOG_PREFIX Web UI preprod deployment completed successfully at $(date)"
echo "$LOG_PREFIX Nginx serves the built files automatically - no restart needed."
