// MongoDB shell script to fix referral pagination issues
// Run with: mongosh --file 9-fix-referral-pagination.js

const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== FIXING REFERRAL PAGINATION ISSUES ===\n');

const dryRun = false; // Set to false to apply fixes
if (dryRun) {
    print('🔍 DRY RUN MODE - No changes will be made');
    print('Use --apply flag to execute fixes\n');
}

// 1. Clean up referrals pointing to deleted/non-existent users
print('=== STEP 1: CLEANING UP ORPHANED REFERRALS ===');

const orphanedReferrals = prodDb.referrals.aggregate([
    {
        $lookup: {
            from: 'users',
            localField: 'referredUser',
            foreignField: '_id',
            as: 'userData'
        }
    },
    {
        $match: {
            $or: [
                { 'userData': { $size: 0 } }, // User doesn't exist
                { 'userData.deleted': true }, // User is deleted
                { 'userData.blocked': true }  // User is blocked
            ],
            archived: { $ne: true } // Only process non-archived referrals
        }
    },
    {
        $project: {
            _id: 1,
            referrer: 1,
            referredUser: 1,
            referralLevel: 1,
            createdAt: 1,
            userExists: { $gt: [{ $size: '$userData' }, 0] },
            userDeleted: { $arrayElemAt: ['$userData.deleted', 0] },
            userBlocked: { $arrayElemAt: ['$userData.blocked', 0] }
        }
    }
]).toArray();

print(`Found ${orphanedReferrals.length} orphaned referrals`);

if (orphanedReferrals.length > 0) {
    print('First 10 orphaned referrals:');
    orphanedReferrals.slice(0, 10).forEach((ref, index) => {
        let reason = 'Unknown';
        if (!ref.userExists) reason = 'User deleted/missing';
        else if (ref.userDeleted) reason = 'User soft-deleted';
        else if (ref.userBlocked) reason = 'User blocked';

        print(`  ${index + 1}. Referral ${ref._id} -> User ${ref.referredUser} (${reason})`);
    });

    if (!dryRun) {
        const orphanedIds = orphanedReferrals.map(ref => ref._id);
        const archiveResult = prodDb.referrals.updateMany(
            { _id: { $in: orphanedIds } },
            {
                $set: {
                    archived: true,
                    archivedAt: new Date(),
                    archiveReason: 'User deleted/blocked/missing'
                }
            }
        );
        print(`✅ Archived ${archiveResult.modifiedCount} orphaned referrals`);
    }
}

// 2. Remove duplicate referrals
print('\n=== STEP 2: REMOVING DUPLICATE REFERRALS ===');

const duplicates = prodDb.referrals.aggregate([
    {
        $match: {
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
            referrals: { $push: { id: '$_id', createdAt: '$createdAt' } }
        }
    },
    {
        $match: {
            count: { $gt: 1 }
        }
    }
]).toArray();

print(`Found ${duplicates.length} duplicate referral groups`);

let totalDuplicatesToRemove = 0;
const duplicateIdsToRemove = [];

duplicates.forEach((dup, index) => {
    // Sort by createdAt and keep the oldest one
    dup.referrals.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const toRemove = dup.referrals.slice(1); // Remove all except the first (oldest)

    totalDuplicatesToRemove += toRemove.length;
    duplicateIdsToRemove.push(...toRemove.map(r => r.id));

    if (index < 5) { // Show first 5 duplicate groups
        print(`  Group ${index + 1}: ${dup._id.referrer} -> ${dup._id.referredUser} (L${dup._id.referralLevel})`);
        print(`    Keeping: ${dup.referrals[0].id} (${dup.referrals[0].createdAt})`);
        print(`    Removing: ${toRemove.length} duplicates`);
    }
});

