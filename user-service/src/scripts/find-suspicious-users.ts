/**
 * Script to find suspicious user accounts
 *
 * Detects accounts where balance doesn't match expected earnings from referrals
 * Criteria:
 * - Calculate expected earnings from referral subscriptions
 * - Compare with actual balance
 * - Flag accounts with unexplained high balances
 *
 * Commission Structure (XAF):
 * - Classique (2000 XAF base): Level 1: 1000 XAF, Level 2: 500 XAF, Level 3: 250 XAF
 * - Cible (5000 XAF base): Level 1: 2500 XAF, Level 2: 1250 XAF, Level 3: 625 XAF
 */

import mongoose from 'mongoose';
import User, { IUser } from '../database/models/user.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import config from '../config';
import logger from '../utils/logger';

interface SuspiciousUser {
    userId: string;
    name: string;
    email: string;
    phoneNumber: string;
    actualBalance: number;
    expectedEarnings: number;
    discrepancy: number;
    discrepancyPercent: number;
    directReferrals: number;
    level2Referrals: number;
    level3Referrals: number;
    totalReferrals: number;
    classiqueSubscribers: number;
    cibleSubscribers: number;
    accountCreated: Date;
    breakdown: {
        classiqueEarnings: number;
        cibleEarnings: number;
        totalExpectedFromReferrals: number;
    };
}

interface ReferralEarnings {
    classique: {
        level1: number;
        level2: number;
        level3: number;
        total: number;
    };
    cible: {
        level1: number;
        level2: number;
        level3: number;
        total: number;
    };
    grandTotal: number;
}

// Commission rates in XAF
const COMMISSIONS = {
    CLASSIQUE: {
        LEVEL1: 1000,
        LEVEL2: 500,
        LEVEL3: 250
    },
    CIBLE: {
        LEVEL1: 2500,
        LEVEL2: 1250,
        LEVEL3: 625
    }
};

async function connectDB() {
    try {
        await mongoose.connect(config.mongodb.uri);
        logger.info('[Script] Connected to MongoDB');
    } catch (error) {
        logger.error(`[Script] Database connection error: ${error}`);
        throw error;
    }
}

/**
 * Get active subscription type for a user (CLASSIQUE or CIBLE)
 * Returns null if user has no active registration subscription
 */
async function getActiveSubscriptionType(userId: string): Promise<'classique' | 'cible' | null> {
    try {
        const subscription = await SubscriptionModel.findOne({
            user: userId,
            status: SubscriptionStatus.ACTIVE,
            category: 'registration', // Only count registration subscriptions (CLASSIQUE/CIBLE)
            endDate: { $gt: new Date() } // Ensure not expired
        }).lean();

        if (!subscription) {
            return null;
        }

        // Map subscription type to lowercase for consistency
        if (subscription.subscriptionType === SubscriptionType.CLASSIQUE) {
            return 'classique';
        } else if (subscription.subscriptionType === SubscriptionType.CIBLE) {
            return 'cible';
        }

        return null;
    } catch (error) {
        logger.error(`[Script] Error getting subscription for user ${userId}:`, error);
        return null;
    }
}

/**
 * Calculate expected earnings from referrals
 */
async function calculateExpectedEarnings(userId: string): Promise<ReferralEarnings> {
    const earnings: ReferralEarnings = {
        classique: { level1: 0, level2: 0, level3: 0, total: 0 },
        cible: { level1: 0, level2: 0, level3: 0, total: 0 },
        grandTotal: 0
    };

    try {
        // Level 1: Direct referrals
        const level1Referrals = await User.find({ referredBy: userId }).lean();

        for (const referral of level1Referrals) {
            // Check subscription status
            const subscriptionType = await getActiveSubscriptionType(referral._id.toString());
            if (subscriptionType === 'classique') {
                earnings.classique.level1 += COMMISSIONS.CLASSIQUE.LEVEL1;
            } else if (subscriptionType === 'cible') {
                earnings.cible.level1 += COMMISSIONS.CIBLE.LEVEL1;
            }
        }

        // Level 2: Referrals of direct referrals
        if (level1Referrals.length > 0) {
            const level1Ids = level1Referrals.map(r => r._id.toString());
            const level2Referrals = await User.find({
                referredBy: { $in: level1Ids }
            }).lean();

            for (const referral of level2Referrals) {
                const subscriptionType = await getActiveSubscriptionType(referral._id.toString());
                if (subscriptionType === 'classique') {
                    earnings.classique.level2 += COMMISSIONS.CLASSIQUE.LEVEL2;
                } else if (subscriptionType === 'cible') {
                    earnings.cible.level2 += COMMISSIONS.CIBLE.LEVEL2;
                }
            }

            // Level 3: Referrals of level 2 referrals
            if (level2Referrals.length > 0) {
                const level2Ids = level2Referrals.map(r => r._id.toString());
                const level3Referrals = await User.find({
                    referredBy: { $in: level2Ids }
                }).lean();

                for (const referral of level3Referrals) {
                    const subscriptionType = await getActiveSubscriptionType(referral._id.toString());
                    if (subscriptionType === 'classique') {
                        earnings.classique.level3 += COMMISSIONS.CLASSIQUE.LEVEL3;
                    } else if (subscriptionType === 'cible') {
                        earnings.cible.level3 += COMMISSIONS.CIBLE.LEVEL3;
                    }
                }
            }
        }

        // Calculate totals
        earnings.classique.total = earnings.classique.level1 + earnings.classique.level2 + earnings.classique.level3;
        earnings.cible.total = earnings.cible.level1 + earnings.cible.level2 + earnings.cible.level3;
        earnings.grandTotal = earnings.classique.total + earnings.cible.total;

    } catch (error) {
        logger.error(`[Script] Error calculating earnings for ${userId}:`, error);
    }

    return earnings;
}

