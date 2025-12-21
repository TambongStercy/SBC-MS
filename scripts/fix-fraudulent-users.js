/**
 * Fix Fraudulent Users Script
 *
 * This script handles the cleanup of confirmed fraudulent user accounts:
 * 1. Deletes their fraudulent deposit transactions
 * 2. Deletes their fraudulent withdrawal transactions
 * 3. Resets their balance to their expected legitimate earnings
 *
 * CONFIRMED FRAUDULENT USERS (have few/no referrals but large withdrawals):
 * - 65d06c20644793ef52ca6e11 (Bemjamin Aime) - 1 referral, 0 subscribed, 478,582 XAF withdrawn
 * - 65d8934ca95f5692725ef543 (Batouri Julien) - 1 referral, 0 subscribed, 296,532 XAF withdrawn
 * - 65d09ec65c96a8ab00a6eb3d (Tchaleu Diane) - 0 referrals, 0 subscribed, 111,699 XAF withdrawn
 * - 669772d5b8a59e6c9725b76b (jessie momo) - 6 referrals, 3 subscribed, 95,950 XAF withdrawn
 * - 666ef2b14b08104253b26b6c (theophile steven) - 19 referrals, 3 subscribed, 95,101 XAF withdrawn
 * - 65d4ddea8ce5ffe48a44a8dd (mouhamed fadil) - 0 referrals, 0 subscribed, 71,750 XAF withdrawn
 *
 * Usage:
 *   DRY RUN:  node scripts/fix-fraudulent-users.js
 *   APPLY:    node scripts/fix-fraudulent-users.js --apply
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Configuration
const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';
const PAYMENT_DB_URI = process.env.PAYMENT_DB_URI || 'mongodb://localhost:27017/sbc_payment_dev';

// Fraudulent users to fix
const FRAUDULENT_USERS = [
    {
        userId: '65d06c20644793ef52ca6e11',
        name: 'Bemjamin Aime',
        expectedBalance: 0, // 0 subscribed referrals = 0 XAF
        reason: '1 referral, 0 subscribed, withdrew 478,582 XAF'
    },
    {
        userId: '65d8934ca95f5692725ef543',
        name: 'Batouri Julien',
        expectedBalance: 0, // 0 subscribed referrals = 0 XAF
        reason: '1 referral, 0 subscribed, withdrew 296,532 XAF'
    },
    {
        userId: '65d09ec65c96a8ab00a6eb3d',
        name: 'Tchaleu Diane',
        expectedBalance: 0, // 0 referrals = 0 XAF
        reason: '0 referrals, withdrew 111,699 XAF'
    },
    {
        userId: '669772d5b8a59e6c9725b76b',
        name: 'jessie momo',
        expectedBalance: 3000, // 3 subscribed L1 referrals = 3000 XAF
        reason: '6 referrals, 3 subscribed (all L1), withdrew 95,950 XAF'
    },
    {
        userId: '666ef2b14b08104253b26b6c',
        name: 'theophile steven',
        expectedBalance: 2500, // 14 L1 + 5 L2, but only 3 subscribed
        reason: '19 referrals, 3 subscribed, withdrew 95,101 XAF'
    },
    {
        userId: '65d4ddea8ce5ffe48a44a8dd',
        name: 'mouhamed fadil',
        expectedBalance: 0, // 0 referrals = 0 XAF
        reason: '0 referrals, withdrew 71,750 XAF'
    }
];

// Check if --apply flag is passed
const DRY_RUN = !process.argv.includes('--apply');

// Models
const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const transactionSchema = new mongoose.Schema({}, { strict: false, collection: 'transactions' });

async function fixFraudulentUsers() {
    let userConnection;
    let paymentConnection;

    try {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🔧 FRAUDULENT USERS CLEANUP SCRIPT');
        console.log('═══════════════════════════════════════════════════════════════\n');

        if (DRY_RUN) {
            console.log('⚠️  DRY RUN MODE - No changes will be made');
            console.log('    Run with --apply to actually make changes\n');
        } else {
            console.log('🚨 APPLY MODE - Changes WILL be made to the database!\n');
        }

        // Connect to databases
        console.log('🔗 Connecting to databases...\n');

        userConnection = await mongoose.createConnection(USER_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('   ✅ Connected to User DB');

        paymentConnection = await mongoose.createConnection(PAYMENT_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('   ✅ Connected to Payment DB\n');

        const User = userConnection.model('User', userSchema);
        const Transaction = paymentConnection.model('Transaction', transactionSchema);

        // Track totals
        let totalTransactionsDeleted = 0;
        let totalDepositsDeleted = 0;
        let totalWithdrawalsDeleted = 0;
        let totalAmountCleaned = 0;

        // Process each fraudulent user
        for (const fraudUser of FRAUDULENT_USERS) {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`👤 Processing: ${fraudUser.name}`);
            console.log(`   User ID: ${fraudUser.userId}`);
            console.log(`   Reason: ${fraudUser.reason}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            const userId = new mongoose.Types.ObjectId(fraudUser.userId);

            // Get current user state
            const user = await User.findById(userId).lean();
            if (!user) {
                console.log('   ❌ User not found!\n');
                continue;
            }

            console.log(`   Current Balance: ${user.balance || 0} XAF`);
            console.log(`   Expected Balance: ${fraudUser.expectedBalance} XAF\n`);

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

            console.log(`   📥 Deposits: ${deposits.length} transactions, ${depositTotal.toFixed(2)} XAF`);
            console.log(`   📤 Withdrawals: ${withdrawals.length} transactions, ${withdrawalTotal.toFixed(2)} XAF\n`);

            if (DRY_RUN) {
                console.log('   [DRY RUN] Would delete:');
                console.log(`      - ${deposits.length} deposit transactions`);
                console.log(`      - ${withdrawals.length} withdrawal transactions`);
                console.log(`      - Reset balance from ${user.balance || 0} to ${fraudUser.expectedBalance} XAF\n`);
            } else {
                // Delete all deposit transactions
                const depositResult = await Transaction.deleteMany({
                    userId: userId,
                    type: 'deposit'
                });
                console.log(`   ✅ Deleted ${depositResult.deletedCount} deposit transactions`);

                // Delete all withdrawal transactions
                const withdrawalResult = await Transaction.deleteMany({
                    userId: userId,
                    type: 'withdrawal'
                });
                console.log(`   ✅ Deleted ${withdrawalResult.deletedCount} withdrawal transactions`);

                // Reset user balance
                await User.updateOne(
                    { _id: userId },
                    { $set: { balance: fraudUser.expectedBalance } }
                );
                console.log(`   ✅ Reset balance to ${fraudUser.expectedBalance} XAF\n`);

                totalDepositsDeleted += depositResult.deletedCount;
                totalWithdrawalsDeleted += withdrawalResult.deletedCount;
                totalTransactionsDeleted += depositResult.deletedCount + withdrawalResult.deletedCount;
                totalAmountCleaned += depositTotal + withdrawalTotal;
            }
        }

        // Summary
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('📊 SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════\n');

        console.log(`   Users Processed: ${FRAUDULENT_USERS.length}`);

        if (DRY_RUN) {
            console.log('\n   [DRY RUN] No changes were made.');
            console.log('   Run with --apply to execute the cleanup.\n');
        } else {
            console.log(`   Deposits Deleted: ${totalDepositsDeleted}`);
            console.log(`   Withdrawals Deleted: ${totalWithdrawalsDeleted}`);
            console.log(`   Total Transactions Deleted: ${totalTransactionsDeleted}`);
            console.log(`   Total Amount Cleaned: ${totalAmountCleaned.toFixed(2)} XAF\n`);
        }

        console.log('═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        if (userConnection) {
            await userConnection.close();
            console.log('✅ User DB connection closed');
        }
        if (paymentConnection) {
            await paymentConnection.close();
            console.log('✅ Payment DB connection closed');
        }
    }
}

// Run the script
fixFraudulentUsers().then(() => {
    console.log('\n✨ Script complete!');
    process.exit(0);
}).catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
