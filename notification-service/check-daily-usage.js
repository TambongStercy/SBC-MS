const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Script to check if you're hitting WhatsApp daily messaging limits
async function checkDailyUsage() {
    console.log('🔍 Daily Messaging Usage Analysis\n');
    console.log('='.repeat(60));

    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    console.log(`📅 Checking usage for: ${todayStart.toDateString()}`);
    console.log('');

    // 1. Check database for today's template messages
    console.log('1️⃣  DATABASE ANALYSIS');
    console.log('─'.repeat(50));

    try {
        // Try to connect to MongoDB
        const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/notification_service';
        const client = new MongoClient(mongoUrl);

        await client.connect();
        console.log('✅ Connected to MongoDB');

        const db = client.db();
        const notificationsCollection = db.collection('notifications');

        // Find today's WhatsApp template messages
        const todayTemplateMessages = await notificationsCollection.find({
            channel: 'whatsapp',
            type: { $ne: 'service' }, // Exclude service messages (they're free)
            createdAt: {
                $gte: todayStart,
                $lt: todayEnd
            },
            whatsappMessageId: { $exists: true } // Only successfully sent messages
        }).toArray();

        console.log(`📊 Template Messages Sent Today: ${todayTemplateMessages.length}`);

        // Count unique recipients (this is what matters for limits)
        const uniqueRecipients = new Set();
        const messagesByHour = {};
        const messageTypes = {};

        todayTemplateMessages.forEach(msg => {
            uniqueRecipients.add(msg.recipient);

            // Track by hour
            const hour = new Date(msg.createdAt).getHours();
            messagesByHour[hour] = (messagesByHour[hour] || 0) + 1;

            // Track by type
            const type = msg.type || 'unknown';
            messageTypes[type] = (messageTypes[type] || 0) + 1;
        });

        console.log(`👥 UNIQUE RECIPIENTS: ${uniqueRecipients.size}`);
        console.log('');

        // Show the critical info
        if (uniqueRecipients.size >= 200) {
            console.log('🚨 LIKELY HITTING MESSAGING LIMIT!');
            console.log(`   You've messaged ${uniqueRecipients.size} unique people today`);
            console.log(`   Default limit is 250 unique recipients/day`);
            console.log(`   Recipients beyond 250 won't receive messages!`);
        } else if (uniqueRecipients.size >= 150) {
            console.log('⚠️  APPROACHING MESSAGING LIMIT');
            console.log(`   You've messaged ${uniqueRecipients.size} unique people today`);
            console.log(`   Limit is likely 250 unique recipients/day`);
        } else {
            console.log('✅ Well within messaging limits');
            console.log(`   ${uniqueRecipients.size} unique recipients (limit ~250)`);
        }

        console.log('');
        console.log('📈 Usage Breakdown:');
        console.log(`   Total Messages: ${todayTemplateMessages.length}`);
        console.log(`   Unique Recipients: ${uniqueRecipients.size}`);
        console.log(`   Message Types:`, messageTypes);
        console.log('');

        // Show hourly distribution
        console.log('⏰ Messages by Hour:');
        Object.keys(messagesByHour).sort((a, b) => a - b).forEach(hour => {
            const hourStr = `${hour.toString().padStart(2, '0')}:00`;
            const count = messagesByHour[hour];
            const bar = '█'.repeat(Math.min(count, 20));
            console.log(`   ${hourStr}: ${count.toString().padStart(3)} ${bar}`);
        });

        console.log('');

        // Check for failed messages that might indicate limit hits
        const failedMessages = await notificationsCollection.find({
            channel: 'whatsapp',
            createdAt: {
                $gte: todayStart,
                $lt: todayEnd
            },
            $or: [
                { whatsappMessageId: { $exists: false } },
                { status: 'failed' },
                { status: 'error' }
            ]
        }).toArray();

        console.log(`❌ Failed/Pending Messages: ${failedMessages.length}`);
        if (failedMessages.length > 0) {
            console.log('   Recent failures:');
            failedMessages.slice(-5).forEach((msg, i) => {
                console.log(`   ${i + 1}. ${msg.recipient} - ${msg.status || 'no status'} - ${new Date(msg.createdAt).toLocaleTimeString()}`);
            });
        }

        await client.close();

    } catch (dbError) {
        console.log('❌ Database check failed:', dbError.message);
        console.log('   Falling back to log analysis...');
    }

    // 2. Check log files
    console.log('');
    console.log('2️⃣  LOG FILE ANALYSIS');
    console.log('─'.repeat(50));

    const logPaths = [
        'logs/whatsapp.log',
        'logs/notification.log',
        'logs/app.log',
        '../logs/notification-service.log'
    ];

    let logAnalyzed = false;

    for (const logPath of logPaths) {
        if (fs.existsSync(logPath)) {
            console.log(`📄 Analyzing: ${logPath}`);
            try {
                const logContent = fs.readFileSync(logPath, 'utf8');
                const todayString = today.toISOString().split('T')[0]; // YYYY-MM-DD
                const todayLines = logContent.split('\n').filter(line =>
                    line.includes(todayString) &&
                    (line.includes('WhatsApp') || line.includes('template') || line.includes('message'))
                );

                // Look for successful sends
                const successfulSends = todayLines.filter(line =>
                    line.includes('successfully') ||
                    line.includes('message ID') ||
                    line.includes('sent')
                );

                // Look for errors/failures
                const errors = todayLines.filter(line =>
                    line.includes('error') ||
                    line.includes('failed') ||
                    line.includes('limit') ||
                    line.includes('rate')
                );

                console.log(`   ✅ Successful sends: ${successfulSends.length}`);
                console.log(`   ❌ Errors/failures: ${errors.length}`);

                if (errors.length > 0) {
                    console.log('   Recent errors:');
                    errors.slice(-3).forEach((error, i) => {
                        console.log(`   ${i + 1}. ${error.substring(0, 100)}...`);
                    });
                }

                logAnalyzed = true;
                break;
            } catch (logError) {
                console.log(`   ❌ Can't read ${logPath}: ${logError.message}`);
            }
        }
    }

    if (!logAnalyzed) {
        console.log('⚠️  No log files found for analysis');
    }

    // 3. Recommendations
    console.log('');
    console.log('3️⃣  RECOMMENDATIONS');
    console.log('─'.repeat(50));

    console.log('🎯 TO CHECK YOUR CURRENT LIMIT:');
    console.log('1. Go to WhatsApp Manager → Account Tools → Phone Numbers');
    console.log('2. Look for your phone number and check "Messaging Limit"');
    console.log('3. Check WhatsApp Manager → Overview → Limits');
    console.log('');

    console.log('🚀 TO INCREASE YOUR LIMIT:');
    console.log('1. Business Verification (can increase to 1,000)');
    console.log('2. Send to 50% of current limit in 7 days');
    console.log('3. Maintain HIGH quality rating');
    console.log('4. Ensure users opt-in and engage positively');
    console.log('');

    console.log('⚡ IMMEDIATE ACTIONS:');
    console.log('1. Check if you hit 250 unique recipients today');
    console.log('2. If yes, users #251+ won\'t receive messages');
    console.log('3. Consider SMS fallback for critical OTPs');
    console.log('4. Prioritize most important users first each day');
    console.log('');

    console.log('💡 SYMPTOMS OF HITTING LIMIT:');
    console.log('• Messages show "sent successfully" in logs');
    console.log('• Users report not receiving messages');
    console.log('• API doesn\'t return errors');
    console.log('• Messages to first ~250 users work fine');
    console.log('• Messages to users beyond that fail silently');
}

// Check if we can determine current messaging tier
function checkMessagingTier() {
    console.log('');
    console.log('4️⃣  MESSAGING TIER IDENTIFICATION');
    console.log('─'.repeat(50));
    console.log('Default Tiers:');
    console.log('• 🟡 Tier 1: 250 messages/day (new numbers)');
    console.log('• 🟠 Tier 2: 1,000 messages/day (after business verification)');
    console.log('• 🔴 Tier 3: 10,000 messages/day (automatic scaling)');
    console.log('• 🟢 Tier 4: 100,000 messages/day (automatic scaling)');
    console.log('• ⚪ Tier 5: Unlimited (automatic scaling)');
    console.log('');
    console.log('To identify your tier:');
    console.log('1. Count unique recipients on your highest-usage day');
    console.log('2. If messages stopped working around 250 → Tier 1');
    console.log('3. If messages stopped working around 1,000 → Tier 2');
    console.log('4. Check WhatsApp Manager for confirmation');
}

if (require.main === module) {
    checkDailyUsage().then(() => {
        checkMessagingTier();
    }).catch(console.error);
}

module.exports = { checkDailyUsage }; 