/**
 * Count referrals at each level
 */
async function countReferralsByLevel(userId: string): Promise<{
    level1: number;
    level2: number;
    level3: number;
    classiqueSubscribers: number;
    cibleSubscribers: number;
}> {
    try {
        // Level 1
        const level1Referrals = await User.find({ referredBy: userId }).lean();
        const level1Count = level1Referrals.length;

        let classiqueCount = 0;
        let cibleCount = 0;

        // Count subscriptions at all levels
        for (const referral of level1Referrals) {
            const subscriptionType = await getActiveSubscriptionType(referral._id.toString());
            if (subscriptionType === 'classique') classiqueCount++;
            else if (subscriptionType === 'cible') cibleCount++;
        }

        // Level 2
        let level2Count = 0;
        let level3Count = 0;

        if (level1Referrals.length > 0) {
            const level1Ids = level1Referrals.map(r => r._id.toString());
            const level2Referrals = await User.find({
                referredBy: { $in: level1Ids }
            }).lean();
            level2Count = level2Referrals.length;

            for (const referral of level2Referrals) {
                const subscriptionType = await getActiveSubscriptionType(referral._id.toString());
                if (subscriptionType === 'classique') classiqueCount++;
                else if (subscriptionType === 'cible') cibleCount++;
            }

            // Level 3
            if (level2Referrals.length > 0) {
                const level2Ids = level2Referrals.map(r => r._id.toString());
                const level3Referrals = await User.find({
                    referredBy: { $in: level2Ids }
                }).lean();
                level3Count = level3Referrals.length;

                for (const referral of level3Referrals) {
                    const subscriptionType = await getActiveSubscriptionType(referral._id.toString());
                    if (subscriptionType === 'classique') classiqueCount++;
                    else if (subscriptionType === 'cible') cibleCount++;
                }
            }
        }

        return {
            level1: level1Count,
            level2: level2Count,
            level3: level3Count,
            classiqueSubscribers: classiqueCount,
            cibleSubscribers: cibleCount
        };
    } catch (error) {
        logger.error(`[Script] Error counting referrals for ${userId}:`, error);
        return { level1: 0, level2: 0, level3: 0, classiqueSubscribers: 0, cibleSubscribers: 0 };
    }
}