if (totalDuplicatesToRemove > 0) {
    print(`Total duplicate referrals to remove: ${totalDuplicatesToRemove}`);

    if (!dryRun) {
        const removeResult = prodDb.referrals.updateMany(
            { _id: { $in: duplicateIdsToRemove } },
            {
                $set: {
                    archived: true,
                    archivedAt: new Date(),
                    archiveReason: 'Duplicate referral removed'
                }
            }
        );
        print(`✅ Archived ${removeResult.modifiedCount} duplicate referrals`);
    }
}

// 3. Rebuild referral indexes for better performance
print('\n=== STEP 3: OPTIMIZING INDEXES ===');

if (!dryRun) {
    try {
        // Drop existing indexes (except _id)
        const existingIndexes = prodDb.referrals.getIndexes();
        existingIndexes.forEach(index => {
            if (index.name !== '_id_') {
                try {
                    prodDb.referrals.dropIndex(index.name);
                    print(`Dropped index: ${index.name}`);
                } catch (e) {
                    print(`Could not drop index ${index.name}: ${e.message}`);
                }
            }
        });

        // Create optimized indexes
        prodDb.referrals.createIndex({ referrer: 1, referralLevel: 1, archived: 1 });
        prodDb.referrals.createIndex({ referrer: 1, archived: 1 });
        prodDb.referrals.createIndex({ referredUser: 1, archived: 1 });
        prodDb.referrals.createIndex({ referrer: 1, referredUser: 1 });

        print('✅ Created optimized indexes');
    } catch (error) {
        print(`Error optimizing indexes: ${error.message}`);
    }
} else {
    print('Would optimize referral indexes for better query performance');
}

// 4. Validate pagination after fixes
print('\n=== STEP 4: VALIDATION TEST ===');

// Test with a few users to see if pagination is working
const testUsers = prodDb.referrals.aggregate([
    { $match: { archived: { $ne: true } } },
    { $group: { _id: '$referrer', count: { $sum: 1 } } },
    { $match: { count: { $gt: 10 } } },
    { $limit: 3 }
]).toArray();

print(`Testing pagination with ${testUsers.length} users who have referrals:`);

testUsers.forEach((user, index) => {
    const userId = user._id;

    // Count query (what the API uses)
    const countResult = prodDb.referrals.countDocuments({
        referrer: userId,
        referralLevel: 1,
        archived: { $ne: true }
    });

    // Data query (what the API uses) - simulating the aggregation
    const dataResult = prodDb.referrals.aggregate([
        {
            $match: {
                referrer: userId,
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
        { $limit: 10 },
        {
            $project: {
                _id: '$referredUserData._id',
                name: '$referredUserData.name'
            }
        }
    ]).toArray();

    print(`  User ${index + 1} (${userId}):`);
    print(`    Count query: ${countResult}`);
    print(`    Data query: ${dataResult.length} results`);
    print(`    Match: ${countResult === dataResult.length ? '✅' : '❌'}`);
});

// 5. Generate summary report
print('\n=== CLEANUP SUMMARY ===');
print(`Orphaned referrals found: ${orphanedReferrals.length}`);
print(`Duplicate referrals found: ${totalDuplicatesToRemove}`);
print(`Total issues identified: ${orphanedReferrals.length + totalDuplicatesToRemove}`);

if (dryRun) {
    print('\n⚠️  DRY RUN COMPLETE - No changes were made');
    print('Run with --apply flag to execute the fixes');
    print('\nRecommended actions:');
    print('1. Run this script with --apply to fix the issues');
    print('2. Test the API endpoints after fixes');
    print('3. Monitor for any remaining pagination issues');
} else {
    print('\n✅ CLEANUP COMPLETE');
    print('The referral pagination issues should now be resolved.');
    print('Test your API endpoints to verify the fixes.');
}

print('\n=== ADDITIONAL RECOMMENDATIONS ===');
print('1. Consider adding validation in your API to prevent orphaned referrals');
print('2. Add monitoring for referral data integrity');
print('3. Implement soft-delete handling in referral queries');
print('4. Consider caching referral counts for better performance');