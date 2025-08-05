# VPS WhatsApp Delivery Fix Checklist

## 🎯 **ISSUE IDENTIFIED**
Your logs show messages are sent successfully with message IDs, but users don't receive them. This indicates VPS-specific configuration issues.

## 🔧 **IMMEDIATE FIXES NEEDED**

### 1. **Deploy the Retry Logic Fix** ✅ CRITICAL
```bash
# SSH to your VPS and navigate to notification service
cd /path/to/your/notification-service

# Check if the fix is in your code
grep -n "withRetry" src/services/whatsapp-cloud.service.ts

# If not found, you need to deploy the fix:
# Upload the fixed whatsapp-cloud.service.ts file
# Then restart PM2:
pm2 restart notification-service
```

### 2. **Check PM2 Process Health** 
```bash
# Check if service is running
pm2 list

# Check service logs for errors
pm2 logs notification-service --lines 100

# Check memory usage (if low memory, service may be restarting)
pm2 monit

# If service is restarting, increase memory limit:
pm2 delete notification-service
pm2 start ecosystem.config.js --env production
```

### 3. **Verify Environment Variables**
```bash
# Check if all WhatsApp env vars are set
pm2 env notification-service | grep WHATSAPP

# Should show:
# WHATSAPP_ACCESS_TOKEN=EAA...
# WHATSAPP_PHONE_NUMBER_ID=752090027981721
# WHATSAPP_BUSINESS_ACCOUNT_ID=758169559932694
# WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_token
```

### 4. **Test WhatsApp API Connectivity from VPS**
```bash
# Test basic API connectivity
curl -s "https://graph.facebook.com/v18.0/752090027981721" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Should return phone number info if working
```

### 5. **Fix Webhook Configuration** ⚠️ CRITICAL
```bash
# Test if webhook endpoint is accessible
curl "http://localhost:3002/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test"

# Check if webhook URL is publicly accessible (from outside VPS)
curl "http://YOUR_VPS_IP:3002/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test"
```

**If webhook fails:** This explains why delivery confirmations aren't working!

## 🌐 **VPS-SPECIFIC CONFIGURATIONS**

### Hostinger VPS Setup:

1. **Firewall Configuration:**
```bash
# Allow port 3002 for webhook
ufw allow 3002

# Check firewall status
ufw status
```

2. **Service Binding:**
```javascript
// In your server.ts, ensure service binds to all interfaces:
app.listen(port, '0.0.0.0', () => {
    console.log(`Notification service running on port ${port}`);
});
```

3. **Webhook URL Setup:**
```bash
# Your webhook URL should be publicly accessible:
# http://YOUR_VPS_IP:3002/api/whatsapp/webhook
# or
# https://your-domain.com:3002/api/whatsapp/webhook
```

## 🔍 **DIAGNOSTIC COMMANDS**

Run these on your VPS to identify issues:

```bash
# 1. Check current service status
pm2 list
pm2 logs notification-service | tail -50

# 2. Check WhatsApp message activity
pm2 logs notification-service | grep "WhatsApp\|template\|message ID" | tail -20

# 3. Test message sending from VPS
curl -X POST "http://localhost:3002/api/notifications/otp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_SECRET" \
  -d '{
    "userId": "507f1f77bcf86cd799439011",
    "recipient": "237675080477",
    "channel": "whatsapp", 
    "code": "VPS123",
    "expireMinutes": 10,
    "userName": "VPS Test"
  }'

# 4. Check webhook functionality
curl "http://localhost:3002/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123"

# 5. Check database connectivity
mongo --eval "db.notifications.find({channel:'whatsapp'}).sort({createdAt:-1}).limit(5)"
```

## 🎯 **MOST LIKELY CAUSES**

Based on your logs analysis:

### 1. **Retry Logic Not Deployed** (85% likely)
- Your VPS still has the old code without retry logic
- Local tests work because I fixed the local version
- VPS needs the updated `whatsapp-cloud.service.ts`

### 2. **Webhook Not Working** (90% likely)  
- WhatsApp can't reach your webhook URL
- No delivery confirmations = users think messages aren't sent
- Need to configure webhook URL properly

### 3. **Database Not Saving Message IDs** (70% likely)
- PM2 process may be restarting due to memory issues
- Database connections timing out
- Need to check PM2 memory limits

## 🚀 **DEPLOYMENT SCRIPT**

Create this script on your VPS:

```bash
#!/bin/bash
# fix-whatsapp-delivery.sh

echo "🔧 Fixing WhatsApp delivery on VPS..."

# 1. Backup current service
pm2 stop notification-service
cp -r /path/to/notification-service /path/to/notification-service-backup

# 2. Deploy fixed code (upload your fixed files here)
# rsync or git pull the updated code

# 3. Install dependencies if needed
cd /path/to/notification-service
npm install

# 4. Restart with proper configuration
pm2 delete notification-service
pm2 start ecosystem.config.js --env production

# 5. Verify service is working
sleep 5
pm2 list
pm2 logs notification-service --lines 10

echo "✅ Deployment complete. Check logs for any errors."
```

## ⚡ **QUICK TEST**

After applying fixes, test immediately:

```bash
# Send test OTP
curl -X POST "http://localhost:3002/api/notifications/otp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_SECRET" \
  -d '{"userId":"test","recipient":"237675080477","channel":"whatsapp","code":"FIXED1","expireMinutes":10}'

# Check if you receive the WhatsApp message
# Check PM2 logs for successful send with message ID
pm2 logs notification-service | grep "message ID"
```

## 📊 **SUCCESS INDICATORS**

You'll know it's fixed when:
- ✅ PM2 logs show "WhatsApp template message sent successfully" with message IDs
- ✅ Users actually receive the WhatsApp OTP messages  
- ✅ Database contains notifications with `whatsappMessageId` populated
- ✅ Webhook endpoint responds to delivery confirmations

---

**Next Steps:**
1. SSH to your VPS
2. Run the diagnostic commands above
3. Deploy the retry logic fix if missing
4. Fix webhook URL configuration
5. Test with real OTP request

The fix should restore reliable WhatsApp delivery immediately! 🎯 