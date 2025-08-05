// MongoDB shell script to analyze createdAt consistency in backup databases
// Run with: mongosh --file analyze-backup-createdAt.js

const backupDb = connect('mongodb://127.0.0.1:27017/SBCv1');
const oldDb = connect('mongodb://127.0.0.1:27017/SBC');
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== ANALYZING CREATEDAT CONSISTENCY ACROSS ALL DATABASES ===\n');

// Function to extract timestamp from ObjectId
function getObjectIdTimestamp(objectId) {
    return objectId.getTimestamp();
}

// Function to compare dates (allowing small differences due to precision)
function datesAreClose(date1, date2, toleranceMs = 1000) {
    if (!date1 || !date2) return false;
    return Math.abs(date1.getTime() - date2.getTime()) <= toleranceMs;
}

// Function to analyze a collection
function analyzeCollection(db, collectionName, sampleSize = 100) {
    const collection = db[collectionName];
    const totalDocs = collection.countDocuments();
    
    if (totalDocs === 0) {
        return {
            total: 0,
            consistent: 0,
            inconsistent: 0,
            consistencyRate: 0,
            samples: []
        };
    }
    
    const docs = collection.find({}).limit(sampleSize).toArray();
    let consistent = 0;
    let inconsistent = 0;
    const samples = [];
    
    docs.forEach((doc, index) => {
        const objectIdDate = getObjectIdTimestamp(doc._id);
        const createdAtDate = doc.createdAt;
        const isConsistent = datesAreClose(objectIdDate, createdAtDate);
        
        if (isConsistent) {
            consistent++;
        } else {
            inconsistent++;
        }
        
        if (index < 3) { // Keep first 3 as samples
            samples.push({
                _id: doc._id,
                objectIdDate: objectIdDate,
                createdAtDate: createdAtDate,
                consistent: isConsistent,
                difference: createdAtDate ? Math.abs(objectIdDate.getTime() - createdAtDate.getTime()) : null
            });
        }
    });
    
    return {
        total: totalDocs,
        sampled: docs.length,
        consistent: consistent,
        inconsistent: inconsistent,
        consistencyRate: (consistent / docs.length * 100).toFixed(2),
        samples: samples
    };
}

print('1. ANALYZING BACKUP DATABASE (SBCv1)...');
print('=====================================');

const backupUsers = analyzeCollection(backupDb, 'users');
print(`Users in backup:`);
print(`  Total: ${backupUsers.total}`);
print(`  Sampled: ${backupUsers.sampled}`);
print(`  Consistent: ${backupUsers.consistent}`);
print(`  Inconsistent: ${backupUsers.inconsistent}`);
print(`  Consistency rate: ${backupUsers.consistencyRate}%`);

const backupReferrals = analyzeCollection(backupDb, 'referrals');
print(`\nReferrals in backup:`);
print(`  Total: ${backupReferrals.total}`);
print(`  Sampled: ${backupReferrals.sampled}`);
print(`  Consistent: ${backupReferrals.consistent}`);
print(`  Inconsistent: ${backupReferrals.inconsistent}`);
print(`  Consistency rate: ${backupReferrals.consistencyRate}%`);

const backupSubscriptions = analyzeCollection(backupDb, 'subscribes');
print(`\nSubscriptions in backup:`);
print(`  Total: ${backupSubscriptions.total}`);
print(`  Sampled: ${backupSubscriptions.sampled}`);
print(`  Consistent: ${backupSubscriptions.consistent}`);
print(`  Inconsistent: ${backupSubscriptions.inconsistent}`);
print(`  Consistency rate: ${backupSubscriptions.consistencyRate}%`);

print('\n2. ANALYZING OLD DATABASE (SBC)...');
print('===================================');

const oldUsers = analyzeCollection(oldDb, 'users');
print(`Users in old DB:`);
print(`  Total: ${oldUsers.total}`);
print(`  Consistency rate: ${oldUsers.consistencyRate}%`);

const oldReferrals = analyzeCollection(oldDb, 'referrals');
print(`\nReferrals in old DB:`);
print(`  Total: ${oldReferrals.total}`);
print(`  Consistency rate: ${oldReferrals.consistencyRate}%`);

print('\n3. ANALYZING PRODUCTION DATABASE (sbc_user_dev)...');
print('==================================================');

const prodUsers = analyzeCollection(prodDb, 'users');
print(`Users in production:`);
print(`  Total: ${prodUsers.total}`);
print(`  Consistency rate: ${prodUsers.consistencyRate}%`);

