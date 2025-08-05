// MongoDB shell script to verify createdAt consistency with ObjectId timestamps
// Run with: mongosh --file verify-createdAt-consistency.js

const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== VERIFYING CREATEDAT CONSISTENCY WITH OBJECTID TIMESTAMPS ===\n');

// Function to extract timestamp from ObjectId
function getObjectIdTimestamp(objectId) {
    return objectId.getTimestamp();
}

// Function to compare dates (allowing small differences due to precision)
function datesAreClose(date1, date2, toleranceMs = 1000) {
    if (!date1 || !date2) return false;
    return Math.abs(date1.getTime() - date2.getTime()) <= toleranceMs;
}

print('1. CHECKING RECOVERED USERS...');
const recoveredUsers = prodDb.users.find({ archived: false }).limit(1000).toArray();
let userInconsistencies = 0;
let userSamples = [];

recoveredUsers.forEach((user, index) => {
    if (index < 5) { // Sample first 5 for detailed output
        const objectIdDate = getObjectIdTimestamp(user._id);
        const createdAtDate = user.createdAt;
        
        userSamples.push({
            _id: user._id,
            objectIdDate: objectIdDate,
            createdAtDate: createdAtDate,
            consistent: datesAreClose(objectIdDate, createdAtDate)
        });
    }
    
    if (!datesAreClose(getObjectIdTimestamp(user._id), user.createdAt)) {
        userInconsistencies++;
    }
});

print(`Users checked: ${recoveredUsers.length}`);
print(`Users with inconsistent dates: ${userInconsistencies}`);
print(`Consistency rate: ${((recoveredUsers.length - userInconsistencies) / recoveredUsers.length * 100).toFixed(2)}%`);

print('\nSample user date comparisons:');
userSamples.forEach((sample, index) => {
    print(`User ${index + 1}:`);
    print(`  ObjectId timestamp: ${sample.objectIdDate}`);
    print(`  createdAt field: ${sample.createdAtDate}`);
    print(`  Consistent: ${sample.consistent ? '✅' : '❌'}`);
});

print('\n2. CHECKING RECOVERED REFERRALS...');
const recoveredReferrals = prodDb.referrals.find({ archived: false }).limit(1000).toArray();
let referralInconsistencies = 0;
let referralSamples = [];

recoveredReferrals.forEach((referral, index) => {
    if (index < 5) { // Sample first 5 for detailed output
        const objectIdDate = getObjectIdTimestamp(referral._id);
        const createdAtDate = referral.createdAt;
        
        referralSamples.push({
            _id: referral._id,
            objectIdDate: objectIdDate,
            createdAtDate: createdAtDate,
            consistent: datesAreClose(objectIdDate, createdAtDate)
        });
    }
    
    if (!datesAreClose(getObjectIdTimestamp(referral._id), referral.createdAt)) {
        referralInconsistencies++;
    }
});

print(`Referrals checked: ${recoveredReferrals.length}`);
print(`Referrals with inconsistent dates: ${referralInconsistencies}`);
print(`Consistency rate: ${((recoveredReferrals.length - referralInconsistencies) / recoveredReferrals.length * 100).toFixed(2)}%`);

print('\nSample referral date comparisons:');
referralSamples.forEach((sample, index) => {
    print(`Referral ${index + 1}:`);
    print(`  ObjectId timestamp: ${sample.objectIdDate}`);
    print(`  createdAt field: ${sample.createdAtDate}`);
    print(`  Consistent: ${sample.consistent ? '✅' : '❌'}`);
});

print('\n3. CHECKING RECOVERED SUBSCRIPTIONS...');
const recoveredSubscriptions = prodDb.subscriptions.find({ 
    'metadata.recoveredFromBackup': true 
}).toArray();
let subscriptionInconsistencies = 0;
let subscriptionSamples = [];

recoveredSubscriptions.forEach((subscription, index) => {
    if (index < 5) { // Sample first 5 for detailed output
        const objectIdDate = getObjectIdTimestamp(subscription._id);
        const createdAtDate = subscription.createdAt;
        
        subscriptionSamples.push({
            _id: subscription._id,
            objectIdDate: objectIdDate,
            createdAtDate: createdAtDate,
            consistent: datesAreClose(objectIdDate, createdAtDate),
            subscriptionType: subscription.subscriptionType
        });
    }
    
    if (!datesAreClose(getObjectIdTimestamp(subscription._id), subscription.createdAt)) {
        subscriptionInconsistencies++;
    }
});

print(`Subscriptions checked: ${recoveredSubscriptions.length}`);
print(`Subscriptions with inconsistent dates: ${subscriptionInconsistencies}`);
if (recoveredSubscriptions.length > 0) {
    print(`Consistency rate: ${((recoveredSubscriptions.length - subscriptionInconsistencies) / recoveredSubscriptions.length * 100).toFixed(2)}%`);
}

print('\nSample subscription date comparisons:');
subscriptionSamples.forEach((sample, index) => {
    print(`Subscription ${index + 1} (${sample.subscriptionType}):`);
    print(`  ObjectId timestamp: ${sample.objectIdDate}`);
    print(`  createdAt field: ${sample.createdAtDate}`);
    print(`  Consistent: ${sample.consistent ? '✅' : '❌'}`);
});

print('\n=== SUMMARY ===');
print(`Total inconsistencies found:`);
print(`- Users: ${userInconsistencies}/${recoveredUsers.length}`);
print(`- Referrals: ${referralInconsistencies}/${recoveredReferrals.length}`);
print(`- Subscriptions: ${subscriptionInconsistencies}/${recoveredSubscriptions.length}`);

const totalChecked = recoveredUsers.length + recoveredReferrals.length + recoveredSubscriptions.length;
const totalInconsistencies = userInconsistencies + referralInconsistencies + subscriptionInconsistencies;

print(`\nOverall consistency: ${((totalChecked - totalInconsistencies) / totalChecked * 100).toFixed(2)}%`);

if (totalInconsistencies > 0) {
    print('\n⚠️  RECOMMENDATIONS:');
    print('1. For documents where createdAt differs from ObjectId timestamp,');
    print('   consider updating createdAt to match ObjectId timestamp for accuracy');
    print('2. Review the subscription recovery logic to use ObjectId timestamps');
    print('3. Create a fix script if significant inconsistencies are found');
}