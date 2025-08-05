// MongoDB shell script to recover users from SBCv1 backup
// Run with: mongosh --file 2-recover-users.js

const backupDb = connect('mongodb://127.0.0.1:27017/SBCv1');
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== USER RECOVERY FROM SBCv1 BACKUP ===\n');

// Create indexes for faster lookups if they don't exist
print('Ensuring indexes for optimal performance...');
try {
    prodDb.users.createIndex({ _id: 1 });
    prodDb.users.createIndex({ email: 1 });
    print('Indexes created/verified');
} catch (e) {
    print('Indexes already exist or error creating them');
}

const totalUsers = backupDb.users.countDocuments();
print(`Total users in backup: ${totalUsers}`);

// Build production user lookup caches for faster existence checks
print('Building production user lookup caches...');
const prodUserIds = new Set();
const prodUserEmails = new Set();

prodDb.users.find({}, { _id: 1, email: 1 }).forEach(u => {
    prodUserIds.add(u._id.toString());
    if (u.email) {
        prodUserEmails.add(u.email.toLowerCase());
    }
});

print(`Cached ${prodUserIds.size} production user IDs`);
print(`Cached ${prodUserEmails.size} production user emails`);

let conflictUsers = [];
let existingUsers = 0;
let recoveredCount = 0;

const processingBatchSize = 5000; // Process in smaller batches
const insertBatchSize = 1000; // Insert in smaller batches
print(`\nProcessing users in batches of ${processingBatchSize}...`);

// Process and insert in streaming fashion to avoid memory buildup
for (let skip = 0; skip < totalUsers; skip += processingBatchSize) {
    const batchEnd = Math.min(skip + processingBatchSize, totalUsers);
    print(`\nProcessing batch: ${skip + 1} to ${batchEnd} (${((batchEnd / totalUsers) * 100).toFixed(1)}%)`);

    const backupUsersBatch = backupDb.users.find({}).skip(skip).limit(processingBatchSize).toArray();
    const recoverableBatch = [];

    for (const backupUser of backupUsersBatch) {
        // Fast existence check using cached set
        const userIdKey = backupUser._id.toString();

        if (prodUserIds.has(userIdKey)) {
            existingUsers++;
            continue;
        }

        // Check for email conflicts using cached set
        if (backupUser.email) {
            const emailKey = backupUser.email.toLowerCase();
            if (prodUserEmails.has(emailKey)) {
                // Get the conflicting user details for reporting
                const conflictingUser = prodDb.users.findOne({ email: backupUser.email });
                conflictUsers.push({
                    backupUser: {
                        _id: backupUser._id,
                        email: backupUser.email,
                        username: backupUser.username,
                        createdAt: backupUser.createdAt
                    },
                    conflictingUser: {
                        _id: conflictingUser._id,
                        email: conflictingUser.email,
                        username: conflictingUser.username,
                        createdAt: conflictingUser.createdAt
                    }
                });
                continue;
            }
            // Add to cache to prevent duplicates within this batch
            prodUserEmails.add(emailKey);
        }

        // Add to cache to prevent duplicates within this batch
        prodUserIds.add(userIdKey);

        // This user can be safely recovered
        recoverableBatch.push({
            ...backupUser,
            archived: false // Add field to match production schema
        });
    }

    // Insert recoverable users in sub-batches
    if (recoverableBatch.length > 0) {
        for (let i = 0; i < recoverableBatch.length; i += insertBatchSize) {
            const insertBatch = recoverableBatch.slice(i, i + insertBatchSize);

            try {
                prodDb.users.insertMany(insertBatch, { ordered: false });
                recoveredCount += insertBatch.length;
            } catch (error) {
                print(`Error inserting batch: ${error.message}`);
                // Try individual inserts for failed batch
                for (const user of insertBatch) {
                    try {
                        prodDb.users.insertOne(user);
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

print(`\n✅ User recovery completed!`);
print(`Successfully recovered: ${recoveredCount} users`);

// Save conflict report for manual review
if (conflictUsers.length > 0) {
    print(`\nSaving email conflicts for manual review...`);

    // Create a temporary collection to store conflicts
    prodDb.user_recovery_conflicts.drop(); // Clear any existing conflicts
    prodDb.user_recovery_conflicts.insertMany(conflictUsers);

    print(`Email conflicts saved to 'user_recovery_conflicts' collection`);
    print(`Review these conflicts manually before proceeding.`);

    // Show first few conflicts
    print(`\nFirst 3 email conflicts:`);
    conflictUsers.slice(0, 3).forEach((conflict, index) => {
        print(`\nConflict ${index + 1}:`);
        print(`  Backup user: ${conflict.backupUser._id} - ${conflict.backupUser.email}`);
        print(`  Production user: ${conflict.conflictingUser._id} - ${conflict.conflictingUser.email}`);
    });
}

// Verify recovery
const finalUserCount = prodDb.users.countDocuments();
print(`Total users in production now: ${finalUserCount}`);

print(`\n=== RECOVERY SUMMARY ===`);
print(`- Total users in backup: ${totalUsers}`);
print(`- Already existed in production: ${existingUsers}`);
print(`- Email conflicts (manual review needed): ${conflictUsers.length}`);
print(`- Successfully recovered: ${recoveredCount}`);

if (conflictUsers.length > 0) {
    print(`\nNext steps:`);
    print(`1. Review conflicts in 'user_recovery_conflicts' collection`);
    print(`2. Manually resolve email conflicts`);
    print(`3. Run referral recovery script`);
}