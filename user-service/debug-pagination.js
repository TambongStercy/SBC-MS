// Debug script to understand pagination issue
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

const Referral = mongoose.model('Referral', referralSchema);
const User = mongoose.model('User', userSchema);

async function debugPagination() {
    try {
        console.log('=== DEBUGGING PAGINATION ISSUE ===\n');

        // Find a user with the specific issue
        const referrerId = new mongoose.Types.ObjectId('65d07017411f423f597c8ee5');
        
        console.log(`Debugging referrer ID: ${referrerId}`);

        // Check total referrals
        const totalReferrals = await Referral.countDocuments({
            referrer: referrerId,
            referralLevel: 1,
            archived: { $ne: true }
        });
        console.log(`Total level 1 referrals: ${totalReferrals}`);

        // Check how many have valid users
        const referralsWithUsers = await Referral.aggregate([
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
                    as: 'userData'
                }
            },
            {
                $addFields: {
                    userExists: { $gt: [{ $size: '$userData' }, 0] },
                    userDeleted: { $arrayElemAt: ['$userData.deleted', 0] },
                    userBlocked: { $arrayElemAt: ['$userData.blocked', 0] }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    withUser: { $sum: { $cond: ['$userExists', 1, 0] } },
                    withDeletedUser: { $sum: { $cond: ['$userDeleted', 1, 0] } },
                    withBlockedUser: { $sum: { $cond: ['$userBlocked', 1, 0] } },
                    validUsers: { 
                        $sum: { 
                            $cond: [
                                { 
                                    $and: [
                                        '$userExists',
                                        { $ne: ['$userDeleted', true] },
                                        { $ne: ['$userBlocked', true] }
                                    ]
                                }, 
                                1, 
                                0
                            ] 
                        } 
                    }
                }
            }
        ]);

        const stats = referralsWithUsers[0];
        console.log('\nReferral Statistics:');
        console.log(`  Total referrals: ${stats.total}`);
        console.log(`  With existing user: ${stats.withUser}`);
        console.log(`  With deleted user: ${stats.withDeletedUser}`);
        console.log(`  With blocked user: ${stats.withBlockedUser}`);
        console.log(`  Valid users: ${stats.validUsers}`);

        // Test pagination with different approaches
        console.log('\n=== TESTING DIFFERENT PAGINATION APPROACHES ===');

        // Approach 1: Simple pagination (current problematic approach)
        console.log('\n--- Approach 1: Simple Pagination ---');
        const page1Simple = await Referral.find({
            referrer: referrerId,
            referralLevel: 1,
            archived: { $ne: true }
        })
        .populate('referredUser')
        .skip(0)
        .limit(10);

        const page1Valid = page1Simple.filter(ref => 
            ref.referredUser && 
            !ref.referredUser.deleted && 
            !ref.referredUser.blocked
        );

        console.log(`Page 1 - Total fetched: ${page1Simple.length}`);
        console.log(`Page 1 - Valid after filtering: ${page1Valid.length}`);

        // Approach 2: Aggregation with proper filtering
        console.log('\n--- Approach 2: Aggregation with Filtering ---');
        const page1Aggregation = await Referral.aggregate([
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
        ]);

        console.log(`Page 1 - Aggregation results: ${page1Aggregation.length}`);

        // Check if there are enough valid users for page 1
        const validUsersForPage1 = await Referral.aggregate([
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
            { $limit: 10 }
        ]);

        console.log(`\nActual valid users available for page 1: ${validUsersForPage1.length}`);

        if (validUsersForPage1.length > 0) {
            console.log('Sample valid users:');
            validUsersForPage1.slice(0, 3).forEach((user, index) => {
                console.log(`  ${index + 1}. ${user.referredUserData.name} (${user.referredUserData.email})`);
            });
        }

    } catch (error) {
        console.error('Error debugging pagination:', error);
    } finally {
        mongoose.connection.close();
    }
}

debugPagination();