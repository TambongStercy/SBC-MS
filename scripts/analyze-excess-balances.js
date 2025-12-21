/**
 * Analyze Excess User Balances Script
 *
 * CONTEXT:
 * - Total user balances in March maintenance: ~3.7M XAF
 * - Expected total balances: ~1.5M XAF
 * - Excess: ~2.2M XAF
 *
 * This script:
 * 1. Finds all users with non-zero balances
 * 2. Calculates their expected earnings based on subscribed referrals
 * 3. Identifies users with balances exceeding their legitimate earnings
 * 4. Can fix balances by resetting to expected values
 *
 * Commission Rates:
 * - Level 1: 1000 XAF per subscribed referral
 * - Level 2: 500 XAF per subscribed L2 referral
 * - Level 3: 250 XAF per subscribed L3 referral
 *
 * Usage:
 *   ANALYZE:  node scripts/analyze-excess-balances.js
 *   FIX:      node scripts/analyze-excess-balances.js --apply
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Configuration
const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';
const PAYMENT_DB_URI = process.env.PAYMENT_DB_URI || 'mongodb://localhost:27017/sbc_payment_dev';

// Commission rates
const COMMISSION_RATES = {
    L1: 1000,
    L2: 500,
    L3: 250
};

// Users to EXCLUDE from cleanup (admin accounts)
const EXCLUDED_USER_IDS = [
    '65d2b0344a7e2b9efbf6205d', // sterling black (admin - testing)
];

// Check if --apply flag is passed
const DRY_RUN = !process.argv.includes('--apply');

// Models
const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const referralSchema = new mongoose.Schema({}, { strict: false, collection: 'referrals' });
const subscriptionSchema = new mongoose.Schema({}, { strict: false, collection: 'subscriptions' });
const transactionSchema = new mongoose.Schema({}, { strict: false, collection: 'transactions' });

async function analyzeExcessBalances() {
    let userConnection;
    let paymentConnection;

    try {
        console.log('================================================================');
        console.log('EXCESS USER BALANCES ANALYSIS');
        console.log('================================================================\n');

        if (DRY_RUN) {
            console.log('ANALYSIS MODE - No changes will be made');
            console.log('Run with --apply to fix balances\n');
        } else {
            console.log('APPLY MODE - Balances WILL be corrected!\n');
        }

        // Connect to databases
        console.log('Connecting to databases...');
        userConnection = await mongoose.createConnection(USER_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('Connected to User DB');

        paymentConnection = await mongoose.createConnection(PAYMENT_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('Connected to Payment DB\n');

        const User = userConnection.model('User', userSchema);
        const Referral = userConnection.model('Referral', referralSchema);
        const Subscription = userConnection.model('Subscription', subscriptionSchema);
        const Transaction = paymentConnection.model('Transaction', transactionSchema);

        // Get all users with non-zero balance (excluding admins)
        console.log('Finding users with non-zero balances...\n');

        const usersWithBalance = await User.find({
            balance: { $gt: 0 },
            role: { $ne: 'admin' }
        }).lean();

        console.log(`Users with non-zero balance: ${usersWithBalance.length}`);

        const currentTotalBalance = usersWithBalance.reduce((sum, u) => sum + (u.balance || 0), 0);
        console.log(`Current total balance: ${currentTotalBalance.toLocaleString()} XAF\n`);

        // Pre-load all subscriptions into a Set for fast lookup
        // Note: Older subscriptions may not have category field - treat missing category as 'registration'
        console.log('Loading all registration subscriptions...');
        const allRegistrations = await Subscription.find({
            $or: [
                { category: 'registration' },
                { category: { $exists: false } }  // Older subscriptions without category field
            ]
        }).select('user').lean();

        const subscribedUserIds = new Set(
            allRegistrations.map(s => s.user.toString())
        );
        console.log(`Users with registration subscriptions: ${subscribedUserIds.size}\n`);

        // Pre-load all referrals into a map for fast lookup
        console.log('Loading all referrals...');
        const allReferrals = await Referral.find({ archived: { $ne: true } }).lean();

        // Create a map: referrerId -> { L1: [userIds], L2: [userIds], L3: [userIds] }
        const referralMap = new Map();
        for (const ref of allReferrals) {
            const referrerId = ref.referrer.toString();
            if (!referralMap.has(referrerId)) {
                referralMap.set(referrerId, { L1: [], L2: [], L3: [] });
            }
            const level = ref.referralLevel;
            if (level === 1) {
                referralMap.get(referrerId).L1.push(ref.referredUser.toString());
            } else if (level === 2) {
                referralMap.get(referrerId).L2.push(ref.referredUser.toString());
            } else if (level === 3) {
                referralMap.get(referrerId).L3.push(ref.referredUser.toString());
            }
        }
        console.log(`Loaded ${allReferrals.length} referrals for ${referralMap.size} referrers\n`);

        // Analyze each user
        const usersWithExcess = [];
        const usersOk = [];
        let processedCount = 0;

        console.log('Analyzing user balances vs referral earnings...\n');

        for (const user of usersWithBalance) {
            const userId = user._id;
            const userIdStr = userId.toString();

            // Skip excluded users
            if (EXCLUDED_USER_IDS.includes(userIdStr)) {
                continue;
            }

            // Get referrals for this user from the map
            const userReferrals = referralMap.get(userIdStr) || { L1: [], L2: [], L3: [] };

            // Count SUBSCRIBED referrals at each level
            const level1Count = userReferrals.L1.filter(id => subscribedUserIds.has(id)).length;
            const level2Count = userReferrals.L2.filter(id => subscribedUserIds.has(id)).length;
            const level3Count = userReferrals.L3.filter(id => subscribedUserIds.has(id)).length;

            // Calculate expected earnings
            const expectedEarnings =
                (level1Count * COMMISSION_RATES.L1) +
                (level2Count * COMMISSION_RATES.L2) +
                (level3Count * COMMISSION_RATES.L3);

            // Get total withdrawals for this user
            const withdrawals = await Transaction.find({
                userId: userId,
                type: 'withdrawal',
                status: 'completed',
                currency: 'XAF'
            }).lean();
            const totalWithdrawn = withdrawals.reduce((sum, w) => sum + (w.amount || 0), 0);

            // Expected current balance = Expected earnings - Withdrawals (can't be negative)
            const expectedBalance = Math.max(0, expectedEarnings - totalWithdrawn);
            const currentBalance = user.balance || 0;
            const excess = currentBalance - expectedBalance;

            if (excess > 100) { // Threshold of 100 XAF to ignore small rounding
                usersWithExcess.push({
                    userId: userIdStr,
                    name: user.name || user.email || 'Unknown',
                    phone: user.phoneNumber || 'N/A',
                    currentBalance,
                    expectedBalance,
                    excess,
                    expectedEarnings,
                    totalWithdrawn,
                    referrals: { L1: level1Count, L2: level2Count, L3: level3Count },
                    totalReferrals: { L1: userReferrals.L1.length, L2: userReferrals.L2.length, L3: userReferrals.L3.length },
                    lastUpdated: user.updatedAt
                });
            } else {
                usersOk.push({
                    userId: userIdStr,
                    name: user.name || user.email,
                    currentBalance,
                    expectedBalance
                });
            }

            processedCount++;
            if (processedCount % 100 === 0) {
                process.stdout.write(`\rProcessed ${processedCount}/${usersWithBalance.length} users...`);
            }
        }

        console.log(`\rProcessed ${processedCount}/${usersWithBalance.length} users.   \n`);

        // Sort by excess (highest first)
        usersWithExcess.sort((a, b) => b.excess - a.excess);

        // Calculate totals
        const totalExcess = usersWithExcess.reduce((sum, u) => sum + u.excess, 0);
        const totalExpectedBalance = usersWithExcess.reduce((sum, u) => sum + u.expectedBalance, 0) +
                                    usersOk.reduce((sum, u) => sum + u.expectedBalance, 0);

        // Display results
        console.log('================================================================');
        console.log('RESULTS');
        console.log('================================================================\n');

        console.log(`Users with excess balance: ${usersWithExcess.length}`);
        console.log(`Users with correct balance: ${usersOk.length}`);
        console.log(`\nCurrent total balance: ${currentTotalBalance.toLocaleString()} XAF`);
        console.log(`Expected total balance: ${totalExpectedBalance.toLocaleString()} XAF`);
        console.log(`Total excess: ${totalExcess.toLocaleString()} XAF\n`);

        // Show top 30 users with excess
        console.log('Top 30 users with excess balances:');
        console.log('─'.repeat(80));

        for (const u of usersWithExcess.slice(0, 30)) {
            console.log(`${u.name} (${u.phone})`);
            console.log(`   Current: ${u.currentBalance.toLocaleString()} XAF | Expected: ${u.expectedBalance.toLocaleString()} XAF | Excess: ${u.excess.toLocaleString()} XAF`);
            console.log(`   Subscribed Referrals: L1=${u.referrals.L1}, L2=${u.referrals.L2}, L3=${u.referrals.L3} (Total: L1=${u.totalReferrals.L1}, L2=${u.totalReferrals.L2}, L3=${u.totalReferrals.L3})`);
            console.log(`   Expected Earnings: ${u.expectedEarnings.toLocaleString()} XAF | Withdrawn: ${u.totalWithdrawn.toLocaleString()} XAF`);
            console.log('');
        }

        if (usersWithExcess.length > 30) {
            console.log(`... and ${usersWithExcess.length - 30} more users with excess balances\n`);
        }

        // Apply fixes if not dry run
        if (!DRY_RUN && usersWithExcess.length > 0) {
            console.log('================================================================');
            console.log('APPLYING BALANCE CORRECTIONS...');
            console.log('================================================================\n');

            let correctedCount = 0;
            let totalCorrected = 0;

            for (const u of usersWithExcess) {
                await User.updateOne(
                    { _id: new mongoose.Types.ObjectId(u.userId) },
                    { $set: { balance: u.expectedBalance } }
                );
                correctedCount++;
                totalCorrected += u.excess;

                if (correctedCount % 50 === 0) {
                    console.log(`Corrected ${correctedCount}/${usersWithExcess.length} users...`);
                }
            }

            console.log(`\nCorrected ${correctedCount} user balances`);
            console.log(`Total balance reduced: ${totalCorrected.toLocaleString()} XAF`);
            console.log(`New total balance: ${(currentTotalBalance - totalCorrected).toLocaleString()} XAF\n`);
        } else if (DRY_RUN) {
            console.log('[DRY RUN] No changes were made.');
            console.log('Run with --apply to correct the balances.\n');
        }

        // Save report
        const report = {
            generatedAt: new Date().toISOString(),
            summary: {
                usersAnalyzed: usersWithBalance.length,
                usersWithExcess: usersWithExcess.length,
                usersOk: usersOk.length,
                currentTotalBalance,
                expectedTotalBalance: totalExpectedBalance,
                totalExcess
            },
            usersWithExcess: usersWithExcess.slice(0, 100) // Top 100
        };

        const fs = require('fs');
        fs.writeFileSync('excess-balances-report.json', JSON.stringify(report, null, 2));
        console.log('Report saved to: excess-balances-report.json');

        console.log('\n================================================================\n');

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    } finally {
        if (userConnection) {
            await userConnection.close();
            console.log('User DB connection closed');
        }
        if (paymentConnection) {
            await paymentConnection.close();
            console.log('Payment DB connection closed');
        }
    }
}

// Run the script
analyzeExcessBalances().then(() => {
    console.log('\nScript complete!');
    process.exit(0);
}).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
