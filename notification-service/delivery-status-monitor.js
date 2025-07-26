const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

// WhatsApp delivery status monitoring script
class DeliveryStatusMonitor {
    constructor() {
        this.mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/sbc_notification';
        this.client = null;
        this.db = null;
    }

    async connect() {
        try {
            this.client = new MongoClient(this.mongoUrl);
            await this.client.connect();
            this.db = this.client.db();
            console.log('✅ Connected to MongoDB');
        } catch (error) {
            console.error('❌ Failed to connect to MongoDB:', error.message);
            throw error;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            console.log('🔌 Disconnected from MongoDB');
        }
    }

    async analyzeDeliveryStatus() {
        console.log('📊 WhatsApp Delivery Status Analysis\n');
        console.log('='.repeat(60));

        try {
            // Get recent WhatsApp notifications (last 24 hours)
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

            const notifications = await this.db.collection('notifications').find({
                channel: 'whatsapp',
                createdAt: { $gte: oneDayAgo },
                type: 'otp'
            }).sort({ createdAt: -1 }).toArray();

            console.log(`\n📅 Analysis Period: Last 24 hours`);
            console.log(`📱 Total WhatsApp OTP notifications: ${notifications.length}`);

            if (notifications.length === 0) {
                console.log('ℹ️  No WhatsApp notifications found in the last 24 hours');
                return;
            }

            // Analyze delivery status
            await this.analyzeOverallStats(notifications);
            await this.analyzeDeliveryTimelines(notifications);
            await this.analyzeFailurePatterns(notifications);
            await this.analyzeRecipientPatterns(notifications);
            await this.generateRecommendations(notifications);

        } catch (error) {
            console.error('❌ Analysis failed:', error.message);
        }
    }

    async analyzeOverallStats(notifications) {
        console.log('\n📈 Overall Delivery Statistics');
        console.log('-'.repeat(40));

        const stats = {
            total: notifications.length,
            pending: 0,
            sent: 0,
            delivered: 0,
            failed: 0,
            withMessageId: 0,
            withDeliveryStatus: 0
        };

        notifications.forEach(notif => {
            // Count by notification status
            switch (notif.status) {
                case 'pending': stats.pending++; break;
                case 'sent': stats.sent++; break;
                case 'delivered': stats.delivered++; break;
                case 'failed': stats.failed++; break;
            }

            // Count by WhatsApp-specific fields
            if (notif.whatsappMessageId) stats.withMessageId++;
            if (notif.whatsappStatus) stats.withDeliveryStatus++;
        });

        console.log(`📊 Status Distribution:`);
        console.log(`   ⏳ Pending: ${stats.pending} (${(stats.pending / stats.total * 100).toFixed(1)}%)`);
        console.log(`   📤 Sent: ${stats.sent} (${(stats.sent / stats.total * 100).toFixed(1)}%)`);
        console.log(`   ✅ Delivered: ${stats.delivered} (${(stats.delivered / stats.total * 100).toFixed(1)}%)`);
        console.log(`   ❌ Failed: ${stats.failed} (${(stats.failed / stats.total * 100).toFixed(1)}%)`);

        console.log(`\n📋 Message Tracking:`);
        console.log(`   🆔 With Message ID: ${stats.withMessageId} (${(stats.withMessageId / stats.total * 100).toFixed(1)}%)`);
        console.log(`   📡 With Delivery Status: ${stats.withDeliveryStatus} (${(stats.withDeliveryStatus / stats.total * 100).toFixed(1)}%)`);

        // Success rate calculation
        const successRate = ((stats.sent + stats.delivered) / stats.total * 100).toFixed(1);
        console.log(`\n🎯 Success Rate: ${successRate}%`);

        if (stats.withMessageId > 0 && stats.withDeliveryStatus === 0) {
            console.log(`⚠️  WARNING: ${stats.withMessageId} messages sent but no delivery confirmations received`);
            console.log('   This suggests webhook delivery status updates are not working');
        }
    }

