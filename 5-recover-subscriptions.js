// MongoDB shell script to recover subscriptions from SBCv1 backup
// Run with: mongosh --file 5-recover-subscriptions.js

const backupDb = connect('mongodb://127.0.0.1:27017/SBCv1');
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== SUBSCRIPTION RECOVERY FROM SBCv1 BACKUP ===\n');

// Create indexes for faster lookups if they don't exist
print('Ensuring indexes for optimal performance...');
try {
    prodDb.users.createIndex({ _id: 1 });
    prodDb.subscriptions.createIndex({ user: 1 });
    print('Indexes created/verified');
} catch (e) {
    print('Indexes already exist or error creating them');
}

const totalSubscriptions = backupDb.subscribes.countDocuments();
print(`Total subscriptions in backup: ${totalSubscriptions}`);

// Build user lookup cache for faster existence checks
print('Building user lookup cache...');
const prodUserIds = new Set();
prodDb.users.find({}, { _id: 1 }).forEach(u => {
    prodUserIds.add(u._id.toString());
});
print(`Cached ${prodUserIds.size} production user IDs`);

// Build existing subscriptions lookup for duplicate detection
print('Building existing subscriptions cache...');
const usersWithSubscriptions = new Set();
prodDb.subscriptions.find({}, { user: 1 }).forEach(sub => {
    usersWithSubscriptions.add(sub.user.toString());
});
print(`Cached ${usersWithSubscriptions.size} users with existing subscriptions`);

let missingUserSubscriptions = 0;
let userAlreadyHasSubscription = 0;
let recoveredCount = 0;
const typeCount = { CLASSIQUE: 0, PREMIUM: 0 };

const processingBatchSize = 5000; // Smaller batches for better memory management
const insertBatchSize = 1000; // Insert in smaller batches
print(`\nProcessing subscriptions in batches of ${processingBatchSize}...`);

// Process and insert in streaming fashion to avoid memory buildup
for (let skip = 0; skip < totalSubscriptions; skip += processingBatchSize) {
    const batchEnd = Math.min(skip + processingBatchSize, totalSubscriptions);
    print(`\nProcessing batch: ${skip + 1} to ${batchEnd} (${((batchEnd / totalSubscriptions) * 100).toFixed(1)}%)`);

    const backupSubscriptionsBatch = backupDb.subscribes.find({}).skip(skip).limit(processingBatchSize).toArray();
    const recoverableBatch = [];

    for (const backupSub of backupSubscriptionsBatch) {
        // Skip if user field is missing or null
        if (!backupSub.user) {
            missingUserSubscriptions++;
            continue;
        }

        // Fast existence check using cached set
        const userKey = backupSub.user.toString();

        if (!prodUserIds.has(userKey)) {
            missingUserSubscriptions++;
            continue;
        }

        // Check if user already has subscription using cached set
        if (usersWithSubscriptions.has(userKey)) {
            userAlreadyHasSubscription++;
            continue;
        }

        // Add to cache to prevent duplicates within this batch
        usersWithSubscriptions.add(userKey);

        // Convert old subscription format to new format
        const subscriptionType = backupSub.plan === '1' ? 'CLASSIQUE' :
            backupSub.plan === '2' ? 'PREMIUM' : 'CLASSIQUE';

        typeCount[subscriptionType]++;

        recoverableBatch.push({
            user: backupSub.user,
            subscriptionType: subscriptionType,
            startDate: backupSub.date || new Date(),
            endDate: new Date('9999-12-31T23:59:59.999Z'),
            status: 'active',
            metadata: {
                migratedFromPlan: backupSub.plan,
                sourceSubId: backupSub._id,
                recoveredFromBackup: true
            },
            createdAt: backupSub.date || new Date(),
            updatedAt: new Date(),
            __v: 0
        });
    }

    // Insert recoverable subscriptions in sub-batches
    if (recoverableBatch.length > 0) {
        for (let i = 0; i < recoverableBatch.length; i += insertBatchSize) {
            const insertBatch = recoverableBatch.slice(i, i + insertBatchSize);

            try {
                prodDb.subscriptions.insertMany(insertBatch, { ordered: false });
                recoveredCount += insertBatch.length;
            } catch (error) {
                print(`Error inserting batch: ${error.message}`);
                // Try individual inserts for failed batch
                for (const sub of insertBatch) {
                    try {
                        prodDb.subscriptions.insertOne(sub);
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

print(`\n✅ Subscription recovery completed!`);
print(`Successfully recovered: ${recoveredCount} subscriptions`);

// Verify recovery
const finalSubscriptionCount = prodDb.subscriptions.countDocuments();
print(`Total subscriptions in production now: ${finalSubscriptionCount}`);

print(`\n=== RECOVERY SUMMARY ===`);
print(`- Total subscriptions in backup: ${totalSubscriptions}`);
print(`- Missing users (couldn't recover): ${missingUserSubscriptions}`);
print(`- Users already had subscriptions: ${userAlreadyHasSubscription}`);
print(`- Successfully recovered: ${recoveredCount}`);

// Calculate recovery impact
const originalProdSubCount = 32226; // Before subscription recovery

print(`\n=== IMPACT ANALYSIS ===`);
print(`Original backup subscriptions: ${totalSubscriptions}`);
print(`Production before recovery: ${originalProdSubCount}`);
print(`Subscriptions recovered: ${recoveredCount}`);
print(`Production after recovery: ${finalSubscriptionCount}`);

if (recoveredCount > 0) {
    print(`\nSubscription Types Recovered:`);
    print(`- CLASSIQUE: ${typeCount.CLASSIQUE} subscriptions`);
    print(`- PREMIUM: ${typeCount.PREMIUM} subscriptions`);
}