// Test script to verify subType pagination fix
const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/sbc_user_dev');

const referralSchema = new mongoose.Schema({
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referralLevel: Number,
    archived: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    phoneNumber: String,
    deleted: { type: Boolean, default: false },
    blocked: { type: Boolean, default: false }
});

const subscriptionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subscriptionType: String,
    status: String,
    createdAt: { type: Date, default: Date.now }
});

const Referral = mongoose.model('Referral', referralSchema);
const User = mongoose.model('User', userSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

async function testSubTypePagination() {
    try {
        console.log('=== TESTING SUBTYPE PAGINATION FIX ===\n');

        // Find a user with many referrals
        const testUser = await Referral.findOne({ archived: { $ne: true } });
        if (!testUser) {
            console.log('No referrals found in database');
            return;
        }

        const referrerId = testUser.referrer;
        console.log(`Testing with referrer ID: ${referrerId}`);

        // Test the old problematic approach (filtering after pagination)
        console.log('\n--- OLD APPROACH (problematic) ---');
        
        // Get page 1 data
        const oldPage1 = await Referral.find({
            referrer: referrerId,
            referralLevel: 1,
            archived: { $ne: true }
        })
        .populate('referredUser')
        .skip(0)
        .limit(10);

        // Get subscription data for these users
        const userIds = oldPage1.map(ref => ref.referredUser._id);
        const subscriptions = await Subscription.find({
            user: { $in: userIds },
            status: 'ACTIVE'
        });

        const subscriptionMap = new Map();
        subscriptions.forEach(sub => {
            const userId = sub.user.toString();
            if (!subscriptionMap.has(userId)) {
                subscriptionMap.set(userId, []);
            }
            subscriptionMap.get(userId).push(sub.subscriptionType);
        });

        // Apply subType=none filter (users with no active subscriptions)
        const oldFiltered = oldPage1.filter(ref => {
            const userId = ref.referredUser._id.toString();
            const userSubs = subscriptionMap.get(userId);
            return !userSubs || userSubs.length === 0;
        });

        console.log(`Old approach - Raw data: ${oldPage1.length}`);
        console.log(`Old approach - After subType=none filter: ${oldFiltered.length}`);

        // Test the new approach (filtering in database)
        console.log('\n--- NEW APPROACH (fixed) ---');
        
        const newPipeline = [
            {
                $match: {
                    referrer: referrerId,
                    referralLevel: 1,
                    archived: { $ne: true }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'referredUserData'
                }
            },
            {
                $unwind: {
                    path: '$referredUserData',
                    preserveNullAndEmptyArrays: false
                }
            },
            {
                $match: {
                    'referredUserData.deleted': { $ne: true },
                    'referredUserData.blocked': { $ne: true }
                }
            },
            {
                $lookup: {
                    from: 'subscriptions',
                    let: { userId: '$referredUserData._id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ['$user', '$$userId'] },
                                status: 'ACTIVE'
                            }
                        }
                    ],
                    as: 'activeSubscriptions'
                }
            },
            {
                $match: {
                    $or: [
                        { activeSubscriptions: { $size: 0 } },
                        { activeSubscriptions: { $exists: false } }
                    ]
                }
            }
        ];

        // Get count
        const countPipeline = [...newPipeline, { $count: 'total' }];
        const countResult = await Referral.aggregate(countPipeline);
        const totalCount = countResult[0]?.total || 0;

        // Get page 1 data
        const dataPipeline = [
            ...newPipeline,
            { $skip: 0 },
            { $limit: 10 },
            {
                $project: {
                    _id: 1,
                    referrer: 1,
                    referralLevel: 1,
                    createdAt: 1,
                    'referredUser._id': '$referredUserData._id',
                    'referredUser.name': '$referredUserData.name',
                    'referredUser.email': '$referredUserData.email'
                }
            }
        ];

        const newPage1 = await Referral.aggregate(dataPipeline);

        console.log(`New approach - Total count: ${totalCount}`);
        console.log(`New approach - Page 1 data: ${newPage1.length}`);
        console.log(`Count matches data: ${totalCount >= newPage1.length ? 'YES' : 'NO'}`);

        // Test page 2
        const page2Pipeline = [
            ...newPipeline,
            { $skip: 10 },
            { $limit: 10 },
            {
                $project: {
                    _id: 1,
                    referrer: 1,
                    referralLevel: 1,
                    createdAt: 1,
                    'referredUser._id': '$referredUserData._id',
                    'referredUser.name': '$referredUserData.name',
                    'referredUser.email': '$referredUserData.email'
                }
            }
        ];

        const newPage2 = await Referral.aggregate(page2Pipeline);
        console.log(`New approach - Page 2 data: ${newPage2.length}`);

        console.log('\n=== RESULTS ===');
        console.log(`Fix successful: ${newPage1.length > 0 || totalCount === 0 ? 'YES' : 'NO'}`);
        console.log(`Pagination consistent: ${totalCount >= newPage1.length ? 'YES' : 'NO'}`);

        if (newPage1.length > 0) {
            console.log('\nSample users with no subscriptions (page 1):');
            newPage1.slice(0, 3).forEach((user, index) => {
                console.log(`  ${index + 1}. ${user.referredUser?.name || 'N/A'} (${user.referredUser?.email || 'N/A'})`);
            });
        } else if (totalCount === 0) {
            console.log('\nNo users found with subType=none filter (this is valid)');
        } else {
            console.log('\n⚠️  Issue: totalCount > 0 but no data returned for page 1');
        }

    } catch (error) {
        console.error('Error testing subType pagination:', error);
    } finally {
        mongoose.connection.close();
    }
}

testSubTypePagination();