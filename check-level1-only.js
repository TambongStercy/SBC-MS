const mongoose = require('mongoose');

async function checkLevel1() {
    await mongoose.connect('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const Referral = mongoose.model('Referral', new mongoose.Schema({}, { strict: false }), 'referrals');

    const user = await User.findOne({ email: 'rufusherma@gmail.com' });
    console.log('User found:', user._id.toString(), user.name);

    const jan2026From = new Date('2026-01-01T00:00:00.000Z');
    const jan2026To = new Date('2026-01-31T23:59:59.999Z');
    const now = new Date();

    console.log('\n=== Checking Referral Levels ===\n');

    // Check LEVEL 1 ONLY referrals
    const level1Jan2026 = await Referral.aggregate([
        { $match: {
            referrer: user._id,
            referralLevel: 1,  // LEVEL 1 ONLY
            archived: { $ne: true }
        }},
        { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'referredUserData' } },
        { $unwind: '$referredUserData' },
        { $match: {
            'referredUserData.createdAt': { $gte: jan2026From, $lte: jan2026To },
            'referredUserData.deleted': { $ne: true },
            'referredUserData.blocked': { $ne: true }
        }},
        { $count: 'total' }
    ]);
    console.log('LEVEL 1 referrals in Jan 2026:', level1Jan2026[0]?.total || 0);

    // Check ALL LEVELS referrals
    const allLevelsJan2026 = await Referral.aggregate([
        { $match: {
            referrer: user._id,
            archived: { $ne: true }
        }},
        { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'referredUserData' } },
        { $unwind: '$referredUserData' },
        { $match: {
            'referredUserData.createdAt': { $gte: jan2026From, $lte: jan2026To },
            'referredUserData.deleted': { $ne: true },
            'referredUserData.blocked': { $ne: true }
        }},
        { $count: 'total' }
    ]);
    console.log('ALL LEVELS referrals in Jan 2026:', allLevelsJan2026[0]?.total || 0);

    // Break down by level
    const byLevel = await Referral.aggregate([
        { $match: {
            referrer: user._id,
            archived: { $ne: true }
        }},
        { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'referredUserData' } },
        { $unwind: '$referredUserData' },
        { $match: {
            'referredUserData.createdAt': { $gte: jan2026From, $lte: jan2026To },
            'referredUserData.deleted': { $ne: true },
            'referredUserData.blocked': { $ne: true }
        }},
        { $group: {
            _id: '$referralLevel',
            count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
    ]);

    console.log('\nBreakdown by referral level:');
    byLevel.forEach(level => {
        console.log(`  Level ${level._id}: ${level.count} referrals`);
    });

    // Now check LEVEL 1 with subscription breakdown
    console.log('\n=== LEVEL 1 Subscription Breakdown ===\n');

    const level1Subscribed = await Referral.aggregate([
        { $match: {
            referrer: user._id,
            referralLevel: 1,
            archived: { $ne: true }
        }},
        { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'referredUserData' } },
        { $unwind: '$referredUserData' },
        { $match: {
            'referredUserData.createdAt': { $gte: jan2026From, $lte: jan2026To },
            'referredUserData.deleted': { $ne: true },
            'referredUserData.blocked': { $ne: true }
        }},
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
        { $match: { 'activeSubscriptions.0': { $exists: true } } },
        { $count: 'total' }
    ]);

    const level1NonSubscribed = await Referral.aggregate([
        { $match: {
            referrer: user._id,
            referralLevel: 1,
            archived: { $ne: true }
        }},
        { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'referredUserData' } },
        { $unwind: '$referredUserData' },
        { $match: {
            'referredUserData.createdAt': { $gte: jan2026From, $lte: jan2026To },
            'referredUserData.deleted': { $ne: true },
            'referredUserData.blocked': { $ne: true }
        }},
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
        { $match: { $or: [{ activeSubscriptions: { $size: 0 } }, { activeSubscriptions: { $exists: false } }] } },
        { $count: 'total' }
    ]);

    const totalLevel1 = level1Jan2026[0]?.total || 0;
    const subscribedLevel1 = level1Subscribed[0]?.total || 0;
    const nonSubscribedLevel1 = level1NonSubscribed[0]?.total || 0;

    console.log(`Total LEVEL 1: ${totalLevel1}`);
    console.log(`Subscribed (CLASSIQUE/CIBLE): ${subscribedLevel1}`);
    console.log(`Non-subscribed: ${nonSubscribedLevel1}`);
    console.log(`Sum check: ${subscribedLevel1 + nonSubscribedLevel1} (should equal ${totalLevel1})`);

    await mongoose.disconnect();
}

checkLevel1().catch(console.error);
