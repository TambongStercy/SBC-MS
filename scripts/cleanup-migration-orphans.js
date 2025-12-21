/**
 * Cleanup Migration Orphan Transactions
 *
 * This script removes the migration orphan transactions that are inflating the deposit totals.
 *
 * CONTEXT:
 * - Current deposits: ~93M XAF
 * - Expected deposits: ~70M XAF
 * - Excess to remove: ~23M XAF
 *
 * The bizarre transactions are from a migration issue. In the old system, when a withdrawal
 * failed, it would create a deposit to refund the user. During the DB/code migration, these
 * failed withdrawal + refund deposit pairs weren't marked as 'failed'.
 *
 * User balances are NOT affected - they are already correct. We just need to DELETE these
 * orphaned transactions to fix the dashboard totals.
 *
 * LEGITIMATE DEPOSIT AMOUNTS:
 * - 1000 XAF (Level 1 Referral Commission)
 * - 500 XAF (Level 2 Referral Commission)
 * - 250 XAF (Level 3 Referral Commission)
 * - 2150 XAF (CLASSIQUE Activation Transfer)
 * - 5300 XAF (CIBLE Activation Transfer)
 * - 3150 XAF (UPGRADE Activation Transfer)
 *
 * ADDITIONAL VALID VARIATIONS (rounding/fees):
 * - Amounts within 5% of legitimate amounts
 * - Common multiples of commissions (2000, 1500, 750, etc.)
 *
 * STRICTLY SUSPICIOUS (target for deletion):
 * - Round amounts like 6060, 5050, etc. that match withdrawal+10% patterns
 * - Amounts that have a matching withdrawal for the same user/amount
 *
 * Usage:
 *   DRY RUN:  node scripts/cleanup-migration-orphans.js
 *   APPLY:    node scripts/cleanup-migration-orphans.js --apply
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Configuration
const PAYMENT_DB_URI = process.env.PAYMENT_DB_URI || 'mongodb://localhost:27017/sbc_payment_dev';

// Legitimate deposit amounts with wider tolerance
const LEGITIMATE_AMOUNTS = [
    // Commissions with fee variations (up to 5%)
    { amount: 1000, tolerance: 50 },   // Level 1 (includes 960, 1010, etc.)
    { amount: 500, tolerance: 25 },    // Level 2 (includes 495, 505, etc.)
    { amount: 250, tolerance: 15 },    // Level 3 (includes 253, etc.)
    // Activation transfers
    { amount: 2150, tolerance: 100 },  // CLASSIQUE
    { amount: 5300, tolerance: 250 },  // CIBLE
    { amount: 3150, tolerance: 150 },  // UPGRADE
    // Common multiples (legitimate earning accumulations)
    { amount: 2000, tolerance: 100 },  // 2x L1
    { amount: 1500, tolerance: 75 },   // 1.5x L1 or 3x L2
    { amount: 750, tolerance: 40 },    // 1.5x L2 or 3x L3
    { amount: 1250, tolerance: 65 },   // L1 + L3
    { amount: 2500, tolerance: 125 },  // 2.5x L1 or 5x L2
    { amount: 3000, tolerance: 150 },  // 3x L1
    { amount: 4000, tolerance: 200 },  // 4x L1
    { amount: 5000, tolerance: 250 },  // 5x L1
];

// Users to EXCLUDE from cleanup (admin accounts for testing)
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
            return true;
        }
    }
    return false;
}

/**
 * Check if amount looks like a withdrawal refund (common patterns)
 * Pattern: The old system added 10% fee on withdrawals, so refunds are often withdrawal * 1.1
 */
function looksLikeWithdrawalRefund(amount) {
    // Common suspicious patterns from the data:
    // 1010, 2020, 3030, 5050, 6060, 10100 etc. (multiples of 1010)
    // These are withdrawal amounts + 10% fee that was refunded

    // Check if divisible by 101 (indicates x * 1.01 pattern)
    if (amount % 101 === 0 && amount > 1000) return true;

    // Check if divisible by 1010 (stronger pattern)
    if (amount % 1010 === 0 && amount >= 1010) return true;

    // Check if divisible by 505 (half of 1010)
    if (amount % 505 === 0 && amount >= 505 && amount !== 1010) return true;

    return false;
}