    async analyzeDeliveryTimelines(notifications) {
        console.log('\n⏰ Delivery Timeline Analysis');
        console.log('-'.repeat(40));

        const deliveredNotifications = notifications.filter(n =>
            n.status === 'delivered' && n.createdAt && n.deliveredAt
        );

        if (deliveredNotifications.length === 0) {
            console.log('ℹ️  No delivered notifications with timestamps found');
            return;
        }

        const deliveryTimes = deliveredNotifications.map(n => {
            const created = new Date(n.createdAt);
            const delivered = new Date(n.deliveredAt);
            return (delivered - created) / 1000; // seconds
        });

        const avgDeliveryTime = deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length;
        const minDeliveryTime = Math.min(...deliveryTimes);
        const maxDeliveryTime = Math.max(...deliveryTimes);

        console.log(`📦 Delivered Messages: ${deliveredNotifications.length}`);
        console.log(`⚡ Average Delivery Time: ${avgDeliveryTime.toFixed(1)} seconds`);
        console.log(`🚀 Fastest Delivery: ${minDeliveryTime.toFixed(1)} seconds`);
        console.log(`🐌 Slowest Delivery: ${maxDeliveryTime.toFixed(1)} seconds`);

        // Categorize delivery times
        const fast = deliveryTimes.filter(t => t <= 10).length;
        const medium = deliveryTimes.filter(t => t > 10 && t <= 60).length;
        const slow = deliveryTimes.filter(t => t > 60).length;

        console.log(`\n📊 Delivery Speed Distribution:`);
        console.log(`   🚀 Fast (≤10s): ${fast} (${(fast / deliveredNotifications.length * 100).toFixed(1)}%)`);
        console.log(`   🔄 Medium (10-60s): ${medium} (${(medium / deliveredNotifications.length * 100).toFixed(1)}%)`);
        console.log(`   🐌 Slow (>60s): ${slow} (${(slow / deliveredNotifications.length * 100).toFixed(1)}%)`);
    }

    async analyzeFailurePatterns(notifications) {
        console.log('\n❌ Failure Pattern Analysis');
        console.log('-'.repeat(40));

        const failedNotifications = notifications.filter(n => n.status === 'failed');

        if (failedNotifications.length === 0) {
            console.log('✅ No failed notifications found');
            return;
        }

        console.log(`📊 Failed Messages: ${failedNotifications.length}`);

        // Analyze error patterns
        const errorPatterns = {};
        failedNotifications.forEach(notif => {
            const error = notif.errorMessage || notif.whatsappError || 'Unknown error';
            errorPatterns[error] = (errorPatterns[error] || 0) + 1;
        });

        console.log(`\n🔍 Error Patterns:`);
        Object.entries(errorPatterns)
            .sort(([, a], [, b]) => b - a)
            .forEach(([error, count]) => {
                console.log(`   • ${error}: ${count} times`);
            });
    }

