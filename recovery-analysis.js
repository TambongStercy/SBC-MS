// MongoDB shell script to analyze recovery opportunities from SBCv1 backup
// Run with: mongosh --file recovery-analysis.js

// Connect to databases
const backupDb = connect('mongodb://127.0.0.1:27017/SBCv1');  // Pre-deletion backup
const oldDb = connect('mongodb://127.0.0.1:27017/SBC');       // Post-deletion, pre-migration
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev'); // Production

print('=== RECOVERY ANALYSIS FROM SBCv1 BACKUP ===\n');

// ===== USER RECOVERY ANALYSIS =====
print('1. USER RECOVERY ANALYSIS');
print('================================');

const sampleSize = 1000;
print(`Analyzing sample of ${sampleSize} users from backup...`);

const backupUsers = backupDb.users.find({}).limit(sampleSize).toArray();
let recoverableUsers = 0;
let conflictUsers = 0;
let alreadyExistUsers = 0;
const usersToRecover = [];

for (let i = 0; i < backupUsers.length; i++) {
    const backupUser = backupUsers[i];
    
    // Check if user exists in production (by ID)
    const existsInProd = prodDb.users.findOne({_id: backupUser._id});
    
    if (existsInProd) {
        alreadyExistUsers++;
        continue;
    }
    
    // Check for email conflicts in production
    const emailConflict = backupUser.email ? 
        prodDb.users.findOne({email: backupUser.email}) : null;
    
    if (emailConflict) {
        conflictUsers++;
        if (conflictUsers <= 3) {
            print(`Email conflict ${conflictUsers}: ${backupUser.email} already exists with different ID`);
        }
        continue;
    }
    
    // This user can be safely recovered
    recoverableUsers++;
    usersToRecover.push({
        _id: backupUser._id,
        email: backupUser.email || 'N/A',
        createdAt: backupUser.createdAt
    });
    
    if (recoverableUsers <= 5) {
        print(`Recoverable user ${recoverableUsers}:`);
        printjson({
            _id: backupUser._id,
            email: backupUser.email || 'N/A',
            createdAt: backupUser.createdAt
        });
    }
}

print(`\nUser Recovery Summary:`);
print(`Sample analyzed: ${backupUsers.length}`);
print(`Already exist in production: ${alreadyExistUsers}`);
print(`Email conflicts: ${conflictUsers}`);
print(`Safely recoverable: ${recoverableUsers}`);
print(`Recovery rate: ${(recoverableUsers / backupUsers.length * 100).toFixed(2)}%`);

const estimatedRecoverableUsers = Math.round((recoverableUsers / sampleSize) * 110643);
print(`Estimated total recoverable users: ${estimatedRecoverableUsers}`);

// ===== REFERRAL RECOVERY ANALYSIS =====
print('\n2. REFERRAL RECOVERY ANALYSIS');
print('================================');

print(`Analyzing sample of ${sampleSize} referrals from backup...`);

const backupReferrals = backupDb.referrals.find({}).limit(sampleSize).toArray();
let recoverableReferrals = 0;
let missingUserReferrals = 0;
let duplicateReferrals = 0;
const referralsToRecover = [];

for (let i = 0; i < backupReferrals.length; i++) {
    const backupRef = backupReferrals[i];
    
    // Check if both users exist in production
    const referrerExists = prodDb.users.findOne({_id: backupRef.referrer});
    const referredExists = prodDb.users.findOne({_id: backupRef.referredUser});
    
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
    recoverableReferrals++;
    referralsToRecover.push({
        referrer: backupRef.referrer,
        referredUser: backupRef.referredUser,
        referralLevel: backupRef.referralLevel,
        createdAt: backupRef.createdAt
    });
    
    if (recoverableReferrals <= 5) {
        print(`Recoverable referral ${recoverableReferrals}:`);
        printjson({
            referrer: backupRef.referrer,
            referredUser: backupRef.referredUser,
            referralLevel: backupRef.referralLevel,
            createdAt: backupRef.createdAt
        });
    }
}

print(`\nReferral Recovery Summary:`);
print(`Sample analyzed: ${backupReferrals.length}`);
print(`Missing users (can't recover): ${missingUserReferrals}`);
print(`Already exist in production: ${duplicateReferrals}`);
print(`Safely recoverable: ${recoverableReferrals}`);
print(`Recovery rate: ${(recoverableReferrals / backupReferrals.length * 100).toFixed(2)}%`);

const estimatedRecoverableReferrals = Math.round((recoverableReferrals / sampleSize) * 311037);
print(`Estimated total recoverable referrals: ${estimatedRecoverableReferrals}`);

// ===== SUBSCRIPTION RECOVERY ANALYSIS =====
print('\n3. SUBSCRIPTION RECOVERY ANALYSIS');
print('================================');

print(`Analyzing sample of ${sampleSize} subscriptions from backup...`);

const backupSubs = backupDb.subscribes.find({}).limit(sampleSize).toArray();
let recoverableSubs = 0;
let missingUserSubs = 0;
let duplicateSubs = 0;
const subsToRecover = [];

for (let i = 0; i < backupSubs.length; i++) {
    const backupSub = backupSubs[i];
    
    // Check if user exists in production
    const userExists = prodDb.users.findOne({_id: backupSub.user});
    
    if (!userExists) {
        missingUserSubs++;
        continue;
    }
    
    // Check if user already has a subscription in production
    const existingSubInProd = prodDb.subscriptions.findOne({user: backupSub.user});
    
    if (existingSubInProd) {
        duplicateSubs++;
        continue;
    }
    
    // This subscription can be safely recovered
    recoverableSubs++;
    subsToRecover.push({
        user: backupSub.user,
        plan: backupSub.plan,
        date: backupSub.date
    });
    
    if (recoverableSubs <= 5) {
        print(`Recoverable subscription ${recoverableSubs}:`);
        printjson({
            user: backupSub.user,
            plan: backupSub.plan,
            date: backupSub.date
        });
    }
}

print(`\nSubscription Recovery Summary:`);
print(`Sample analyzed: ${backupSubs.length}`);
print(`Missing users (can't recover): ${missingUserSubs}`);
print(`User already has subscription: ${duplicateSubs}`);
print(`Safely recoverable: ${recoverableSubs}`);
print(`Recovery rate: ${(recoverableSubs / backupSubs.length * 100).toFixed(2)}%`);

const estimatedRecoverableSubs = Math.round((recoverableSubs / sampleSize) * 28116);
print(`Estimated total recoverable subscriptions: ${estimatedRecoverableSubs}`);

// ===== OVERALL RECOVERY SUMMARY =====
print('\n4. OVERALL RECOVERY SUMMARY');
print('================================');
print(`Estimated recoverable data from SBCv1 backup:`);
print(`- Users: ${estimatedRecoverableUsers} out of 110,643`);
print(`- Referrals: ${estimatedRecoverableReferrals} out of 311,037`);
print(`- Subscriptions: ${estimatedRecoverableSubs} out of 28,116`);
print(`\nThis represents the data lost due to the TTL deletion bug that can be safely restored.`);