async function cleanupMigrationOrphans() {
    let connection;

    try {
        console.log('================================================================');
        console.log('MIGRATION ORPHAN CLEANUP SCRIPT');
        console.log('================================================================\n');

        if (DRY_RUN) {
            console.log('DRY RUN MODE - No changes will be made');
            console.log('Run with --apply to actually make changes\n');
        } else {
            console.log('APPLY MODE - Changes WILL be made to the database!\n');
        }

        // Connect to Payment DB
        console.log('Connecting to database...');
        connection = await mongoose.createConnection(PAYMENT_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('Connected to Payment DB\n');

        const Transaction = connection.model('Transaction', transactionSchema);

        // Convert excluded IDs to ObjectIds
        const excludedObjectIds = EXCLUDED_USER_IDS.map(id => new mongoose.Types.ObjectId(id));

        // Find all completed XAF deposits
        console.log('Analyzing deposits...');

        const allDeposits = await Transaction.find({
            type: 'deposit',
            currency: 'XAF',
            status: 'completed',
            userId: { $nin: excludedObjectIds }
        }).lean();

        console.log(`Total XAF deposits: ${allDeposits.length}`);

        // Find all completed XAF withdrawals
        const allWithdrawals = await Transaction.find({
            type: 'withdrawal',
            currency: 'XAF',
            status: 'completed',
            userId: { $nin: excludedObjectIds }
        }).lean();

        console.log(`Total XAF withdrawals: ${allWithdrawals.length}`);

        // Build withdrawal lookup map
        const withdrawalMap = new Map();
        for (const w of allWithdrawals) {
            const key = `${w.userId.toString()}_${w.amount}`;
            if (!withdrawalMap.has(key)) {
                withdrawalMap.set(key, []);
            }
            withdrawalMap.get(key).push(w);
        }

        // Categorize deposits
        const legitimateDeposits = [];
        const suspiciousDeposits = [];
        const matchedWithdrawals = new Set(); // Track which withdrawals are matched

        for (const deposit of allDeposits) {
            const userIdStr = deposit.userId.toString();
            const key = `${userIdStr}_${deposit.amount}`;

            // A deposit is suspicious if:
            // 1. It has a matching withdrawal (same user, same amount) - indicates refund
            // 2. AND it doesn't look like a legitimate commission amount
            const hasMatchingWithdrawal = withdrawalMap.has(key);
            const isLegit = isLegitimateAmount(deposit.amount);

            if (hasMatchingWithdrawal && !isLegit) {
                // This is likely a failed withdrawal refund
                suspiciousDeposits.push(deposit);

                // Mark the matching withdrawal as matched
                const matchingWithdrawals = withdrawalMap.get(key);
                if (matchingWithdrawals && matchingWithdrawals.length > 0) {
                    // Match one withdrawal per deposit
                    const w = matchingWithdrawals.find(mw => !matchedWithdrawals.has(mw._id.toString()));
                    if (w) {
                        matchedWithdrawals.add(w._id.toString());
                    }
                }
            } else {
                legitimateDeposits.push(deposit);
            }
        }

        console.log(`\nLegitimate deposits: ${legitimateDeposits.length}`);
        console.log(`Suspicious deposits (with matching withdrawals): ${suspiciousDeposits.length}`);

        // Get the actual matching withdrawals to delete
        const suspiciousWithdrawals = allWithdrawals.filter(w => matchedWithdrawals.has(w._id.toString()));

        // Calculate totals
        const totalLegitimateAmount = legitimateDeposits.reduce((sum, d) => sum + d.amount, 0);
        const totalSuspiciousDepositAmount = suspiciousDeposits.reduce((sum, d) => sum + d.amount, 0);
        const totalSuspiciousWithdrawalAmount = suspiciousWithdrawals.reduce((sum, w) => sum + w.amount, 0);

        // Show amount distribution of suspicious deposits
        console.log('\nTop suspicious deposit amounts:');
        const amountDistribution = {};
        for (const dep of suspiciousDeposits) {
            amountDistribution[dep.amount] = (amountDistribution[dep.amount] || 0) + 1;
        }
        const sortedAmounts = Object.entries(amountDistribution)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15);
        for (const [amount, count] of sortedAmounts) {
            console.log(`   ${parseFloat(amount).toFixed(0)} XAF: ${count} transactions`);
        }

        // Get unique affected users
        const affectedUserIds = [...new Set(suspiciousDeposits.map(d => d.userId.toString()))];

        // Summary before action
        console.log('\n================================================================');
        console.log('SUMMARY');
        console.log('================================================================');
        console.log(`Legitimate deposits: ${legitimateDeposits.length} (${totalLegitimateAmount.toLocaleString()} XAF)`);
        console.log(`Suspicious deposits to delete: ${suspiciousDeposits.length} (${totalSuspiciousDepositAmount.toLocaleString()} XAF)`);
        console.log(`Matching withdrawals to delete: ${suspiciousWithdrawals.length} (${totalSuspiciousWithdrawalAmount.toLocaleString()} XAF)`);
        console.log(`Affected users: ${affectedUserIds.length}`);
        console.log(`\nNOTE: User balances will NOT be changed (they are already correct).`);

        // Calculate projected impact
        const currentDeposits = 93406573; // From dashboard
        const projectedDeposits = currentDeposits - totalSuspiciousDepositAmount;
        console.log(`\nPROJECTED IMPACT:`);
        console.log(`   Current deposits: ${currentDeposits.toLocaleString()} XAF`);
        console.log(`   Deposits to remove: ${totalSuspiciousDepositAmount.toLocaleString()} XAF`);
        console.log(`   Projected deposits: ${projectedDeposits.toLocaleString()} XAF`);
        console.log(`   Target deposits: ~70,000,000 XAF`);

        if (DRY_RUN) {
            console.log('\n[DRY RUN] No changes were made.');
            console.log('Run with --apply to execute the cleanup.\n');
        } else {
            console.log('\n================================================================');
            console.log('EXECUTING CLEANUP...');
            console.log('================================================================\n');

            // Delete suspicious deposits
            const suspiciousDepositIds = suspiciousDeposits.map(d => d._id);
            const deleteDepositResult = await Transaction.deleteMany({
                _id: { $in: suspiciousDepositIds }
            });
            console.log(`Deleted ${deleteDepositResult.deletedCount} suspicious deposits`);

            // Delete matching withdrawals
            const suspiciousWithdrawalIds = suspiciousWithdrawals.map(w => w._id);
            const deleteWithdrawalResult = await Transaction.deleteMany({
                _id: { $in: suspiciousWithdrawalIds }
            });
            console.log(`Deleted ${deleteWithdrawalResult.deletedCount} matching withdrawals`);

            console.log('\nCLEANUP COMPLETED SUCCESSFULLY!');
            console.log(`Total transactions deleted: ${deleteDepositResult.deletedCount + deleteWithdrawalResult.deletedCount}`);
        }

        console.log('================================================================\n');

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    } finally {
        if (connection) {
            await connection.close();
            console.log('Database connection closed');
        }
    }
}

// Run the script
cleanupMigrationOrphans().then(() => {
    console.log('\nScript complete!');
    process.exit(0);
}).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
