#!/bin/bash

echo "🚀 Deploying Email Delivery Fix for SBC..."
echo "=============================================="

# Check if we're in the correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this script from the notification-service directory"
    exit 1
fi

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}📋 Step 1: Checking Email Configuration...${NC}"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "Please create a .env file with the following configuration:"
    echo ""
    cat << EOF
# Email Configuration (CRITICAL FOR BOUNCE FIX)
EMAIL_SERVICE=SendGrid
EMAIL_USER=apikey
EMAIL_PASSWORD=your_sendgrid_api_key_here
EMAIL_FROM=Sniper Business Center <noreply@sniperbuisnesscenter.com>

# Bounce Handling (NEW)
EMAIL_BOUNCE_HANDLING_ENABLED=true
SENDGRID_WEBHOOK_SECRET=your_webhook_verification_secret
EMAIL_MAX_RETRIES=3
EMAIL_RETRY_DELAY=300000
EOF
    echo ""
    echo -e "${YELLOW}⚠️  Create .env file first, then run this script again${NC}"
    exit 1
fi

# Check critical email variables
echo -e "${BLUE}🔍 Checking email configuration...${NC}"

# Source .env file
source .env

if [ -z "$EMAIL_SERVICE" ] || [ -z "$EMAIL_USER" ] || [ -z "$EMAIL_PASSWORD" ]; then
    echo -e "${RED}❌ Missing critical email configuration!${NC}"
    echo "Please ensure these variables are set in .env:"
    echo "- EMAIL_SERVICE"
    echo "- EMAIL_USER" 
    echo "- EMAIL_PASSWORD"
    exit 1
fi

if [ "$EMAIL_SERVICE" != "SendGrid" ]; then
    echo -e "${YELLOW}⚠️  Warning: EMAIL_SERVICE is not set to SendGrid${NC}"
    echo "Current value: $EMAIL_SERVICE"
    echo "Recommended: SendGrid"
fi

echo -e "${GREEN}✅ Email configuration looks good${NC}"

echo -e "${BLUE}📦 Step 2: Installing/Updating Dependencies...${NC}"

# Install dependencies
npm install

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dependencies installed successfully${NC}"

echo -e "${BLUE}🔨 Step 3: Building TypeScript...${NC}"

# Compile TypeScript
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ TypeScript compilation failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ TypeScript compiled successfully${NC}"

echo -e "${BLUE}🧪 Step 4: Running Email Diagnostics...${NC}"

# Run email diagnostics
node diagnose-email-issues.js > email-diagnostics-report.txt 2>&1

echo -e "${GREEN}✅ Diagnostics completed - check email-diagnostics-report.txt${NC}"

echo -e "${BLUE}🔄 Step 5: Restarting Service...${NC}"

# Stop existing process if running
if pgrep -f "notification-service" > /dev/null; then
    echo "Stopping existing notification-service..."
    pkill -f "notification-service"
    sleep 2
fi

# Start the service
if [ "$NODE_ENV" = "production" ]; then
    echo "Starting notification-service in production mode..."
    npm run start:prod &
else
    echo "Starting notification-service in development mode..."
    npm run start:dev &
fi

# Wait a moment for the service to start
sleep 5

# Check if service is running
if pgrep -f "notification-service" > /dev/null; then
    echo -e "${GREEN}✅ Notification service started successfully${NC}"
else
    echo -e "${RED}❌ Failed to start notification service${NC}"
    echo "Check logs for errors"
    exit 1
fi

echo -e "${BLUE}🔍 Step 6: Testing Email System...${NC}"

# Test webhook endpoint
curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/api/webhook/test > /dev/null
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Webhook endpoint accessible${NC}"
else
    echo -e "${YELLOW}⚠️  Webhook endpoint test failed (this is OK if auth is required)${NC}"
fi

echo ""
echo -e "${GREEN}🎉 EMAIL FIX DEPLOYMENT COMPLETE!${NC}"
echo "=============================================="
echo ""
echo -e "${YELLOW}📋 NEXT STEPS:${NC}"
echo "1. 🌐 Configure DNS records (see URGENT_EMAIL_FIX.md)"
echo "2. 🔧 Set up SendGrid domain authentication"
echo "3. 📊 Monitor bounce rates in dashboard"
echo "4. 🚀 Test email delivery to iCloud addresses"
echo ""
echo -e "${BLUE}📊 Monitoring:${NC}"
echo "- View logs: tail -f logs/combined.log"
echo "- Check bounces: curl http://localhost:3002/api/webhook/bounce-stats"
echo "- Diagnostics report: cat email-diagnostics-report.txt"
echo ""
echo -e "${GREEN}✅ Your email delivery should improve significantly within 24-48 hours!${NC}"
echo ""

# Show final status
echo -e "${BLUE}📈 Current Status:${NC}"
echo "- Service: $(pgrep -f "notification-service" > /dev/null && echo "Running ✅" || echo "Stopped ❌")"
echo "- Email Config: $([ ! -z "$EMAIL_SERVICE" ] && echo "Configured ✅" || echo "Missing ❌")"
echo "- Bounce Handler: $([ "$EMAIL_BOUNCE_HANDLING_ENABLED" = "true" ] && echo "Enabled ✅" || echo "Disabled ⚠️")"
echo ""
echo "🔗 For detailed fix instructions, see: URGENT_EMAIL_FIX.md" 