async function findSuspiciousUsers(): Promise<SuspiciousUser[]> {
    try {
        logger.info('[Script] Searching for users with balance > 5000 XAF...');

        // Find users with significant balances
        const usersWithBalance = await User.find({
            balance: { $gt: 5000 }
        }).select('_id name email phoneNumber balance createdAt').lean();

        logger.info(`[Script] Found ${usersWithBalance.length} users with balance > 5000 XAF`);

        const suspiciousUsers: SuspiciousUser[] = [];
        let processedCount = 0;

        for (const user of usersWithBalance) {
            processedCount++;

            if (processedCount % 10 === 0) {
                logger.info(`[Script] Progress: ${processedCount}/${usersWithBalance.length} users processed`);
            }

            const userId = user._id.toString();
            const actualBalance = user.balance || 0;

            // Calculate expected earnings from referrals
            const earnings = await calculateExpectedEarnings(userId);
            const referralCounts = await countReferralsByLevel(userId);

            const expectedEarnings = earnings.grandTotal;
            const discrepancy = actualBalance - expectedEarnings;
            const discrepancyPercent = expectedEarnings > 0
                ? ((discrepancy / expectedEarnings) * 100)
                : (actualBalance > 0 ? 10000 : 0); // 10000% if no referrals but has balance

            // Flag as suspicious if:
            // 1. Balance > 10000 XAF AND discrepancy > 5000 XAF
            // 2. OR balance > 20000 XAF AND discrepancy > 50% of expected
            // 3. OR balance > 5000 XAF with ZERO active subscribed referrals
            const isSuspicious =
                (actualBalance > 10000 && discrepancy > 5000) ||
                (actualBalance > 20000 && discrepancyPercent > 50) ||
                (actualBalance > 5000 && referralCounts.classiqueSubscribers === 0 && referralCounts.cibleSubscribers === 0);

            if (isSuspicious) {
                suspiciousUsers.push({
                    userId,
                    name: user.name,
                    email: user.email,
                    phoneNumber: user.phoneNumber,
                    actualBalance,
                    expectedEarnings,
                    discrepancy,
                    discrepancyPercent,
                    directReferrals: referralCounts.level1,
                    level2Referrals: referralCounts.level2,
                    level3Referrals: referralCounts.level3,
                    totalReferrals: referralCounts.level1 + referralCounts.level2 + referralCounts.level3,
                    classiqueSubscribers: referralCounts.classiqueSubscribers,
                    cibleSubscribers: referralCounts.cibleSubscribers,
                    accountCreated: user.createdAt,
                    breakdown: {
                        classiqueEarnings: earnings.classique.total,
                        cibleEarnings: earnings.cible.total,
                        totalExpectedFromReferrals: earnings.grandTotal
                    }
                });
            }
        }

        logger.info(`[Script] Found ${suspiciousUsers.length} suspicious users`);
        return suspiciousUsers;
    } catch (error: any) {
        logger.error(`[Script] Error finding suspicious users: ${error}`);
        throw error;
    }
}

function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function generateReport(users: SuspiciousUser[]): void {
    console.log('\n===========================================');
    console.log('SUSPICIOUS USERS REPORT');
    console.log('===========================================');
    console.log(`Detection Criteria:`);
    console.log(`  - Balance > 10,000 XAF with discrepancy > 5,000 XAF`);
    console.log(`  - OR Balance > 20,000 XAF with discrepancy > 50%`);
    console.log(`  - OR Balance > 5,000 XAF with ZERO subscribed referrals`);
    console.log(`\nTotal Suspicious Users Found: ${users.length}`);
    console.log('===========================================\n');

    if (users.length === 0) {
        console.log('No suspicious users found.');
        return;
    }

    // Sort by discrepancy (highest first)
    const sortedUsers = users.sort((a, b) => b.discrepancy - a.discrepancy);

    // Calculate statistics
    const totalActualBalance = sortedUsers.reduce((sum, user) => sum + user.actualBalance, 0);
    const totalExpected = sortedUsers.reduce((sum, user) => sum + user.expectedEarnings, 0);
    const totalDiscrepancy = sortedUsers.reduce((sum, user) => sum + user.discrepancy, 0);

    console.log('STATISTICS:');
    console.log(`  Total Actual Balance: ${totalActualBalance.toLocaleString('fr-FR')} XAF`);
    console.log(`  Total Expected Earnings: ${totalExpected.toLocaleString('fr-FR')} XAF`);
    console.log(`  Total Discrepancy: ${totalDiscrepancy.toLocaleString('fr-FR')} XAF`);
    console.log(`  Average Discrepancy: ${(totalDiscrepancy / users.length).toLocaleString('fr-FR')} XAF`);
    console.log('\n');

    // Print table header
    console.log('DETAILED LIST:');
    console.log('─'.repeat(180));
    console.log(
        'Name'.padEnd(25) +
        'Email'.padEnd(30) +
        'Balance'.padEnd(15) +
        'Expected'.padEnd(15) +
        'Discrepancy'.padEnd(15) +
        'Diff%'.padEnd(10) +
        'Refs'.padEnd(8) +
        'Classique'.padEnd(10) +
        'Cible'.padEnd(8) +
        'Created'
    );
    console.log('─'.repeat(180));

    // Print each user
    sortedUsers.forEach((user) => {
        const balanceStr = `${user.actualBalance.toLocaleString('fr-FR')} XAF`;
        const expectedStr = `${user.expectedEarnings.toLocaleString('fr-FR')} XAF`;
        const discrepancyStr = `${user.discrepancy.toLocaleString('fr-FR')} XAF`;
        const discrepancyPctStr = user.discrepancyPercent > 1000
            ? '>1000%'
            : `${user.discrepancyPercent.toFixed(0)}%`;

        console.log(
            `${user.name.substring(0, 24).padEnd(25)}` +
            `${user.email.substring(0, 29).padEnd(30)}` +
            `${balanceStr.padEnd(15)}` +
            `${expectedStr.padEnd(15)}` +
            `${discrepancyStr.padEnd(15)}` +
            `${discrepancyPctStr.padEnd(10)}` +
            `${user.totalReferrals.toString().padEnd(8)}` +
            `${user.classiqueSubscribers.toString().padEnd(10)}` +
            `${user.cibleSubscribers.toString().padEnd(8)}` +
            `${formatDate(user.accountCreated)}`
        );
    });

    console.log('─'.repeat(180));
    console.log('\n');

    // HIGH RISK: Users with zero subscribers
    const zeroSubscribers = sortedUsers.filter(u => u.classiqueSubscribers === 0 && u.cibleSubscribers === 0);
    if (zeroSubscribers.length > 0) {
        console.log('⚠️  CRITICAL: Users with ZERO subscribed referrals but high balance:');
        console.log('─'.repeat(180));
        zeroSubscribers.forEach(user => {
            console.log(`  ${user.name} (${user.email})`);
            console.log(`    Balance: ${user.actualBalance.toLocaleString('fr-FR')} XAF`);
            console.log(`    Referrals: ${user.totalReferrals} (but none are subscribed)`);
            console.log(`    Account age: ${formatDate(user.accountCreated)}`);
            console.log('');
        });
        console.log('─'.repeat(180));
        console.log('\n');
    }

    // Breakdown by discrepancy range
    console.log('BREAKDOWN BY DISCREPANCY:');
    const ranges = [
        { label: '> 50,000 XAF', min: 50000, max: Infinity },
        { label: '20,000 - 50,000 XAF', min: 20000, max: 50000 },
        { label: '10,000 - 20,000 XAF', min: 10000, max: 20000 },
        { label: '5,000 - 10,000 XAF', min: 5000, max: 10000 },
        { label: '< 5,000 XAF', min: 0, max: 5000 }
    ];

    ranges.forEach(range => {
        const usersInRange = sortedUsers.filter(u => u.discrepancy >= range.min && u.discrepancy < range.max);
        if (usersInRange.length > 0) {
            const totalInRange = usersInRange.reduce((sum, u) => sum + u.discrepancy, 0);
            console.log(`  ${range.label}: ${usersInRange.length} users (${totalInRange.toLocaleString('fr-FR')} XAF)`);
        }
    });

    console.log('\n');
}

