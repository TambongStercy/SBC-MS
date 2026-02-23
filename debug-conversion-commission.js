const mongoose = require('mongoose');

async function debugConversionCommission() {
    // Connect to both databases
    const userConn = mongoose.createConnection('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');
    const paymentConn = mongoose.createConnection('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_payment?authSource=admin');

    const User = userConn.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const Referral = userConn.model('Referral', new mongoose.Schema({}, { strict: false }), 'referrals');
    const Subscription = userConn.model('Subscription', new mongoose.Schema({}, { strict: false }), 'subscriptions');
    const SponsoredActivation = userConn.model('SponsoredActivation', new mongoose.Schema({}, { strict: false }), 'sponsoredactivations');
    const Transaction = paymentConn.model('Transaction', new mongoose.Schema({}, { strict: false }), 'transactions');
    const PaymentIntent = paymentConn.model('PaymentIntent', new mongoose.Schema({}, { strict: false }), 'paymentintents');

    console.log('=== Checking User with 3 Conversions but No Commission ===\n');
    console.log('Please provide the user email or ID to investigate...');
    console.log('For now, checking general conversion commission logic:\n');

    // Get all users with referrals that have paid (CLASSIQUE/CIBLE subscriptions)
    const conversions = await Referral.aggregate([
        { $match: { referralLevel: 1, archived: { $ne: true } } },
        { $lookup: {
            from: 'users',
            localField: 'referredUser',
            foreignField: '_id',
            as: 'referredUserData'
        }},
        { $unwind: '$referredUserData' },
        { $lookup: {
            from: 'subscriptions',
            let: { userId: '$referredUserData._id' },
            pipeline: [
                { $match: {
                    $expr: { $eq: ['$user', '$$userId'] },
                    status: 'active',
                    subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] }
                }}
            ],
            as: 'subscriptions'
        }},
        { $match: { 'subscriptions.0': { $exists: true } } },
        { $group: {
            _id: '$referrer',
            conversions: { $sum: 1 },
            referredUsers: { $push: {
                userId: '$referredUserData._id',
                name: '$referredUserData.name',
                email: '$referredUserData.email',
                subscriptionType: { $arrayElemAt: ['$subscriptions.subscriptionType', 0] }
            }}
        }},
        { $match: { conversions: { $gte: 3 } } },
        { $limit: 10 }
    ]);

    console.log(`Found ${conversions.length} users with 3+ conversions:\n`);

    for (const conv of conversions) {
        const referrer = await User.findById(conv._id).lean();
        console.log(`Referrer: ${referrer?.name} (${referrer?.email})`);
        console.log(`Conversions: ${conv.conversions}`);

        // Check if they received commissions (commissions are DEPOSITS with metadata.commissionLevel)
        const commissions = await Transaction.find({
            userId: conv._id,  // Changed from 'user' to 'userId' (correct field name)
            type: 'deposit',   // Changed from 'transactionType' to 'type', value is 'deposit'
            status: 'completed',
            'metadata.commissionLevel': { $exists: true }  // Filter for commission deposits only
        }).lean();

        console.log(`Commissions received: ${commissions.length}`);

        // Check if converted users actually PAID for their subscriptions
        console.log('Checking payment records for converted users...');
        let paidCount = 0;
        const paymentDetails = [];

        for (const convertedUser of conv.referredUsers) {
            // Check if this user has a completed PaymentIntent for subscription
            const payment = await PaymentIntent.findOne({
                userId: convertedUser.userId.toString(),
                paymentType: 'SUBSCRIPTION',
                status: 'confirmed'
            }).lean();

            // Also check if they were sponsored
            const sponsorship = await SponsoredActivation.findOne({
                beneficiary: convertedUser.userId
            }).lean();

            if (payment) {
                paidCount++;
                paymentDetails.push({
                    name: convertedUser.name,
                    email: convertedUser.email,
                    subType: convertedUser.subscriptionType,
                    amount: payment.amount,
                    currency: payment.currency,
                    date: payment.createdAt,
                    type: 'PAID'
                });
            } else if (sponsorship) {
                paidCount++;
                paymentDetails.push({
                    name: convertedUser.name,
                    email: convertedUser.email,
                    subType: sponsorship.subscriptionType,
                    amount: sponsorship.amount,
                    currency: 'XAF',
                    date: sponsorship.createdAt,
                    type: 'SPONSORED',
                    sponsor: (await User.findById(sponsorship.sponsor).lean())?.name || 'Unknown'
                });
            }
        }

        console.log(`Users who PAID or SPONSORED: ${paidCount}/${conv.conversions}`);

        if (paidCount > 0) {
            console.log('\nSubscription details:');
            paymentDetails.forEach((p, i) => {
                if (p.type === 'PAID') {
                    console.log(`  ${i+1}. ${p.name} (${p.email}) - ${p.subType} - ${p.amount} ${p.currency} - ${p.date?.toISOString().split('T')[0]} - [PAID]`);
                } else if (p.type === 'SPONSORED') {
                    console.log(`  ${i+1}. ${p.name} (${p.email}) - ${p.subType} - ${p.amount} ${p.currency} - ${p.date?.toISOString().split('T')[0]} - [SPONSORED by ${p.sponsor}]`);
                }
            });
        } else {
            // If no payment or sponsorship found, check subscription dates
            console.log('\n📅 Checking subscription creation dates (might be admin-created or old data):');
            for (const convertedUser of conv.referredUsers.slice(0, 3)) { // Show first 3 only
                const sub = await Subscription.findOne({
                    user: convertedUser.userId,
                    subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] },
                    status: 'active'
                }).lean();
                if (sub) {
                    console.log(`  - ${convertedUser.name}: ${sub.subscriptionType} created ${sub.createdAt?.toISOString().split('T')[0] || 'unknown date'}`);
                }
            }
            if (conv.referredUsers.length > 3) {
                console.log(`  ... and ${conv.referredUsers.length - 3} more`);
            }
        }

        if (commissions.length === 0) {
            console.log('\n⚠️  NO COMMISSIONS FOUND!');
            if (paidCount > 0) {
                const sponsoredCount = paymentDetails.filter(p => p.type === 'SPONSORED').length;
                const selfPaidCount = paymentDetails.filter(p => p.type === 'PAID').length;
                console.log(`🔴 CRITICAL BUG: ${paidCount} users (${selfPaidCount} paid, ${sponsoredCount} sponsored) but NO commissions were recorded!`);
            } else {
                console.log('ℹ️  No users paid or sponsored yet');
            }
        } else {
            const totalCommission = commissions.reduce((sum, c) => sum + c.amount, 0);
            console.log(`✅ Total commission: ${totalCommission} XOF`);
        }
        console.log('---\n');
    }

    await userConn.close();
    await paymentConn.close();
}

debugConversionCommission().catch(console.error);
