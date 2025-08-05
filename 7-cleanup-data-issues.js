// MongoDB shell script to clean up data integrity issues
// Run with: mongosh --file 7-cleanup-data-issues.js

const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== DATA CLEANUP OPERATIONS ===\n');

let cleanupSummary = {
    orphanedReferralsRemoved: 0,
    duplicateReferralsRemoved: 0,
    duplicateSubscriptionsHandled: 0,
    usersWithoutEmailFound: 0
};

// ===== 1. REMOVE ORPHANED REFERRALS =====
print('1. CLEANING ORPHANED REFERRALS');
print('===============================');

print('Finding referrals with missing referred users...');
const orphanedReferrals = prodDb.referrals.aggregate([
    {
        $lookup: {
            from: "users",
            localField: "referredUser",
            foreignField: "_id",
            as: "referredUserData"
        }
    },
    { $match: { referredUserData: { $size: 0 } } },
    { $project: { _id: 1, referrer: 1, referredUser: 1, createdAt: 1 } }
]).toArray();

if (orphanedReferrals.length > 0) {
    print(`Found ${orphanedReferrals.length} orphaned referrals. Removing them...`);
    
    // Show first few for logging
    orphanedReferrals.slice(0, 3).forEach((ref, index) => {
        print(`  ${index + 1}. Referral ID: ${ref._id}, Missing User: ${ref.referredUser}`);
    });
    
    // Remove orphaned referrals
    const orphanedIds = orphanedReferrals.map(ref => ref._id);
    const deleteResult = prodDb.referrals.deleteMany({ _id: { $in: orphanedIds } });
    
    cleanupSummary.orphanedReferralsRemoved = deleteResult.deletedCount;
    print(`✅ Removed ${deleteResult.deletedCount} orphaned referrals`);
} else {
    print('✅ No orphaned referrals found');
}

// ===== 2. REMOVE DUPLICATE REFERRALS =====
print('\n2. CLEANING DUPLICATE REFERRALS');
print('================================');

print('Finding duplicate referral relationships...');
const duplicateReferrals = prodDb.referrals.aggregate([
    {
        $group: {
            _id: { referrer: "$referrer", referredUser: "$referredUser" },
            count: { $sum: 1 },
            ids: { $push: "$_id" },
            dates: { $push: "$createdAt" }
        }
    },
    { $match: { count: { $gt: 1 } } }
]).toArray();

if (duplicateReferrals.length > 0) {
    print(`Found ${duplicateReferrals.length} duplicate referral relationships. Cleaning up...`);
    
    let duplicatesRemoved = 0;
    
    duplicateReferrals.forEach((dup, index) => {
        if (index < 3) {
            print(`  ${index + 1}. Referrer: ${dup._id.referrer}, Referred: ${dup._id.referredUser} (${dup.count} duplicates)`);
        }
        
        // Keep the oldest referral (first created), remove the rest
        const sortedByDate = dup.ids.map((id, i) => ({ id, date: dup.dates[i] }))
                                    .sort((a, b) => (a.date || new Date(0)) - (b.date || new Date(0)));
        
        const idsToRemove = sortedByDate.slice(1).map(item => item.id); // Remove all except the first (oldest)
        
        if (idsToRemove.length > 0) {
            const deleteResult = prodDb.referrals.deleteMany({ _id: { $in: idsToRemove } });
            duplicatesRemoved += deleteResult.deletedCount;
        }
    });
    
    cleanupSummary.duplicateReferralsRemoved = duplicatesRemoved;
    print(`✅ Removed ${duplicatesRemoved} duplicate referrals (kept oldest for each relationship)`);
} else {
    print('✅ No duplicate referrals found');
}

// ===== 3. HANDLE MULTIPLE SUBSCRIPTIONS =====
print('\n3. HANDLING MULTIPLE SUBSCRIPTIONS');
print('===================================');

print('Finding users with multiple subscriptions...');
const multipleSubscriptions = prodDb.subscriptions.aggregate([
    { $group: { _id: "$user", count: { $sum: 1 }, subIds: { $push: "$_id" }, dates: { $push: "$createdAt" } } },
    { $match: { count: { $gt: 1 } } }
]).toArray();

if (multipleSubscriptions.length > 0) {
    print(`Found ${multipleSubscriptions.length} users with multiple subscriptions.`);
    print('Strategy: Keep the most recent subscription, remove older ones...');
    
    let subscriptionsRemoved = 0;
    
    multipleSubscriptions.forEach((multi, index) => {
        if (index < 3) {
            print(`  ${index + 1}. User: ${multi._id} has ${multi.count} subscriptions`);
        }
        
        // Keep the most recent subscription, remove the rest
        const sortedByDate = multi.subIds.map((id, i) => ({ id, date: multi.dates[i] }))
                                         .sort((a, b) => (b.date || new Date(0)) - (a.date || new Date(0)));
        
        const idsToRemove = sortedByDate.slice(1).map(item => item.id); // Remove all except the first (most recent)
        
        if (idsToRemove.length > 0) {
            const deleteResult = prodDb.subscriptions.deleteMany({ _id: { $in: idsToRemove } });
            subscriptionsRemoved += deleteResult.deletedCount;
        }
    });
    
    cleanupSummary.duplicateSubscriptionsHandled = subscriptionsRemoved;
    print(`✅ Removed ${subscriptionsRemoved} duplicate subscriptions (kept most recent for each user)`);
} else {
    print('✅ No users with multiple subscriptions found');
}

// ===== 4. IDENTIFY USER WITHOUT EMAIL =====
print('\n4. IDENTIFYING USER WITHOUT EMAIL');
print('==================================');

const usersWithoutEmail = prodDb.users.find({
    $or: [
        { email: { $exists: false } },
        { email: null },
        { email: "" }
    ]
}, { _id: 1, username: 1, createdAt: 1 }).toArray();

if (usersWithoutEmail.length > 0) {
    print(`Found ${usersWithoutEmail.length} user(s) without email:`);
    usersWithoutEmail.forEach((user, index) => {
        print(`  ${index + 1}. User ID: ${user._id}, Username: ${user.username || 'N/A'}, Created: ${user.createdAt || 'N/A'}`);
    });
    print('⚠️  Manual review recommended for users without email addresses');
    cleanupSummary.usersWithoutEmailFound = usersWithoutEmail.length;
} else {
    print('✅ All users have email addresses');
}

// ===== CLEANUP SUMMARY =====
print('\n=== CLEANUP SUMMARY ===');
print('========================');
print(`Orphaned referrals removed: ${cleanupSummary.orphanedReferralsRemoved}`);
print(`Duplicate referrals removed: ${cleanupSummary.duplicateReferralsRemoved}`);
print(`Duplicate subscriptions removed: ${cleanupSummary.duplicateSubscriptionsHandled}`);
print(`Users without email (manual review): ${cleanupSummary.usersWithoutEmailFound}`);

// ===== FINAL VERIFICATION =====
print('\n=== FINAL VERIFICATION ===');
print('===========================');

const finalCounts = {
    users: prodDb.users.countDocuments(),
    referrals: prodDb.referrals.countDocuments(),
    subscriptions: prodDb.subscriptions.countDocuments()
};

print(`Final counts after cleanup:`);
print(`- Users: ${finalCounts.users.toLocaleString()}`);
print(`- Referrals: ${finalCounts.referrals.toLocaleString()}`);
print(`- Subscriptions: ${finalCounts.subscriptions.toLocaleString()}`);

print('\n✅ DATA CLEANUP COMPLETED!');
print('Database integrity issues have been resolved.');
print('Run validation script again to confirm all issues are fixed.');