function generateCSV(users: SuspiciousUser[]): string {
    const headers = [
        'User ID',
        'Name',
        'Email',
        'Phone',
        'Actual Balance (XAF)',
        'Expected Earnings (XAF)',
        'Discrepancy (XAF)',
        'Discrepancy %',
        'Direct Referrals',
        'Level 2 Referrals',
        'Level 3 Referrals',
        'Total Referrals',
        'Classique Subscribers',
        'Cible Subscribers',
        'Classique Earnings',
        'Cible Earnings',
        'Account Created'
    ];

    const rows = users.map(user => [
        user.userId,
        user.name,
        user.email,
        user.phoneNumber,
        user.actualBalance.toString(),
        user.expectedEarnings.toString(),
        user.discrepancy.toString(),
        user.discrepancyPercent.toFixed(2),
        user.directReferrals.toString(),
        user.level2Referrals.toString(),
        user.level3Referrals.toString(),
        user.totalReferrals.toString(),
        user.classiqueSubscribers.toString(),
        user.cibleSubscribers.toString(),
        user.breakdown.classiqueEarnings.toString(),
        user.breakdown.cibleEarnings.toString(),
        user.accountCreated.toISOString()
    ]);

    const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csv;
}

async function main() {
    try {
        // Connect to database
        await connectDB();

        // Find suspicious users
        const suspiciousUsers = await findSuspiciousUsers();

        // Generate console report
        generateReport(suspiciousUsers);

        // Generate CSV file
        if (suspiciousUsers.length > 0) {
            const csv = generateCSV(suspiciousUsers);
            const fs = require('fs');
            const path = require('path');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const filename = path.join(__dirname, `../../reports/suspicious-users-${timestamp}.csv`);

            // Create reports directory if it doesn't exist
            const reportsDir = path.join(__dirname, '../../reports');
            if (!fs.existsSync(reportsDir)) {
                fs.mkdirSync(reportsDir, { recursive: true });
            }

            fs.writeFileSync(filename, csv);
            logger.info(`[Script] CSV report saved to: ${filename}`);
            console.log(`\n📄 CSV Report saved to: ${filename}\n`);
        }

        // Close database connection
        await mongoose.connection.close();
        logger.info('[Script] Database connection closed');

        process.exit(0);
    } catch (error) {
        logger.error(`[Script] Fatal error: ${error}`);
        console.error('\n❌ Error:', error);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main();
}

export { findSuspiciousUsers, SuspiciousUser };
