/**
 * Script to find suspicious user accounts - OPTIMIZED VERSION
 *
 * NEW DETECTION LOGIC:
 * - Only checks users with at least ONE withdrawal transaction
 * - Simplified calculation:
 *   Expected = (Active Direct Referrals × 1000) + (Active Indirect Referrals × 375)
 * - Actual = Total Withdrawals + Current Balance
 * - Flags users with withdrawals but NO active subscription as highly suspicious
 *
 * OPTIMIZATIONS:
 * - Batch fetches all data upfront
 * - Uses aggregation pipelines
 * - Processes in memory instead of N+1 queries
 */

import mongoose from 'mongoose';
import User, { IUser } from '../database/models/user.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import ReferralModel from '../database/models/referral.model';
import config from '../config';
import logger from '../utils/logger';

// Transaction model from payment-service
interface ITransaction {
    _id: mongoose.Types.ObjectId;
    transactionId: string;
    userId: mongoose.Types.ObjectId;
    type: string;
    amount: number;
    currency: string;
    fee: number;
    status: string;
    deleted: boolean;
    createdAt: Date;
}

// Payment service connection
let paymentConnection: mongoose.Connection;
let TransactionModel: mongoose.Model<ITransaction>;

interface SuspiciousUser {
    userId: string;
    name: string;
    email: string;
    phoneNumber: string;
    hasActiveSubscription: boolean;
    currentBalance: number;
    totalWithdrawals: number;
    withdrawalCount: number;
    actualMoney: number;
    expectedEarnings: number;
    discrepancy: number;
    discrepancyPercent: number;
    activeDirectReferrals: number;
    activeIndirectReferrals: number;
    totalActiveReferrals: number;
    accountCreated: Date;
    suspicionLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    suspicionReasons: string[];
}

async function connectDatabases() {
    try {
        await mongoose.connect(config.mongodb.uri);
        logger.info('[Script] Connected to User Service MongoDB');

        // Automatically detect payment DB name from user service URI
        // Development: sbc_user_dev -> sbc_payment_dev
        // Production: sbc_users -> sbc_payment
        const paymentDbUri = config.mongodb.uri
            .replace('/sbc_user_dev', '/sbc_payment_dev')  // Development
            .replace('/sbc_users', '/sbc_payment');        // Production

        paymentConnection = await mongoose.createConnection(paymentDbUri).asPromise();
        logger.info('[Script] Connected to Payment Service MongoDB');

        const TransactionSchema = new mongoose.Schema({
            transactionId: String,
            userId: mongoose.Schema.Types.ObjectId,
            type: String,
            amount: Number,
            currency: String,
            fee: Number,
            status: String,
            deleted: { type: Boolean, default: false },
            createdAt: Date
        }, { collection: 'transactions' });

        TransactionModel = paymentConnection.model<ITransaction>('Transaction', TransactionSchema);
        logger.info('[Script] Transaction model initialized');

    } catch (error) {
        logger.error(`[Script] Database connection error: ${error}`);
        throw error;
    }
}

