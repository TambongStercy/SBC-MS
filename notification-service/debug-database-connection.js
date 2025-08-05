const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

// Debug script to find recent WhatsApp notifications
async function debugDatabaseConnection() {
    console.log('🔍 Database Connection Debug\n');
    console.log('='.repeat(60));

    // Try different database connections
    const possibleConnections = [
        'mongodb://localhost:27017/sbc_notification_dev',
        'mongodb://localhost:27017/sbc_notification',
        'mongodb://localhost:27017/notification_service',
        'mongodb://localhost:27017'
    ];

    for (const connectionString of possibleConnections) {
        try {
            console.log(`\n🔗 Trying: ${connectionString}`);
            const client = new MongoClient(connectionString);
            await client.connect();

            if (connectionString.endsWith('27017')) {
                // List all databases
                const admin = client.db().admin();
                const dbs = await admin.listDatabases();
                console.log(`📋 Available databases: ${dbs.databases.map(db => db.name).join(', ')}`);

                // Check each database for notifications
                for (const dbInfo of dbs.databases) {
                    if (dbInfo.name.includes('notification') || dbInfo.name.includes('sbc')) {
                        console.log(`\n📂 Checking database: ${dbInfo.name}`);
                        const db = client.db(dbInfo.name);
                        const collections = await db.listCollections().toArray();

                        for (const collection of collections) {
                            if (collection.name.includes('notification')) {
                                console.log(`   📋 Collection: ${collection.name}`);
                                const coll = db.collection(collection.name);

                                // Count total documents
                                const totalCount = await coll.countDocuments();
                                console.log(`   📊 Total documents: ${totalCount}`);

                                // Count WhatsApp notifications
                                const whatsappCount = await coll.countDocuments({ channel: 'whatsapp' });
                                console.log(`   📱 WhatsApp notifications: ${whatsappCount}`);

                                // Get the most recent document
                                const mostRecent = await coll.findOne({}, { sort: { createdAt: -1 } });
                                if (mostRecent) {
                                    console.log(`   ⏰ Most recent: ${mostRecent.createdAt} - ${mostRecent.recipient} - ${mostRecent.status}`);
                                }

                                // Check for notifications from today
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const todayCount = await coll.countDocuments({
                                    channel: 'whatsapp',
                                    createdAt: { $gte: today }
                                });
                                console.log(`   📅 Today's WhatsApp notifications: ${todayCount}`);

                                // Check for notifications from last hour (more recent)
                                const lastHour = new Date(Date.now() - 60 * 60 * 1000);
                                const lastHourCount = await coll.countDocuments({
                                    channel: 'whatsapp',
                                    createdAt: { $gte: lastHour }
                                });
                                console.log(`   ⏱️  Last hour WhatsApp notifications: ${lastHourCount}`);

                                // Get some recent WhatsApp notifications with detailed info
                                if (whatsappCount > 0) {
                                    console.log(`\n   📋 Recent WhatsApp notifications:`);
                                    const recent = await coll.find({ channel: 'whatsapp' })
                                        .sort({ createdAt: -1 })
                                        .limit(5)
                                        .toArray();

                                    recent.forEach((notif, index) => {
                                        const time = new Date(notif.createdAt).toLocaleString();
                                        const recipient = notif.recipient || 'unknown';
                                        const status = notif.status || 'unknown';
                                        const messageId = notif.whatsappMessageId ? 'YES' : 'NO';
                                        const deliveryStatus = notif.whatsappStatus || 'none';

                                        console.log(`     ${index + 1}. [${time}] ${recipient} - Status: ${status} - MsgID: ${messageId} - Delivery: ${deliveryStatus}`);
                                    });
                                }
                            }
                        }
                    }
                }
            } else {
                // Check specific database
                const db = client.db();
                const collections = await db.listCollections().toArray();
                console.log(`📋 Collections: ${collections.map(c => c.name).join(', ')}`);

                if (collections.some(c => c.name === 'notifications')) {
                    const notificationsCollection = db.collection('notifications');
                    const whatsappCount = await notificationsCollection.countDocuments({ channel: 'whatsapp' });
                    console.log(`📱 WhatsApp notifications: ${whatsappCount}`);

                    // Get recent WhatsApp notifications
                    const recent = await notificationsCollection.find({ channel: 'whatsapp' })
                        .sort({ createdAt: -1 })
                        .limit(3)
                        .toArray();

                    recent.forEach((notif, index) => {
                        const time = new Date(notif.createdAt).toLocaleString();
                        console.log(`     ${index + 1}. [${time}] ${notif.recipient} - ${notif.status}`);
                    });
                }
            }

            await client.close();

        } catch (error) {
            console.log(`❌ Failed to connect: ${error.message}`);
        }
    }

    // Also check environment variables
    console.log('\n🔧 Environment Check');
    console.log('-'.repeat(30));
    console.log(`MONGODB_URL: ${process.env.MONGODB_URL || 'Not set'}`);
    console.log(`MONGODB_URI_DEV: ${process.env.MONGODB_URI_DEV || 'Not set'}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV || 'Not set'}`);

    // Check the service logs for recent activity
    console.log('\n📜 Recent Service Logs Check');
    console.log('-'.repeat(30));

    try {
        const fs = require('fs');
        const path = require('path');

        const logFiles = ['combined.log', 'error.log'];
        for (const logFile of logFiles) {
            const logPath = path.join(__dirname, 'logs', logFile);
            if (fs.existsSync(logPath)) {
                console.log(`\n📄 Recent entries in ${logFile}:`);
                const content = fs.readFileSync(logPath, 'utf8');
                const recentLines = content.split('\n')
                    .filter(line => line.includes('WhatsApp') || line.includes('template'))
                    .slice(-5);

                recentLines.forEach(line => {
                    console.log(`   ${line.substring(0, 120)}...`);
                });
            }
        }
    } catch (error) {
        console.log(`⚠️  Could not read logs: ${error.message}`);
    }
}

// Run the debug
debugDatabaseConnection().catch(console.error); 