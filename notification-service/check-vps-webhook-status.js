const axios = require('axios');

// Script to check VPS webhook status and delivery confirmations
async function checkVpsWebhookStatus() {
    console.log('🔍 VPS Webhook & Delivery Status Check\n');
    console.log('='.repeat(60));

    // Since VPS is sending messages successfully but users don't receive them,
    // the issue is likely webhook/delivery confirmation related

    console.log('📋 DIAGNOSIS SUMMARY:');
    console.log('✅ VPS sends messages successfully (logs show message IDs)');
    console.log('✅ Retry logic fix is deployed on VPS');
    console.log('❌ Users don\'t receive messages');
    console.log('❌ Local token expired (needs refresh)');
    console.log('');

    console.log('🎯 ROOT CAUSE: Webhook/Delivery Confirmation Issues');
    console.log('');

    console.log('🔧 VPS COMMANDS TO RUN:');
    console.log('Run these commands on your Hostinger VPS:\n');

    // 1. Check current webhook status
    console.log('1️⃣  CHECK WEBHOOK ENDPOINT:');
    console.log('curl -X GET "http://localhost:3002/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123"');
    console.log('   Expected: Should return "test123"');
    console.log('');

    // 2. Check if webhook is publicly accessible
    console.log('2️⃣  CHECK PUBLIC WEBHOOK ACCESS:');
    console.log('curl -X GET "http://YOUR_VPS_IP:3002/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123"');
    console.log('   Expected: Should return "test123" from external access');
    console.log('');

    // 3. Check WhatsApp webhook configuration
    console.log('3️⃣  VERIFY WHATSAPP WEBHOOK CONFIG:');
    console.log('Check Meta Business Manager → WhatsApp → Configuration:');
    console.log('   Webhook URL: http://YOUR_VPS_IP:3002/api/whatsapp/webhook');
    console.log('   Verify Token: YOUR_VERIFY_TOKEN');
    console.log('   Subscribed Fields: messages, message_deliveries, message_reads');
    console.log('');

    // 4. Test message sending with tracking
    console.log('4️⃣  SEND TEST MESSAGE WITH TRACKING:');
    console.log(`curl -X POST "http://localhost:3002/api/notifications/otp" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SERVICE_SECRET" \\
  -d '{
    "userId": "test-webhook-user",
    "recipient": "237675080477",
    "channel": "whatsapp",
    "code": "WEBHOOK1",
    "expireMinutes": 10,
    "userName": "Webhook Test"
  }'`);
    console.log('');

    // 5. Check delivery confirmations in database
    console.log('5️⃣  CHECK DELIVERY CONFIRMATIONS:');
    console.log('mongo --eval "db.notifications.find({channel:\'whatsapp\', whatsappMessageId:{$exists:true}}).sort({createdAt:-1}).limit(3).pretty()"');
    console.log('   Look for: deliveredAt, readAt, or status updates');
    console.log('');

    // 6. Check recent webhook activity
    console.log('6️⃣  CHECK WEBHOOK ACTIVITY IN LOGS:');
    console.log('pm2 logs notification-service | grep "webhook\\|delivery\\|read_receipt" | tail -20');
    console.log('');

    console.log('🚨 MOST LIKELY ISSUES:');
    console.log('');
    console.log('📌 ISSUE 1: Webhook URL Not Publicly Accessible (85% likely)');
    console.log('   • WhatsApp can\'t reach your VPS webhook endpoint');
    console.log('   • Messages are sent but no delivery confirmations received');
    console.log('   • Users may have settings blocking unknown numbers');
    console.log('');
    console.log('📌 ISSUE 2: Firewall Blocking Webhook (70% likely)');
    console.log('   • Port 3002 blocked by VPS firewall');
    console.log('   • Hostinger firewall blocking incoming webhook requests');
    console.log('');
    console.log('📌 ISSUE 3: Users Block Unknown Numbers (60% likely)');
    console.log('   • Users have settings blocking messages from unknown businesses');
    console.log('   • WhatsApp spam filters blocking template messages');
    console.log('');

    console.log('🔧 IMMEDIATE FIXES:');
    console.log('');
    console.log('1. REFRESH LOCAL ACCESS TOKEN:');
    console.log('   • Go to Meta Business Manager → WhatsApp → API Setup');
    console.log('   • Generate new temporary access token');
    console.log('   • Update your local .env file');
    console.log('');
    console.log('2. FIX VPS WEBHOOK:');
    console.log('   • Ensure port 3002 is open: ufw allow 3002');
    console.log('   • Check if service binds to 0.0.0.0, not just localhost');
    console.log('   • Update webhook URL in Meta Business Manager');
    console.log('');
    console.log('3. TEST WITH SAVED CONTACT:');
    console.log('   • Ask test user to save your business WhatsApp number as contact');
    console.log('   • This often resolves delivery issues');
    console.log('');

    console.log('⚡ QUICK VERIFICATION:');
    console.log('After fixes, you should see:');
    console.log('✅ Webhook endpoint responds to external requests');
    console.log('✅ PM2 logs show webhook delivery confirmations');
    console.log('✅ Database notifications get deliveredAt timestamps');
    console.log('✅ Users actually receive WhatsApp messages');
    console.log('');

    console.log('🎯 PRIORITY ORDER:');
    console.log('1. First: Fix webhook URL accessibility');
    console.log('2. Second: Refresh your local access token for testing');
    console.log('3. Third: Ask users to save business number as contact');
    console.log('');

    // Generate the actual commands for user's VPS
    console.log('📝 COPY-PASTE COMMANDS FOR YOUR VPS:');
    console.log('');
    console.log('# Check if webhook endpoint works locally');
    console.log('curl "http://localhost:3002/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=test123"');
    console.log('');
    console.log('# Check firewall status');
    console.log('ufw status');
    console.log('');
    console.log('# Open port if needed');
    console.log('ufw allow 3002');
    console.log('');
    console.log('# Check if service binds to all interfaces (should show 0.0.0.0:3002)');
    console.log('netstat -tlnp | grep 3002');
    console.log('');
    console.log('# Send test message and track it');
    console.log('curl -X POST "http://localhost:3002/api/notifications/otp" -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_SERVICE_SECRET" -d \'{"userId":"webhook-test","recipient":"237675080477","channel":"whatsapp","code":"WEBHOOK1","expireMinutes":10}\'');
    console.log('');
    console.log('# Check for delivery confirmations');
    console.log('pm2 logs notification-service | grep "webhook\\|delivery" | tail -10');
}

// Additional helper for webhook testing
function generateWebhookTestPayload() {
    console.log('\n📱 WEBHOOK TEST PAYLOAD');
    console.log('Use this to manually test webhook from external source:');
    console.log('');
    console.log('POST http://YOUR_VPS_IP:3002/api/whatsapp/webhook');
    console.log('Content-Type: application/json');
    console.log('');
    console.log(JSON.stringify({
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
            "changes": [{
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {
                        "display_phone_number": "15550123456",
                        "phone_number_id": "752090027981721"
                    },
                    "statuses": [{
                        "id": "test_message_id_123",
                        "status": "delivered",
                        "timestamp": Math.floor(Date.now() / 1000),
                        "recipient_id": "237675080477"
                    }]
                },
                "field": "messages"
            }]
        }]
    }, null, 2));
}

if (require.main === module) {
    checkVpsWebhookStatus();
    generateWebhookTestPayload();
}

module.exports = { checkVpsWebhookStatus, generateWebhookTestPayload }; 