/**
 * Find Users with Manual Account Manipulation (Detailed Analysis)
 *
 * This script identifies users who may have bypassed the referral system by
 * manually depositing into their accounts and withdrawing money.
 *
 * Enhanced version that includes:
 * - Detailed breakdown of subscribed referrals by level
 * - Commission calculation based on subscription type and referral level
 * - CLASSIQUE subscriptions: 1000 XAF (L1), 500 XAF (L2), 250 XAF (L3)
 * - CIBLE subscriptions: Same rates
 *
 * Criteria:
 * - Less than 20 total referrals (not just subscribed referrals)
 * - More than 50,000 XAF in completed withdrawals
 *
 * Usage: node scripts/find-manual-manipulation-detailed.js
 */

const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

// Configuration
const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';
const BALANCE_REPORT_FILE = './balance-inconsistencies-report.json';
const OUTPUT_FILE = './manual-manipulation-detailed-report.json';

// Referral commission rates (in XAF) - same for both CLASSIQUE and CIBLE
const REFERRAL_COMMISSIONS = {
    1: 1000,  // Level 1
    2: 500,   // Level 2
    3: 250    // Level 3
};

// Thresholds
const MAX_REFERRALS = 20;
const MIN_WITHDRAWALS = 50000;

// Models
const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const referralSchema = new mongoose.Schema({}, { strict: false, collection: 'referrals' });
const subscriptionSchema = new mongoose.Schema({}, { strict: false, collection: 'subscriptions' });