    async analyzeRecipientPatterns(notifications) {
        console.log('\n📱 Recipient Pattern Analysis');
        console.log('-'.repeat(40));

        // Analyze by country code
        const countryPatterns = {};
        const recipientStats = {};

        notifications.forEach(notif => {
            const recipient = notif.recipient;
            if (recipient) {
                // Extract country code (first 2-3 digits after +)
                const countryMatch = recipient.match(/^(\+?\d{2,3})/);
                const countryCode = countryMatch ? countryMatch[1] : 'unknown';

                if (!countryPatterns[countryCode]) {
                    countryPatterns[countryCode] = { total: 0, delivered: 0, failed: 0 };
                }

                countryPatterns[countryCode].total++;
                if (notif.status === 'delivered') countryPatterns[countryCode].delivered++;
                if (notif.status === 'failed') countryPatterns[countryCode].failed++;

                // Track individual recipients
                if (!recipientStats[recipient]) {
                    recipientStats[recipient] = { total: 0, delivered: 0, failed: 0 };
                }
                recipientStats[recipient].total++;
                if (notif.status === 'delivered') recipientStats[recipient].delivered++;
                if (notif.status === 'failed') recipientStats[recipient].failed++;
            }
        });

        console.log(`\n🌍 By Country Code:`);
        Object.entries(countryPatterns)
            .sort(([, a], [, b]) => b.total - a.total)
            .slice(0, 10) // Top 10
            .forEach(([code, stats]) => {
                const successRate = stats.total > 0 ? (stats.delivered / stats.total * 100).toFixed(1) : 0;
                console.log(`   ${code}: ${stats.total} total, ${successRate}% delivered`);
            });

        // Find problematic recipients
        const problematicRecipients = Object.entries(recipientStats)
            .filter(([, stats]) => stats.total >= 3 && stats.delivered === 0)
            .sort(([, a], [, b]) => b.total - a.total);

        if (problematicRecipients.length > 0) {
            console.log(`\n⚠️  Problematic Recipients (3+ attempts, 0 delivered):`);
            problematicRecipients.slice(0, 5).forEach(([recipient, stats]) => {
                console.log(`   ${recipient}: ${stats.total} attempts, ${stats.failed} failed`);
            });
        }
    }

    async generateRecommendations(notifications) {
        console.log('\n💡 Recommendations');
        console.log('-'.repeat(40));

        const stats = {
            total: notifications.length,
            withMessageId: notifications.filter(n => n.whatsappMessageId).length,
            withDeliveryStatus: notifications.filter(n => n.whatsappStatus).length,
            delivered: notifications.filter(n => n.status === 'delivered').length,
            failed: notifications.filter(n => n.status === 'failed').length
        };

        console.log('\n🔧 Technical Recommendations:');

        if (stats.withMessageId > 0 && stats.withDeliveryStatus < stats.withMessageId * 0.5) {
            console.log('1. ⚠️  Webhook delivery status updates appear to be missing');
            console.log('   - Check webhook endpoint configuration');
            console.log('   - Verify webhook URL is accessible from WhatsApp servers');
            console.log('   - Review webhook processing logs for errors');
        }

        if (stats.failed > stats.total * 0.1) {
            console.log('2. ⚠️  High failure rate detected');
            console.log('   - Review failed message error patterns');
            console.log('   - Check phone number validation logic');
            console.log('   - Consider implementing retry logic for failed messages');
        }

        if (stats.delivered < stats.total * 0.5) {
            console.log('3. ⚠️  Low delivery confirmation rate');
            console.log('   - Many messages may not be reaching users');
            console.log('   - Share user troubleshooting guide with support team');
            console.log('   - Consider implementing SMS fallback for critical OTP');
        }

        console.log('\n📞 User Education Recommendations:');
        console.log('1. Create user onboarding guide for WhatsApp notifications');
        console.log('2. Provide troubleshooting steps in user FAQ');
        console.log('3. Train support team on common delivery issues');
        console.log('4. Consider proactive outreach to users with delivery issues');

        console.log('\n📊 Monitoring Recommendations:');
        console.log('1. Set up alerts for delivery rate drops below 80%');
        console.log('2. Monitor webhook processing errors daily');
        console.log('3. Track user complaints about missing OTP messages');
        console.log('4. Regular review of WhatsApp Business Manager for warnings');
    }
}

// Run the monitoring
async function runMonitoring() {
    const monitor = new DeliveryStatusMonitor();

    try {
        await monitor.connect();
        await monitor.analyzeDeliveryStatus();
    } catch (error) {
        console.error('❌ Monitoring failed:', error.message);
    } finally {
        await monitor.disconnect();
    }
}

// Check if running directly
if (require.main === module) {
    runMonitoring().catch(console.error);
}

module.exports = { DeliveryStatusMonitor }; 