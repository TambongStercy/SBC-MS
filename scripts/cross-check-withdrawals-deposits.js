/**
 * Cross-Check Withdrawals vs Suspicious Deposits
 *
 * This script checks if the suspicious deposits have corresponding withdrawal transactions.
 * It analyzes if each suspicious deposit matches a withdrawal (amount - 10% fee).
 *
 * For example:
 * - Suspicious deposit of 20200 XAF should have a withdrawal of ~20000 XAF
 * - Suspicious deposit of 10100 XAF should have a withdrawal of ~10000 XAF
 *
 * Usage: node scripts/cross-check-withdrawals-deposits.js
 */

const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

// Configuration
const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';
const PAYMENT_DB_URI = process.env.PAYMENT_DB_URI || 'mongodb://localhost:27017/sbc_payment_dev';
const SUSPICIOUS_DEPOSITS_REPORT = './suspicious-deposits-report.json';
const OUTPUT_FILE = './withdrawal-deposit-crosscheck-report.json';

// Models
const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const transactionSchema = new mongoose.Schema({}, { strict: false, collection: 'transactions' });

/**
 * The suspicious deposit amount SHOULD match a withdrawal exactly
 * (the deposit is the fraudulent copy of the withdrawal with 10% added)
 * Example: 6060 XAF deposit = 6060 XAF withdrawal (not 6060/1.1)
 */
function getWithdrawalAmountFromDeposit(depositAmount) {
    return depositAmount; // Exact match
}

