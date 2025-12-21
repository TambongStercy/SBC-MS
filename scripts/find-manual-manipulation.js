/**
 * Find Users with Manual Account Manipulation
 *
 * This script identifies users who may have bypassed the referral system by
 * manually depositing into their accounts and withdrawing money.
 *
 * Criteria:
 * - Less than 20 total referrals (not just subscribed referrals)
 * - More than 50,000 XAF in completed withdrawals
 *
 * These users may have accessed the system and deposited manually without
 * proper referral earnings to justify their withdrawal amounts.
 *
 * Usage: node scripts/find-manual-manipulation.js
 */

const fs = require('fs');

// Configuration
const BALANCE_REPORT_FILE = './balance-inconsistencies-report.json';
const OUTPUT_FILE = './manual-manipulation-report.json';

// Thresholds
const MAX_REFERRALS = 20;
const MIN_WITHDRAWALS = 50000;

async function findManualManipulation() {
    try {
        console.log('📄 Reading balance inconsistencies report...\n');

        // Read the existing balance report
        const balanceReport = JSON.parse(fs.readFileSync(BALANCE_REPORT_FILE, 'utf8'));
        const allUsers = balanceReport.inconsistencies;

        console.log(`   Found ${allUsers.length} users with balance inconsistencies\n`);
        console.log('📊 Filtering for manual manipulation indicators...\n');
        console.log(`   Criteria: <${MAX_REFERRALS} referrals AND >${MIN_WITHDRAWALS.toLocaleString()} XAF withdrawals\n`);

        const results = [];

        for (const user of allUsers) {
            const totalReferrals = user.totalReferrals || 0;
            const totalWithdrawals = parseFloat(user.totalWithdrawals) || 0;

            // Apply our filtering criteria
            if (totalReferrals < MAX_REFERRALS && totalWithdrawals > MIN_WITHDRAWALS) {
                const currentBalance = parseFloat(user.currentBalance) || 0;
                const expectedEarnings = parseFloat(user.expectedEarnings) || 0;
                const actualEarnings = parseFloat(user.actualEarnings) || 0;
                const discrepancy = parseFloat(user.discrepancy) || 0;

                results.push({
                    userId: user.userId,
                    name: user.name,
                    email: user.email,
                    phoneNumber: user.phoneNumber,
                    role: user.role,
                    createdAt: user.createdAt,
                    currentBalance: currentBalance,
                    totalReferrals: totalReferrals,
                    referralsByLevel: user.referralsByLevel,
                    subscribedReferrals: user.subscribedReferrals,
                    expectedEarnings: expectedEarnings,
                    actualEarnings: actualEarnings,
                    discrepancy: discrepancy,
                    withdrawals: {
                        count: user.withdrawalCount,
                        totalAmount: totalWithdrawals
                    },
                    suspicionScore: calculateSuspicionScore(
                        totalReferrals,
                        user.subscribedReferrals,
                        totalWithdrawals,
                        discrepancy
                    )
                });
            }
        }

        console.log(`   ✅ Found ${results.length} users matching criteria!\n`);

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
            totalDiscrepancy: results.reduce((sum, r) => sum + r.discrepancy, 0),
            usersWithZeroReferrals: results.filter(r => r.totalReferrals === 0).length,
            usersWithZeroSubscribedReferrals: results.filter(r => r.subscribedReferrals === 0).length,
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
        console.log('🚨 MANUAL MANIPULATION DETECTION REPORT');
        console.log('═══════════════════════════════════════════════════════════════\n');

        console.log('📈 SUMMARY:');
        console.log(`   Total Users Analyzed:              ${summary.totalUsersAnalyzed.toLocaleString()}`);
        console.log(`   Flagged Users:                     ${summary.flaggedUsers.toLocaleString()}`);
        console.log(`   Criteria:                          <${MAX_REFERRALS} referrals AND >${MIN_WITHDRAWALS.toLocaleString()} XAF withdrawals`);
        console.log();
        console.log(`   Total Withdrawals (Flagged):       ${summary.totalWithdrawals.toFixed(2)} XAF`);
        console.log(`   Total Current Balances (Flagged):  ${summary.totalCurrentBalance.toFixed(2)} XAF`);
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
            console.log();
            console.log(`👥 REFERRAL DATA:`);
            console.log(`   Total Referrals:          ${user.totalReferrals}`);
            if (user.referralsByLevel) {
                console.log(`   By Level:                 L1=${user.referralsByLevel.lvl1 || 0}, L2=${user.referralsByLevel.lvl2 || 0}, L3=${user.referralsByLevel.lvl3 || 0}`);
            }
            console.log(`   Subscribed Referrals:     ${user.subscribedReferrals}`);
            console.log();
            console.log(`📊 EARNINGS ANALYSIS:`);
            console.log(`   Expected Earnings:        ${user.expectedEarnings.toFixed(2)} XAF`);
            console.log(`   Actual Earnings:          ${user.actualEarnings.toFixed(2)} XAF`);
            console.log(`   Discrepancy:              ${user.discrepancy.toFixed(2)} XAF`);
            console.log();
            console.log(`🚨 SUSPICION SCORE: ${user.suspicionScore}/100`);
            console.log(`   ${getSuspicionLevel(user.suspicionScore)}`);
            console.log();
        });

        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`📄 Full report exported to: ${OUTPUT_FILE}`);
        console.log('═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
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
findManualManipulation().then(() => {
    console.log('\n✨ Analysis complete!');
    process.exit(0);
}).catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
