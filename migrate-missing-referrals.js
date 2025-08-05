// Migration script to recover missing referrals from old DB to production
// Run with: mongosh --file migrate-missing-referrals.js

print('=== Missing Referrals Migration Script ===');

const oldDb = connect('mongodb://127.0.0.1:27017/SBC');
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

// Define the cutoff date (after Feb 23, 2025)
const cutoffDate = new Date('2025-02-23T23:59:59.999Z');

print(`Finding referrals created after: ${cutoffDate}`);

// Get missing referrals from old DB
const missingReferrals = oldDb.referrals.find({
    createdAt: { $gt: cutoffDate }
}).toArray();

print(`Found ${missingReferrals.length} missing referrals to migrate`);

if (missingReferrals.length === 0) {
    print('No referrals to migrate. Exiting.');
    quit();
}

// Show date range of missing referrals
const dates = missingReferrals.map(r => r.createdAt).sort();
print(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);

// Prepare referrals for insertion (add archived field, generate new ObjectIds)
const referralsToInsert = missingReferrals.map(ref => ({
    referrer: ref.referrer,
    referredUser: ref.referredUser,
    referralLevel: ref.referralLevel,
    archived: false,  // Add the archived field that production DB has
    createdAt: ref.createdAt,
    __v: ref.__v || 0
}));

print(`\nPrepared ${referralsToInsert.length} referrals for insertion`);

// Show sample of what will be inserted
print('\nSample referral to be inserted:');
printjson(referralsToInsert[0]);

print('\n⚠️  WARNING: This will insert referrals into PRODUCTION database!');
print('Press Ctrl+C to cancel, or any key to continue...');

// Uncomment the lines below to actually perform the migration
// print('\nStarting migration...');
// const result = prodDb.referrals.insertMany(referralsToInsert);
// print(`Successfully inserted ${result.insertedIds.length} referrals`);

print('\n✅ Migration script prepared. Uncomment the insertion lines to execute.');
print('Recommended: Test on a backup first!');