async function crossCheckWithdrawalsAndDeposits() {
    let userConnection;
    let paymentConnection;

    try {
        console.log('🔗 Connecting to databases...\n');

        userConnection = await mongoose.createConnection(USER_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('✅ Connected to User Service DB');

        paymentConnection = await mongoose.createConnection(PAYMENT_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('✅ Connected to Payment Service DB\n');

        const User = userConnection.model('User', userSchema);
        const Transaction = paymentConnection.model('Transaction', transactionSchema);

        // Read the suspicious deposits report
        console.log('📄 Reading suspicious deposits report...\n');
        const suspiciousReport = JSON.parse(fs.readFileSync(SUSPICIOUS_DEPOSITS_REPORT, 'utf8'));

        const usersWithSuspiciousDeposits = suspiciousReport.suspiciousUsers;
        console.log(`Found ${usersWithSuspiciousDeposits.length} users with suspicious deposits\n`);

        console.log('📊 Cross-checking withdrawals and deposits...\n');

        const results = [];
        let processedCount = 0;

        for (const user of usersWithSuspiciousDeposits) {
            processedCount++;

            if (processedCount % 10 === 0) {
                console.log(`   Progress: ${processedCount}/${usersWithSuspiciousDeposits.length}`);
            }

            const userId = new mongoose.Types.ObjectId(user.userId);

            // Get ALL withdrawal transactions for this user
            const withdrawals = await Transaction.find({
                userId: userId,
                type: 'withdrawal',
                currency: 'XAF'
            }).sort({ createdAt: 1 }).lean();

            // Get current balance from user service database
            const userDoc = await User.findById(userId).select('balance usdBalance activationBalance').lean();

            // Calculate statistics
            const completedWithdrawals = withdrawals.filter(w => w.status === 'completed');
            const totalWithdrawalAmount = completedWithdrawals.reduce((sum, w) => sum + (w.amount || 0), 0);
            const totalSuspiciousDepositAmount = user.totalSuspiciousAmount;

            // Try to match suspicious deposits with withdrawals
            const suspiciousDeposits = user.suspiciousTransactions;
            let matchedCount = 0;
            let unmatchedDeposits = [];

            for (const deposit of suspiciousDeposits) {
                const expectedWithdrawalAmount = getWithdrawalAmountFromDeposit(deposit.amount);

                // Look for a withdrawal with matching amount (within tolerance)
                const matchingWithdrawal = withdrawals.find(w =>
                    Math.abs((w.amount || 0) - expectedWithdrawalAmount) < 10
                );

                if (matchingWithdrawal) {
                    matchedCount++;
                } else {
                    unmatchedDeposits.push({
                        depositAmount: deposit.amount,
                        expectedWithdrawalAmount: Math.round(expectedWithdrawalAmount),
                        date: deposit.date,
                        transactionId: deposit.transactionId
                    });
                }
            }

            // Analyze the discrepancy
            const netImpact = totalSuspiciousDepositAmount - totalWithdrawalAmount;

            results.push({
                userId: user.userId,
                name: user.name,
                email: user.email,
                phoneNumber: user.phoneNumber,
                accountDiscrepancy: user.discrepancy,
                suspiciousDeposits: {
                    count: user.suspiciousDeposits,
                    totalAmount: totalSuspiciousDepositAmount
                },
                withdrawals: {
                    total: withdrawals.length,
                    completed: completedWithdrawals.length,
                    totalAmount: totalWithdrawalAmount
                },
                matching: {
                    matched: matchedCount,
                    unmatched: suspiciousDeposits.length - matchedCount,
                    unmatchedSample: unmatchedDeposits.slice(0, 10)
                },
                currentBalance: userDoc?.balance || 0,
                netImpact: netImpact,
                analysis: netImpact > 0
                    ? `User gained ${netImpact.toFixed(2)} XAF (more deposits than withdrawals)`
                    : netImpact < 0
                    ? `User lost ${Math.abs(netImpact).toFixed(2)} XAF (more withdrawals than deposits)`
                    : 'Balanced (deposits = withdrawals)'
            });
        }

        console.log(`   Progress: ${processedCount}/${usersWithSuspiciousDeposits.length}`);
        console.log('\n   ✅ Analysis complete!\n');

        // Sort by current balance FIRST (highest balances at top), then by net impact
        results.sort((a, b) => {
            // First priority: current balance (descending)
            if (Math.abs(b.currentBalance - a.currentBalance) > 100) {
                return b.currentBalance - a.currentBalance;
            }
            // Second priority: net impact (descending)
            return b.netImpact - a.netImpact;
        });

        // Generate summary statistics
        const summary = {
            totalUsersAnalyzed: results.length,
            totalSuspiciousDeposits: results.reduce((sum, r) => sum + r.suspiciousDeposits.count, 0),
            totalSuspiciousDepositAmount: results.reduce((sum, r) => sum + r.suspiciousDeposits.totalAmount, 0),
            totalWithdrawalAmount: results.reduce((sum, r) => sum + r.withdrawals.totalAmount, 0),
            totalCurrentBalance: results.reduce((sum, r) => sum + r.currentBalance, 0),
            netImpactTotal: results.reduce((sum, r) => sum + r.netImpact, 0),
            usersWithGains: results.filter(r => r.netImpact > 0).length,
            usersWithLosses: results.filter(r => r.netImpact < 0).length,
            usersBalanced: results.filter(r => Math.abs(r.netImpact) < 100).length
        };

        // Generate report
        const report = {
            generatedAt: new Date().toISOString(),
            summary,
            users: results
        };

        // Save to file
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

        // Display results
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🔍 WITHDRAWAL-DEPOSIT CROSS-CHECK REPORT');
        console.log('═══════════════════════════════════════════════════════════════\n');

        console.log('📈 SUMMARY:');
        console.log(`   Total Users Analyzed:              ${summary.totalUsersAnalyzed}`);
        console.log(`   Total Suspicious Deposits:         ${summary.totalSuspiciousDeposits}`);
        console.log(`   Total Suspicious Deposit Amount:   ${summary.totalSuspiciousDepositAmount.toFixed(2)} XAF`);
        console.log(`   Total Withdrawal Amount:           ${summary.totalWithdrawalAmount.toFixed(2)} XAF`);
        console.log(`   Total Current Balances:            ${summary.totalCurrentBalance.toFixed(2)} XAF`);
        console.log(`   Net Impact (Deposits - Withdrawals): ${summary.netImpactTotal.toFixed(2)} XAF`);
        console.log();
        console.log(`   Users with Net Gains:              ${summary.usersWithGains}`);
        console.log(`   Users with Net Losses:             ${summary.usersWithLosses}`);
        console.log(`   Users Balanced:                    ${summary.usersBalanced}`);
        console.log();

        // Display top 20 users (sorted by balance first, then net impact)
        console.log('🔝 TOP 20 USERS (Sorted by Current Balance, then Net Impact):\n');

        results.slice(0, 20).forEach((user, index) => {
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`#${index + 1} - ${user.name}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`User ID:                  ${user.userId}`);
            console.log(`Email:                    ${user.email}`);
            console.log(`Phone:                    ${user.phoneNumber}`);
            console.log();
            console.log(`💰 FINANCIAL DATA:`);
            console.log(`   Current Balance:          ${user.currentBalance.toFixed(2)} XAF`);
            console.log(`   Account Discrepancy:      ${user.accountDiscrepancy.toFixed(2)} XAF`);
            console.log();
            console.log(`📥 SUSPICIOUS DEPOSITS:`);
            console.log(`   Count:                    ${user.suspiciousDeposits.count}`);
            console.log(`   Total Amount:             ${user.suspiciousDeposits.totalAmount.toFixed(2)} XAF`);
            console.log();
            console.log(`📤 WITHDRAWALS:`);
            console.log(`   Total Transactions:       ${user.withdrawals.total}`);
            console.log(`   Completed:                ${user.withdrawals.completed}`);
            console.log(`   Total Amount:             ${user.withdrawals.totalAmount.toFixed(2)} XAF`);
            console.log();
            console.log(`🔍 MATCHING:`);
            console.log(`   Matched Deposits:         ${user.matching.matched}`);
            console.log(`   Unmatched Deposits:       ${user.matching.unmatched}`);
            console.log();
            console.log(`📊 NET IMPACT:`);
            if (user.netImpact > 0) {
                console.log(`   ⚠️ USER GAINED: ${user.netImpact.toFixed(2)} XAF`);
                console.log(`   (More suspicious deposits than withdrawals)`);
            } else if (user.netImpact < 0) {
                console.log(`   ⚠️ USER LOST: ${Math.abs(user.netImpact).toFixed(2)} XAF`);
                console.log(`   (More withdrawals than suspicious deposits)`);
            } else {
                console.log(`   ✅ BALANCED (Deposits ≈ Withdrawals)`);
            }
            console.log();

            if (user.matching.unmatchedSample.length > 0) {
                console.log(`🚩 Sample Unmatched Deposits (no matching withdrawal found):`);
                user.matching.unmatchedSample.slice(0, 5).forEach((deposit, i) => {
                    console.log(`   ${i + 1}. ${deposit.depositAmount.toFixed(2)} XAF (looking for exact match withdrawal)`);
                    console.log(`      Date: ${new Date(deposit.date).toLocaleDateString()}`);
                });
                console.log();
            }
        });

        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`📄 Full report exported to: ${OUTPUT_FILE}`);
        console.log('═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        if (userConnection) {
            await userConnection.close();
            console.log('✅ User Service DB connection closed');
        }
        if (paymentConnection) {
            await paymentConnection.close();
            console.log('✅ Payment Service DB connection closed');
        }
    }
}

// Run the script
crossCheckWithdrawalsAndDeposits().then(() => {
    console.log('\n✨ Analysis complete!');
    process.exit(0);
}).catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
