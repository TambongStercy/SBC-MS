/**
 * Analyze Suspicious Deposit Transactions
 *
 * This script analyzes deposit transactions for high-severity OVER_EARNED users
 * to identify deposits that don't match the expected referral commission amounts.
 *
 * Legitimate deposit amounts:
 * - 1000 XAF (Level 1 referral commission)
 * - 500 XAF (Level 2 referral commission)
 * - 250 XAF (Level 3 referral commission)
 * - 2150, 5300, 3150 (activation balance transfers)
 *
 * Suspicious patterns:
 * - Amounts like 20200, 10100, 3030, 5050 (look like withdrawals + 10% fee)
 * - Large deposits that don't match commission structure
 *
 * Usage: node scripts/analyze-suspicious-deposits.js
 */

const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

// Configuration
const PAYMENT_DB_URI = process.env.PAYMENT_DB_URI || 'mongodb://localhost:27017/sbc_payment_dev';
const REPORT_FILE = './balance-inconsistencies-report.json';
const OUTPUT_FILE = './suspicious-deposits-report.json';

// Legitimate amounts that should appear in deposits
const LEGITIMATE_AMOUNTS = {
    // Referral commissions
    1000: 'Level 1 Referral Commission',
    500: 'Level 2 Referral Commission',
    250: 'Level 3 Referral Commission',

    // Activation balance transfers (from activation-pricing.ts)
    2150: 'CLASSIQUE Activation Transfer',
    5300: 'CIBLE Activation Transfer',
    3150: 'UPGRADE Activation Transfer',
};

// Tolerance for floating point comparison
const AMOUNT_TOLERANCE = 1;

// Models
const transactionSchema = new mongoose.Schema({}, { strict: false, collection: 'transactions' });

/**
 * Check if an amount is legitimate (matches expected commission/transfer amounts)
 */
function isLegitimateAmount(amount) {
    for (const [legitAmount, description] of Object.entries(LEGITIMATE_AMOUNTS)) {
        if (Math.abs(amount - Number(legitAmount)) <= AMOUNT_TOLERANCE) {
            return { isLegit: true, description };
        }
    }
    return { isLegit: false, description: null };
}

/**
 * Check if amount matches the withdrawal + 10% pattern
 * (e.g., 20200 = 20000 + 10%, 3030 = 3000 + 10%)
 */
function looksLikeWithdrawalPlusFee(amount) {
    // If amount / 1.1 gives a round number (or close to it), it's suspicious
    const baseAmount = amount / 1.1;
    const roundedBase = Math.round(baseAmount);

    // Check if the base is a round number (divisible by 10, 100, or 1000)
    if (Math.abs(baseAmount - roundedBase) < 1) {
        // Check if it's divisible by common round numbers
        if (roundedBase % 1000 === 0 || roundedBase % 500 === 0 || roundedBase % 100 === 0) {
            return {
                suspicious: true,
                likelyWithdrawalAmount: roundedBase,
                calculatedWithFee: roundedBase * 1.1
            };
        }
    }

    return { suspicious: false };
}