const prodReferrals = analyzeCollection(prodDb, 'referrals');
print(`\nReferrals in production:`);
print(`  Total: ${prodReferrals.total}`);
print(`  Consistency rate: ${prodReferrals.consistencyRate}%`);

const prodSubscriptions = analyzeCollection(prodDb, 'subscriptions');
print(`\nSubscriptions in production:`);
print(`  Total: ${prodSubscriptions.total}`);
print(`  Consistency rate: ${prodSubscriptions.consistencyRate}%`);

print('\n4. DETAILED SAMPLE ANALYSIS...');
print('===============================');

print('\nBackup Users Sample:');
backupUsers.samples.forEach((sample, index) => {
    print(`  User ${index + 1}:`);
    print(`    ObjectId timestamp: ${sample.objectIdDate}`);
    print(`    createdAt field: ${sample.createdAtDate}`);
    print(`    Consistent: ${sample.consistent ? '✅' : '❌'}`);
    if (sample.difference) {
        print(`    Difference: ${sample.difference}ms`);
    }
});

print('\nBackup Referrals Sample:');
backupReferrals.samples.forEach((sample, index) => {
    print(`  Referral ${index + 1}:`);
    print(`    ObjectId timestamp: ${sample.objectIdDate}`);
    print(`    createdAt field: ${sample.createdAtDate}`);
    print(`    Consistent: ${sample.consistent ? '✅' : '❌'}`);
    if (sample.difference) {
        print(`    Difference: ${sample.difference}ms`);
    }
});

print('\nBackup Subscriptions Sample:');
backupSubscriptions.samples.forEach((sample, index) => {
    print(`  Subscription ${index + 1}:`);
    print(`    ObjectId timestamp: ${sample.objectIdDate}`);
    print(`    createdAt field: ${sample.createdAtDate}`);
    print(`    Consistent: ${sample.consistent ? '✅' : '❌'}`);
    if (sample.difference) {
        print(`    Difference: ${sample.difference}ms`);
    }
});

print('\n5. RECOVERY IMPACT ANALYSIS...');
print('===============================');

// Check specifically recovered data
const recoveredSubscriptions = prodDb.subscriptions.find({ 
    'metadata.recoveredFromBackup': true 
}).toArray();

print(`\nRecovered subscriptions analysis:`);
print(`  Total recovered: ${recoveredSubscriptions.length}`);

if (recoveredSubscriptions.length > 0) {
    let recoveredConsistent = 0;
    recoveredSubscriptions.forEach(sub => {
        if (datesAreClose(getObjectIdTimestamp(sub._id), sub.createdAt)) {
            recoveredConsistent++;
        }
    });
    
    print(`  Consistent with ObjectId: ${recoveredConsistent}`);
    print(`  Inconsistent: ${recoveredSubscriptions.length - recoveredConsistent}`);
    print(`  Consistency rate: ${(recoveredConsistent / recoveredSubscriptions.length * 100).toFixed(2)}%`);
}

print('\n=== SUMMARY AND RECOMMENDATIONS ===');
print('====================================');

const overallBackupConsistency = (
    (backupUsers.consistent + backupReferrals.consistent + backupSubscriptions.consistent) /
    (backupUsers.sampled + backupReferrals.sampled + backupSubscriptions.sampled) * 100
).toFixed(2);

const overallProdConsistency = (
    (prodUsers.consistent + prodReferrals.consistent + prodSubscriptions.consistent) /
    (prodUsers.sampled + prodReferrals.sampled + prodSubscriptions.sampled) * 100
).toFixed(2);

print(`Overall backup consistency: ${overallBackupConsistency}%`);
print(`Overall production consistency: ${overallProdConsistency}%`);

print('\nRecommendations:');
if (parseFloat(overallProdConsistency) < 95) {
    print('❌ Production consistency is below 95%');
    print('   → Run fix-createdAt-from-objectid.js to correct inconsistencies');
} else {
    print('✅ Production consistency is acceptable');
}

if (parseFloat(backupUsers.consistencyRate) < 90) {
    print('⚠️  Backup data had createdAt inconsistencies');
    print('   → This explains why some recovered data may have incorrect dates');
}

print('\nNext steps:');
print('1. Run verify-createdAt-consistency.js for detailed verification');
print('2. If issues found, run fix-createdAt-from-objectid.js');
print('3. Monitor application behavior with corrected timestamps');