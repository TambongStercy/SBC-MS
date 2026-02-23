const mongoose = require('mongoose');

async function checkRecentSubsPayment() {
    const userConn = mongoose.createConnection('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');
    const paymentConn = mongoose.createConnection('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_payment?authSource=admin');

    const Subscription = userConn.model('Subscription', new mongoose.Schema({}, { strict: false, timestamps: true }), 'subscriptions');
    const User = userConn.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const SponsoredActivation = userConn.model('SponsoredActivation', new mongoose.Schema({}, { strict: false }), 'sponsoredactivations');
    const PaymentIntent = paymentConn.model('PaymentIntent', new mongoose.Schema({}, { strict: false }), 'paymentintents');
    const Transaction = paymentConn.model('Transaction', new mongoose.Schema({}, { strict: false }), 'transactions');

    console.log('=== Checking Recent Subscriptions for Payment/Sponsorship ===\n');

    // Get subscriptions created in the last 2 days
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const subs = await Subscription.find({
        subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] },
        status: 'active',
        createdAt: { $gte: twoDaysAgo }
    })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

    console.log(`Found ${subs.length} subscriptions created in last 2 days:\n`);

    let paidCount = 0;
    let sponsoredCount = 0;
    let unknownCount = 0;
    let withCommissionCount = 0;

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

        // Check for commission
        const commission = await Transaction.findOne({
            userId: sub.user,
            type: 'deposit',
            status: 'completed',
            'metadata.commissionLevel': { $exists: true }
        }).lean();

        let paymentType = 'UNKNOWN';
        if (payment) {
            paymentType = 'PAID';
            paidCount++;
        } else if (sponsorship) {
            paymentType = 'SPONSORED';
            sponsoredCount++;
        } else {
            unknownCount++;
        }

        if (commission) {
            withCommissionCount++;
        }

        console.log(`${paymentType === 'UNKNOWN' ? '❓' : paymentType === 'PAID' ? '💳' : '🎁'} ${user?.name || 'Unknown'} (${user?.email || 'Unknown'})`);
        console.log(`   Type: ${sub.subscriptionType} | Created: ${new Date(sub.createdAt).toISOString()}`);
        console.log(`   Payment Type: ${paymentType}${commission ? ' (has commission)' : ''}`);

        if (payment) {
            console.log(`   Payment: ${payment.amount} ${payment.currency} - Status: ${payment.status}`);
        }
        if (sponsorship) {
            const sponsor = await User.findById(sponsorship.sponsor).lean();
            console.log(`   Sponsored by: ${sponsor?.name || 'Unknown'} - Amount: ${sponsorship.amount} XAF`);
        }
        console.log('');
    }

    console.log('=== Summary ===');
    console.log(`Total: ${subs.length}`);
    console.log(`Paid: ${paidCount}`);
    console.log(`Sponsored: ${sponsoredCount}`);
    console.log(`Unknown: ${unknownCount}`);
    console.log(`With Commission: ${withCommissionCount}`);

    if (unknownCount > 0) {
        console.log(`\n⚠️  ${unknownCount} subscriptions have no PaymentIntent or SponsoredActivation record!`);
        console.log('These were likely created manually by an admin.');
    }

    await userConn.close();
    await paymentConn.close();
}

checkRecentSubsPayment().catch(console.error);
