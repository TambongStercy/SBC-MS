/**
 * Balance Inconsistency Analysis Script
 *
 * This script identifies users whose actual lifetime earnings don't match
 * their expected earnings based on referral commissions.
 *
 * Logic:
 * - Referral earnings: Lvl1 = 1000 XAF, Lvl2 = 500 XAF, Lvl3 = 250 XAF
 * - Expected lifetime earnings = Sum of all referral commissions
 * - Actual lifetime earnings = Current balance + Sum of all withdrawal amounts
 * - Flag users with significant discrepancies
 *
 * Usage: node scripts/analyze-balance-inconsistencies.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Configuration
const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';
const PAYMENT_DB_URI = process.env.PAYMENT_DB_URI || 'mongodb://localhost:27017/sbc_payment_dev';

// Referral commission rates (in XAF)
const REFERRAL_COMMISSIONS = {
    1: 1000,  // Level 1
    2: 500,   // Level 2
    3: 250    // Level 3
};

// Discrepancy threshold (in XAF)
const DISCREPANCY_THRESHOLD = 5000; // Flag if difference is >= 5000 XAF

// Models
const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const subscriptionSchema = new mongoose.Schema({}, { strict: false, collection: 'subscriptions' });
const referralSchema = new mongoose.Schema({}, { strict: false, collection: 'referrals' });
const transactionSchema = new mongoose.Schema({}, { strict: false, collection: 'transactions' });

async function analyzeBalanceInconsistencies() {
    let userConnection;
    let paymentConnection;

    try {
        console.log('🔗 Connecting to databases...\n');

        // Connect to databases
        userConnection = await mongoose.createConnection(USER_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('✅ Connected to User Service DB');

        paymentConnection = await mongoose.createConnection(PAYMENT_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('✅ Connected to Payment Service DB\n');

        // Get models
        const User = userConnection.model('User', userSchema);
        const Subscription = userConnection.model('Subscription', subscriptionSchema);
        const Referral = userConnection.model('Referral', referralSchema);
        const Transaction = paymentConnection.model('Transaction', transactionSchema);

        console.log('📊 Step 1: Finding all subscribed users...\n');

        // Get ALL users with CLASSIQUE or CIBLE subscriptions
        // Don't filter by category since it was added after many users registered
        // Don't filter by status to include all users who ever subscribed
        const subscribedUsers = await Subscription.find({
            subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] }
        }).distinct('user');

        console.log(`   Found ${subscribedUsers.length} users with CLASSIQUE/CIBLE subscriptions\n`);

        // Convert to strings for easier comparison
        const subscribedUserIds = subscribedUsers.map(id => id.toString());
        const usersToAnalyze = subscribedUsers;

        console.log(`   Analyzing all ${usersToAnalyze.length} subscribed users...\n`);

        console.log('📊 Step 2: Calculating expected vs actual earnings...\n');

        const inconsistencies = [];
        let processedCount = 0;

        for (const userId of usersToAnalyze) {
            processedCount++;
            if (processedCount % 50 === 0 || processedCount === usersToAnalyze.length) {
                process.stdout.write(`   Progress: ${processedCount}/${usersToAnalyze.length}\r`);
            }

            // Get user details
            const user = await User.findById(userId).lean();
            if (!user) continue;

            // STEP 1: Calculate EXPECTED lifetime earnings from referrals
            // Get all referrals for this user
            const referrals = await Referral.find({
                referrer: userId,
                archived: false
            }).lean();

            let expectedEarnings = 0;

            // For each referral, check if they're subscribed and calculate commission
            for (const referral of referrals) {
                const isReferredUserSubscribed = subscribedUserIds.includes(
                    referral.referredUser.toString()
                );

                if (isReferredUserSubscribed) {
                    const commission = REFERRAL_COMMISSIONS[referral.referralLevel] || 0;
                    expectedEarnings += commission;
                }
            }

            // STEP 2: Calculate ACTUAL lifetime earnings
            // Actual = Current balance + Total withdrawals
            const currentBalance = user.balance || 0;

            // Get all completed withdrawal transactions
            const withdrawals = await Transaction.find({
                userId: userId,
                type: 'withdrawal',
                status: 'completed',
                currency: 'XAF'
            }).lean();

            const totalWithdrawals = withdrawals.reduce((sum, tx) => {
                return sum + (tx.amount || 0);
            }, 0);

            const actualEarnings = currentBalance + totalWithdrawals;

            // STEP 3: Calculate discrepancy
            const discrepancy = actualEarnings - expectedEarnings;
            const discrepancyPercentage = expectedEarnings > 0
                ? ((discrepancy / expectedEarnings) * 100).toFixed(2)
                : 'N/A';

            // Only flag if discrepancy exceeds threshold
            if (Math.abs(discrepancy) >= DISCREPANCY_THRESHOLD) {
                const subscribedReferralsCount = referrals.filter(r =>
                    subscribedUserIds.includes(r.referredUser.toString())
                ).length;

                inconsistencies.push({
                    userId: user._id.toString(),
                    name: user.name,
                    email: user.email,
                    phoneNumber: user.phoneNumber,
                    role: user.role || 'user',
                    createdAt: user.createdAt,

                    // Referral data
                    totalReferrals: referrals.length,
                    subscribedReferrals: subscribedReferralsCount,
                    referralsByLevel: {
                        lvl1: referrals.filter(r => r.referralLevel === 1).length,
                        lvl2: referrals.filter(r => r.referralLevel === 2).length,
                        lvl3: referrals.filter(r => r.referralLevel === 3).length
                    },

                    // Financial data
                    currentBalance: currentBalance.toFixed(2),
                    totalWithdrawals: totalWithdrawals.toFixed(2),
                    withdrawalCount: withdrawals.length,

                    // Earnings comparison
                    expectedEarnings: expectedEarnings.toFixed(2),
                    actualEarnings: actualEarnings.toFixed(2),
                    discrepancy: discrepancy.toFixed(2),
                    discrepancyPercentage,

                    // Classification
                    type: discrepancy > 0 ? 'OVER_EARNED' : 'UNDER_EARNED',
                    severity: Math.abs(discrepancy) >= 20000 ? 'HIGH' :
                             Math.abs(discrepancy) >= 10000 ? 'MEDIUM' : 'LOW'
                });
            }
        }

        console.log(`\n   ✅ Analysis complete!\n`);

        // Sort by absolute discrepancy (highest first)
        inconsistencies.sort((a, b) =>
            Math.abs(parseFloat(b.discrepancy)) - Math.abs(parseFloat(a.discrepancy))
        );

        // Display results
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🚨 BALANCE INCONSISTENCY REPORT');
        console.log('═══════════════════════════════════════════════════════════════\n');

        console.log(`Total Users Analyzed: ${usersToAnalyze.length}`);
        console.log(`Inconsistencies Found: ${inconsistencies.length}\n`);

        if (inconsistencies.length === 0) {
            console.log('✅ No significant balance inconsistencies found!\n');
        } else {
            // Summary statistics
            const overEarned = inconsistencies.filter(u => u.type === 'OVER_EARNED');
            const underEarned = inconsistencies.filter(u => u.type === 'UNDER_EARNED');
            const highSeverity = inconsistencies.filter(u => u.severity === 'HIGH');

            console.log('📈 SUMMARY:');
            console.log(`   Over-earned: ${overEarned.length} users (have more than expected)`);
            console.log(`   Under-earned: ${underEarned.length} users (have less than expected)`);
            console.log(`   High severity: ${highSeverity.length} users (discrepancy >= 20,000 XAF)\n`);

            // Display detailed results
            inconsistencies.forEach((user, index) => {
                console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`#${index + 1} - ${user.name} [${user.severity} SEVERITY]`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`User ID:           ${user.userId}`);
                console.log(`Email:             ${user.email}`);
                console.log(`Phone:             ${user.phoneNumber || 'N/A'}`);
                console.log(`Role:              ${user.role}`);
                console.log(`Created:           ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}`);

                console.log(`\n👥 REFERRAL DATA:`);
                console.log(`   Total Referrals:       ${user.totalReferrals}`);
                console.log(`   Subscribed Referrals:  ${user.subscribedReferrals}`);
                console.log(`   By Level:              L1=${user.referralsByLevel.lvl1}, L2=${user.referralsByLevel.lvl2}, L3=${user.referralsByLevel.lvl3}`);

                console.log(`\n💰 FINANCIAL DATA:`);
                console.log(`   Current Balance:       ${user.currentBalance} XAF`);
                console.log(`   Total Withdrawals:     ${user.totalWithdrawals} XAF (${user.withdrawalCount} txns)`);

                console.log(`\n📊 EARNINGS ANALYSIS:`);
                console.log(`   Expected Earnings:     ${user.expectedEarnings} XAF (from referrals)`);
                console.log(`   Actual Earnings:       ${user.actualEarnings} XAF (balance + withdrawals)`);
                console.log(`   Discrepancy:           ${user.discrepancy} XAF (${user.discrepancyPercentage}%)`);
                console.log(`   Classification:        ${user.type === 'OVER_EARNED' ? '⚠️ OVER-EARNED' : '⚠️ UNDER-EARNED'}`);

                if (user.type === 'OVER_EARNED') {
                    console.log(`\n🚩 This user has ${user.discrepancy} XAF MORE than expected from referrals.`);
                    console.log(`   Possible reasons: Manual credits, bonuses, or other income sources.`);
                } else {
                    console.log(`\n🚩 This user has ${Math.abs(parseFloat(user.discrepancy))} XAF LESS than expected from referrals.`);
                    console.log(`   Possible reasons: Untracked withdrawals, fees, or system errors.`);
                }
            });

            console.log('\n\n═══════════════════════════════════════════════════════════════');
            console.log('📄 DETAILED BREAKDOWN');
            console.log('═══════════════════════════════════════════════════════════════\n');

            // Export to JSON
            const fs = require('fs');
            const outputPath = './balance-inconsistencies-report.json';
            fs.writeFileSync(outputPath, JSON.stringify({
                generatedAt: new Date().toISOString(),
                configuration: {
                    referralCommissions: REFERRAL_COMMISSIONS,
                    discrepancyThreshold: DISCREPANCY_THRESHOLD
                },
                summary: {
                    totalUsersAnalyzed: usersToAnalyze.length,
                    inconsistenciesFound: inconsistencies.length,
                    overEarnedCount: overEarned.length,
                    underEarnedCount: underEarned.length,
                    highSeverityCount: highSeverity.length
                },
                inconsistencies
            }, null, 2));

            console.log(`📄 Full report exported to: ${outputPath}\n`);
        }

        console.log('═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        // Close connections
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
analyzeBalanceInconsistencies().then(() => {
    console.log('\n✨ Analysis complete!');
    process.exit(0);
}).catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
