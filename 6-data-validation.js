// MongoDB shell script to validate data integrity after recovery
// Run with: mongosh --file 6-data-validation.js

const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== DATA INTEGRITY VALIDATION ===\n');

let validationErrors = [];
let validationWarnings = [];

// ===== USER VALIDATION =====
print('1. USER DATA VALIDATION');
print('========================');

const totalUsers = prodDb.users.countDocuments();
print(`Total users in production: ${totalUsers}`);

// Check for duplicate emails
print('Checking for duplicate emails...');
const duplicateEmails = prodDb.users.aggregate([
    { $match: { email: { $exists: true, $ne: null, $ne: "" } } },
    { $group: { _id: "$email", count: { $sum: 1 }, users: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } }
]).toArray();

if (duplicateEmails.length > 0) {
    validationErrors.push(`Found ${duplicateEmails.length} duplicate email addresses`);
    print(`❌ Found ${duplicateEmails.length} duplicate emails`);
    duplicateEmails.slice(0, 3).forEach((dup, index) => {
        print(`  ${index + 1}. Email: ${dup._id} (${dup.count} users: ${dup.users.join(', ')})`);
    });
} else {
    print('✅ No duplicate emails found');
}

// Check for users without email
const usersWithoutEmail = prodDb.users.countDocuments({
    $or: [
        { email: { $exists: false } },
        { email: null },
        { email: "" }
    ]
});

if (usersWithoutEmail > 0) {
    validationWarnings.push(`${usersWithoutEmail} users without email addresses`);
    print(`⚠️  ${usersWithoutEmail} users without email addresses`);
} else {
    print('✅ All users have email addresses');
}

// ===== REFERRAL VALIDATION =====
print('\n2. REFERRAL DATA VALIDATION');
print('============================');

const totalReferrals = prodDb.referrals.countDocuments();
print(`Total referrals in production: ${totalReferrals}`);

// Check for orphaned referrals (referrer doesn't exist)
print('Checking for orphaned referrals (missing referrer)...');
const orphanedReferrers = prodDb.referrals.aggregate([
    {
        $lookup: {
            from: "users",
            localField: "referrer",
            foreignField: "_id",
            as: "referrerUser"
        }
    },
    { $match: { referrerUser: { $size: 0 } } },
    { $count: "orphanedReferrers" }
]).toArray();

const orphanedReferrerCount = orphanedReferrers.length > 0 ? orphanedReferrers[0].orphanedReferrers : 0;
if (orphanedReferrerCount > 0) {
    validationErrors.push(`${orphanedReferrerCount} referrals with missing referrer users`);
    print(`❌ Found ${orphanedReferrerCount} referrals with missing referrer users`);
} else {
    print('✅ All referrals have valid referrer users');
}

// Check for orphaned referrals (referred user doesn't exist)
print('Checking for orphaned referrals (missing referred user)...');
const orphanedReferred = prodDb.referrals.aggregate([
    {
        $lookup: {
            from: "users",
            localField: "referredUser",
            foreignField: "_id",
            as: "referredUserData"
        }
    },
    { $match: { referredUserData: { $size: 0 } } },
    { $count: "orphanedReferred" }
]).toArray();

const orphanedReferredCount = orphanedReferred.length > 0 ? orphanedReferred[0].orphanedReferred : 0;
if (orphanedReferredCount > 0) {
    validationErrors.push(`${orphanedReferredCount} referrals with missing referred users`);
    print(`❌ Found ${orphanedReferredCount} referrals with missing referred users`);
} else {
    print('✅ All referrals have valid referred users');
}

// Check for duplicate referrals
print('Checking for duplicate referrals...');
const duplicateReferrals = prodDb.referrals.aggregate([
    {
        $group: {
            _id: { referrer: "$referrer", referredUser: "$referredUser" },
            count: { $sum: 1 },
            ids: { $push: "$_id" }
        }
    },
    { $match: { count: { $gt: 1 } } }
]).toArray();

if (duplicateReferrals.length > 0) {
    validationErrors.push(`Found ${duplicateReferrals.length} duplicate referral relationships`);
    print(`❌ Found ${duplicateReferrals.length} duplicate referral relationships`);
    duplicateReferrals.slice(0, 3).forEach((dup, index) => {
        print(`  ${index + 1}. Referrer: ${dup._id.referrer}, Referred: ${dup._id.referredUser} (${dup.count} duplicates)`);
    });
} else {
    print('✅ No duplicate referrals found');
}

