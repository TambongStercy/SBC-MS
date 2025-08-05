// MongoDB shell script to check for referral inconsistencies
// Run with: mongosh --file 6-check-referral-consistency.js

const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== REFERRAL CONSISTENCY CHECK ===\n');

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

print('\nChecking for bidirectional referral inconsistencies...');

// Build referral lookup map for faster bidirectional checking
print('Building referral lookup map...');
const referralMap = new Map();
let processedCount = 0;
const batchSize = 10000;

for (let skip = 0; skip < totalReferrals; skip += batchSize) {
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

    const progress = ((skip + batch.length) / totalReferrals * 100).toFixed(1);
    print(`  Built lookup map: ${processedCount}/${totalReferrals} (${progress}%)`);
}

print('Checking for bidirectional relationships...');
const bidirectionalReferrals = [];
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

        bidirectionalReferrals.push({
            _id: referral._id,
            referrer: referral.referrer,
            referredUser: referral.referredUser,
            createdAt: referral.createdAt,
            reverseReferralId: reverseReferral._id,
            reverseCreatedAt: reverseReferral.createdAt
        });

        checkedPairs.add(pairKey);
    }
});

print(`Found ${bidirectionalReferrals.length} referrals with bidirectional relationships`);

if (bidirectionalReferrals.length > 0) {
    print('\n=== BIDIRECTIONAL REFERRAL ISSUES ===');

    // Group by user pairs to avoid showing duplicates
    const uniquePairs = new Map();

    bidirectionalReferrals.forEach(ref => {
        const userA = ref.referrer.toString();
        const userB = ref.referredUser.toString();
        const pairKey = [userA, userB].sort().join('_');

        if (!uniquePairs.has(pairKey)) {
            uniquePairs.set(pairKey, {
                userA: userA,
                userB: userB,
                referralAtoB: null,
                referralBtoA: null
            });
        }

        const pair = uniquePairs.get(pairKey);
        if (ref.referrer.toString() === pair.userA) {
            pair.referralAtoB = ref;
        } else {
            pair.referralBtoA = ref;
        }
    });

    print(`Unique bidirectional pairs found: ${uniquePairs.size}`);

    let issueCount = 0;
    const problematicPairs = [];

    uniquePairs.forEach((pair, pairKey) => {
        issueCount++;
        problematicPairs.push(pair);

        if (issueCount <= 10) { // Show first 10 issues
            print(`\nIssue ${issueCount}:`);
            print(`  User A: ${pair.userA}`);
            print(`  User B: ${pair.userB}`);

            if (pair.referralAtoB) {
                print(`  A → B referral: ${pair.referralAtoB._id} (${pair.referralAtoB.createdAt})`);
            }
            if (pair.referralBtoA) {
                print(`  B → A referral: ${pair.referralBtoA._id} (${pair.referralBtoA.createdAt})`);
            }

            // Determine which referral is older (should be kept)
            if (pair.referralAtoB && pair.referralBtoA) {
                const dateA = new Date(pair.referralAtoB.createdAt);
                const dateB = new Date(pair.referralBtoA.createdAt);

                if (dateA < dateB) {
                    print(`  → Keep A → B (older), remove B → A`);
                } else if (dateB < dateA) {
                    print(`  → Keep B → A (older), remove A → B`);
                } else {
                    print(`  → Same timestamp, manual review needed`);
                }
            }
        }
    });

    if (issueCount > 10) {
        print(`\n... and ${issueCount - 10} more bidirectional pairs`);
    }

    // Save problematic pairs for potential cleanup
    print(`\nSaving bidirectional referral issues for review...`);
    prodDb.referral_consistency_issues.drop();

    const issueDocuments = Array.from(uniquePairs.values()).map(pair => ({
        userA: pair.userA,
        userB: pair.userB,
        referralAtoB: pair.referralAtoB,
        referralBtoA: pair.referralBtoA,
        recommendedAction: (() => {
            if (!pair.referralAtoB || !pair.referralBtoA) return 'incomplete_data';

            const dateA = new Date(pair.referralAtoB.createdAt);
            const dateB = new Date(pair.referralBtoA.createdAt);

            if (dateA < dateB) {
                return { keep: pair.referralAtoB._id, remove: pair.referralBtoA._id, reason: 'A_to_B_older' };
            } else if (dateB < dateA) {
                return { keep: pair.referralBtoA._id, remove: pair.referralAtoB._id, reason: 'B_to_A_older' };
            } else {
                return { reason: 'same_timestamp_manual_review' };
            }
        })(),
        detectedAt: new Date()
    }));

    prodDb.referral_consistency_issues.insertMany(issueDocuments);
    print(`Saved ${issueDocuments.length} consistency issues to 'referral_consistency_issues' collection`);

} else {
    print('\n✅ No bidirectional referral inconsistencies found!');
}

// Additional checks
print('\n=== ADDITIONAL CONSISTENCY CHECKS ===');

// Check for self-referrals using the already loaded data
print('\nChecking for self-referrals...');
const selfReferrals = [];
let selfCheckCount = 0;

referralMap.forEach((referral) => {
    selfCheckCount++;

    if (selfCheckCount % 50000 === 0) {
        const progress = (selfCheckCount / referralMap.size * 100).toFixed(1);
        print(`  Self-referral check: ${selfCheckCount}/${referralMap.size} (${progress}%)`);
    }

    if (referral.referrer.toString() === referral.referredUser.toString()) {
        selfReferrals.push(referral);
    }
});

