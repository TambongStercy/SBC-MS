const mongoose = require('mongoose');

async function checkSubDates() {
    const userConn = mongoose.createConnection('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');

    const Subscription = userConn.model('Subscription', new mongoose.Schema({}, { strict: false, timestamps: true }), 'subscriptions');
    const User = userConn.model('User', new mongoose.Schema({}, { strict: false }), 'users');

    console.log('=== Checking Subscription Document Timestamps ===\n');

    // Get subscriptions created in the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const subs = await Subscription.find({
        subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] },
        status: 'active',
        createdAt: { $gte: sixMonthsAgo }
    })
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

    console.log(`Found ${subs.length} subscriptions created in last 6 months:\n`);

    for (const sub of subs) {
        const user = await User.findById(sub.user).lean();
        console.log(`User: ${user?.name || 'Unknown'} (${user?.email || 'Unknown'})`);
        console.log(`  Type: ${sub.subscriptionType}`);
        console.log(`  Status: ${sub.status}`);
        console.log(`  Start Date: ${sub.startDate ? new Date(sub.startDate).toISOString().split('T')[0] : 'N/A'}`);
        console.log(`  End Date: ${sub.endDate ? new Date(sub.endDate).toISOString().split('T')[0] : 'N/A'}`);
        console.log(`  Created At (DB): ${sub.createdAt ? new Date(sub.createdAt).toISOString() : 'N/A'}`);
        console.log(`  Updated At (DB): ${sub.updatedAt ? new Date(sub.updatedAt).toISOString() : 'N/A'}`);

        // Calculate time difference
        if (sub.createdAt && sub.startDate) {
            const createdTime = new Date(sub.createdAt).getTime();
            const startTime = new Date(sub.startDate).getTime();
            const diffSeconds = Math.abs(createdTime - startTime) / 1000;
            if (diffSeconds > 60) {
                console.log(`  ⚠️  Time difference: ${Math.round(diffSeconds / 60)} minutes`);
            }
        }
        console.log('');
    }

    // Also check for old subscriptions (before timestamps)
    console.log('\n=== Checking Old Subscriptions (might not have createdAt) ===\n');

    const oldSubs = await Subscription.find({
        subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] },
        status: 'active',
        createdAt: { $exists: false }
    })
    .limit(10)
    .lean();

    if (oldSubs.length > 0) {
        console.log(`Found ${oldSubs.length} subscriptions WITHOUT createdAt timestamp:\n`);
        for (const sub of oldSubs) {
            const user = await User.findById(sub.user).lean();
            console.log(`User: ${user?.name || 'Unknown'} (${user?.email || 'Unknown'})`);
            console.log(`  Type: ${sub.subscriptionType}`);
            console.log(`  Start Date: ${sub.startDate ? new Date(sub.startDate).toISOString().split('T')[0] : 'N/A'}`);
            console.log(`  _id (ObjectId creation): ${sub._id.getTimestamp().toISOString()}`);
            console.log('');
        }
    } else {
        console.log('All subscriptions have createdAt timestamps ✓\n');
    }

    await userConn.close();
}

checkSubDates().catch(console.error);
