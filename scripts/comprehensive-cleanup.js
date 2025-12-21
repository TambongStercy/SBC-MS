/**
 * Comprehensive Database Cleanup Script
 *
 * This script performs a complete cleanup of the database to fix:
 * 1. Bizarre migration orphan transactions (failed withdrawal + refund deposit pairs)
 * 2. Fraudulent user transactions and balances
 * 3. User balance corrections based on legitimate earnings
 *
 * CONTEXT:
 * - Current deposits: ~93M XAF
 * - Expected deposits: ~70M XAF
 * - Excess to remove: ~23M XAF
 *
 * LEGITIMATE DEPOSIT AMOUNTS:
 * - 1000 XAF (Level 1 Referral Commission)
 * - 500 XAF (Level 2 Referral Commission)
 * - 250 XAF (Level 3 Referral Commission)
 * - 2150 XAF (CLASSIQUE Activation Transfer)
 * - 5300 XAF (CIBLE Activation Transfer)
 * - 3150 XAF (UPGRADE Activation Transfer)
 *
 * Usage:
 *   DRY RUN:  node scripts/comprehensive-cleanup.js
 *   APPLY:    node scripts/comprehensive-cleanup.js --apply
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Configuration
const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';
const PAYMENT_DB_URI = process.env.PAYMENT_DB_URI || 'mongodb://localhost:27017/sbc_payment_dev';

// Legitimate deposit amounts (with tolerance for rounding)
const LEGITIMATE_AMOUNTS = [
    { amount: 1000, tolerance: 1, description: 'Level 1 Referral Commission' },
    { amount: 500, tolerance: 1, description: 'Level 2 Referral Commission' },
    { amount: 250, tolerance: 1, description: 'Level 3 Referral Commission' },
    { amount: 2150, tolerance: 1, description: 'CLASSIQUE Activation Transfer' },
    { amount: 5300, tolerance: 1, description: 'CIBLE Activation Transfer' },
    { amount: 3150, tolerance: 1, description: 'UPGRADE Activation Transfer' },
    // USD crypto commissions (converted amounts might vary slightly)
    { amount: 2, tolerance: 0.1, description: 'Crypto L1 Commission (USD)' },
    { amount: 1, tolerance: 0.1, description: 'Crypto L2 Commission (USD)' },
    { amount: 0.5, tolerance: 0.1, description: 'Crypto L3 Commission (USD)' },
];

// Commission rates
const COMMISSION_RATES = {
    XAF: { L1: 1000, L2: 500, L3: 250 },
    USD: { L1: 2, L2: 1, L3: 0.5 }
};

// Users to EXCLUDE from cleanup (admin accounts)
const EXCLUDED_USER_IDS = [
    '65d2b0344a7e2b9efbf6205d', // sterling black (admin - testing)
];

// Confirmed fraudulent users (from fix-fraudulent-users.js)
const FRAUDULENT_USERS = [
    {
        userId: '65d06c20644793ef52ca6e11',
        name: 'Bemjamin Aime',
        expectedBalance: 0,
        reason: '1 referral, 0 subscribed, withdrew 478,582 XAF'
    },
    {
        userId: '65d8934ca95f5692725ef543',
        name: 'Batouri Julien',
        expectedBalance: 0,
        reason: '1 referral, 0 subscribed, withdrew 296,532 XAF'
    },
    {
        userId: '65d09ec65c96a8ab00a6eb3d',
        name: 'Tchaleu Diane',
        expectedBalance: 0,
        reason: '0 referrals, withdrew 111,699 XAF'
    },
    {
        userId: '669772d5b8a59e6c9725b76b',
        name: 'jessie momo',
        expectedBalance: 3000,
        reason: '6 referrals, 3 subscribed (all L1), withdrew 95,950 XAF'
    },
    {
        userId: '666ef2b14b08104253b26b6c',
        name: 'theophile steven',
        expectedBalance: 2500,
        reason: '19 referrals, 3 subscribed, withdrew 95,101 XAF'
    },
    {
        userId: '65d4ddea8ce5ffe48a44a8dd',
        name: 'mouhamed fadil',
        expectedBalance: 0,
        reason: '0 referrals, withdrew 71,750 XAF'
    }
];

// Check if --apply flag is passed
const DRY_RUN = !process.argv.includes('--apply');

// Models
const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const transactionSchema = new mongoose.Schema({}, { strict: false, collection: 'transactions' });

/**
 * Check if a deposit amount is legitimate
 */
