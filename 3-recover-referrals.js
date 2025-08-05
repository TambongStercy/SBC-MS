// MongoDB shell script to recover referrals from SBCv1 backup
// Run with: mongosh --file 3-recover-referrals.js

const backupDb = connect('mongodb://127.0.0.1:27017/SBCv1');
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== REFERRAL RECOVERY FROM SBCv1 BACKUP ===\n');

const totalReferrals = backupDb.referrals.countDocuments();
print(`Total referrals in backup: ${totalReferrals}`);

let recoverableReferrals = [];
let missingUserReferrals = 0;
let duplicateReferrals = 0;
let processedCount = 0;

const processingBatchSize = 50000; // Process 50K at a time
print(`\nProcessing referrals in batches of ${processingBatchSize}...`);

// Process referrals in batches to avoid memory issues
for (let skip = 0; skip < totalReferrals; skip += processingBatchSize) {
    const batchEnd = Math.min(skip + processingBatchSize, totalReferrals);
    print(`\nProcessing batch: ${skip + 1} to ${batchEnd} (${((batchEnd / totalReferrals) * 100).toFixed(1)}%)`);

    const backupReferralsBatch = backupDb.referrals.find({}).skip(skip).limit(processingBatchSize).toArray();

    for (let i = 0; i < backupReferralsBatch.length; i++) {
        const backupRef = backupReferralsBatch[i];
        processedCount++;

        // Progress indicator within batch
        if (i % 10000 === 0 && i > 0) {
            print(`  Processed ${i}/${backupReferralsBatch.length} in current batch...`);
        }

        // Check if both users exist in production
        const referrerExists = prodDb.users.findOne({ _id: backupRef.referrer });
        const referredExists = prodDb.users.findOne({ _id: backupRef.referredUser });

        if (!referrerExists || !referredExists) {
            missingUserReferrals++;
            continue;
        }

        // Check if referral already exists in production
        const existsInProd = prodDb.referrals.findOne({
            referrer: backupRef.referrer,
            referredUser: backupRef.referredUser
        });

        if (existsInProd) {
            duplicateReferrals++;
            continue;
        }

        // This referral can be safely recovered
        recoverableReferrals.push({
            referrer: backupRef.referrer,
            referredUser: backupRef.referredUser,
            referralLevel: backupRef.referralLevel || 1,
            archived: false, // Add field to match production schema
            createdAt: backupRef.createdAt,
            __v: backupRef.__v || 0
        });
    }

    print(`  Batch completed. Recoverable so far: ${recoverableReferrals.length}`);
}

print(`\nAnalysis Complete:`);
print(`- Total referrals in backup: ${totalReferrals}`);
print(`- Missing users (can't recover): ${missingUserReferrals}`);
print(`- Already exist in production: ${duplicateReferrals}`);
print(`- Safely recoverable: ${recoverableReferrals.length}`);

// Recover referrals in batches
if (recoverableReferrals.length > 0) {
    print(`\nStarting referral recovery...`);

    const batchSize = 1000;
    let recoveredCount = 0;

    for (let i = 0; i < recoverableReferrals.length; i += batchSize) {
        const batch = recoverableReferrals.slice(i, i + batchSize);

        try {
            prodDb.referrals.insertMany(batch, { ordered: false });
            recoveredCount += batch.length;

            print(`Recovered batch: ${recoveredCount}/${recoverableReferrals.length} referrals`);

        } catch (error) {
            print(`Error in batch starting at index ${i}: ${error.message}`);
            // Continue with next batch
        }
    }

    print(`\n✅ Referral recovery completed!`);
    print(`Successfully recovered: ${recoveredCount} referrals`);

    // Verify recovery
    const finalReferralCount = prodDb.referrals.countDocuments();
    print(`Total referrals in production now: ${finalReferralCount}`);

} else {
    print(`\nNo referrals to recover.`);
}

print(`\n=== RECOVERY SUMMARY ===`);
print(`Referrals recovered: ${recoverableReferrals.length}`);
print(`Referrals with missing users: ${missingUserReferrals}`);
print(`Referrals already existed: ${duplicateReferrals}`);

// Calculate recovery impact
const originalBackupCount = 311037;
const originalProdCount = 170540;
const recoveredCount = recoverableReferrals.length;

print(`\n=== IMPACT ANALYSIS ===`);
print(`Original backup referrals: ${originalBackupCount}`);
print(`Production before recovery: ${originalProdCount}`);
print(`Referrals recovered: ${recoveredCount}`);
print(`Production after recovery: ${originalProdCount + recoveredCount}`);
print(`Recovery percentage: ${((recoveredCount / (originalBackupCount - originalProdCount)) * 100).toFixed(2)}%`);