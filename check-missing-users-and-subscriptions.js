// MongoDB shell script to find missing users and their subscriptions
// Run with: mongosh --file check-missing-users-and-subscriptions.js

// Connect to old DB
const oldDb = connect('mongodb://127.0.0.1:27017/SBC');
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('Starting missing users and subscriptions analysis...');

// Get sample of old users to check
const sampleSize = 2000;
print(`Checking sample of ${sampleSize} users from old DB...`);

const oldUsers = oldDb.users.find({}).limit(sampleSize).toArray();
print(`Found ${oldUsers.length} users in sample`);

let missingUsersCount = 0;
let existingUsersCount = 0;
const missingUsers = [];

print('\nChecking user migration...');
for (let i = 0; i < oldUsers.length; i++) {
    const oldUser = oldUsers[i];
    
    // Check if user exists in production DB
    const userExists = prodDb.users.findOne({_id: oldUser._id});
    
    if (!userExists) {
        missingUsersCount++;
        missingUsers.push({
            _id: oldUser._id,
            email: oldUser.email,
            username: oldUser.username,
            createdAt: oldUser.createdAt
        });
        
        if (missingUsersCount <= 5) {
            print(`Missing user ${missingUsersCount}:`);
            printjson({
                _id: oldUser._id,
                email: oldUser.email || 'N/A',
                username: oldUser.username || 'N/A',
                createdAt: oldUser.createdAt
            });
        }
    } else {
        existingUsersCount++;
    }
    
    if ((i + 1) % 500 === 0) {
        print(`Processed ${i + 1}/${oldUsers.length} users...`);
    }
}

print(`\nUser Migration Analysis:`);
print(`Sample size: ${oldUsers.length}`);
print(`Missing users: ${missingUsersCount}`);
print(`Existing users: ${existingUsersCount}`);
print(`Missing percentage: ${(missingUsersCount / oldUsers.length * 100).toFixed(2)}%`);

// Now check subscriptions for missing users
if (missingUsersCount > 0) {
    print(`\nChecking subscriptions for missing users...`);
    
    let missingUserSubscriptions = 0;
    let totalSubscriptionsChecked = 0;
    
    // Check first 10 missing users for their subscriptions
    const usersToCheck = missingUsers.slice(0, Math.min(10, missingUsers.length));
    
    for (let i = 0; i < usersToCheck.length; i++) {
        const userId = usersToCheck[i]._id;
        
        // Check if user had subscriptions in old DB
        const oldSubscriptions = oldDb.subscribes.find({user: userId}).toArray();
        totalSubscriptionsChecked += oldSubscriptions.length;
        
        if (oldSubscriptions.length > 0) {
            print(`Missing user ${userId} had ${oldSubscriptions.length} subscription(s):`);
            oldSubscriptions.forEach((sub, index) => {
                if (index < 2) { // Show first 2 subscriptions
                    printjson({
                        subscriptionId: sub._id,
                        userId: sub.user,
                        plan: sub.plan,
                        date: sub.date,
                        createdAt: sub.createdAt || 'N/A'
                    });
                }
            });
            missingUserSubscriptions += oldSubscriptions.length;
        }
    }
    
    print(`\nSubscription Analysis for Missing Users:`);
    print(`Users checked: ${usersToCheck.length}`);
    print(`Total subscriptions found: ${totalSubscriptionsChecked}`);
    print(`Missing subscriptions: ${missingUserSubscriptions}`);
}

// Check overall subscription counts
print(`\nOverall Subscription Counts:`);
const oldSubscriptionsCount = oldDb.subscribes.countDocuments();
const prodSubscriptionsCount = prodDb.subscriptions.countDocuments();

print(`Old DB subscriptions: ${oldSubscriptionsCount}`);
print(`Production DB subscriptions: ${prodSubscriptionsCount}`);
print(`Difference: ${oldSubscriptionsCount - prodSubscriptionsCount}`);

if (missingUsersCount > 0) {
    const estimatedTotalMissingUsers = Math.round((missingUsersCount / sampleSize) * 106918);
    print(`\nEstimated total missing users: ${estimatedTotalMissingUsers}`);
}