function isLegitimateAmount(amount) {
    for (const legit of LEGITIMATE_AMOUNTS) {
        if (Math.abs(amount - legit.amount) <= legit.tolerance) {
            return { isLegit: true, description: legit.description };
        }
    }
    return { isLegit: false, description: null };
}

/**
 * Calculate expected earnings based on referrals
 */
function calculateExpectedEarnings(referralStats) {
    let expectedXAF = 0;
    let expectedUSD = 0;

    // Level 1 commissions
    if (referralStats.level1) {
        expectedXAF += (referralStats.level1.subscribedXAF || 0) * COMMISSION_RATES.XAF.L1;
        expectedUSD += (referralStats.level1.subscribedUSD || 0) * COMMISSION_RATES.USD.L1;
    }

    // Level 2 commissions
    if (referralStats.level2) {
        expectedXAF += (referralStats.level2.subscribedXAF || 0) * COMMISSION_RATES.XAF.L2;
        expectedUSD += (referralStats.level2.subscribedUSD || 0) * COMMISSION_RATES.USD.L2;
    }

    // Level 3 commissions
    if (referralStats.level3) {
        expectedXAF += (referralStats.level3.subscribedXAF || 0) * COMMISSION_RATES.XAF.L3;
        expectedUSD += (referralStats.level3.subscribedUSD || 0) * COMMISSION_RATES.USD.L3;
    }

    return { expectedXAF, expectedUSD };
}

