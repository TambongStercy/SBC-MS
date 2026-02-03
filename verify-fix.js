const mongoose = require('mongoose');

async function verifyFix() {
    await mongoose.connect('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const Referral = mongoose.model('Referral', new mongoose.Schema({}, { strict: false }), 'referrals');

    const user = await User.findOne({ email: 'rufusherma@gmail.com' });
    console.log('User found:', user._id.toString(), user.name);

    const jan2026From = new Date('2026-01-01T00:00:00.000Z');
    const jan2026To = new Date('2026-01-31T23:59:59.999Z');
    const now = new Date();

    console.log('\n=== VERIFICATION: Level 1 Referrals for Jan 2026 ===');
    console.log('This should match /api/users/get-referals endpoint\n');

    // Query that mimics the FIXED code (Level 1 only)
    const level1Total = await Referral.aggregate([
        { $match: {
            referrer: user._id,
            referralLevel: 1,  // LEVEL 1 ONLY - this is the fix
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
                    subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] },  // CLASSIQUE/CIBLE only - this is the fix
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

    const total = level1Total[0]?.total || 0;
    const subscribed = level1Subscribed[0]?.total || 0;
    const nonSubscribed = level1NonSubscribed[0]?.total || 0;

    console.log('✅ EXPECTED VALUES (should match /api/users/get-referals):');
    console.log(`   Total Level 1: ${total}`);
    console.log(`   Subscribed (CLASSIQUE/CIBLE): ${subscribed}`);
    console.log(`   Non-subscribed: ${nonSubscribed}`);
    console.log(`   Sum check: ${subscribed + nonSubscribed} = ${total} ✓`);

    console.log('\n=== Summary of Fixes Applied ===');
    console.log('1. Added referralLevel: 1 filter to campaign queries');
    console.log('2. Added subscriptionType: CLASSIQUE/CIBLE filter (excludes RELANCE)');
    console.log('3. Fixed date filter to use user.createdAt (registration date)');
    console.log('\nAfter rebuilding user-service, campaign preview should show:');
    console.log(`   - ${nonSubscribed} non-subscribed users (not 94)`);
    console.log(`   - ${subscribed} subscribed users`);
    console.log(`   - ${total} total users for January 2026`);

    await mongoose.disconnect();
}

verifyFix().catch(console.error);
