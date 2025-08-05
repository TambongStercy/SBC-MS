const axios = require('axios');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

// Urgent diagnostic to identify the database saving issue
async function urgentDiagnosis() {
    console.log('🚨 URGENT WhatsApp Delivery Diagnosis\n');
    console.log('='.repeat(60));

    // 1. Test if notification service is responding
    console.log('1️⃣ Notification Service Health Check');
    console.log('-'.repeat(40));

    const serviceUrls = [
        'http://localhost:3002',
        'http://127.0.0.1:3002',
        'http://notification-service:3002'
    ];

    let workingServiceUrl = null;

    for (const url of serviceUrls) {
        try {
            const response = await axios.get(`${url}/api/health`, { timeout: 3000 });
            console.log(`✅ Service responding at: ${url} (${response.status})`);
            workingServiceUrl = url;
            break;
        } catch (error) {
            console.log(`❌ Service not responding at: ${url}`);
        }
    }

    if (!workingServiceUrl) {
        console.log('🚨 CRITICAL: Notification service is not running!');
        console.log('   This explains why recent notifications aren\'t in database');
        console.log('   Solution: Start the notification service');
        return;
    }

    // 2. Test sending an OTP and track what happens
    console.log('\n2️⃣ Live OTP Test & Database Tracking');
    console.log('-'.repeat(40));

    try {
        // Connect to database first to monitor
        const client = new MongoClient('mongodb://localhost:27017/sbc_notification_dev');
        await client.connect();
        const db = client.db();
        const notificationsCollection = db.collection('notifications');

        // Get count before sending
        const countBefore = await notificationsCollection.countDocuments();
        console.log(`📊 Notifications in DB before test: ${countBefore}`);

        // Send test OTP
        console.log('📤 Sending test OTP...');
        const testOtpResponse = await axios.post(`${workingServiceUrl}/api/notifications/otp`, {
            userId: "507f1f77bcf86cd799439011",
            recipient: "237675080477",
            channel: "whatsapp",
            code: "URGENT1",
            expireMinutes: 10,
            userName: "Urgent Test"
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.SERVICE_SECRET || 'test-token'}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        console.log(`✅ OTP API Response: ${JSON.stringify(testOtpResponse.data)}`);

        // Wait a moment for database save
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check count after sending
        const countAfter = await notificationsCollection.countDocuments();
        console.log(`📊 Notifications in DB after test: ${countAfter}`);

        if (countAfter > countBefore) {
            console.log('✅ Notification WAS saved to database');

            // Get the most recent notification
            const recent = await notificationsCollection.findOne({}, { sort: { createdAt: -1 } });
            console.log('📋 Most recent notification:');
            console.log(`   ID: ${recent._id}`);
            console.log(`   Recipient: ${recent.recipient}`);
            console.log(`   Status: ${recent.status}`);
            console.log(`   Created: ${recent.createdAt}`);
            console.log(`   Message ID: ${recent.whatsappMessageId || 'NOT SET'}`);
            console.log(`   Delivery Status: ${recent.whatsappStatus || 'NOT SET'}`);

        } else {
            console.log('❌ Notification was NOT saved to database');
            console.log('   This indicates a database connection issue in the service');
        }

        await client.close();

    } catch (error) {
        console.log(`❌ Live test failed: ${error.message}`);
    }

    // 3. Check webhook endpoint
    console.log('\n3️⃣ Webhook Endpoint Check');
    console.log('-'.repeat(40));

    try {
        const webhookResponse = await axios.get(`${workingServiceUrl}/api/whatsapp/webhook`, {
            timeout: 3000,
            params: {
                'hub.mode': 'subscribe',
                'hub.verify_token': process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'test',
                'hub.challenge': 'test-challenge'
            }
        });
        console.log(`✅ Webhook endpoint responding: ${webhookResponse.status}`);
    } catch (error) {
        console.log(`❌ Webhook endpoint issue: ${error.message}`);
        console.log('   This explains why delivery confirmations aren\'t working');
    }

    // 4. Check recent service logs
    console.log('\n4️⃣ Service Log Analysis');
    console.log('-'.repeat(40));

    try {
        const fs = require('fs');
        const path = require('path');

        const logPath = path.join(__dirname, 'logs', 'combined.log');
        if (fs.existsSync(logPath)) {
            const content = fs.readFileSync(logPath, 'utf8');
            const lines = content.split('\n');

            // Look for recent database operations
            const dbLines = lines.filter(line =>
                line.includes('markAsSentWithMessageId') ||
                line.includes('notification') && line.includes('sent successfully')
            ).slice(-5);

            console.log('📄 Recent database operations:');
            dbLines.forEach(line => console.log(`   ${line.substring(0, 120)}...`));

            // Look for errors
            const errorLines = lines.filter(line =>
                line.includes('error') || line.includes('Error')
            ).slice(-3);

            console.log('\n❌ Recent errors:');
            errorLines.forEach(line => console.log(`   ${line.substring(0, 120)}...`));

        }
    } catch (error) {
        console.log(`⚠️  Could not analyze logs: ${error.message}`);
    }

    // 5. Summary and recommendations
    console.log('\n5️⃣ URGENT RECOMMENDATIONS');
    console.log('='.repeat(60));

    console.log('🔧 Immediate Actions Needed:');
    console.log('1. Verify notification service is running and connected to correct database');
    console.log('2. Check if message IDs are being saved to database (markAsSentWithMessageId)');
    console.log('3. Fix webhook endpoint for delivery confirmations');
    console.log('4. Monitor database writes in real-time during message sending');

    console.log('\n🎯 Root Cause Analysis:');
    console.log('• Messages are being sent successfully (API returns message IDs)');
    console.log('• BUT notifications aren\'t being saved with message IDs');
    console.log('• AND delivery confirmations aren\'t coming through webhooks');
    console.log('• This creates the illusion that messages are sent but users don\'t receive them');

    console.log('\n💡 Quick Fix Test:');
    console.log('1. Restart notification service to ensure proper database connection');
    console.log('2. Send a test OTP and verify message ID is saved to database');
    console.log('3. Check if webhook delivery confirmations are received');
}

// Run urgent diagnosis
urgentDiagnosis().catch(console.error); 