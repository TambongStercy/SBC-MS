// MongoDB shell script to diagnose referral pagination issues
// Run with: mongosh --file 8-diagnose-referral-pagination.js

const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== REFERRAL PAGINATION DIAGNOSTIC ===\n');

// Test with a specific user ID that has the issue
// Replace this with the actual user ID experiencing the problem
const testUserId = '673aeb438564c97489b355e7'; // Replace with actual problematic user ID

print(`Diagnosing referral pagination for user: ${testUserId}\n`);

// 1. Check total referral records for this user
const totalReferrals = prodDb.referrals.countDocuments({
    referrer: new ObjectId(testUserId),
    archived: { $ne: true }
});

print(`Total referral records: ${totalReferrals}`);

// 2. Check referrals by level
const level1Count = prodDb.referrals.countDocuments({
    referrer: new ObjectId(testUserId),
    referralLevel: 1,
    archived: { $ne: true }
});

const level2Count = prodDb.referrals.countDocuments({
    referrer: new ObjectId(testUserId),
    referralLevel: 2,
    archived: { $ne: true }
});

const level3Count = prodDb.referrals.countDocuments({
    referrer: new ObjectId(testUserId),
    referralLevel: 3,
    archived: { $ne: true }
});

print(`Level 1 referrals: ${level1Count}`);
print(`Level 2 referrals: ${level2Count}`);
print(`Level 3 referrals: ${level3Count}`);
print(`Total by levels: ${level1Count + level2Count + level3Count}`);

// 3. Check if referred users still exist
print('\n=== CHECKING REFERRED USER EXISTENCE ===');

const referralsWithUsers = prodDb.referrals.aggregate([
    {
        $match: {
            referrer: new ObjectId(testUserId),
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
            userBlocked: { $arrayElemAt: ['$userData.blocked', 0] },
            userName: { $arrayElemAt: ['$userData.name', 0] }
        }
    },
    {
        $project: {
            referredUser: 1,
            userExists: 1,
            userDeleted: 1,
            userBlocked: 1,
            userName: 1,
            createdAt: 1
        }
    }
]).toArray();

let validUsers = 0;
let deletedUsers = 0;
let blockedUsers = 0;
let missingUsers = 0;

referralsWithUsers.forEach((ref, index) => {
    if (index < 10) { // Show first 10 for debugging
        print(`Referral ${index + 1}:`);
        print(`  User ID: ${ref.referredUser}`);
        print(`  User exists: ${ref.userExists}`);
        print(`  User name: ${ref.userName || 'N/A'}`);
        print(`  User deleted: ${ref.userDeleted || false}`);
        print(`  User blocked: ${ref.userBlocked || false}`);
        print(`  Created: ${ref.createdAt}`);
        print('');
    }
    
    if (!ref.userExists) {
        missingUsers++;
    } else if (ref.userDeleted) {
        deletedUsers++;
    } else if (ref.userBlocked) {
        blockedUsers++;
    } else {
        validUsers++;
    }
});

print(`=== USER STATUS SUMMARY ===`);
print(`Valid users: ${validUsers}`);
print(`Deleted users: ${deletedUsers}`);
print(`Blocked users: ${blockedUsers}`);
print(`Missing users: ${missingUsers}`);
print(`Total checked: ${referralsWithUsers.length}`);

// 4. Test pagination logic manually
print('\n=== TESTING PAGINATION LOGIC ===');

const page1Results = prodDb.referrals.aggregate([
    {
        $match: {
            referrer: new ObjectId(testUserId),
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
        $addFields: {
            'nameLower': { $toLower: '$referredUserData.name' }
        }
    },
    { $sort: { 'nameLower': 1 } },
    { $skip: 0 }, // Page 1
    { $limit: 10 },
    {
        $project: {
            _id: '$referredUserData._id',
            name: '$referredUserData.name',
            email: '$referredUserData.email',
            phoneNumber: '$referredUserData.phoneNumber',
            referralLevel: '$referralLevel',
            createdAt: '$createdAt'
        }
    }
]).toArray();

print(`Page 1 results: ${page1Results.length} users`);
page1Results.forEach((user, index) => {
    print(`  ${index + 1}. ${user.name} (${user.email})`);
});

// 5. Check for duplicate referrals
print('\n=== CHECKING FOR DUPLICATE REFERRALS ===');

const duplicateCheck = prodDb.referrals.aggregate([
    {
        $match: {
            referrer: new ObjectId(testUserId),
            archived: { $ne: true }
        }
    },
    {
        $group: {
            _id: {
                referrer: '$referrer',
                referredUser: '$referredUser',
                referralLevel: '$referralLevel'
            },
            count: { $sum: 1 },
            referralIds: { $push: '$_id' }
        }
    },
    {
        $match: {
            count: { $gt: 1 }
        }
    }
]).toArray();

print(`Duplicate referrals found: ${duplicateCheck.length}`);
duplicateCheck.forEach((dup, index) => {
    print(`  Duplicate ${index + 1}: User ${dup._id.referredUser} at level ${dup._id.referralLevel} (${dup.count} times)`);
});

// 6. Check index usage
print('\n=== CHECKING INDEXES ===');

const indexes = prodDb.referrals.getIndexes();
print('Current indexes on referrals collection:');
indexes.forEach(index => {
    print(`  ${JSON.stringify(index.key)} - ${index.name}`);
});

// 7. Sample problematic query simulation
print('\n=== SIMULATING PROBLEMATIC QUERY ===');

// This simulates the exact query that might be causing issues
const countQuery = {
    referrer: new ObjectId(testUserId),
    referralLevel: 1,
    archived: { $ne: true }
};

const directCount = prodDb.referrals.countDocuments(countQuery);
print(`Direct count query result: ${directCount}`);

// Count with user validation
const validatedCount = prodDb.referrals.aggregate([
    { $match: countQuery },
    { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { 'user.deleted': { $ne: true }, 'user.blocked': { $ne: true } } },
    { $count: 'totalCount' }
]).toArray();

const validatedCountResult = validatedCount[0]?.totalCount || 0;
print(`Validated count (with user checks): ${validatedCountResult}`);
print(`Count discrepancy: ${directCount - validatedCountResult}`);

print('\n=== DIAGNOSTIC COMPLETE ===');
print('This diagnostic will help identify:');
print('1. Whether users are being deleted/blocked after referrals');
print('2. If there are duplicate referral records');
print('3. If pagination logic is working correctly');
print('4. If indexes are properly set up');
print('5. The exact cause of count vs data mismatch');