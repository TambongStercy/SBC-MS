/**
 * Fix Bizarre Deposits & Withdrawals Script
 *
 * CONTEXT:
 * These bizarre transactions are from a migration issue. In the old system, when a
 * withdrawal failed, it would create a deposit to refund the user. During the DB/code
 * migration, these failed withdrawal + refund deposit pairs weren't marked as 'failed'.
 *
 * IMPORTANT: User balances are NOT affected - they are already correct. The old system
 * cut the balance before initiating withdrawal, then deposited back on failure.
 * We just need to DELETE these orphaned transactions to fix the dashboard totals.
 *
 * LEGITIMATE DEPOSIT AMOUNTS:
 * - 1000 XAF (Level 1 Referral Commission)
 * - 500 XAF (Level 2 Referral Commission)
 * - 250 XAF (Level 3 Referral Commission)
 * - 2150 XAF (CLASSIQUE Activation Transfer)
 * - 5300 XAF (CIBLE Activation Transfer)
 * - 3150 XAF (UPGRADE Activation Transfer)
 *
 * BIZARRE PATTERNS (failed withdrawal + refund deposit pairs from migration):
 * - Non-standard amounts (6060, 5050 XAF, etc.)
 * - Most were updated on the same day (migration day)
 *
 * This script:
 * 1. Finds all suspicious deposit transactions (non-legitimate amounts)
 * 2. Finds matching withdrawal transactions (same user, same amount)
 * 3. Deletes both WITHOUT touching user balances (they're already correct)
 *
 * Usage:
 *   DRY RUN:  node scripts/fix-bizarre-deposits.js
 *   APPLY:    node scripts/fix-bizarre-deposits.js --apply
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Configuration - Only need Payment DB (user balances are already correct)
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

// Users to EXCLUDE from cleanup (only your account for testing)
const EXCLUDED_USER_IDS = [
    '65d2b0344a7e2b9efbf6205d', // sterling black (admin - testing)
];

// Check if --apply flag is passed
const DRY_RUN = !process.argv.includes('--apply');

// Model
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

async function fixBizarreTransactions() {
    let paymentConnection;

    try {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🔧 BIZARRE DEPOSITS & WITHDRAWALS CLEANUP SCRIPT');
        console.log('═══════════════════════════════════════════════════════════════\n');

        if (DRY_RUN) {
            console.log('⚠️  DRY RUN MODE - No changes will be made');
            console.log('    Run with --apply to actually make changes\n');
        } else {
            console.log('🚨 APPLY MODE - Changes WILL be made to the database!\n');
        }

        // Connect to Payment DB only (no need for User DB - balances are already correct)
        console.log('🔗 Connecting to database...\n');

        paymentConnection = await mongoose.createConnection(PAYMENT_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('   ✅ Connected to Payment DB\n');

        const Transaction = paymentConnection.model('Transaction', transactionSchema);

        // Find all completed XAF deposits
        console.log('📊 Analyzing all deposit transactions...\n');

        const allDeposits = await Transaction.find({
            type: 'deposit',
            currency: 'XAF',
            status: 'completed'
        }).lean();

        console.log(`   Total XAF deposits found: ${allDeposits.length}\n`);

        // Categorize deposits
        const legitimateDeposits = [];
        const suspiciousDeposits = [];
        const excludedUserDeposits = [];

        for (const deposit of allDeposits) {
            const userIdStr = deposit.userId.toString();

            // Check if user is excluded
            if (EXCLUDED_USER_IDS.includes(userIdStr)) {
                excludedUserDeposits.push(deposit);
                continue;
            }

            const check = isLegitimateAmount(deposit.amount);
            if (check.isLegit) {
                legitimateDeposits.push({ ...deposit, description: check.description });
            } else {
                suspiciousDeposits.push(deposit);
            }
        }

        console.log(`   Legitimate deposits: ${legitimateDeposits.length}`);
        console.log(`   Suspicious deposits: ${suspiciousDeposits.length}`);
        console.log(`   Excluded user deposits: ${excludedUserDeposits.length}\n`);

        // ========== ANALYZE WITHDRAWALS ==========
        // Find matching withdrawals: same user + same amount as suspicious deposits
        // These are the failed withdrawals that triggered the refund deposits
        console.log('📊 Finding matching withdrawal transactions...\n');

        const allWithdrawals = await Transaction.find({
            type: 'withdrawal',
            currency: 'XAF',
            status: 'completed'
        }).lean();

        console.log(`   Total XAF withdrawals found: ${allWithdrawals.length}\n`);

        // Build a map of suspicious deposits by user+amount for matching
        const suspiciousDepositMap = new Map();
        for (const dep of suspiciousDeposits) {
            const key = `${dep.userId.toString()}_${dep.amount}`;
            if (!suspiciousDepositMap.has(key)) {
                suspiciousDepositMap.set(key, []);
            }
            suspiciousDepositMap.get(key).push(dep);
        }

        // Find matching withdrawals (same user, same amount as suspicious deposit)
        const suspiciousWithdrawals = [];
        const legitimateWithdrawals = [];
        const excludedUserWithdrawals = [];

        for (const withdrawal of allWithdrawals) {
            const userIdStr = withdrawal.userId.toString();

            // Check if user is excluded
            if (EXCLUDED_USER_IDS.includes(userIdStr)) {
                excludedUserWithdrawals.push(withdrawal);
                continue;
            }

            // A withdrawal is suspicious if there's a matching deposit (same user + amount)
            const key = `${userIdStr}_${withdrawal.amount}`;
            if (suspiciousDepositMap.has(key)) {
                suspiciousWithdrawals.push(withdrawal);
            } else {
                legitimateWithdrawals.push(withdrawal);
            }
        }

        console.log(`   Legitimate withdrawals: ${legitimateWithdrawals.length}`);
        console.log(`   Matching suspicious withdrawals: ${suspiciousWithdrawals.length}`);
        console.log(`   Excluded user withdrawals: ${excludedUserWithdrawals.length}\n`);

        // Analyze suspicious deposit amounts distribution
        const depositAmountDistribution = {};
        for (const dep of suspiciousDeposits) {
            const amt = dep.amount;
            depositAmountDistribution[amt] = (depositAmountDistribution[amt] || 0) + 1;
        }

        console.log('📈 Top 20 suspicious deposit amounts:');
        const sortedDepositAmounts = Object.entries(depositAmountDistribution)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);

        for (const [amount, count] of sortedDepositAmounts) {
            console.log(`   ${parseFloat(amount).toFixed(2)} XAF: ${count} transactions`);
        }
        console.log();

        // Analyze suspicious withdrawal amounts distribution
        const withdrawalAmountDistribution = {};
        for (const w of suspiciousWithdrawals) {
            const amt = w.amount;
            withdrawalAmountDistribution[amt] = (withdrawalAmountDistribution[amt] || 0) + 1;
        }

        console.log('📈 Top 20 suspicious withdrawal amounts:');
        const sortedWithdrawalAmounts = Object.entries(withdrawalAmountDistribution)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);

        for (const [amount, count] of sortedWithdrawalAmounts) {
            console.log(`   ${parseFloat(amount).toFixed(2)} XAF: ${count} transactions`);
        }
        console.log();

        // Calculate total suspicious amounts
        const totalSuspiciousDepositAmount = suspiciousDeposits.reduce((sum, d) => sum + d.amount, 0);
        const totalSuspiciousWithdrawalAmount = suspiciousWithdrawals.reduce((sum, w) => sum + w.amount, 0);

        console.log(`💰 Total suspicious deposit amount: ${totalSuspiciousDepositAmount.toFixed(2)} XAF`);
        console.log(`💰 Total suspicious withdrawal amount: ${totalSuspiciousWithdrawalAmount.toFixed(2)} XAF\n`);

        // Get unique affected users (from both deposits and withdrawals)
        const affectedUserIds = [...new Set([
            ...suspiciousDeposits.map(d => d.userId.toString()),
            ...suspiciousWithdrawals.map(w => w.userId.toString())
        ])];
        console.log(`👥 Affected users: ${affectedUserIds.length}\n`);

        if (DRY_RUN) {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('[DRY RUN] Would perform the following actions:');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            console.log(`   1. Delete ${suspiciousDeposits.length} suspicious deposit transactions`);
            console.log(`   2. Delete ${suspiciousWithdrawals.length} matching withdrawal transactions`);
            console.log(`   3. Total deposit amount to be removed from totals: ${totalSuspiciousDepositAmount.toFixed(2)} XAF`);
            console.log(`   4. Total withdrawal amount to be removed from totals: ${totalSuspiciousWithdrawalAmount.toFixed(2)} XAF`);
            console.log(`\n   NOTE: User balances will NOT be changed (they are already correct).`);
            console.log(`         These were failed withdrawal + refund pairs from the migration.\n`);
        } else {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🚀 Executing cleanup...');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            // Delete suspicious deposits
            const suspiciousDepositIds = suspiciousDeposits.map(d => d._id);
            const deleteDepositResult = await Transaction.deleteMany({
                _id: { $in: suspiciousDepositIds }
            });

            console.log(`   ✅ Deleted ${deleteDepositResult.deletedCount} suspicious deposits`);

            // Delete suspicious withdrawals
            const suspiciousWithdrawalIds = suspiciousWithdrawals.map(w => w._id);
            const deleteWithdrawalResult = await Transaction.deleteMany({
                _id: { $in: suspiciousWithdrawalIds }
            });

            console.log(`   ✅ Deleted ${deleteWithdrawalResult.deletedCount} matching withdrawals`);
            console.log(`\n   NOTE: User balances were NOT modified (already correct).\n`);
        }

        // Summary
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('📊 SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════\n');

        console.log(`   Total deposits analyzed: ${allDeposits.length}`);
        console.log(`   Total withdrawals analyzed: ${allWithdrawals.length}`);
        console.log(`   Legitimate deposits: ${legitimateDeposits.length}`);
        console.log(`   Legitimate withdrawals: ${legitimateWithdrawals.length}`);
        console.log(`   Suspicious deposits: ${suspiciousDeposits.length}`);
        console.log(`   Suspicious withdrawals: ${suspiciousWithdrawals.length}`);
        console.log(`   Total suspicious deposit amount: ${totalSuspiciousDepositAmount.toFixed(2)} XAF`);
        console.log(`   Total suspicious withdrawal amount: ${totalSuspiciousWithdrawalAmount.toFixed(2)} XAF`);
        console.log(`   Affected users: ${affectedUserIds.length}`);

        if (DRY_RUN) {
            console.log('\n   [DRY RUN] No changes were made.');
            console.log('   Run with --apply to execute the cleanup.\n');
        } else {
            console.log('\n   ✅ Cleanup completed successfully!\n');
        }

        console.log('═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        if (paymentConnection) {
            await paymentConnection.close();
            console.log('✅ Payment DB connection closed');
        }
    }
}

// Run the script
fixBizarreTransactions().then(() => {
    console.log('\n✨ Script complete!');
    process.exit(0);
}).catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
