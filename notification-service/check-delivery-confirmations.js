const { MongoClient } = require('mongodb');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Script to check delivery confirmations and webhook status
async function checkDeliveryConfirmations() {
    console.log('🔍 WhatsApp Delivery Confirmation Analysis\n');
    console.log('='.repeat(60));

    const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/sbc_notification_dev';

    try {
        const client = new MongoClient(mongoUrl);
        await client.connect();
        const db = client.db('sbc_notification_dev');

        console.log('✅ Connected to MongoDB');

        // Check recent notifications with detailed status
        console.log('\n📊 Recent WhatsApp Notifications Analysis');
        console.log('-'.repeat(50));

        const recentNotifications = await db.collection('notifications').find({
            channel: 'whatsapp',
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
        }).sort({ createdAt: -1 }).limit(20).toArray();

        console.log(`📱 Found ${recentNotifications.length} WhatsApp notifications in last 7 days\n`);

        if (recentNotifications.length === 0) {
            console.log('ℹ️  No WhatsApp notifications found in the last 7 days');
            await client.close();
            return;
        }

        // Analyze delivery patterns
        const statusCounts = {
            pending: 0,
            sent: 0,
            delivered: 0,
            failed: 0,
            withMessageId: 0,
            withDeliveryStatus: 0,
            withWebhookData: 0
        };

        console.log('📋 Recent Notifications Detail:');
        console.log('Time                | Recipient     | Status     | Message ID | Delivery Status');
        console.log('-'.repeat(80));

        recentNotifications.forEach((notif, index) => {
            const time = new Date(notif.createdAt).toLocaleString();
            const recipient = notif.recipient.substring(0, 6) + '***';
            const status = notif.status || 'unknown';
            const messageId = notif.whatsappMessageId ? 'YES' : 'NO';
            const deliveryStatus = notif.whatsappStatus || 'none';

            console.log(`${time} | ${recipient.padEnd(13)} | ${status.padEnd(10)} | ${messageId.padEnd(10)} | ${deliveryStatus}`);

            // Count statuses
            statusCounts[status] = (statusCounts[status] || 0) + 1;
            if (notif.whatsappMessageId) statusCounts.withMessageId++;
            if (notif.whatsappStatus) statusCounts.withDeliveryStatus++;
            if (notif.whatsappDeliveredAt || notif.whatsappReadAt) statusCounts.withWebhookData++;
        });

        console.log('\n📊 Status Summary:');
        console.log(`   📤 Sent: ${statusCounts.sent || 0}`);
        console.log(`   ✅ Delivered: ${statusCounts.delivered || 0}`);
        console.log(`   ❌ Failed: ${statusCounts.failed || 0}`);
        console.log(`   ⏳ Pending: ${statusCounts.pending || 0}`);
        console.log(`   🆔 With Message ID: ${statusCounts.withMessageId}`);
        console.log(`   📡 With Delivery Status: ${statusCounts.withDeliveryStatus}`);
        console.log(`   🔔 With Webhook Data: ${statusCounts.withWebhookData}`);

        // Calculate delivery rate
        const totalSent = statusCounts.sent + statusCounts.delivered;
        const deliveryRate = totalSent > 0 ? (statusCounts.delivered / totalSent * 100).toFixed(1) : 0;
        console.log(`   📈 Delivery Confirmation Rate: ${deliveryRate}%`);

        // Check webhook configuration
        console.log('\n🔗 Webhook Configuration Check');
        console.log('-'.repeat(50));

        await checkWebhookConfiguration();

        // Check recent webhook activity  
        console.log('\n📥 Recent Webhook Activity');
        console.log('-'.repeat(50));

        await checkRecentWebhookActivity();

        await client.close();

        // Generate recommendations
        console.log('\n💡 Analysis Results');
        console.log('='.repeat(60));

        if (statusCounts.withMessageId > 0 && statusCounts.withDeliveryStatus === 0) {
            console.log('🚨 CRITICAL ISSUE: Messages are being sent but NO delivery confirmations received');
            console.log('   This indicates webhook delivery status updates are not working');
            console.log('   Possible causes:');
            console.log('   1. Webhook URL not accessible from WhatsApp servers');
            console.log('   2. Webhook verification failing');
            console.log('   3. Webhook processing errors');
            console.log('   4. WhatsApp webhook configuration incorrect');
        } else if (statusCounts.withDeliveryStatus < statusCounts.withMessageId * 0.5) {
            console.log('⚠️  WARNING: Low delivery confirmation rate');
            console.log('   Some webhook updates are coming through but not all');
        } else {
            console.log('✅ Webhook delivery confirmations appear to be working');
        

        if (statusCounts.delivered === 0 && statusCounts.sent > 0) {
            console.log('\n🎯 RECOMMENDATION: Implement immediate diagnostic');
            console.log('1. Test webhook endpoint manually');
            console.log('2. Check WhatsApp webhook configuration in Business Manager');
            console.log('3. Verify webhook URL is publicly accessible');
            console.log('4. Check webhook processing logs for errors');
        }

    } catch (error) {
        console.error('❌ Error analyzing delivery confirmations:', error.message);
    }
}

async function checkWebhookConfiguration() {
    try {
        const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL || 'Not configured';
        const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'Not configured';

        console.log(`📍 Webhook URL: ${webhookUrl}`);
        console.log(`🔑 Verify Token: ${verifyToken.length > 0 ? 'Configured' : 'Not configured'}`);

        // Test if webhook URL is accessible
        if (webhookUrl.startsWith('http')) {
            try {
                const response = await axios.get(webhookUrl.replace('/webhook', '/health'), { timeout: 5000 });
                console.log(`✅ Webhook endpoint accessible (${response.status})`);
            } catch (error) {
                console.log(`❌ Webhook endpoint not accessible: ${error.message}`);
            }
        }

    } catch (error) {
        console.log(`⚠️  Could not check webhook configuration: ${error.message}`);
    }
}

async function checkRecentWebhookActivity() {
    try {
        // Check if there are any recent webhook logs
        const fs = require('fs');
        const path = require('path');

        const logFiles = ['combined.log', 'webhook.log', 'whatsapp.log'];
        let webhookActivity = false;

        for (const logFile of logFiles) {
            const logPath = path.join(__dirname, 'logs', logFile);
            if (fs.existsSync(logPath)) {
                const content = fs.readFileSync(logPath, 'utf8');
                const webhookLines = content.split('\n')
                    .filter(line => line.includes('webhook') || line.includes('delivery') || line.includes('status'))
                    .slice(-5);

                if (webhookLines.length > 0) {
                    console.log(`📄 Recent webhook activity in ${logFile}:`);
                    webhookLines.forEach(line => console.log(`   ${line.substring(0, 100)}...`));
                    webhookActivity = true;
                }
            }
        }

        if (!webhookActivity) {
            console.log('⚠️  No recent webhook activity found in logs');
            console.log('   This suggests webhooks are not being received or processed');
        }

    } catch (error) {
        console.log(`⚠️  Could not check webhook activity: ${error.message}`);
    }
}

// Run the check
checkDeliveryConfirmations().catch(console.error); 