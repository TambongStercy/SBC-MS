// MongoDB shell script to fix createdAt dates using ObjectId timestamps
// Run with: mongosh --file fix-createdAt-from-objectid.js

const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== FIXING CREATEDAT DATES FROM OBJECTID TIMESTAMPS ===\n');

// Function to extract timestamp from ObjectId
function getObjectIdTimestamp(objectId) {
    return objectId.getTimestamp();
}

// Function to compare dates (allowing small differences due to precision)
function datesAreClose(date1, date2, toleranceMs = 1000) {
    if (!date1 || !date2) return false;
    return Math.abs(date1.getTime() - date2.getTime()) <= toleranceMs;
}

print('1. FIXING RECOVERED USERS...');
let userUpdates = 0;
const userBatchSize = 1000;

// Process users in batches
const totalUsers = prodDb.users.countDocuments({ archived: false });
print(`Total users to check: ${totalUsers}`);

for (let skip = 0; skip < totalUsers; skip += userBatchSize) {
    const users = prodDb.users.find({ archived: false }).skip(skip).limit(userBatchSize).toArray();
    
    const bulkOps = [];
    
    users.forEach(user => {
        const objectIdDate = getObjectIdTimestamp(user._id);
        const createdAtDate = user.createdAt;
        
        if (!datesAreClose(objectIdDate, createdAtDate)) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: user._id },
                    update: { 
                        $set: { 
                            createdAt: objectIdDate,
                            'metadata.createdAtFixedFromObjectId': true
                        } 
                    }
                }
            });
        }
    });
    
    if (bulkOps.length > 0) {
        const result = prodDb.users.bulkWrite(bulkOps);
        userUpdates += result.modifiedCount;
        print(`Updated ${result.modifiedCount} users in batch (${skip + 1} to ${skip + users.length})`);
    }
}

print(`Total users updated: ${userUpdates}`);

print('\n2. FIXING RECOVERED REFERRALS...');
let referralUpdates = 0;
const referralBatchSize = 1000;

// Process referrals in batches
const totalReferrals = prodDb.referrals.countDocuments({ archived: false });
print(`Total referrals to check: ${totalReferrals}`);

for (let skip = 0; skip < totalReferrals; skip += referralBatchSize) {
    const referrals = prodDb.referrals.find({ archived: false }).skip(skip).limit(referralBatchSize).toArray();
    
    const bulkOps = [];
    
    referrals.forEach(referral => {
        const objectIdDate = getObjectIdTimestamp(referral._id);
        const createdAtDate = referral.createdAt;
        
        if (!datesAreClose(objectIdDate, createdAtDate)) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: referral._id },
                    update: { 
                        $set: { 
                            createdAt: objectIdDate,
                            'metadata.createdAtFixedFromObjectId': true
                        } 
                    }
                }
            });
        }
    });
    
    if (bulkOps.length > 0) {
        const result = prodDb.referrals.bulkWrite(bulkOps);
        referralUpdates += result.modifiedCount;
        print(`Updated ${result.modifiedCount} referrals in batch (${skip + 1} to ${skip + referrals.length})`);
    }
}

print(`Total referrals updated: ${referralUpdates}`);

print('\n3. FIXING RECOVERED SUBSCRIPTIONS...');
let subscriptionUpdates = 0;

// Process all recovered subscriptions
const recoveredSubscriptions = prodDb.subscriptions.find({ 
    'metadata.recoveredFromBackup': true 
}).toArray();

print(`Total recovered subscriptions to check: ${recoveredSubscriptions.length}`);

if (recoveredSubscriptions.length > 0) {
    const bulkOps = [];
    
    recoveredSubscriptions.forEach(subscription => {
        const objectIdDate = getObjectIdTimestamp(subscription._id);
        const createdAtDate = subscription.createdAt;
        
        if (!datesAreClose(objectIdDate, createdAtDate)) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: subscription._id },
                    update: { 
                        $set: { 
                            createdAt: objectIdDate,
                            'metadata.createdAtFixedFromObjectId': true
                        } 
                    }
                }
            });
        }
    });
    
    if (bulkOps.length > 0) {
        const result = prodDb.subscriptions.bulkWrite(bulkOps);
        subscriptionUpdates += result.modifiedCount;
        print(`Updated ${result.modifiedCount} subscriptions`);
    }
}

print(`Total subscriptions updated: ${subscriptionUpdates}`);

print('\n=== FIX SUMMARY ===');
print(`Documents updated:`);
print(`- Users: ${userUpdates}`);
print(`- Referrals: ${referralUpdates}`);
print(`- Subscriptions: ${subscriptionUpdates}`);
print(`Total documents fixed: ${userUpdates + referralUpdates + subscriptionUpdates}`);

if (userUpdates + referralUpdates + subscriptionUpdates > 0) {
    print('\n✅ createdAt dates have been synchronized with ObjectId timestamps');
    print('All fixed documents now have metadata.createdAtFixedFromObjectId: true');
} else {
    print('\n✅ All createdAt dates were already consistent with ObjectId timestamps');
}

print('\n=== VERIFICATION ===');
print('Running quick verification...');

// Quick verification
const inconsistentUsers = prodDb.users.find({ archived: false }).toArray().filter(user => 
    !datesAreClose(getObjectIdTimestamp(user._id), user.createdAt)
).length;

const inconsistentReferrals = prodDb.referrals.find({ archived: false }).toArray().filter(referral => 
    !datesAreClose(getObjectIdTimestamp(referral._id), referral.createdAt)
).length;

const inconsistentSubscriptions = prodDb.subscriptions.find({ 
    'metadata.recoveredFromBackup': true 
}).toArray().filter(subscription => 
    !datesAreClose(getObjectIdTimestamp(subscription._id), subscription.createdAt)
).length;

print(`Remaining inconsistencies:`);
print(`- Users: ${inconsistentUsers}`);
print(`- Referrals: ${inconsistentReferrals}`);
print(`- Subscriptions: ${inconsistentSubscriptions}`);

if (inconsistentUsers + inconsistentReferrals + inconsistentSubscriptions === 0) {
    print('\n🎉 ALL CREATEDAT DATES ARE NOW CONSISTENT WITH OBJECTID TIMESTAMPS!');
} else {
    print('\n⚠️  Some inconsistencies remain. Manual review may be needed.');
}