async function findSuspiciousUsers(): Promise<SuspiciousUser[]> {
    try {
        logger.info('[Script] Step 1: Fetching all withdrawal transactions...');

        // Get all withdrawal transactions grouped by user
        const withdrawalAggregation = await TransactionModel.aggregate([
            {
                $match: {
                    type: 'withdrawal',
                    status: { $in: ['completed', 'processing'] },
                    deleted: false
                }
            },
            {
                $group: {
                    _id: '$userId',
                    totalWithdrawals: { $sum: '$amount' },
                    withdrawalCount: { $sum: 1 }
                }
            }
        ]);

        const withdrawalMap = new Map<string, { total: number; count: number }>();
        const userIdsWithWithdrawals = withdrawalAggregation.map(w => {
            const userId = w._id.toString();
            withdrawalMap.set(userId, { total: w.totalWithdrawals, count: w.withdrawalCount });
            return new mongoose.Types.ObjectId(userId);
        });

        logger.info(`[Script] Found ${userIdsWithWithdrawals.length} users with withdrawals`);

        logger.info('[Script] Step 2: Fetching user data...');
        const users = await User.find({ _id: { $in: userIdsWithWithdrawals } })
            .select('_id name email phoneNumber balance createdAt')
            .lean();

        const userMap = new Map<string, any>();
        users.forEach(u => userMap.set(u._id.toString(), u));
        logger.info(`[Script] Loaded ${users.length} user records`);

        logger.info('[Script] Step 3: Fetching all active subscriptions...');
        const now = new Date();
        const activeSubscriptions = await SubscriptionModel.find({
            user: { $in: userIdsWithWithdrawals },
            status: SubscriptionStatus.ACTIVE,
            subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] },
            endDate: { $gt: now }
        }).select('user').lean();

        const usersWithActiveSubs = new Set<string>();
        activeSubscriptions.forEach(sub => usersWithActiveSubs.add(sub.user.toString()));
        logger.info(`[Script] Found ${activeSubscriptions.length} active subscriptions`);

        logger.info('[Script] Step 4: Fetching all referral relationships...');
        const allReferrals = await ReferralModel.find({
            referrer: { $in: userIdsWithWithdrawals },
            archived: false
        }).select('referrer referredUser referralLevel').lean();

        // Build referral maps
        const directReferralsMap = new Map<string, string[]>(); // referrer -> [referredUserIds]
        const indirectReferralsMap = new Map<string, string[]>();

        allReferrals.forEach(ref => {
            const referrerId = ref.referrer.toString();
            const referredUserId = ref.referredUser.toString();

            if (ref.referralLevel === 1) {
                if (!directReferralsMap.has(referrerId)) {
                    directReferralsMap.set(referrerId, []);
                }
                directReferralsMap.get(referrerId)!.push(referredUserId);
            } else if (ref.referralLevel === 2 || ref.referralLevel === 3) {
                if (!indirectReferralsMap.has(referrerId)) {
                    indirectReferralsMap.set(referrerId, []);
                }
                indirectReferralsMap.get(referrerId)!.push(referredUserId);
            }
        });

        logger.info(`[Script] Mapped ${allReferrals.length} referral relationships`);

        logger.info('[Script] Step 5: Fetching all referral subscriptions...');
        // Get all unique referred user IDs
        const allReferredUserIds = new Set<string>();
        allReferrals.forEach(ref => allReferredUserIds.add(ref.referredUser.toString()));

        const referralSubscriptions = await SubscriptionModel.find({
            user: { $in: Array.from(allReferredUserIds) },
            status: SubscriptionStatus.ACTIVE,
            subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] },
            endDate: { $gt: now }
        }).select('user').lean();

        const usersWithActiveSubsSet = new Set<string>();
        referralSubscriptions.forEach(sub => usersWithActiveSubsSet.add(sub.user.toString()));
        logger.info(`[Script] Found ${referralSubscriptions.length} active referral subscriptions`);

        logger.info('[Script] Step 6: Processing users and detecting suspicious accounts...');
        const suspiciousUsers: SuspiciousUser[] = [];
        let processedCount = 0;

        for (const userId of userIdsWithWithdrawals) {
            processedCount++;

            if (processedCount % 500 === 0) {
                logger.info(`[Script] Progress: ${processedCount}/${userIdsWithWithdrawals.length} users processed`);
            }

            try {
                const userIdStr = userId.toString();
                const user = userMap.get(userIdStr);

                if (!user) {
                    continue;
                }

                // Check if user has active subscription (from our pre-fetched set)
                const hasActiveSub = usersWithActiveSubs.has(userIdStr);

                // Count active referrals
                const directReferredUserIds = directReferralsMap.get(userIdStr) || [];
                const indirectReferredUserIds = indirectReferralsMap.get(userIdStr) || [];

                const activeDirectCount = directReferredUserIds.filter(id =>
                    usersWithActiveSubsSet.has(id)
                ).length;

                const activeIndirectCount = indirectReferredUserIds.filter(id =>
                    usersWithActiveSubsSet.has(id)
                ).length;

                // Calculate expected earnings
                const expectedEarnings = (activeDirectCount * 1000) + (activeIndirectCount * 375);

                // Get withdrawal data
                const withdrawals = withdrawalMap.get(userIdStr) || { total: 0, count: 0 };
                const currentBalance = user.balance || 0;
                const actualMoney = withdrawals.total + currentBalance;

                // Calculate discrepancy
                const discrepancy = actualMoney - expectedEarnings;
                const discrepancyPercent = expectedEarnings > 0
                    ? ((discrepancy / expectedEarnings) * 100)
                    : (actualMoney > 0 ? 10000 : 0);

                // Determine suspicion level and reasons
                const suspicionReasons: string[] = [];
                let suspicionLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' = 'MEDIUM';

                // CRITICAL: User has withdrawals but NO active subscription
                if (!hasActiveSub && withdrawals.count > 0) {
                    suspicionLevel = 'CRITICAL';
                    suspicionReasons.push('Has withdrawals but NO active subscription');
                }

                // HIGH: Actual money significantly exceeds expected earnings
                if (discrepancy > 20000) {
                    if (suspicionLevel !== 'CRITICAL') suspicionLevel = 'HIGH';
                    suspicionReasons.push(`Excess funds: ${discrepancy.toLocaleString()} XAF`);
                }

                // HIGH: Has money but zero active referrals
                if (actualMoney > 10000 && activeDirectCount === 0 && activeIndirectCount === 0) {
                    if (suspicionLevel !== 'CRITICAL') suspicionLevel = 'HIGH';
                    suspicionReasons.push('Has money but ZERO active referrals');
                }

                // MEDIUM: Discrepancy percentage > 100%
                if (discrepancyPercent > 100 && expectedEarnings > 0) {
                    suspicionReasons.push(`Discrepancy: ${discrepancyPercent.toFixed(0)}%`);
                }

                // MEDIUM: Multiple withdrawals with low expected earnings
                if (withdrawals.count >= 3 && expectedEarnings < 5000) {
                    suspicionReasons.push(`${withdrawals.count} withdrawals but low expected earnings`);
                }

                // Flag as suspicious if there are any suspicion reasons
                if (suspicionReasons.length > 0 || !hasActiveSub) {
                    suspiciousUsers.push({
                        userId: userIdStr,
                        name: user.name,
                        email: user.email,
                        phoneNumber: user.phoneNumber,
                        hasActiveSubscription: hasActiveSub,
                        currentBalance,
                        totalWithdrawals: withdrawals.total,
                        withdrawalCount: withdrawals.count,
                        actualMoney,
                        expectedEarnings,
                        discrepancy,
                        discrepancyPercent,
                        activeDirectReferrals: activeDirectCount,
                        activeIndirectReferrals: activeIndirectCount,
                        totalActiveReferrals: activeDirectCount + activeIndirectCount,
                        accountCreated: user.createdAt,
                        suspicionLevel,
                        suspicionReasons
                    });
                }

            } catch (error) {
                logger.error(`[Script] Error processing user ${userId}:`, error);
                continue;
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
    console.log('SUSPICIOUS USERS REPORT (OPTIMIZED)');
    console.log('===========================================');
    console.log(`Detection Criteria:`);
    console.log(`  - Only users with at least ONE withdrawal transaction`);
    console.log(`  - Expected = (Active Direct Refs × 1000) + (Active Indirect Refs × 375)`);
    console.log(`  - Actual = Total Withdrawals + Current Balance`);
    console.log(`  - CRITICAL: Has withdrawals but NO active subscription`);
    console.log(`  - HIGH: Actual >> Expected OR Has money but zero active referrals`);
    console.log(`\nTotal Suspicious Users Found: ${users.length}`);
    console.log('===========================================\n');

    if (users.length === 0) {
        console.log('No suspicious users found.');
        return;
    }

    // Sort by suspicion level, then by discrepancy
    const sortedUsers = users.sort((a, b) => {
        const levelOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
        const levelDiff = levelOrder[a.suspicionLevel] - levelOrder[b.suspicionLevel];
        return levelDiff !== 0 ? levelDiff : b.discrepancy - a.discrepancy;
    });

    // Calculate statistics
    const totalActual = sortedUsers.reduce((sum, user) => sum + user.actualMoney, 0);
    const totalExpected = sortedUsers.reduce((sum, user) => sum + user.expectedEarnings, 0);
    const totalDiscrepancy = sortedUsers.reduce((sum, user) => sum + user.discrepancy, 0);

    const criticalCount = sortedUsers.filter(u => u.suspicionLevel === 'CRITICAL').length;
    const highCount = sortedUsers.filter(u => u.suspicionLevel === 'HIGH').length;
    const mediumCount = sortedUsers.filter(u => u.suspicionLevel === 'MEDIUM').length;

    console.log('STATISTICS:');
    console.log(`  CRITICAL Suspicion: ${criticalCount} users`);
    console.log(`  HIGH Suspicion: ${highCount} users`);
    console.log(`  MEDIUM Suspicion: ${mediumCount} users`);
    console.log(`  Total Actual Money: ${totalActual.toLocaleString('fr-FR')} XAF`);
    console.log(`  Total Expected Earnings: ${totalExpected.toLocaleString('fr-FR')} XAF`);
    console.log(`  Total Discrepancy: ${totalDiscrepancy.toLocaleString('fr-FR')} XAF`);
    console.log(`  Average Discrepancy: ${(totalDiscrepancy / users.length).toLocaleString('fr-FR')} XAF`);
    console.log('\n');

    // Print table header
    console.log('DETAILED LIST (Top 50):');
    console.log('─'.repeat(200));
    console.log(
        'Level'.padEnd(10) +
        'Name'.padEnd(25) +
        'HasSub'.padEnd(8) +
        'Balance'.padEnd(12) +
        'Withdrawn'.padEnd(12) +
        'Actual'.padEnd(12) +
        'Expected'.padEnd(12) +
        'Diff'.padEnd(12) +
        'Active'.padEnd(8) +
        'Direct'.padEnd(8) +
        'Indirect'.padEnd(10) +
        'Reasons'
    );
    console.log('─'.repeat(200));

    // Print top 50 users
    sortedUsers.slice(0, 50).forEach((user) => {
        const levelColor = user.suspicionLevel === 'CRITICAL' ? '🔴' :
                          user.suspicionLevel === 'HIGH' ? '🟠' : '🟡';

        console.log(
            `${levelColor} ${user.suspicionLevel.padEnd(8)}` +
            `${user.name.substring(0, 24).padEnd(25)}` +
            `${(user.hasActiveSubscription ? 'YES' : 'NO').padEnd(8)}` +
            `${user.currentBalance.toLocaleString('fr-FR').padEnd(12)}` +
            `${user.totalWithdrawals.toLocaleString('fr-FR').padEnd(12)}` +
            `${user.actualMoney.toLocaleString('fr-FR').padEnd(12)}` +
            `${user.expectedEarnings.toLocaleString('fr-FR').padEnd(12)}` +
            `${user.discrepancy.toLocaleString('fr-FR').padEnd(12)}` +
            `${user.totalActiveReferrals.toString().padEnd(8)}` +
            `${user.activeDirectReferrals.toString().padEnd(8)}` +
            `${user.activeIndirectReferrals.toString().padEnd(10)}` +
            `${user.suspicionReasons.join('; ')}`
        );
    });

    console.log('─'.repeat(200));
    if (sortedUsers.length > 50) {
        console.log(`\n... and ${sortedUsers.length - 50} more suspicious users (see CSV for full list)\n`);
    }
    console.log('\n');

    // CRITICAL SECTION
    const criticalUsers = sortedUsers.filter(u => u.suspicionLevel === 'CRITICAL');
    if (criticalUsers.length > 0) {
        console.log(`🔴 CRITICAL RISK: ${criticalUsers.length} users with withdrawals but NO active subscription:`);
        console.log('─'.repeat(150));
        criticalUsers.slice(0, 10).forEach(user => {
            console.log(`  ${user.name} (${user.email})`);
            console.log(`    Withdrawals: ${user.withdrawalCount} (${user.totalWithdrawals.toLocaleString('fr-FR')} XAF)`);
            console.log(`    Current Balance: ${user.currentBalance.toLocaleString('fr-FR')} XAF`);
            console.log(`    Total Money: ${user.actualMoney.toLocaleString('fr-FR')} XAF`);
            console.log(`    Active Referrals: ${user.totalActiveReferrals} (Direct: ${user.activeDirectReferrals}, Indirect: ${user.activeIndirectReferrals})`);
            console.log('');
        });
        if (criticalUsers.length > 10) {
            console.log(`  ... and ${criticalUsers.length - 10} more CRITICAL users (see CSV)\n`);
        }
        console.log('─'.repeat(150));
        console.log('\n');
    }

    // Breakdown by discrepancy range
    console.log('BREAKDOWN BY DISCREPANCY:');
    const ranges = [
        { label: '> 100,000 XAF', min: 100000, max: Infinity },
        { label: '50,000 - 100,000 XAF', min: 50000, max: 100000 },
        { label: '20,000 - 50,000 XAF', min: 20000, max: 50000 },
        { label: '10,000 - 20,000 XAF', min: 10000, max: 20000 },
        { label: '< 10,000 XAF', min: -Infinity, max: 10000 }
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
        'Suspicion Level',
        'Has Active Subscription',
        'Current Balance (XAF)',
        'Total Withdrawals (XAF)',
        'Withdrawal Count',
        'Actual Money (XAF)',
        'Expected Earnings (XAF)',
        'Discrepancy (XAF)',
        'Discrepancy %',
        'Active Direct Referrals',
        'Active Indirect Referrals',
        'Total Active Referrals',
        'Account Created',
        'Suspicion Reasons'
    ];

    const rows = users.map(user => [
        user.userId,
        user.name,
        user.email,
        user.phoneNumber,
        user.suspicionLevel,
        user.hasActiveSubscription ? 'YES' : 'NO',
        user.currentBalance.toString(),
        user.totalWithdrawals.toString(),
        user.withdrawalCount.toString(),
        user.actualMoney.toString(),
        user.expectedEarnings.toString(),
        user.discrepancy.toString(),
        user.discrepancyPercent.toFixed(2),
        user.activeDirectReferrals.toString(),
        user.activeIndirectReferrals.toString(),
        user.totalActiveReferrals.toString(),
        user.accountCreated.toISOString(),
        user.suspicionReasons.join('; ')
    ]);

    const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csv;
}

async function main() {
    try {
        const startTime = Date.now();

        // Connect to databases
        await connectDatabases();

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

            const reportsDir = path.join(__dirname, '../../reports');
            if (!fs.existsSync(reportsDir)) {
                fs.mkdirSync(reportsDir, { recursive: true });
            }

            fs.writeFileSync(filename, csv);
            logger.info(`[Script] CSV report saved to: ${filename}`);
            console.log(`\n📄 CSV Report saved to: ${filename}\n`);
        }

        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`⏱️  Total execution time: ${elapsedTime} seconds\n`);

        // Close database connections
        await mongoose.connection.close();
        await paymentConnection.close();
        logger.info('[Script] Database connections closed');

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
