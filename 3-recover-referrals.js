// MongoDB shell script to recover referrals from SBCv1 backup
// Run with: mongosh --file 3-recover-referrals.js

const backupDb = connect('mongodb://127.0.0.1:27017/SBCv1');
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== REFERRAL RECOVERY FROM SBCv1 BACKUP ===\n');

// Create indexes for faster lookups if they don't exist
print('Ensuring indexes for optimal performance...');
try {
    prodDb.users.createIndex({ _id: 1 });
    prodDb.referrals.createIndex({ referrer: 1, referredUser: 1 });
    print('Indexes created/verified');
} catch (e) {
    print('Indexes already exist or error creating them');
}

const totalReferrals = backupDb.referrals.countDocuments();
print(`Total referrals in backup: ${totalReferrals}`);

// Build user lookup sets for faster existence checks
print('Building user lookup cache...');
const prodUserIds = new Set();
prodDb.users.find({}, { _id: 1 }).forEach(u => {
    prodUserIds.add(u._id.toString());
});
print(`Cached ${prodUserIds.size} production user IDs`);

// Build existing referrals lookup for duplicate detection
print('Building existing referrals cache...');
const existingReferrals = new Set();
prodDb.referrals.find({}, { referrer: 1, referredUser: 1 }).forEach(ref => {
    existingReferrals.add(`${ref.referrer}_${ref.referredUser}`);
});
print(`Cached ${existingReferrals.size} existing referral pairs`);

let missingUserReferrals = 0;
let duplicateReferrals = 0;
let recoveredCount = 0;

const processingBatchSize = 10000; // Smaller batches for better memory management
const insertBatchSize = 1000; // Insert in smaller batches
print(`\nProcessing referrals in batches of ${processingBatchSize}...`);

// Process and insert in streaming fashion to avoid memory buildup
for (let skip = 0; skip < totalReferrals; skip += processingBatchSize) {
    const batchEnd = Math.min(skip + processingBatchSize, totalReferrals);
    print(`\nProcessing batch: ${skip + 1} to ${batchEnd} (${((batchEnd / totalReferrals) * 100).toFixed(1)}%)`);

    const backupReferralsBatch = backupDb.referrals.find({}).skip(skip).limit(processingBatchSize).toArray();
    const recoverableBatch = [];

    for (const backupRef of backupReferralsBatch) {
        // Fast existence checks using cached sets
        const referrerKey = backupRef.referrer.toString();
        const referredKey = backupRef.referredUser.toString();

        if (!prodUserIds.has(referrerKey) || !prodUserIds.has(referredKey)) {
            missingUserReferrals++;
            continue;
        }

        // Check for duplicates using cached set
        const referralKey = `${backupRef.referrer}_${backupRef.referredUser}`;
        if (existingReferrals.has(referralKey)) {
            duplicateReferrals++;
            continue;
        }

        // Add to cache to prevent duplicates within this batch
        existingReferrals.add(referralKey);

        recoverableBatch.push({
            referrer: backupRef.referrer,
            referredUser: backupRef.referredUser,
            referralLevel: backupRef.referralLevel || 1,
            archived: false,
            createdAt: backupRef.createdAt,
            __v: backupRef.__v || 0
        });
    }

    // Insert recoverable referrals in sub-batches
    if (recoverableBatch.length > 0) {
        for (let i = 0; i < recoverableBatch.length; i += insertBatchSize) {
            const insertBatch = recoverableBatch.slice(i, i + insertBatchSize);

            try {
                prodDb.referrals.insertMany(insertBatch, { ordered: false });
                recoveredCount += insertBatch.length;
            } catch (error) {
                print(`Error inserting batch: ${error.message}`);
                // Try individual inserts for failed batch
                for (const ref of insertBatch) {
                    try {
                        prodDb.referrals.insertOne(ref);
                        recoveredCount++;
                    } catch (e) {
                        // Skip individual failures
                    }
                }
            }
        }
    }

    print(`  Batch completed. Recovered so far: ${recoveredCount}`);
}

print(`\n✅ Referral recovery completed!`);
print(`Successfully recovered: ${recoveredCount} referrals`);

// Verify recovery
const finalReferralCount = prodDb.referrals.countDocuments();
print(`Total referrals in production now: ${finalReferralCount}`);

print(`\n=== RECOVERY SUMMARY ===`);
print(`- Total referrals in backup: ${totalReferrals}`);
print(`- Missing users (couldn't recover): ${missingUserReferrals}`);
print(`- Already existed in production: ${duplicateReferrals}`);
print(`- Successfully recovered: ${recoveredCount}`);

// Calculate recovery impact
const originalBackupCount = 311037;
const originalProdCount = 170540;

print(`\n=== IMPACT ANALYSIS ===`);
print(`Original backup referrals: ${originalBackupCount}`);
print(`Production before recovery: ${originalProdCount}`);
print(`Referrals recovered: ${recoveredCount}`);
print(`Production after recovery: ${finalReferralCount}`);
if (originalBackupCount > originalProdCount) {
    print(`Recovery percentage: ${((recoveredCount / (originalBackupCount - originalProdCount)) * 100).toFixed(2)}%`);
}