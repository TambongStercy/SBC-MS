/**
 * Service for calculating referral statistics
 */

import User from '../database/models/user.model';
import ReferralModel from '../database/models/referral.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
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

        const now = new Date();
        logger.info(`[ReferralStatsService] Calculating stats for user ${userId}`);

        // Get direct referrals (Level 1) using Referral model
        const directReferralRecords = await ReferralModel.find({
            referrer: userId,
            referralLevel: 1,
            archived: false
        }).lean();

        stats.directReferrals = directReferralRecords.length;
        logger.info(`[ReferralStatsService] Found ${stats.directReferrals} direct referrals`);

        // Get all direct referral user IDs
        const directReferralUserIds = directReferralRecords.map(r => r.referredUser);

        // Count direct referrals with active CLASSIQUE/CIBLE subscriptions
        // Query by subscriptionType directly to handle both new and legacy data
        if (directReferralUserIds.length > 0) {
            const directSubscribedCount = await SubscriptionModel.countDocuments({
                user: { $in: directReferralUserIds },
                status: SubscriptionStatus.ACTIVE,
                subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] },
                endDate: { $gt: now }
            });
            stats.directSubscribedReferrals = directSubscribedCount;
            logger.info(`[ReferralStatsService] Found ${directSubscribedCount} direct referrals with active CLASSIQUE/CIBLE subscriptions`);
        }

        // Get indirect referrals (Level 2 and Level 3)
        const indirectReferralRecords = await ReferralModel.find({
            referrer: userId,
            referralLevel: { $in: [2, 3] },
            archived: false
        }).lean();

        stats.indirectReferrals = indirectReferralRecords.length;
        logger.info(`[ReferralStatsService] Found ${stats.indirectReferrals} indirect referrals`);

        // Get all indirect referral user IDs
        const indirectReferralUserIds = indirectReferralRecords.map(r => r.referredUser);

        // Count indirect referrals with active CLASSIQUE/CIBLE subscriptions
        // Query by subscriptionType directly to handle both new and legacy data
        if (indirectReferralUserIds.length > 0) {
            const indirectSubscribedCount = await SubscriptionModel.countDocuments({
                user: { $in: indirectReferralUserIds },
                status: SubscriptionStatus.ACTIVE,
                subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] },
                endDate: { $gt: now }
            });
            stats.indirectSubscribedReferrals = indirectSubscribedCount;
            logger.info(`[ReferralStatsService] Found ${indirectSubscribedCount} indirect referrals with active CLASSIQUE/CIBLE subscriptions`);
        }

        // Calculate totals
        stats.totalReferrals = stats.directReferrals + stats.indirectReferrals;
        stats.totalSubscribedReferrals = stats.directSubscribedReferrals + stats.indirectSubscribedReferrals;

        logger.info(`[ReferralStatsService] Final stats for user ${userId}:`, {
            directReferrals: stats.directReferrals,
            directSubscribedReferrals: stats.directSubscribedReferrals,
            indirectReferrals: stats.indirectReferrals,
            indirectSubscribedReferrals: stats.indirectSubscribedReferrals,
            totalReferrals: stats.totalReferrals,
            totalSubscribedReferrals: stats.totalSubscribedReferrals
        });

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