async function analyzeSuspiciousDeposits() {
    let paymentConnection;

    try {
        console.log('🔗 Connecting to Payment Service database...\n');

        paymentConnection = await mongoose.createConnection(PAYMENT_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('✅ Connected to Payment Service DB\n');

        const Transaction = paymentConnection.model('Transaction', transactionSchema);

        // Read the balance inconsistencies report
        console.log('📄 Reading balance inconsistencies report...\n');
        const reportData = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));

        // Filter for HIGH severity OVER_EARNED users
        const highSeverityUsers = reportData.inconsistencies.filter(
            u => u.type === 'OVER_EARNED' && u.severity === 'HIGH'
        );

        console.log(`Found ${highSeverityUsers.length} HIGH severity OVER_EARNED users\n`);
        console.log('📊 Analyzing deposit transactions...\n');

        const results = [];
        let processedCount = 0;

        for (const user of highSeverityUsers) {
            processedCount++;

            if (processedCount % 10 === 0) {
                console.log(`   Progress: ${processedCount}/${highSeverityUsers.length}`);
            }

            // Get all deposit transactions for this user
            // Convert string userId to ObjectId for query
            const deposits = await Transaction.find({
                userId: new mongoose.Types.ObjectId(user.userId),
                type: 'deposit',
                currency: 'XAF'
                // Don't filter by status - include ALL deposits
            }).sort({ createdAt: 1 }).lean();

            if (deposits.length === 0) {
                continue;
            }

            // Analyze each deposit
            const suspiciousDeposits = [];
            const legitimateDeposits = [];
            let totalSuspiciousAmount = 0;

            for (const deposit of deposits) {
                const amount = deposit.amount || 0;
                const legitCheck = isLegitimateAmount(amount);
                const withdrawalCheck = looksLikeWithdrawalPlusFee(amount);

                if (legitCheck.isLegit) {
                    legitimateDeposits.push({
                        amount,
                        description: legitCheck.description,
                        date: deposit.createdAt,
                        status: deposit.status,
                        transactionId: deposit.transactionId || deposit._id.toString()
                    });
                } else {
                    // This is a suspicious deposit
                    suspiciousDeposits.push({
                        amount,
                        date: deposit.createdAt,
                        status: deposit.status,
                        transactionId: deposit.transactionId || deposit._id.toString(),
                        description: deposit.description || 'N/A',
                        metadata: deposit.metadata || {},
                        paymentProvider: deposit.paymentProvider || null,
                        withdrawalPattern: withdrawalCheck.suspicious ? {
                            likelyWithdrawalAmount: withdrawalCheck.likelyWithdrawalAmount,
                            calculatedWithFee: withdrawalCheck.calculatedWithFee
                        } : null
                    });

                    if (deposit.status === 'completed') {
                        totalSuspiciousAmount += amount;
                    }
                }
            }

            if (suspiciousDeposits.length > 0) {
                results.push({
                    userId: user.userId,
                    name: user.name,
                    email: user.email,
                    phoneNumber: user.phoneNumber,
                    discrepancy: parseFloat(user.discrepancy),
                    totalDeposits: deposits.length,
                    suspiciousDeposits: suspiciousDeposits.length,
                    legitimateDeposits: legitimateDeposits.length,
                    totalSuspiciousAmount,
                    suspiciousTransactions: suspiciousDeposits,
                    legitimateTransactions: legitimateDeposits.slice(0, 5) // Just show first 5 legitimate ones
                });
            }
        }

        console.log(`   Progress: ${processedCount}/${highSeverityUsers.length}`);
        console.log('\n   ✅ Analysis complete!\n');

        // Sort by total suspicious amount descending
        results.sort((a, b) => b.totalSuspiciousAmount - a.totalSuspiciousAmount);

        // Generate report
        const report = {
            generatedAt: new Date().toISOString(),
            summary: {
                totalUsersAnalyzed: highSeverityUsers.length,
                usersWithSuspiciousDeposits: results.length,
                totalSuspiciousDepositsFound: results.reduce((sum, r) => sum + r.suspiciousDeposits, 0),
                totalSuspiciousAmount: results.reduce((sum, r) => sum + r.totalSuspiciousAmount, 0)
            },
            suspiciousUsers: results
        };

        // Save to file
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

        // Display summary
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🚨 SUSPICIOUS DEPOSITS ANALYSIS REPORT');
        console.log('═══════════════════════════════════════════════════════════════\n');

        console.log('📈 SUMMARY:');
        console.log(`   Total HIGH severity users analyzed: ${report.summary.totalUsersAnalyzed}`);
        console.log(`   Users with suspicious deposits:     ${report.summary.usersWithSuspiciousDeposits}`);
        console.log(`   Total suspicious deposits found:    ${report.summary.totalSuspiciousDepositsFound}`);
        console.log(`   Total suspicious amount:            ${report.summary.totalSuspiciousAmount.toFixed(2)} XAF\n`);

        // Display top 20 users with most suspicious deposits
        console.log('🔝 TOP 20 USERS WITH MOST SUSPICIOUS DEPOSITS:\n');

        results.slice(0, 20).forEach((user, index) => {
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`#${index + 1} - ${user.name}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`User ID:                  ${user.userId}`);
            console.log(`Email:                    ${user.email}`);
            console.log(`Phone:                    ${user.phoneNumber}`);
            console.log(`Account Discrepancy:      ${user.discrepancy.toFixed(2)} XAF`);
            console.log();
            console.log(`Total Deposits:           ${user.totalDeposits}`);
            console.log(`Suspicious Deposits:      ${user.suspiciousDeposits}`);
            console.log(`Legitimate Deposits:      ${user.legitimateDeposits}`);
            console.log(`Total Suspicious Amount:  ${user.totalSuspiciousAmount.toFixed(2)} XAF`);
            console.log();

            // Show first 10 suspicious transactions
            console.log('🚩 Sample Suspicious Deposits:');
            user.suspiciousTransactions.slice(0, 10).forEach((txn, i) => {
                console.log(`   ${i + 1}. ${txn.amount.toFixed(2)} XAF - ${new Date(txn.date).toLocaleDateString()} [${txn.status}]`);
                if (txn.withdrawalPattern) {
                    console.log(`      ⚠️ Matches withdrawal pattern: ${txn.withdrawalPattern.likelyWithdrawalAmount} XAF + 10% fee`);
                }
                console.log(`      Desc: ${txn.description.substring(0, 80)}${txn.description.length > 80 ? '...' : ''}`);
                console.log(`      TxID: ${txn.transactionId}`);
            });

            console.log();
        });

        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`📄 Full report exported to: ${OUTPUT_FILE}`);
        console.log('═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        if (paymentConnection) {
            await paymentConnection.close();
            console.log('✅ Payment Service DB connection closed');
        }
    }
}

// Run the script
analyzeSuspiciousDeposits().then(() => {
    console.log('\n✨ Analysis complete!');
    process.exit(0);
}).catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