async function findManualManipulationDetailed() {
    let userConnection;

    try {
        console.log('📄 Reading balance inconsistencies report...\n');

        // Read the existing balance report
        const balanceReport = JSON.parse(fs.readFileSync(BALANCE_REPORT_FILE, 'utf8'));
        const allUsers = balanceReport.inconsistencies;

        console.log(`   Found ${allUsers.length} users with balance inconsistencies\n`);
        console.log('📊 Filtering for manual manipulation indicators...\n');
        console.log(`   Criteria: <${MAX_REFERRALS} referrals AND >${MIN_WITHDRAWALS.toLocaleString()} XAF withdrawals\n`);

        // Filter users based on criteria
        const flaggedUsers = allUsers.filter(user => {
            const totalReferrals = user.totalReferrals || 0;
            const totalWithdrawals = parseFloat(user.totalWithdrawals) || 0;
            return totalReferrals < MAX_REFERRALS && totalWithdrawals > MIN_WITHDRAWALS;
        });

        console.log(`   ✅ Found ${flaggedUsers.length} users matching criteria!\n`);
        console.log('🔗 Connecting to database for detailed analysis...\n');

        // Connect to database to get detailed referral and subscription data
        userConnection = await mongoose.createConnection(USER_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('✅ Connected to User Service DB\n');

        const Referral = userConnection.model('Referral', referralSchema);
        const Subscription = userConnection.model('Subscription', subscriptionSchema);

        console.log('📊 Analyzing detailed referral and subscription data...\n');

        const results = [];
        let processedCount = 0;

        for (const user of flaggedUsers) {
            processedCount++;

            if (processedCount % 5 === 0) {
                console.log(`   Progress: ${processedCount}/${flaggedUsers.length}`);
            }

            const userId = new mongoose.Types.ObjectId(user.userId);

            // Get all referrals made by this user
            const referrals = await Referral.find({
                referrer: userId,
                archived: false
            }).lean();

            // Get detailed subscription info for each referred user
            const subscribedReferralsDetailed = [];
            let totalExpectedCommissions = 0;

            for (const referral of referrals) {
                const referredUserId = referral.referredUser;

                // Check if this referred user has an active subscription
                const subscription = await Subscription.findOne({
                    user: referredUserId,
                    subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] }
                }).lean();

                if (subscription) {
                    const level = referral.referralLevel;
                    const commission = REFERRAL_COMMISSIONS[level] || 0;
                    totalExpectedCommissions += commission;

                    subscribedReferralsDetailed.push({
                        referredUserId: referredUserId.toString(),
                        referralLevel: level,
                        subscriptionType: subscription.subscriptionType,
                        subscriptionStatus: subscription.status,
                        commission: commission,
                        startDate: subscription.startDate,
                        endDate: subscription.endDate
                    });
                }
            }

            // Group subscribed referrals by level and subscription type
            const referralBreakdown = {
                level1: {
                    classique: subscribedReferralsDetailed.filter(r => r.referralLevel === 1 && r.subscriptionType === 'CLASSIQUE').length,
                    cible: subscribedReferralsDetailed.filter(r => r.referralLevel === 1 && r.subscriptionType === 'CIBLE').length,
                    total: subscribedReferralsDetailed.filter(r => r.referralLevel === 1).length,
                    expectedCommission: subscribedReferralsDetailed.filter(r => r.referralLevel === 1).length * REFERRAL_COMMISSIONS[1]
                },
                level2: {
                    classique: subscribedReferralsDetailed.filter(r => r.referralLevel === 2 && r.subscriptionType === 'CLASSIQUE').length,
                    cible: subscribedReferralsDetailed.filter(r => r.referralLevel === 2 && r.subscriptionType === 'CIBLE').length,
                    total: subscribedReferralsDetailed.filter(r => r.referralLevel === 2).length,
                    expectedCommission: subscribedReferralsDetailed.filter(r => r.referralLevel === 2).length * REFERRAL_COMMISSIONS[2]
                },
                level3: {
                    classique: subscribedReferralsDetailed.filter(r => r.referralLevel === 3 && r.subscriptionType === 'CLASSIQUE').length,
                    cible: subscribedReferralsDetailed.filter(r => r.referralLevel === 3 && r.subscriptionType === 'CIBLE').length,
                    total: subscribedReferralsDetailed.filter(r => r.referralLevel === 3).length,
                    expectedCommission: subscribedReferralsDetailed.filter(r => r.referralLevel === 3).length * REFERRAL_COMMISSIONS[3]
                }
            };

            const currentBalance = parseFloat(user.currentBalance) || 0;
            const totalWithdrawals = parseFloat(user.totalWithdrawals) || 0;
            const actualEarnings = currentBalance + totalWithdrawals;
            const discrepancy = actualEarnings - totalExpectedCommissions;

            results.push({
                userId: user.userId,
                name: user.name,
                email: user.email,
                phoneNumber: user.phoneNumber,
                role: user.role,
                createdAt: user.createdAt,
                currentBalance: currentBalance,
                totalReferrals: user.totalReferrals || 0,
                subscribedReferrals: {
                    total: subscribedReferralsDetailed.length,
                    byLevel: referralBreakdown,
                    details: subscribedReferralsDetailed.slice(0, 10) // Keep first 10 for sample
                },
                expectedCommissions: {
                    total: totalExpectedCommissions,
                    level1: referralBreakdown.level1.expectedCommission,
                    level2: referralBreakdown.level2.expectedCommission,
                    level3: referralBreakdown.level3.expectedCommission
                },
                actualEarnings: actualEarnings,
                discrepancy: discrepancy,
                withdrawals: {
                    count: user.withdrawalCount,
                    totalAmount: totalWithdrawals
                },
                suspicionScore: calculateSuspicionScore(
                    user.totalReferrals || 0,
                    subscribedReferralsDetailed.length,
                    totalWithdrawals,
                    discrepancy
                )
            });
        }

        console.log(`   Progress: ${processedCount}/${flaggedUsers.length}`);
        console.log('\n   ✅ Detailed analysis complete!\n');

        // Sort by total withdrawals descending
        results.sort((a, b) => b.withdrawals.totalAmount - a.withdrawals.totalAmount);

        // Generate summary statistics
        const summary = {
            totalUsersAnalyzed: allUsers.length,
            flaggedUsers: results.length,
            criteria: {
                maxReferrals: MAX_REFERRALS,
                minWithdrawals: MIN_WITHDRAWALS
            },
            totalWithdrawals: results.reduce((sum, r) => sum + r.withdrawals.totalAmount, 0),
            totalCurrentBalance: results.reduce((sum, r) => sum + r.currentBalance, 0),
            totalExpectedCommissions: results.reduce((sum, r) => sum + r.expectedCommissions.total, 0),
            totalActualEarnings: results.reduce((sum, r) => sum + r.actualEarnings, 0),
            totalDiscrepancy: results.reduce((sum, r) => sum + r.discrepancy, 0),
            usersWithZeroReferrals: results.filter(r => r.totalReferrals === 0).length,
            usersWithZeroSubscribedReferrals: results.filter(r => r.subscribedReferrals.total === 0).length,
            highSuspicionUsers: results.filter(r => r.suspicionScore >= 80).length
        };

        // Generate report
        const report = {
            generatedAt: new Date().toISOString(),
            summary,
            flaggedUsers: results
        };

        // Save to file
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

        // Display results
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🚨 MANUAL MANIPULATION DETECTION REPORT (DETAILED)');
        console.log('═══════════════════════════════════════════════════════════════\n');

        console.log('📈 SUMMARY:');
        console.log(`   Total Users Analyzed:              ${summary.totalUsersAnalyzed.toLocaleString()}`);
        console.log(`   Flagged Users:                     ${summary.flaggedUsers.toLocaleString()}`);
        console.log(`   Criteria:                          <${MAX_REFERRALS} referrals AND >${MIN_WITHDRAWALS.toLocaleString()} XAF withdrawals`);
        console.log();
        console.log(`   Total Withdrawals (Flagged):       ${summary.totalWithdrawals.toFixed(2)} XAF`);
        console.log(`   Total Current Balances (Flagged):  ${summary.totalCurrentBalance.toFixed(2)} XAF`);
        console.log(`   Total Expected Commissions:        ${summary.totalExpectedCommissions.toFixed(2)} XAF`);
        console.log(`   Total Actual Earnings:             ${summary.totalActualEarnings.toFixed(2)} XAF`);
        console.log(`   Total Discrepancy:                 ${summary.totalDiscrepancy.toFixed(2)} XAF`);
        console.log();
        console.log(`   Users with 0 Referrals:            ${summary.usersWithZeroReferrals}`);
        console.log(`   Users with 0 Subscribed Referrals: ${summary.usersWithZeroSubscribedReferrals}`);
        console.log(`   High Suspicion Users (score ≥80):  ${summary.highSuspicionUsers}`);
        console.log();

        // Display top 30 flagged users
        console.log('🔝 TOP 30 FLAGGED USERS (Sorted by Withdrawal Amount):\n');

        results.slice(0, 30).forEach((user, index) => {
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`#${index + 1} - ${user.name}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`User ID:                  ${user.userId}`);
            console.log(`Email:                    ${user.email}`);
            console.log(`Phone:                    ${user.phoneNumber}`);
            console.log();
            console.log(`💰 FINANCIAL DATA:`);
            console.log(`   Current Balance:          ${user.currentBalance.toFixed(2)} XAF`);
            console.log(`   Total Withdrawals:        ${user.withdrawals.totalAmount.toFixed(2)} XAF (${user.withdrawals.count} transactions)`);
            console.log(`   Actual Earnings:          ${user.actualEarnings.toFixed(2)} XAF`);
            console.log();
            console.log(`👥 REFERRAL DATA:`);
            console.log(`   Total Referrals:          ${user.totalReferrals}`);
            console.log(`   Subscribed Referrals:     ${user.subscribedReferrals.total}`);
            console.log();
            console.log(`   Subscribed by Level & Type:`);
            console.log(`     Level 1: ${user.subscribedReferrals.byLevel.level1.total} (CLASSIQUE: ${user.subscribedReferrals.byLevel.level1.classique}, CIBLE: ${user.subscribedReferrals.byLevel.level1.cible})`);
            console.log(`     Level 2: ${user.subscribedReferrals.byLevel.level2.total} (CLASSIQUE: ${user.subscribedReferrals.byLevel.level2.classique}, CIBLE: ${user.subscribedReferrals.byLevel.level2.cible})`);
            console.log(`     Level 3: ${user.subscribedReferrals.byLevel.level3.total} (CLASSIQUE: ${user.subscribedReferrals.byLevel.level3.classique}, CIBLE: ${user.subscribedReferrals.byLevel.level3.cible})`);
            console.log();
            console.log(`💵 EXPECTED COMMISSIONS:`);
            console.log(`   Level 1 (${user.subscribedReferrals.byLevel.level1.total} × 1000):  ${user.expectedCommissions.level1.toFixed(2)} XAF`);
            console.log(`   Level 2 (${user.subscribedReferrals.byLevel.level2.total} × 500):   ${user.expectedCommissions.level2.toFixed(2)} XAF`);
            console.log(`   Level 3 (${user.subscribedReferrals.byLevel.level3.total} × 250):   ${user.expectedCommissions.level3.toFixed(2)} XAF`);
            console.log(`   ─────────────────────────────────`);
            console.log(`   TOTAL EXPECTED:           ${user.expectedCommissions.total.toFixed(2)} XAF`);
            console.log();
            console.log(`📊 DISCREPANCY ANALYSIS:`);
            console.log(`   Actual Earnings:          ${user.actualEarnings.toFixed(2)} XAF`);
            console.log(`   Expected Commissions:     ${user.expectedCommissions.total.toFixed(2)} XAF`);
            console.log(`   ─────────────────────────────────`);
            console.log(`   DISCREPANCY:              ${user.discrepancy.toFixed(2)} XAF`);

            if (user.discrepancy > 0) {
                const percentage = user.expectedCommissions.total > 0
                    ? ((user.discrepancy / user.expectedCommissions.total) * 100).toFixed(2)
                    : 'N/A';
                console.log(`   ⚠️ OVER-EARNED by ${user.discrepancy.toFixed(2)} XAF (${percentage}%)`);
            } else if (user.discrepancy < 0) {
                console.log(`   ℹ️ Under-earned by ${Math.abs(user.discrepancy).toFixed(2)} XAF`);
            }
            console.log();
            console.log(`🚨 SUSPICION SCORE: ${user.suspicionScore}/100`);
            console.log(`   ${getSuspicionLevel(user.suspicionScore)}`);
            console.log();

            // Show sample of subscribed referrals if any
            if (user.subscribedReferrals.details.length > 0) {
                console.log(`📋 Sample Subscribed Referrals (showing ${Math.min(5, user.subscribedReferrals.details.length)} of ${user.subscribedReferrals.total}):`);
                user.subscribedReferrals.details.slice(0, 5).forEach((ref, i) => {
                    console.log(`   ${i + 1}. Level ${ref.referralLevel} - ${ref.subscriptionType} (${ref.subscriptionStatus}) - Commission: ${ref.commission} XAF`);
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
    }
}

/**
 * Calculate a suspicion score (0-100) based on multiple factors
 */
function calculateSuspicionScore(totalReferrals, subscribedReferrals, totalWithdrawals, discrepancy) {
    let score = 0;

    // Factor 1: Number of referrals (lower = more suspicious)
    if (totalReferrals === 0) {
        score += 40;
    } else if (totalReferrals <= 5) {
        score += 30;
    } else if (totalReferrals <= 10) {
        score += 20;
    } else {
        score += 10;
    }

    // Factor 2: Subscribed referrals (lower = more suspicious)
    if (subscribedReferrals === 0) {
        score += 30;
    } else if (subscribedReferrals <= 3) {
        score += 20;
    } else {
        score += 10;
    }

    // Factor 3: Withdrawal amount (higher = more suspicious)
    if (totalWithdrawals >= 500000) {
        score += 20;
    } else if (totalWithdrawals >= 200000) {
        score += 15;
    } else if (totalWithdrawals >= 100000) {
        score += 10;
    } else {
        score += 5;
    }

    // Factor 4: Discrepancy (higher = more suspicious)
    if (discrepancy >= 200000) {
        score += 10;
    } else if (discrepancy >= 100000) {
        score += 7;
    } else if (discrepancy >= 50000) {
        score += 5;
    }

    return Math.min(score, 100);
}

/**
 * Get suspicion level description
 */
function getSuspicionLevel(score) {
    if (score >= 80) {
        return '🔴 CRITICAL - Very high likelihood of manual manipulation';
    } else if (score >= 60) {
        return '🟠 HIGH - Strong indicators of suspicious activity';
    } else if (score >= 40) {
        return '🟡 MEDIUM - Some suspicious indicators present';
    } else {
        return '🟢 LOW - May have alternative explanation';
    }
}

// Run the script
findManualManipulationDetailed().then(() => {
    console.log('\n✨ Analysis complete!');
    process.exit(0);
}).catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
