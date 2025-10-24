/**
 * Service for calculating referral statistics
 */

import User from '../database/models/user.model';
import ReferralModel from '../database/models/referral.model';
import SubscriptionModel, { SubscriptionStatus } from '../database/models/subscription.model';
import logger from '../utils/logger';

export interface ReferralStats {
    directReferrals: number;
    indirectReferrals: number;
    totalReferrals: number;
    directSubscribedReferrals: number;
    indirectSubscribedReferrals: number;
    totalSubscribedReferrals: number;
}

/**
 * Count referrals for a user (direct and indirect)
 * @param userId - User ID to count referrals for
 * @returns Referral statistics including subscription counts
 */
export async function getReferralStats(userId: string): Promise<ReferralStats> {
    try {
        const stats: ReferralStats = {
            directReferrals: 0,
            indirectReferrals: 0,
            totalReferrals: 0,
            directSubscribedReferrals: 0,
            indirectSubscribedReferrals: 0,
            totalSubscribedReferrals: 0
        };

        // Get direct referrals (Level 1) using Referral model
        const directReferralRecords = await ReferralModel.find({
            referrer: userId,
            referralLevel: 1,
            archived: false
        }).lean();

        stats.directReferrals = directReferralRecords.length;

        // Count direct referrals with active subscriptions
        for (const referralRecord of directReferralRecords) {
            const hasActiveSubscription = await SubscriptionModel.exists({
                user: referralRecord.referredUser,
                status: SubscriptionStatus.ACTIVE,
                category: 'registration', // Only count CLASSIQUE/CIBLE subscriptions
                endDate: { $gt: new Date() }
            });

            if (hasActiveSubscription) {
                stats.directSubscribedReferrals++;
            }
        }

        // Get indirect referrals (Level 2 and Level 3)
        const indirectReferralRecords = await ReferralModel.find({
            referrer: userId,
            referralLevel: { $in: [2, 3] },
            archived: false
        }).lean();

        stats.indirectReferrals = indirectReferralRecords.length;

        // Count indirect referrals with active subscriptions
        for (const referralRecord of indirectReferralRecords) {
            const hasActiveSubscription = await SubscriptionModel.exists({
                user: referralRecord.referredUser,
                status: SubscriptionStatus.ACTIVE,
                category: 'registration',
                endDate: { $gt: new Date() }
            });

            if (hasActiveSubscription) {
                stats.indirectSubscribedReferrals++;
            }
        }

        // Calculate totals
        stats.totalReferrals = stats.directReferrals + stats.indirectReferrals;
        stats.totalSubscribedReferrals = stats.directSubscribedReferrals + stats.indirectSubscribedReferrals;

        logger.info(`[ReferralStatsService] Stats for user ${userId}:`, stats);

        return stats;
    } catch (error) {
        logger.error(`[ReferralStatsService] Error getting referral stats for user ${userId}:`, error);
        // Return zeros on error
        return {
            directReferrals: 0,
            indirectReferrals: 0,
            totalReferrals: 0,
            directSubscribedReferrals: 0,
            indirectSubscribedReferrals: 0,
            totalSubscribedReferrals: 0
        };
    }
}
