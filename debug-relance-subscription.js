const mongoose = require('mongoose');

async function debugRelanceSubscription() {
    await mongoose.connect('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const Subscription = mongoose.model('Subscription', new mongoose.Schema({}, { strict: false }), 'subscriptions');

    const user = await User.findOne({ email: 'christianmomo72@gmail.com' });

    if (!user) {
        console.log('❌ User not found: christianmomo72@gmail.com');
        await mongoose.disconnect();
        return;
    }

    console.log('=== RELANCE Subscription Debug ===');
    console.log(`User: ${user.name} (${user.email})`);
    console.log(`User ID: ${user._id.toString()}\n`);

    const now = new Date();
    console.log(`Current date: ${now.toISOString()}\n`);

    // Get all subscriptions for this user
    const allSubscriptions = await Subscription.find({ user: user._id }).lean();

    console.log(`Total subscriptions: ${allSubscriptions.length}\n`);

    // Check for RELANCE subscriptions
    const relanceSubscriptions = allSubscriptions.filter(s => s.subscriptionType === 'RELANCE');
    console.log(`RELANCE subscriptions: ${relanceSubscriptions.length}`);

    if (relanceSubscriptions.length === 0) {
        console.log('❌ No RELANCE subscriptions found for this user!\n');
    } else {
        console.log('\n--- RELANCE Subscription Details ---');
        relanceSubscriptions.forEach((sub, i) => {
            console.log(`\n${i+1}. Subscription ID: ${sub._id}`);
            console.log(`   Type: ${sub.subscriptionType}`);
            console.log(`   Status: ${sub.status}`);
            console.log(`   Category: ${sub.category || 'N/A'}`);
            console.log(`   Duration: ${sub.duration || 'N/A'}`);
            console.log(`   Start Date: ${sub.startDate?.toISOString() || 'N/A'}`);
            console.log(`   End Date: ${sub.endDate?.toISOString() || 'N/A'}`);

            // Check if active
            const isActive = sub.status === 'active' && sub.endDate > now;
            console.log(`   Is Active Now: ${isActive ? '✅ YES' : '❌ NO'}`);

            if (!isActive) {
                if (sub.status !== 'active') {
                    console.log(`   ⚠️  Status is "${sub.status}", not "active"`);
                }
                if (sub.endDate <= now) {
                    console.log(`   ⚠️  Expired on ${sub.endDate?.toISOString()}`);
                }
            }
        });
    }

    // Check the specific query used by the check endpoint
    console.log('\n--- Checking API Endpoint Logic ---');
    const activeRelanceSubscription = await Subscription.findOne({
        user: user._id,
        subscriptionType: 'RELANCE',
        status: 'active',
        endDate: { $gt: now }
    }).lean();

    if (activeRelanceSubscription) {
        console.log('✅ User HAS active RELANCE subscription');
        console.log(`   Subscription ID: ${activeRelanceSubscription._id}`);
        console.log(`   End Date: ${activeRelanceSubscription.endDate.toISOString()}`);
        console.log('\n⚠️  User should NOT see "User does not have active RELANCE subscription" message');
    } else {
        console.log('❌ User DOES NOT have active RELANCE subscription');
        console.log('✅ User SHOULD see "User does not have active RELANCE subscription" message');
    }

    // Check all other subscriptions
    console.log('\n--- Other Subscriptions ---');
    const otherSubs = allSubscriptions.filter(s => s.subscriptionType !== 'RELANCE');
    if (otherSubs.length === 0) {
        console.log('No other subscriptions');
    } else {
        otherSubs.forEach((sub, i) => {
            const isActive = sub.status === 'active' && sub.endDate > now;
            console.log(`${i+1}. ${sub.subscriptionType} - ${sub.status} - End: ${sub.endDate?.toISOString().split('T')[0]} - Active: ${isActive ? '✅' : '❌'}`);
        });
    }

    await mongoose.disconnect();
}

debugRelanceSubscription().catch(console.error);