print(`Self-referrals found: ${selfReferrals.length}`);

if (selfReferrals.length > 0) {
    print('Self-referrals detected - users referring themselves');
    print('First 5 self-referrals:');
    selfReferrals.slice(0, 5).forEach((ref, index) => {
        print(`  ${index + 1}. User ${ref.referrer} referring themselves (ID: ${ref._id})`);
    });
}

// Check for duplicate referrals using batch processing
print('\nChecking for duplicate referrals...');
const duplicateMap = new Map();
let dupCheckCount = 0;

for (let skip = 0; skip < totalReferrals; skip += batchSize) {
    const batch = prodDb.referrals.find({}, { _id: 1, referrer: 1, referredUser: 1, createdAt: 1 })
        .skip(skip)
        .limit(batchSize)
        .toArray();

    for (const ref of batch) {
        const key = `${ref.referrer}_${ref.referredUser}`;

        if (!duplicateMap.has(key)) {
            duplicateMap.set(key, []);
        }
        duplicateMap.get(key).push({
            _id: ref._id,
            createdAt: ref.createdAt
        });

        dupCheckCount++;
    }

    const progress = ((skip + batch.length) / totalReferrals * 100).toFixed(1);
    print(`  Duplicate check: ${dupCheckCount}/${totalReferrals} (${progress}%)`);
}

const duplicateReferrals = [];
duplicateMap.forEach((refs, key) => {
    if (refs.length > 1) {
        const [referrer, referredUser] = key.split('_');
        duplicateReferrals.push({
            _id: { referrer, referredUser },
            count: refs.length,
            referralIds: refs.map(r => r._id),
            createdDates: refs.map(r => r.createdAt)
        });
    }
});

print(`Duplicate referral pairs found: ${duplicateReferrals.length}`);

if (duplicateReferrals.length > 0) {
    print('First 5 duplicate pairs:');
    duplicateReferrals.slice(0, 5).forEach((dup, index) => {
        print(`  ${index + 1}. ${dup._id.referrer} → ${dup._id.referredUser} (${dup.count} times)`);
        print(`     IDs: ${dup.referralIds.join(', ')}`);
    });
}

// Check for referrals with non-existent users
print('\nChecking for referrals with non-existent users...');
print('Building user ID cache...');
const userIds = new Set();
const userCount = prodDb.users.countDocuments();
let userProcessed = 0;

for (let skip = 0; skip < userCount; skip += batchSize) {
    const userBatch = prodDb.users.find({}, { _id: 1 })
        .skip(skip)
        .limit(batchSize)
        .toArray();

    for (const user of userBatch) {
        userIds.add(user._id.toString());
        userProcessed++;
    }

    const progress = ((skip + userBatch.length) / userCount * 100).toFixed(1);
    print(`  User cache: ${userProcessed}/${userCount} (${progress}%)`);
}

print('Checking for orphaned referrals...');
const orphanedReferrals = [];
let orphanCheckCount = 0;

referralMap.forEach((referral) => {
    orphanCheckCount++;

    if (orphanCheckCount % 50000 === 0) {
        const progress = (orphanCheckCount / referralMap.size * 100).toFixed(1);
        print(`  Orphan check: ${orphanCheckCount}/${referralMap.size} (${progress}%)`);
    }

    const missingReferrer = !userIds.has(referral.referrer.toString());
    const missingReferred = !userIds.has(referral.referredUser.toString());

    if (missingReferrer || missingReferred) {
        orphanedReferrals.push({
            _id: referral._id,
            referrer: referral.referrer,
            referredUser: referral.referredUser,
            missingReferrer,
            missingReferred
        });
    }
});

print(`Orphaned referrals found: ${orphanedReferrals.length}`);

if (orphanedReferrals.length > 0) {
    print('First 5 orphaned referrals:');
    orphanedReferrals.slice(0, 5).forEach((ref, index) => {
        const issues = [];
        if (ref.missingReferrer) issues.push('missing referrer');
        if (ref.missingReferred) issues.push('missing referred user');

        print(`  ${index + 1}. ID: ${ref._id} - ${issues.join(', ')}`);
        print(`     Referrer: ${ref.referrer}, Referred: ${ref.referredUser}`);
    });
}

print('\n=== CONSISTENCY CHECK SUMMARY ===');
print(`Total referrals checked: ${totalReferrals}`);
print(`Bidirectional inconsistencies: ${bidirectionalReferrals.length / 2} pairs`);
print(`Self-referrals: ${selfReferrals.length}`);
print(`Duplicate referral pairs: ${duplicateReferrals.length}`);
print(`Orphaned referrals: ${orphanedReferrals.length}`);

const totalIssues = (bidirectionalReferrals.length / 2) + selfReferrals.length + duplicateReferrals.length + orphanedReferrals.length;
print(`Total consistency issues: ${totalIssues}`);

if (totalIssues === 0) {
    print('\n✅ All referral consistency checks passed!');
} else {
    print('\n⚠️  Consistency issues detected. Review the issues above and consider running cleanup scripts.');
    print('Issues have been saved to collections for further analysis:');
    print('- referral_consistency_issues (bidirectional referrals)');
}