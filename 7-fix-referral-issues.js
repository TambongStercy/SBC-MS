// MongoDB shell script to fix referral issues
// Run with: mongosh --file 7-fix-referral-issues.js

const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== REFERRAL ISSUE CLEANUP ===\n');

// Create indexes for optimal performance
print('Ensuring indexes for optimal performance...');
try {
    prodDb.referrals.createIndex({ referrer: 1, referredUser: 1 });
    prodDb.referrals.createIndex({ referredUser: 1, referrer: 1 });
    print('Indexes created/verified');
} catch (e) {
    print('Indexes already exist or error creating them');
}

const totalReferrals = prodDb.referrals.countDocuments();
print(`Total referrals in database: ${totalReferrals}`);

// STEP 1: Find and delete self-referrals
print('\n=== STEP 1: REMOVING SELF-REFERRALS ===');

print('Finding self-referrals...');
const selfReferrals = prodDb.referrals.find({
    $expr: { $eq: ["$referrer", "$referredUser"] }
}).toArray();

print(`Self-referrals found: ${selfReferrals.length}`);

if (selfReferrals.length > 0) {
    print('\nSelf-referrals to be deleted:');
    selfReferrals.forEach((ref, index) => {
        print(`  ${index + 1}. User ${ref.referrer} referring themselves (ID: ${ref._id}, Created: ${ref.createdAt})`);
    });
    
    print(`\nDeleting ${selfReferrals.length} self-referrals...`);
    const deleteResult = prodDb.referrals.deleteMany({
        $expr: { $eq: ["$referrer", "$referredUser"] }
    });
    
    print(`✅ Successfully deleted ${deleteResult.deletedCount} self-referrals`);
} else {
    print('✅ No self-referrals found');
}

// STEP 2: Find bidirectional referrals for manual review
print('\n=== STEP 2: IDENTIFYING BIDIRECTIONAL REFERRALS ===');

print('Building referral lookup map...');
const referralMap = new Map();
let processedCount = 0;
const batchSize = 10000;
const currentTotal = prodDb.referrals.countDocuments(); // Recount after deletions

for (let skip = 0; skip < currentTotal; skip += batchSize) {
    const batch = prodDb.referrals.find({}, { referrer: 1, referredUser: 1, createdAt: 1 })
        .skip(skip)
        .limit(batchSize)
        .toArray();
    
    for (const ref of batch) {
        const key = `${ref.referrer}_${ref.referredUser}`;
        referralMap.set(key, {
            _id: ref._id,
            referrer: ref.referrer,
            referredUser: ref.referredUser,
            createdAt: ref.createdAt
        });
        processedCount++;
    }
    
    const progress = ((skip + batch.length) / currentTotal * 100).toFixed(1);
    print(`  Built lookup map: ${processedCount}/${currentTotal} (${progress}%)`);
}

print('Checking for bidirectional relationships...');
const bidirectionalPairs = [];
const checkedPairs = new Set();
let checkCount = 0;

referralMap.forEach((referral, key) => {
    checkCount++;
    
    if (checkCount % 50000 === 0) {
        const progress = (checkCount / referralMap.size * 100).toFixed(1);
        print(`  Checked: ${checkCount}/${referralMap.size} (${progress}%)`);
    }
    
    const reverseKey = `${referral.referredUser}_${referral.referrer}`;
    const pairKey = [referral.referrer.toString(), referral.referredUser.toString()].sort().join('_');
    
    // Skip if we already processed this pair
    if (checkedPairs.has(pairKey)) {
        return;
    }
    
    if (referralMap.has(reverseKey)) {
        const reverseReferral = referralMap.get(reverseKey);
        
        bidirectionalPairs.push({
            userA: referral.referrer,
            userB: referral.referredUser,
            referralAtoB: {
                _id: referral._id,
                createdAt: referral.createdAt
            },
            referralBtoA: {
                _id: reverseReferral._id,
                createdAt: reverseReferral.createdAt
            }
        });
        
        checkedPairs.add(pairKey);
    }
});

print(`\nBidirectional referral pairs found: ${bidirectionalPairs.length}`);