// ===== SUBSCRIPTION VALIDATION =====
print('\n3. SUBSCRIPTION DATA VALIDATION');
print('================================');

const totalSubscriptions = prodDb.subscriptions.countDocuments();
print(`Total subscriptions in production: ${totalSubscriptions}`);

// Check for orphaned subscriptions (user doesn't exist)
print('Checking for orphaned subscriptions...');
const orphanedSubscriptions = prodDb.subscriptions.aggregate([
    {
        $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "userData"
        }
    },
    { $match: { userData: { $size: 0 } } },
    { $count: "orphanedSubs" }
]).toArray();

const orphanedSubCount = orphanedSubscriptions.length > 0 ? orphanedSubscriptions[0].orphanedSubs : 0;
if (orphanedSubCount > 0) {
    validationErrors.push(`${orphanedSubCount} subscriptions with missing users`);
    print(`❌ Found ${orphanedSubCount} subscriptions with missing users`);
} else {
    print('✅ All subscriptions have valid users');
}

// Check for users with multiple subscriptions
print('Checking for users with multiple subscriptions...');
const multipleSubscriptions = prodDb.subscriptions.aggregate([
    { $group: { _id: "$user", count: { $sum: 1 }, subIds: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } }
]).toArray();

if (multipleSubscriptions.length > 0) {
    validationWarnings.push(`${multipleSubscriptions.length} users have multiple subscriptions`);
    print(`⚠️  ${multipleSubscriptions.length} users have multiple subscriptions`);
    multipleSubscriptions.slice(0, 3).forEach((multi, index) => {
        print(`  ${index + 1}. User: ${multi._id} has ${multi.count} subscriptions`);
    });
} else {
    print('✅ No users with multiple subscriptions');
}

// Check subscription types distribution
print('Checking subscription types...');
const subscriptionTypes = prodDb.subscriptions.aggregate([
    { $group: { _id: "$subscriptionType", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
]).toArray();

print('Subscription type distribution:');
subscriptionTypes.forEach(type => {
    print(`  - ${type._id}: ${type.count} subscriptions`);
});

// ===== RECOVERY METADATA VALIDATION =====
print('\n4. RECOVERY METADATA VALIDATION');
print('================================');

// Check recovered users (those with archived: false field)
const recoveredUsers = prodDb.users.countDocuments({ archived: false });
print(`Users with recovery metadata: ${recoveredUsers}`);

// Check recovered referrals
const recoveredReferrals = prodDb.referrals.countDocuments({ archived: false });
print(`Referrals with recovery metadata: ${recoveredReferrals}`);

// Check recovered subscriptions
const recoveredSubscriptions = prodDb.subscriptions.countDocuments({ 
    "metadata.recoveredFromBackup": true 
});
print(`Subscriptions recovered from backup: ${recoveredSubscriptions}`);

// ===== FINAL VALIDATION SUMMARY =====
print('\n=== VALIDATION SUMMARY ===');
print('===========================');

if (validationErrors.length === 0) {
    print('✅ DATA INTEGRITY: EXCELLENT');
    print('No critical data integrity issues found.');
} else {
    print('❌ DATA INTEGRITY: ISSUES FOUND');
    print('Critical issues that need attention:');
    validationErrors.forEach((error, index) => {
        print(`  ${index + 1}. ${error}`);
    });
}

if (validationWarnings.length > 0) {
    print('\n⚠️  WARNINGS:');
    validationWarnings.forEach((warning, index) => {
        print(`  ${index + 1}. ${warning}`);
    });
}

print('\n=== DATABASE STATISTICS ===');
print(`Total Users: ${totalUsers.toLocaleString()}`);
print(`Total Referrals: ${totalReferrals.toLocaleString()}`);
print(`Total Subscriptions: ${totalSubscriptions.toLocaleString()}`);

print('\n=== VALIDATION COMPLETED ===');
print('Database validation completed successfully.');
if (validationErrors.length === 0) {
    print('Your database is ready for production use! 🎉');
} else {
    print('Please address the critical issues before proceeding.');
}