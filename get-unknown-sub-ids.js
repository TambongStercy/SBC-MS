const mongoose = require('mongoose');

async function getUnknownSubIds() {
    const userConn = mongoose.createConnection('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');
    const paymentConn = mongoose.createConnection('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_payment?authSource=admin');

    const Subscription = userConn.model('Subscription', new mongoose.Schema({}, { strict: false, timestamps: true }), 'subscriptions');
    const User = userConn.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const SponsoredActivation = userConn.model('SponsoredActivation', new mongoose.Schema({}, { strict: false }), 'sponsoredactivations');
    const PaymentIntent = paymentConn.model('PaymentIntent', new mongoose.Schema({}, { strict: false }), 'paymentintents');

    console.log('=== Getting User IDs for Unknown Subscriptions ===\n');

    // Get subscriptions created in the last 2 days
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const subs = await Subscription.find({
        subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] },
        status: 'active',
        createdAt: { $gte: twoDaysAgo }
    })
    .sort({ createdAt: -1 })
    .limit(50) // Get more to ensure we have enough unknowns
    .lean();

    console.log(`Checking ${subs.length} subscriptions...\n`);

    const unknownUsers = [];

    for (const sub of subs) {
        const user = await User.findById(sub.user).lean();
        const userId = sub.user.toString();

        // Check for payment
        const payment = await PaymentIntent.findOne({
            userId: userId,
            paymentType: 'SUBSCRIPTION',
            status: 'confirmed',
            createdAt: { $gte: twoDaysAgo }
        }).lean();

        // Check for sponsorship
        const sponsorship = await SponsoredActivation.findOne({
            beneficiary: sub.user
        }).lean();

        // If neither payment nor sponsorship, it's unknown
        if (!payment && !sponsorship) {
            unknownUsers.push({
                userId: userId,
                name: user?.name || 'Unknown',
                email: user?.email || 'Unknown',
                subscriptionType: sub.subscriptionType,
                createdAt: sub.createdAt
            });
        }
    }

    console.log(`Found ${unknownUsers.length} unknown subscriptions:\n`);

    // Print as array of IDs
    console.log('User IDs (array format):');
    console.log(JSON.stringify(unknownUsers.map(u => u.userId), null, 2));

    console.log('\n\nDetailed list:');
    unknownUsers.forEach((u, i) => {
        console.log(`${i+1}. ${u.userId} - ${u.name} (${u.email}) - ${u.subscriptionType} - ${new Date(u.createdAt).toISOString()}`);
    });

    console.log('\n\nComma-separated IDs:');
    console.log(unknownUsers.map(u => u.userId).join(','));

    await userConn.close();
    await paymentConn.close();
}

getUnknownSubIds().catch(console.error);
