const mongoose = require('mongoose');

async function checkData() {
    await mongoose.connect('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const user = await User.findOne({ email: 'rufusherma@gmail.com' });

    console.log('User found:', user._id.toString(), user.name);

    const Referral = mongoose.model('Referral', new mongoose.Schema({}, { strict: false }), 'referrals');

    const now = new Date();
    const jan2026From = new Date('2026-01-01T00:00:00.000Z');
    const jan2026To = new Date('2026-01-31T23:59:59.999Z');

    console.log('\n=== January 2026 Filter Results ===');
    console.log('Date range:', jan2026From.toISOString(), 'to', jan2026To.toISOString());

    // Total users registered in Jan 2026
    const totalJan2026 = await Referral.aggregate([
        { $match: { referrer: user._id, archived: { $ne: true } } },
        { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'referredUserData' } },
        { $unwind: '$referredUserData' },
        { $match: {
            'referredUserData.createdAt': { $gte: jan2026From, $lte: jan2026To },
            'referredUserData.deleted': { $ne: true },
            'referredUserData.blocked': { $ne: true }
        }},
        { $count: 'total' }
    ]);
    console.log('\nTotal users registered in Jan 2026:', totalJan2026[0]?.total || 0);

    // Subscribed users registered in Jan 2026
    const subscribedJan2026 = await Referral.aggregate([
        { $match: { referrer: user._id, archived: { $ne: true } } },
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
    console.log('SUBSCRIBED (with CLASSIQUE/CIBLE) in Jan 2026:', subscribedJan2026[0]?.total || 0);

    // Check for users with ANY active subscription (including RELANCE)
    const anySubscriptionJan2026 = await Referral.aggregate([
        { $match: { referrer: user._id, archived: { $ne: true } } },
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
                    endDate: { $gt: now }
                }}
            ],
            as: 'activeSubscriptions'
        }},
        { $match: { 'activeSubscriptions.0': { $exists: true } } },
        { $count: 'total' }
    ]);
    console.log('SUBSCRIBED (with ANY subscription type) in Jan 2026:', anySubscriptionJan2026[0]?.total || 0);

    // Non-subscribed users registered in Jan 2026
    const nonSubscribedJan2026 = await Referral.aggregate([
        { $match: { referrer: user._id, archived: { $ne: true } } },
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
    console.log('NON-SUBSCRIBED in Jan 2026:', nonSubscribedJan2026[0]?.total || 0);

    console.log('\n=== Summary ===');
    const total = totalJan2026[0]?.total || 0;
    const subscribed = subscribedJan2026[0]?.total || 0;
    const nonSubscribed = nonSubscribedJan2026[0]?.total || 0;
    console.log(`Total: ${total}`);
    console.log(`Subscribed: ${subscribed}`);
    console.log(`Non-subscribed: ${nonSubscribed}`);
    console.log(`Sum check: ${subscribed + nonSubscribed} (should equal ${total})`);

    await mongoose.disconnect();
}

checkData().catch(console.error);