async function comprehensiveCleanup() {
    let userConnection;
    let paymentConnection;

    try {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('COMPREHENSIVE DATABASE CLEANUP SCRIPT');
        console.log('═══════════════════════════════════════════════════════════════\n');

        if (DRY_RUN) {
            console.log('DRY RUN MODE - No changes will be made');
            console.log('    Run with --apply to actually make changes\n');
        } else {
            console.log('APPLY MODE - Changes WILL be made to the database!\n');
        }

        // Connect to databases
        console.log('Connecting to databases...\n');

        userConnection = await mongoose.createConnection(USER_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('   Connected to User DB');

        paymentConnection = await mongoose.createConnection(PAYMENT_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('   Connected to Payment DB\n');

        const User = userConnection.model('User', userSchema);
        const Transaction = paymentConnection.model('Transaction', transactionSchema);

        // Track totals
        const stats = {
            bizarreDepositsDeleted: 0,
            bizarreWithdrawalsDeleted: 0,
            bizarreDepositAmount: 0,
            bizarreWithdrawalAmount: 0,
            fraudulentTransactionsDeleted: 0,
            fraudulentAmount: 0,
            balancesAdjusted: 0,
            totalBalanceReduction: 0
        };

        // =========================================================================
        // PHASE 1: Delete Bizarre Migration Orphan Transactions
        // =========================================================================
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('PHASE 1: Cleaning Migration Orphan Transactions');
        console.log('═══════════════════════════════════════════════════════════════\n');

        // Find all completed XAF deposits
        const allDeposits = await Transaction.find({
            type: 'deposit',
            currency: 'XAF',
            status: 'completed'
        }).lean();

        console.log(`   Total XAF deposits found: ${allDeposits.length}`);

        // Categorize deposits
        const suspiciousDeposits = [];
        const fraudulentUserIds = FRAUDULENT_USERS.map(f => f.userId);

        for (const deposit of allDeposits) {
            const userIdStr = deposit.userId.toString();

            // Skip excluded users
            if (EXCLUDED_USER_IDS.includes(userIdStr)) continue;

            // Skip fraudulent users (handled in Phase 2)
            if (fraudulentUserIds.includes(userIdStr)) continue;

            const check = isLegitimateAmount(deposit.amount);
            if (!check.isLegit) {
                suspiciousDeposits.push(deposit);
            }
        }

        console.log(`   Suspicious deposits (non-legitimate amounts): ${suspiciousDeposits.length}`);

        // Build a map for matching withdrawals
        const suspiciousDepositMap = new Map();
        for (const dep of suspiciousDeposits) {
            const key = `${dep.userId.toString()}_${dep.amount}`;
            if (!suspiciousDepositMap.has(key)) {
                suspiciousDepositMap.set(key, []);
            }
            suspiciousDepositMap.get(key).push(dep);
        }

        // Find matching withdrawals
        const allWithdrawals = await Transaction.find({
            type: 'withdrawal',
            currency: 'XAF',
            status: 'completed'
        }).lean();

        console.log(`   Total XAF withdrawals found: ${allWithdrawals.length}`);

        const suspiciousWithdrawals = [];
        for (const withdrawal of allWithdrawals) {
            const userIdStr = withdrawal.userId.toString();

            // Skip excluded and fraudulent users
            if (EXCLUDED_USER_IDS.includes(userIdStr)) continue;
            if (fraudulentUserIds.includes(userIdStr)) continue;

            // Match with suspicious deposits
            const key = `${userIdStr}_${withdrawal.amount}`;
            if (suspiciousDepositMap.has(key)) {
                suspiciousWithdrawals.push(withdrawal);
            }
        }

        console.log(`   Matching suspicious withdrawals: ${suspiciousWithdrawals.length}`);

        const totalSuspiciousDepositAmount = suspiciousDeposits.reduce((sum, d) => sum + d.amount, 0);
        const totalSuspiciousWithdrawalAmount = suspiciousWithdrawals.reduce((sum, w) => sum + w.amount, 0);

        console.log(`\n   Total suspicious deposit amount: ${totalSuspiciousDepositAmount.toFixed(2)} XAF`);
        console.log(`   Total suspicious withdrawal amount: ${totalSuspiciousWithdrawalAmount.toFixed(2)} XAF\n`);

        if (!DRY_RUN) {
            // Delete suspicious deposits
            const suspiciousDepositIds = suspiciousDeposits.map(d => d._id);
            if (suspiciousDepositIds.length > 0) {
                const deleteDepositResult = await Transaction.deleteMany({
                    _id: { $in: suspiciousDepositIds }
                });
                stats.bizarreDepositsDeleted = deleteDepositResult.deletedCount;
                stats.bizarreDepositAmount = totalSuspiciousDepositAmount;
                console.log(`   Deleted ${deleteDepositResult.deletedCount} suspicious deposits`);
            }

            // Delete suspicious withdrawals
            const suspiciousWithdrawalIds = suspiciousWithdrawals.map(w => w._id);
            if (suspiciousWithdrawalIds.length > 0) {
                const deleteWithdrawalResult = await Transaction.deleteMany({
                    _id: { $in: suspiciousWithdrawalIds }
                });
                stats.bizarreWithdrawalsDeleted = deleteWithdrawalResult.deletedCount;
                stats.bizarreWithdrawalAmount = totalSuspiciousWithdrawalAmount;
                console.log(`   Deleted ${deleteWithdrawalResult.deletedCount} matching withdrawals`);
            }
        } else {
            console.log('   [DRY RUN] Would delete:');
            console.log(`      - ${suspiciousDeposits.length} suspicious deposits (${totalSuspiciousDepositAmount.toFixed(2)} XAF)`);
            console.log(`      - ${suspiciousWithdrawals.length} matching withdrawals (${totalSuspiciousWithdrawalAmount.toFixed(2)} XAF)`);
        }

        // =========================================================================
        // PHASE 2: Fix Fraudulent Users
        // =========================================================================
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('PHASE 2: Fixing Confirmed Fraudulent Users');
        console.log('═══════════════════════════════════════════════════════════════\n');

        for (const fraudUser of FRAUDULENT_USERS) {
            console.log(`   Processing: ${fraudUser.name} (${fraudUser.userId})`);
            console.log(`   Reason: ${fraudUser.reason}`);

            const userId = new mongoose.Types.ObjectId(fraudUser.userId);

            // Get current user state
            const user = await User.findById(userId).lean();
            if (!user) {
                console.log('      User not found!\n');
                continue;
            }

            // Count transactions
            const deposits = await Transaction.find({
                userId: userId,
                type: 'deposit'
            }).lean();

            const withdrawals = await Transaction.find({
                userId: userId,
                type: 'withdrawal'
            }).lean();

            const depositTotal = deposits.reduce((sum, d) => sum + (d.amount || 0), 0);
            const withdrawalTotal = withdrawals.reduce((sum, w) => sum + (w.amount || 0), 0);

            console.log(`      Current Balance: ${user.balance || 0} XAF`);
            console.log(`      Deposits: ${deposits.length} (${depositTotal.toFixed(2)} XAF)`);
            console.log(`      Withdrawals: ${withdrawals.length} (${withdrawalTotal.toFixed(2)} XAF)`);

            if (!DRY_RUN) {
                // Delete all transactions
                const depositResult = await Transaction.deleteMany({ userId: userId, type: 'deposit' });
                const withdrawalResult = await Transaction.deleteMany({ userId: userId, type: 'withdrawal' });

                // Reset balance
                await User.updateOne(
                    { _id: userId },
                    { $set: { balance: fraudUser.expectedBalance } }
                );

                stats.fraudulentTransactionsDeleted += depositResult.deletedCount + withdrawalResult.deletedCount;
                stats.fraudulentAmount += depositTotal + withdrawalTotal;

                console.log(`      Deleted ${depositResult.deletedCount + withdrawalResult.deletedCount} transactions`);
                console.log(`      Reset balance to ${fraudUser.expectedBalance} XAF\n`);
            } else {
                console.log(`      [DRY RUN] Would delete ${deposits.length + withdrawals.length} transactions`);
                console.log(`      [DRY RUN] Would reset balance to ${fraudUser.expectedBalance} XAF\n`);
            }
        }

        // =========================================================================
        // PHASE 3: Adjust Balances for Users with Excessive Earnings
        // =========================================================================
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('PHASE 3: Adjusting User Balances Based on Legitimate Earnings');
        console.log('═══════════════════════════════════════════════════════════════\n');

        // Get all users (excluding admins and fraudulent)
        const allUsers = await User.find({
            role: { $ne: 'admin' },
            _id: { $nin: [...EXCLUDED_USER_IDS, ...fraudulentUserIds].map(id => new mongoose.Types.ObjectId(id)) }
        }).lean();

        console.log(`   Total non-admin users to analyze: ${allUsers.length}\n`);

        // Analyze each user
        const usersNeedingBalanceAdjustment = [];

        for (const user of allUsers) {
            const userId = user._id;

            // Get referral stats - count subscribed referrals by level
            const level1Referrals = await User.countDocuments({
                referredBy: userId,
                subscriptionStatus: 'active'
            });

            // For level 2 and 3, we need to do nested queries
            const directReferrals = await User.find({ referredBy: userId }).select('_id').lean();
            const directReferralIds = directReferrals.map(r => r._id);

            let level2Referrals = 0;
            let level3Referrals = 0;

            if (directReferralIds.length > 0) {
                level2Referrals = await User.countDocuments({
                    referredBy: { $in: directReferralIds },
                    subscriptionStatus: 'active'
                });

                const level2Refs = await User.find({ referredBy: { $in: directReferralIds } }).select('_id').lean();
                const level2RefIds = level2Refs.map(r => r._id);

                if (level2RefIds.length > 0) {
                    level3Referrals = await User.countDocuments({
                        referredBy: { $in: level2RefIds },
                        subscriptionStatus: 'active'
                    });
                }
            }

            // Calculate expected earnings (XAF only for now)
            const expectedXAF = (level1Referrals * COMMISSION_RATES.XAF.L1) +
                               (level2Referrals * COMMISSION_RATES.XAF.L2) +
                               (level3Referrals * COMMISSION_RATES.XAF.L3);

            // Get actual withdrawals
            const withdrawals = await Transaction.find({
                userId: userId,
                type: 'withdrawal',
                currency: 'XAF',
                status: 'completed'
            }).lean();
            const totalWithdrawn = withdrawals.reduce((sum, w) => sum + (w.amount || 0), 0);

            // Actual earnings = current balance + withdrawals
            const currentBalance = user.balance || 0;
            const actualEarnings = currentBalance + totalWithdrawn;

            // Check if over-earned
            const overEarned = actualEarnings - expectedXAF;

            if (overEarned > 1000 && currentBalance > 0) { // Threshold of 1000 XAF
                // Calculate new balance (can't go negative)
                const newBalance = Math.max(0, currentBalance - overEarned);
                const balanceReduction = currentBalance - newBalance;

                if (balanceReduction > 0) {
                    usersNeedingBalanceAdjustment.push({
                        userId: userId,
                        name: user.name || user.email,
                        currentBalance,
                        expectedEarnings: expectedXAF,
                        actualEarnings,
                        overEarned,
                        newBalance,
                        balanceReduction,
                        referrals: { L1: level1Referrals, L2: level2Referrals, L3: level3Referrals }
                    });
                }
            }
        }

        console.log(`   Users needing balance adjustment: ${usersNeedingBalanceAdjustment.length}\n`);

        // Sort by overEarned (highest first) and show top 20
        usersNeedingBalanceAdjustment.sort((a, b) => b.overEarned - a.overEarned);

        console.log('   Top 20 users with excessive balances:');
        for (const u of usersNeedingBalanceAdjustment.slice(0, 20)) {
            console.log(`      ${u.name}: ${u.currentBalance.toFixed(0)} -> ${u.newBalance.toFixed(0)} XAF`);
            console.log(`         (Expected: ${u.expectedEarnings.toFixed(0)}, Over-earned: ${u.overEarned.toFixed(0)})`);
        }

        const totalBalanceReduction = usersNeedingBalanceAdjustment.reduce((sum, u) => sum + u.balanceReduction, 0);
        console.log(`\n   Total balance reduction: ${totalBalanceReduction.toFixed(2)} XAF`);

        if (!DRY_RUN) {
            console.log('\n   Applying balance adjustments...');
            for (const u of usersNeedingBalanceAdjustment) {
                await User.updateOne(
                    { _id: u.userId },
                    { $set: { balance: u.newBalance } }
                );
                stats.balancesAdjusted++;
                stats.totalBalanceReduction += u.balanceReduction;
            }
            console.log(`   Adjusted ${stats.balancesAdjusted} user balances`);
        } else {
            console.log(`\n   [DRY RUN] Would adjust ${usersNeedingBalanceAdjustment.length} user balances`);
        }

        // =========================================================================
        // FINAL SUMMARY
        // =========================================================================
        console.log('\n\n═══════════════════════════════════════════════════════════════');
        console.log('FINAL SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════\n');

        if (DRY_RUN) {
            console.log('[DRY RUN] No changes were made. Summary of what WOULD happen:\n');
            console.log('PHASE 1 - Migration Orphans:');
            console.log(`   Would delete ${suspiciousDeposits.length} suspicious deposits (${totalSuspiciousDepositAmount.toFixed(2)} XAF)`);
            console.log(`   Would delete ${suspiciousWithdrawals.length} matching withdrawals (${totalSuspiciousWithdrawalAmount.toFixed(2)} XAF)`);
            console.log(`   Net deposit reduction: ${totalSuspiciousDepositAmount.toFixed(2)} XAF\n`);

            console.log('PHASE 2 - Fraudulent Users:');
            console.log(`   Would process ${FRAUDULENT_USERS.length} fraudulent users\n`);

            console.log('PHASE 3 - Balance Adjustments:');
            console.log(`   Would adjust ${usersNeedingBalanceAdjustment.length} user balances`);
            console.log(`   Total balance reduction: ${totalBalanceReduction.toFixed(2)} XAF\n`);

            console.log('ESTIMATED IMPACT:');
            console.log(`   Deposit transactions removed: ~${totalSuspiciousDepositAmount.toFixed(0)} XAF`);
            console.log(`   This should bring deposits from ~93M to ~${(93000000 - totalSuspiciousDepositAmount).toFixed(0)} XAF\n`);

            console.log('Run with --apply to execute these changes.');
        } else {
            console.log('CHANGES APPLIED:\n');
            console.log('PHASE 1 - Migration Orphans:');
            console.log(`   Deleted ${stats.bizarreDepositsDeleted} suspicious deposits (${stats.bizarreDepositAmount.toFixed(2)} XAF)`);
            console.log(`   Deleted ${stats.bizarreWithdrawalsDeleted} matching withdrawals (${stats.bizarreWithdrawalAmount.toFixed(2)} XAF)\n`);

            console.log('PHASE 2 - Fraudulent Users:');
            console.log(`   Deleted ${stats.fraudulentTransactionsDeleted} transactions (${stats.fraudulentAmount.toFixed(2)} XAF)\n`);

            console.log('PHASE 3 - Balance Adjustments:');
            console.log(`   Adjusted ${stats.balancesAdjusted} user balances`);
            console.log(`   Total balance reduction: ${stats.totalBalanceReduction.toFixed(2)} XAF\n`);

            console.log('CLEANUP COMPLETED SUCCESSFULLY!');
        }

        console.log('\n═══════════════════════════════════════════════════════════════\n');

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
comprehensiveCleanup().then(() => {
    console.log('\nScript complete!');
    process.exit(0);
}).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
