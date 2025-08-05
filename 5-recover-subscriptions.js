// MongoDB shell script to recover subscriptions from SBCv1 backup
// Run with: mongosh --file 5-recover-subscriptions.js

const backupDb = connect('mongodb://127.0.0.1:27017/SBCv1');
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== SUBSCRIPTION RECOVERY FROM SBCv1 BACKUP ===\n');

const totalSubscriptions = backupDb.subscribes.countDocuments();
print(`Total subscriptions in backup: ${totalSubscriptions}`);

let recoverableSubscriptions = [];
let missingUserSubscriptions = 0;
let userAlreadyHasSubscription = 0;
let processedCount = 0;

const processingBatchSize = 10000; // Process 10K at a time
print(`\nProcessing subscriptions in batches of ${processingBatchSize}...`);

// Process subscriptions in batches
for (let skip = 0; skip < totalSubscriptions; skip += processingBatchSize) {
    const batchEnd = Math.min(skip + processingBatchSize, totalSubscriptions);
    print(`\nProcessing batch: ${skip + 1} to ${batchEnd} (${((batchEnd / totalSubscriptions) * 100).toFixed(1)}%)`);
    
    const backupSubscriptionsBatch = backupDb.subscribes.find({}).skip(skip).limit(processingBatchSize).toArray();
    
    for (let i = 0; i < backupSubscriptionsBatch.length; i++) {
        const backupSub = backupSubscriptionsBatch[i];
        processedCount++;
        
        // Progress indicator within batch
        if (i % 2000 === 0 && i > 0) {
            print(`  Processed ${i}/${backupSubscriptionsBatch.length} in current batch...`);
        }
        
        // Check if user exists in production
        const userExists = prodDb.users.findOne({_id: backupSub.user});
        
        if (!userExists) {
            missingUserSubscriptions++;
            continue;
        }
        
        // Check if user already has a subscription in production
        const existingSubInProd = prodDb.subscriptions.findOne({user: backupSub.user});
        
        if (existingSubInProd) {
            userAlreadyHasSubscription++;
            continue;
        }
        
        // This subscription can be safely recovered
        // Convert old subscription format to new format
        const subscriptionType = backupSub.plan === '1' ? 'CLASSIQUE' : 
                                backupSub.plan === '2' ? 'PREMIUM' : 'CLASSIQUE';
        
        recoverableSubscriptions.push({
            user: backupSub.user,
            subscriptionType: subscriptionType,
            startDate: backupSub.date || new Date(),
            endDate: new Date('9999-12-31T23:59:59.999Z'), // Set to far future like production
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
    
    print(`  Batch completed. Recoverable so far: ${recoverableSubscriptions.length}`);
}

print(`\nAnalysis Complete:`);
print(`- Total subscriptions in backup: ${totalSubscriptions}`);
print(`- Missing users (can't recover): ${missingUserSubscriptions}`);
print(`- User already has subscription: ${userAlreadyHasSubscription}`);
print(`- Safely recoverable: ${recoverableSubscriptions.length}`);

// Recover subscriptions in batches
if (recoverableSubscriptions.length > 0) {
    print(`\nStarting subscription recovery...`);
    
    const insertBatchSize = 1000;
    let recoveredCount = 0;
    
    for (let i = 0; i < recoverableSubscriptions.length; i += insertBatchSize) {
        const batch = recoverableSubscriptions.slice(i, i + insertBatchSize);
        
        try {
            prodDb.subscriptions.insertMany(batch, { ordered: false });
            recoveredCount += batch.length;
            
            print(`Recovered batch: ${recoveredCount}/${recoverableSubscriptions.length} subscriptions`);
            
        } catch (error) {
            print(`Error in batch starting at index ${i}: ${error.message}`);
            // Continue with next batch
        }
    }
    
    print(`\n✅ Subscription recovery completed!`);
    print(`Successfully recovered: ${recoveredCount} subscriptions`);
    
    // Verify recovery
    const finalSubscriptionCount = prodDb.subscriptions.countDocuments();
    print(`Total subscriptions in production now: ${finalSubscriptionCount}`);
    
} else {
    print(`\nNo subscriptions to recover.`);
}

print(`\n=== RECOVERY SUMMARY ===`);
print(`Subscriptions recovered: ${recoverableSubscriptions.length}`);
print(`Subscriptions with missing users: ${missingUserSubscriptions}`);
print(`Users already had subscriptions: ${userAlreadyHasSubscription}`);

// Calculate recovery impact
const originalProdSubCount = 32226; // Before subscription recovery
const recoveredSubCount = recoverableSubscriptions.length;

print(`\n=== IMPACT ANALYSIS ===`);
print(`Original backup subscriptions: ${totalSubscriptions}`);
print(`Production before recovery: ${originalProdSubCount}`);
print(`Subscriptions recovered: ${recoveredSubCount}`);
print(`Production after recovery: ${originalProdSubCount + recoveredSubCount}`);

if (recoveredSubCount > 0) {
    print(`\nSubscription Types Recovered:`);
    const typeCount = {};
    recoverableSubscriptions.forEach(sub => {
        typeCount[sub.subscriptionType] = (typeCount[sub.subscriptionType] || 0) + 1;
    });
    
    Object.keys(typeCount).forEach(type => {
        print(`- ${type}: ${typeCount[type]} subscriptions`);
    });
}