if (bidirectionalPairs.length > 0) {
    print('\n=== BIDIRECTIONAL REFERRALS FOR MANUAL REVIEW ===');
    print('Each pair shows both referrals that need manual decision:\n');
    
    bidirectionalPairs.forEach((pair, index) => {
        const dateA = new Date(pair.referralAtoB.createdAt);
        const dateB = new Date(pair.referralBtoA.createdAt);
        
        print(`Pair ${index + 1}:`);
        print(`  User A: ${pair.userA}`);
        print(`  User B: ${pair.userB}`);
        print(`  A → B referral: ${pair.referralAtoB._id} (Created: ${pair.referralAtoB.createdAt})`);
        print(`  B → A referral: ${pair.referralBtoA._id} (Created: ${pair.referralBtoA.createdAt})`);
        
        // Provide recommendation based on timestamps
        if (dateA < dateB) {
            const timeDiff = Math.abs(dateB - dateA) / (1000 * 60 * 60 * 24); // days
            print(`  💡 RECOMMENDATION: Keep A → B (${timeDiff.toFixed(1)} days older), delete B → A`);
            print(`  🗑️  DELETE COMMAND: db.referrals.deleteOne({_id: ObjectId("${pair.referralBtoA._id}")})`);
        } else if (dateB < dateA) {
            const timeDiff = Math.abs(dateA - dateB) / (1000 * 60 * 60 * 24); // days
            print(`  💡 RECOMMENDATION: Keep B → A (${timeDiff.toFixed(1)} days older), delete A → B`);
            print(`  🗑️  DELETE COMMAND: db.referrals.deleteOne({_id: ObjectId("${pair.referralAtoB._id}")})`);
        } else {
            print(`  ⚠️  SAME TIMESTAMP: Manual review required - check user registration dates or other criteria`);
            print(`  🗑️  DELETE A → B: db.referrals.deleteOne({_id: ObjectId("${pair.referralAtoB._id}")})`);
            print(`  🗑️  DELETE B → A: db.referrals.deleteOne({_id: ObjectId("${pair.referralBtoA._id}")})`);
        }
        print(''); // Empty line for readability
    });
    
    // Save detailed report for reference
    print('Saving bidirectional referrals report...');
    prodDb.bidirectional_referrals_report.drop();
    
    const reportDocuments = bidirectionalPairs.map((pair, index) => {
        const dateA = new Date(pair.referralAtoB.createdAt);
        const dateB = new Date(pair.referralBtoA.createdAt);
        
        let recommendation;
        let deleteCommand;
        
        if (dateA < dateB) {
            recommendation = 'Keep A → B (older), delete B → A';
            deleteCommand = `db.referrals.deleteOne({_id: ObjectId("${pair.referralBtoA._id}")})`;
        } else if (dateB < dateA) {
            recommendation = 'Keep B → A (older), delete A → B';
            deleteCommand = `db.referrals.deleteOne({_id: ObjectId("${pair.referralAtoB._id}")})`;
        } else {
            recommendation = 'Same timestamp - manual review required';
            deleteCommand = 'Manual decision needed';
        }
        
        return {
            pairNumber: index + 1,
            userA: pair.userA,
            userB: pair.userB,
            referralAtoB: pair.referralAtoB,
            referralBtoA: pair.referralBtoA,
            recommendation: recommendation,
            deleteCommand: deleteCommand,
            timeDifferenceHours: Math.abs(dateA - dateB) / (1000 * 60 * 60),
            reportGeneratedAt: new Date()
        };
    });
    
    prodDb.bidirectional_referrals_report.insertMany(reportDocuments);
    print(`✅ Saved ${reportDocuments.length} bidirectional pairs to 'bidirectional_referrals_report' collection`);
    
    print('\n=== BULK DELETE COMMANDS ===');
    print('Copy and paste these commands to fix the recommended deletions:\n');
    
    reportDocuments.forEach(doc => {
        if (doc.deleteCommand !== 'Manual decision needed') {
            print(`// Pair ${doc.pairNumber}: ${doc.userA} ↔ ${doc.userB}`);
            print(doc.deleteCommand);
        }
    });
    
} else {
    print('✅ No bidirectional referrals found');
}

// Final summary
const finalReferralCount = prodDb.referrals.countDocuments();
print('\n=== CLEANUP SUMMARY ===');
print(`Original referrals: ${totalReferrals}`);
print(`Self-referrals deleted: ${selfReferrals.length}`);
print(`Bidirectional pairs found: ${bidirectionalPairs.length}`);
print(`Current referrals: ${finalReferralCount}`);
print(`Referrals needing manual review: ${bidirectionalPairs.length * 2}`);

if (bidirectionalPairs.length > 0) {
    print('\n=== NEXT STEPS ===');
    print('1. Review the bidirectional referrals listed above');
    print('2. Use the provided DELETE COMMANDS to remove unwanted referrals');
    print('3. Check the "bidirectional_referrals_report" collection for detailed analysis');
    print('4. Run the consistency check again to verify all issues are resolved');
} else {
    print('\n✅ All referral issues have been resolved!');
}