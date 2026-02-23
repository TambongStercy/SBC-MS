const mongoose = require('mongoose');

async function debugRufusCampaign() {
    await mongoose.connect('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const Referral = mongoose.model('Referral', new mongoose.Schema({}, { strict: false }), 'referrals');

    const user = await User.findOne({ email: 'rufusherma@gmail.com' });
    console.log('User:', user._id.toString(), user.name);

    const jan2026From = new Date('2026-01-01T00:00:00.000Z');
    const jan2026To = new Date('2026-01-31T23:59:59.999Z');

    console.log('\n=== DEBUGGING: January 2026 Query ===');
    console.log('Date range:', jan2026From.toISOString(), 'to', jan2026To.toISOString());

    // Step 1: Total LEVEL 1 referrals (what the code SHOULD query)
    console.log('\n--- Step 1: Level 1 Referrals ---');
    const level1Total = await Referral.countDocuments({
        referrer: user._id,
        referralLevel: 1,
        archived: { $ne: true }
    });
    console.log('Total Level 1 referrals (no date filter):', level1Total);

    // Step 2: Level 1 referrals registered in Jan 2026
    console.log('\n--- Step 2: Level 1 + Date Filter ---');
    const level1Jan2026 = await Referral.aggregate([
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
        { $count: 'total' }
    ]);
    console.log('Level 1 referrals in Jan 2026:', level1Jan2026[0]?.total || 0);

    // Step 3: What if we're missing the referralLevel filter?
    console.log('\n--- Step 3: ALL LEVELS (no referralLevel filter) ---');
    const allLevelsJan2026 = await Referral.aggregate([
        { $match: {
            referrer: user._id,
            archived: { $ne: true }
            // NO referralLevel filter!
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

    // Step 4: What if the date filter is on referral.createdAt instead of user.createdAt?
    console.log('\n--- Step 4: Level 1 with WRONG date filter (referral.createdAt) ---');
    const wrongDateFilter = await Referral.countDocuments({
        referrer: user._id,
        referralLevel: 1,
        archived: { $ne: true },
        createdAt: { $gte: jan2026From, $lte: jan2026To }
    });
    console.log('Level 1 referrals created in Jan 2026 (wrong filter):', wrongDateFilter);

    // Step 5: Check if user has ALL referrals (including archived)
    console.log('\n--- Step 5: Including Archived ---');
    const includingArchived = await Referral.aggregate([
        { $match: {
            referrer: user._id,
            referralLevel: 1
            // No archived filter
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
    console.log('Level 1 in Jan 2026 (including archived):', includingArchived[0]?.total || 0);

    // Step 6: Sample some referrals to see their structure
    console.log('\n--- Step 6: Sample Referrals ---');
    const sampleReferrals = await Referral.find({
        referrer: user._id,
        referralLevel: 1
    }).limit(5).lean();

    console.log('\nSample of 5 Level 1 referrals:');
    for (const ref of sampleReferrals) {
        console.log(`- ID: ${ref._id}, Level: ${ref.referralLevel}, Archived: ${ref.archived || false}, CreatedAt: ${ref.createdAt?.toISOString().split('T')[0] || 'N/A'}`);
    }

    // Step 7: Check the actual endpoint query (getReferralsForCampaign simulation)
    console.log('\n--- Step 7: Simulating getReferralsForCampaign endpoint ---');

    // This is what the endpoint SHOULD do after our fix
    const User2 = mongoose.model('User2', new mongoose.Schema({}, { strict: false }), 'users');
    const referrals = await User2.aggregate([
        { $match: { _id: user._id } },
        { $lookup: {
            from: 'referrals',
            let: { userId: '$_id' },
            pipeline: [
                { $match: {
                    $expr: { $eq: ['$referrer', '$$userId'] },
                    referralLevel: 1,  // THIS IS THE KEY FIX
                    archived: { $ne: true }
                }},
                { $lookup: {
                    from: 'users',
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'userData'
                }},
                { $unwind: '$userData' },
                { $match: {
                    'userData.createdAt': { $gte: jan2026From, $lte: jan2026To },
                    'userData.deleted': { $ne: true },
                    'userData.blocked': { $ne: true }
                }}
            ],
            as: 'referrals'
        }},
        { $project: { count: { $size: '$referrals' } } }
    ]);

    console.log('Simulated endpoint result (with referralLevel: 1):', referrals[0]?.count || 0);

    console.log('\n=== EXPECTED RESULT ===');
    console.log('The user should see:', level1Jan2026[0]?.total || 0, 'users');
    console.log('\nIf they see 15,331 users, the code is likely:');
    console.log('1. Missing referralLevel: 1 filter (would give:', allLevelsJan2026[0]?.total || 0, 'users)');
    console.log('2. Using wrong date filter on referral.createdAt');
    console.log('3. Including archived referrals');

    await mongoose.disconnect();
}

debugRufusCampaign().catch(console.error);
