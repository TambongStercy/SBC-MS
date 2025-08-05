// MongoDB shell script to recover users from SBCv1 backup
// Run with: mongosh --file 2-recover-users.js

const backupDb = connect('mongodb://127.0.0.1:27017/SBCv1');
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== USER RECOVERY FROM SBCv1 BACKUP ===\n');

print('Analyzing all users from backup...');
const backupUsers = backupDb.users.find({}).toArray();
print(`Total users in backup: ${backupUsers.length}`);

let recoverableUsers = [];
let conflictUsers = [];
let existingUsers = 0;
let processedCount = 0;

print('\nProcessing users...');

for (let i = 0; i < backupUsers.length; i++) {
    const backupUser = backupUsers[i];
    processedCount++;
    
    // Progress indicator
    if (processedCount % 5000 === 0) {
        print(`Processed ${processedCount}/${backupUsers.length} users...`);
    }
    
    // Check if user exists in production (by ID)
    const existsInProd = prodDb.users.findOne({_id: backupUser._id});
    
    if (existsInProd) {
        existingUsers++;
        continue;
    }
    
    // Check for email conflicts in production
    const emailConflict = backupUser.email ? 
        prodDb.users.findOne({email: backupUser.email}) : null;
    
    if (emailConflict) {
        conflictUsers.push({
            backupUser: {
                _id: backupUser._id,
                email: backupUser.email,
                username: backupUser.username,
                createdAt: backupUser.createdAt
            },
            conflictingUser: {
                _id: emailConflict._id,
                email: emailConflict.email,
                username: emailConflict.username,
                createdAt: emailConflict.createdAt
            }
        });
        continue;
    }
    
    // This user can be safely recovered
    recoverableUsers.push(backupUser);
}

print(`\nAnalysis Complete:`);
print(`- Total users in backup: ${backupUsers.length}`);
print(`- Already exist in production: ${existingUsers}`);
print(`- Email conflicts (need manual review): ${conflictUsers.length}`);
print(`- Safely recoverable: ${recoverableUsers.length}`);

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

// Recover users in batches
if (recoverableUsers.length > 0) {
    print(`\nStarting user recovery...`);
    
    const batchSize = 1000;
    let recoveredCount = 0;
    
    for (let i = 0; i < recoverableUsers.length; i += batchSize) {
        const batch = recoverableUsers.slice(i, i + batchSize);
        
        try {
            // Add archived field to match production schema
            const usersToInsert = batch.map(user => ({
                ...user,
                archived: false // Add this field to match production schema
            }));
            
            prodDb.users.insertMany(usersToInsert, { ordered: false });
            recoveredCount += batch.length;
            
            print(`Recovered batch: ${recoveredCount}/${recoverableUsers.length} users`);
            
        } catch (error) {
            print(`Error in batch starting at index ${i}: ${error.message}`);
            // Continue with next batch
        }
    }
    
    print(`\n✅ User recovery completed!`);
    print(`Successfully recovered: ${recoveredCount} users`);
    
    // Verify recovery
    const finalUserCount = prodDb.users.countDocuments();
    print(`Total users in production now: ${finalUserCount}`);
    
} else {
    print(`\nNo users to recover.`);
}

print(`\n=== RECOVERY SUMMARY ===`);
print(`Users recovered: ${recoverableUsers.length}`);
print(`Email conflicts (manual review needed): ${conflictUsers.length}`);
print(`Users already existed: ${existingUsers}`);

if (conflictUsers.length > 0) {
    print(`\nNext steps:`);
    print(`1. Review conflicts in 'user_recovery_conflicts' collection`);
    print(`2. Manually resolve email conflicts`);
    print(`3. Run referral recovery script`);
}