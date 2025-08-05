// MongoDB shell script to find missing referrals
// Run with: mongosh --file find-missing-referrals.js

// Connect to old DB
const oldDb = connect('mongodb://127.0.0.1:27017/SBC');
const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('Starting missing referrals analysis...');

// Get sample of old referrals to check
const sampleSize = 5000;
print(`Checking sample of ${sampleSize} referrals from old DB...`);

const oldReferrals = oldDb.referrals.find({}).limit(sampleSize).toArray();
print(`Found ${oldReferrals.length} referrals in sample`);

let missingCount = 0;
let excludedCount = 0;
let validCount = 0;
const missingReferrals = [];

for (let i = 0; i < oldReferrals.length; i++) {
    const oldRef = oldReferrals[i];
    
    // First check if both users exist in production DB
    const referrerExists = prodDb.users.findOne({_id: oldRef.referrer});
    const referredUserExists = prodDb.users.findOne({_id: oldRef.referredUser});
    
    if (!referrerExists || !referredUserExists) {
        excludedCount++;
        if (excludedCount <= 3) {
            print(`Excluded referral ${excludedCount} (users don't exist):`);
            printjson({
                referrer: oldRef.referrer,
                referredUser: oldRef.referredUser,
                referrerExists: !!referrerExists,
                referredUserExists: !!referredUserExists,
                createdAt: oldRef.createdAt
            });
        }
        continue;
    }
    
    validCount++;
    
    // Check if referral exists in production
    const exists = prodDb.referrals.findOne({
        referrer: oldRef.referrer,
        referredUser: oldRef.referredUser
    });
    
    if (!exists) {
        missingCount++;
        missingReferrals.push({
            referrer: oldRef.referrer,
            referredUser: oldRef.referredUser,
            referralLevel: oldRef.referralLevel,
            createdAt: oldRef.createdAt
        });
        
        if (missingCount <= 5) {
            print(`Missing referral ${missingCount} (valid users):`);
            printjson({
                referrer: oldRef.referrer,
                referredUser: oldRef.referredUser,
                referralLevel: oldRef.referralLevel,
                createdAt: oldRef.createdAt
            });
        }
    }
    
    if ((i + 1) % 100 === 0) {
        print(`Processed ${i + 1}/${oldReferrals.length} referrals...`);
    }
}

print(`\nSample Analysis Results:`);
print(`Sample size: ${oldReferrals.length}`);
print(`Excluded (users don't exist): ${excludedCount}`);
print(`Valid referrals checked: ${validCount}`);
print(`Missing valid referrals: ${missingCount}`);
print(`Missing percentage of valid: ${validCount > 0 ? (missingCount / validCount * 100).toFixed(2) : 0}%`);

if (missingCount > 0 && validCount > 0) {
    const estimatedTotalMissing = Math.round((missingCount / validCount) * (299766 * (validCount / oldReferrals.length)));
    print(`Estimated total missing referrals (excluding invalid users): ${estimatedTotalMissing}`);
}