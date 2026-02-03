const mongoose = require('mongoose');

async function testCampaignFilter() {
    await mongoose.connect('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const Referral = mongoose.model('Referral', new mongoose.Schema({}, { strict: false }), 'referrals');

    const user = await User.findOne({ email: 'rufusherma@gmail.com' });
    console.log('User found:', user._id.toString(), user.name);

    const jan2026From = new Date('2026-01-01T00:00:00.000Z');
    const jan2026To = new Date('2026-01-31T23:59:59.999Z');
    const now = new Date();

    console.log('\n=== Testing Campaign Filter Logic ===');
    console.log('Filter: non-subscribed, Jan 1-31 2026\n');

    // Step 1: Get ALL referrals for this user with user data and subscription info
    // This mimics what findAllReferralsByReferrerWithSubType does
    const allReferrals = await Referral.aggregate([
        // Match referrals
        { $match: {
            referrer: user._id,
            archived: { $ne: true }
        }},

        // Lookup user data
        { $lookup: {
            from: 'users',
            localField: 'referredUser',
            foreignField: '_id',
            as: 'referredUserData'
        }},
        { $unwind: '$referredUserData' },

        // Filter by user criteria (date, not deleted/blocked)
        { $match: {
            'referredUserData.createdAt': { $gte: jan2026From, $lte: jan2026To },
            'referredUserData.deleted': { $ne: true },
            'referredUserData.blocked': { $ne: true }
        }},

        // Lookup subscriptions (CLASSIQUE/CIBLE only)
        { $lookup: {
            from: 'subscriptions',
            let: { userId: '$referredUserData._id' },
            pipeline: [
                { $match: {
                    $expr: { $eq: ['$user', '$$userId'] },
                    status: 'active',
                    subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] },
                    endDate: { $gt: now }
                }}
            ],
            as: 'activeSubscriptions'
        }},

        // Project the data we need
        { $project: {
            _id: 1,
            referredUser: 1,
            userName: '$referredUserData.name',
            userEmail: '$referredUserData.email',
            userCreatedAt: '$referredUserData.createdAt',
            activeSubscriptions: 1,
            hasSubscription: { $gt: [{ $size: '$activeSubscriptions' }, 0] }
        }}
    ]);

    console.log(`Total referrals after date filter: ${allReferrals.length}`);

    const subscribed = allReferrals.filter(r => r.hasSubscription);
    const nonSubscribed = allReferrals.filter(r => !r.hasSubscription);

    console.log(`Subscribed (CLASSIQUE/CIBLE): ${subscribed.length}`);
    console.log(`Non-subscribed: ${nonSubscribed.length}`);

    // Show a sample of non-subscribed users
    console.log('\n=== Sample of Non-Subscribed Users ===');
    nonSubscribed.slice(0, 5).forEach((r, i) => {
        console.log(`${i+1}. ${r.userName} (${r.userEmail}) - Created: ${r.userCreatedAt.toISOString().split('T')[0]}`);
    });

    await mongoose.disconnect();
}

testCampaignFilter().catch(console.error);
