import CampaignModel, { ICampaign, CampaignType, CampaignStatus, TargetFilter } from '../database/models/relance-campaign.model';
import RelanceTargetModel, { TargetStatus } from '../database/models/relance-target.model';
import RelanceConfigModel from '../database/models/relance-config.model';
import { userServiceClient } from './clients/user.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('CampaignService');

/**
 * Campaign Service
 * Handles campaign creation, filtering, scheduling, and lifecycle management
 */
class CampaignService {

    /**
     * Create a new filtered campaign
     */
    async createCampaign(
        userId: string,
        name: string,
        targetFilter: TargetFilter,
        options?: {
            scheduledStartDate?: Date;
            runAfterCampaignId?: string;
            customMessages?: ICampaign['customMessages'];
            maxMessagesPerDay?: number;
        }
    ): Promise<{ success: boolean; campaign?: ICampaign; error?: string }> {
        try {
            // Validate user has relance subscription
            const hasRelance = await userServiceClient.hasRelanceSubscription(userId);
            if (!hasRelance) {
                return { success: false, error: 'User does not have active RELANCE subscription' };
            }

            // Get user config for limits
            const config = await RelanceConfigModel.findOne({ userId });
            if (!config) {
                return { success: false, error: 'Relance configuration not found' };
            }

            // Estimate target count based on filter
            const estimatedTargets = await this.estimateTargetCount(userId, targetFilter);

            // Check if exceeds max targets limit
            if (estimatedTargets > config.maxTargetsPerCampaign) {
                return {
                    success: false,
                    error: `Filter matches ${estimatedTargets} targets, exceeds limit of ${config.maxTargetsPerCampaign}`
                };
            }

            // Validate scheduling against subscription end date
            if (options?.scheduledStartDate) {
                // TODO: Get user subscription end date from user service
                // For now, skip validation
            }

            // Validate runAfter campaign exists and belongs to user
            if (options?.runAfterCampaignId) {
                const parentCampaign = await CampaignModel.findOne({
                    _id: options.runAfterCampaignId,
                    userId
                });

                if (!parentCampaign) {
                    return { success: false, error: 'Parent campaign not found or does not belong to user' };
                }

                if (parentCampaign.status === CampaignStatus.COMPLETED || parentCampaign.status === CampaignStatus.CANCELLED) {
                    return { success: false, error: 'Parent campaign is already completed or cancelled' };
                }
            }

            // Estimate end date
            const estimatedEndDate = this.calculateEstimatedEndDate(estimatedTargets);

            // Create campaign
            const campaign = await CampaignModel.create({
                userId,
                name,
                type: CampaignType.FILTERED,
                status: options?.scheduledStartDate ? CampaignStatus.SCHEDULED :
                        options?.runAfterCampaignId ? CampaignStatus.SCHEDULED :
                        CampaignStatus.DRAFT,
                targetFilter,
                estimatedTargetCount: estimatedTargets,
                scheduledStartDate: options?.scheduledStartDate,
                estimatedEndDate,
                runAfterCampaignId: options?.runAfterCampaignId,
                customMessages: options?.customMessages,
                maxMessagesPerDay: options?.maxMessagesPerDay || config.maxMessagesPerDay,
                createdBy: userId
            });

            log.info(`Created campaign ${campaign._id} for user ${userId}: ${name} (${estimatedTargets} targets)`);

            return { success: true, campaign };

        } catch (error: any) {
            log.error(`Error creating campaign for user ${userId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Estimate how many targets match the filter criteria
     */
    private async estimateTargetCount(userId: string, filter: TargetFilter): Promise<number> {
        try {
            // Get all unpaid referrals for this user
            const unpaidReferrals = await userServiceClient.getUnpaidReferrals(userId);

            // Apply filters
            let filtered = unpaidReferrals;

            // Filter by registration date
            if (filter.registrationDateFrom || filter.registrationDateTo) {
                filtered = filtered.filter(ref => {
                    const regDate = new Date(ref.createdAt);
                    if (filter.registrationDateFrom && regDate < filter.registrationDateFrom) return false;
                    if (filter.registrationDateTo && regDate > filter.registrationDateTo) return false;
                    return true;
                });
            }

            // Filter by country
            if (filter.countries && filter.countries.length > 0) {
                filtered = filtered.filter(ref =>
                    filter.countries!.includes(ref.country)
                );
            }

            // Filter by gender
            if (filter.gender && filter.gender !== 'all') {
                filtered = filtered.filter(ref => ref.gender === filter.gender);
            }

            // Filter by profession
            if (filter.professions && filter.professions.length > 0) {
                filtered = filtered.filter(ref =>
                    filter.professions!.includes(ref.profession)
                );
            }

            // Filter by age
            if (filter.minAge || filter.maxAge) {
                filtered = filtered.filter(ref => {
                    if (!ref.age) return false;
                    if (filter.minAge && ref.age < filter.minAge) return false;
                    if (filter.maxAge && ref.age > filter.maxAge) return false;
                    return true;
                });
            }

            // Exclude users already in active campaigns
            if (filter.excludeCurrentTargets) {
                const existingTargetIds = await RelanceTargetModel.distinct('referralUserId', {
                    status: { $in: [TargetStatus.ACTIVE, TargetStatus.PAUSED] }
                });

                filtered = filtered.filter(ref =>
                    !existingTargetIds.some(id => id.toString() === ref._id.toString())
                );
            }

            return filtered.length;

        } catch (error: any) {
            log.error(`Error estimating target count:`, error);
            return 0;
        }
    }

    /**
     * Calculate estimated campaign end date based on target count
     */
    private calculateEstimatedEndDate(targetCount: number): Date {
        // Assume we can process ~10 targets per day (conservative estimate)
        // Each target gets 7 days of messages, but they run in parallel
        const estimatedDays = Math.ceil(targetCount / 10) + 7; // Enrollment days + message cycle

        const endDate = new Date();
        endDate.setDate(endDate.getDate() + estimatedDays);

        return endDate;
    }

    /**
     * Start a campaign (activate it)
     */
    async startCampaign(campaignId: string, userId: string): Promise<{ success: boolean; error?: string }> {
        try {
            const campaign = await CampaignModel.findOne({ _id: campaignId, userId });

            if (!campaign) {
                return { success: false, error: 'Campaign not found' };
            }

            if (campaign.status !== CampaignStatus.DRAFT && campaign.status !== CampaignStatus.SCHEDULED) {
                return { success: false, error: `Cannot start campaign with status: ${campaign.status}` };
            }

            // Check if default campaign should be paused
            const config = await RelanceConfigModel.findOne({ userId });
            if (config && !config.allowSimultaneousCampaigns) {
                // Pause default campaign
                config.defaultCampaignPaused = true;
                await config.save();
                log.info(`Paused default campaign for user ${userId} due to filtered campaign start`);
            }

            // Activate campaign
            campaign.status = CampaignStatus.ACTIVE;
            campaign.actualStartDate = new Date();
            await campaign.save();

            log.info(`Started campaign ${campaignId} for user ${userId}`);

            return { success: true };

        } catch (error: any) {
            log.error(`Error starting campaign ${campaignId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Pause a campaign
     */
    async pauseCampaign(campaignId: string, userId: string): Promise<{ success: boolean; error?: string }> {
        try {
            const campaign = await CampaignModel.findOne({ _id: campaignId, userId });

            if (!campaign) {
                return { success: false, error: 'Campaign not found' };
            }

            if (campaign.status !== CampaignStatus.ACTIVE) {
                return { success: false, error: `Cannot pause campaign with status: ${campaign.status}` };
            }

            campaign.pause(userId);
            await campaign.save();

            log.info(`Paused campaign ${campaignId} for user ${userId}`);

            return { success: true };

        } catch (error: any) {
            log.error(`Error pausing campaign ${campaignId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Resume a paused campaign
     */
    async resumeCampaign(campaignId: string, userId: string): Promise<{ success: boolean; error?: string }> {
        try {
            const campaign = await CampaignModel.findOne({ _id: campaignId, userId });

            if (!campaign) {
                return { success: false, error: 'Campaign not found' };
            }

            if (campaign.status !== CampaignStatus.PAUSED) {
                return { success: false, error: `Cannot resume campaign with status: ${campaign.status}` };
            }

            campaign.resume();
            await campaign.save();

            log.info(`Resumed campaign ${campaignId} for user ${userId}`);

            return { success: true };

        } catch (error: any) {
            log.error(`Error resuming campaign ${campaignId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel a campaign
     */
    async cancelCampaign(campaignId: string, userId: string, reason?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const campaign = await CampaignModel.findOne({ _id: campaignId, userId });

            if (!campaign) {
                return { success: false, error: 'Campaign not found' };
            }

            if (campaign.status === CampaignStatus.COMPLETED || campaign.status === CampaignStatus.CANCELLED) {
                return { success: false, error: `Cannot cancel campaign with status: ${campaign.status}` };
            }

            campaign.cancel(userId, reason);
            await campaign.save();

            // Exit all active targets for this campaign
            await RelanceTargetModel.updateMany(
                { campaignId: campaignId, status: TargetStatus.ACTIVE },
                {
                    status: TargetStatus.COMPLETED,
                    exitReason: 'manual',
                    exitedLoopAt: new Date()
                }
            );

            // Check if this was the last active filtered campaign
            const activeFilteredCampaigns = await CampaignModel.countDocuments({
                userId,
                type: CampaignType.FILTERED,
                status: CampaignStatus.ACTIVE
            });

            // Resume default campaign if no more filtered campaigns
            if (activeFilteredCampaigns === 0) {
                const config = await RelanceConfigModel.findOne({ userId });
                if (config && config.defaultCampaignPaused) {
                    config.defaultCampaignPaused = false;
                    await config.save();
                    log.info(`Resumed default campaign for user ${userId} after filtered campaign cancellation`);
                }
            }

            log.info(`Cancelled campaign ${campaignId} for user ${userId}: ${reason || 'No reason provided'}`);

            return { success: true };

        } catch (error: any) {
            log.error(`Error cancelling campaign ${campaignId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get campaigns for a user
     */
    async getUserCampaigns(
        userId: string,
        filters?: { status?: CampaignStatus; type?: CampaignType }
    ): Promise<ICampaign[]> {
        try {
            const query: any = { userId };

            if (filters?.status) {
                query.status = filters.status;
            }

            if (filters?.type) {
                query.type = filters.type;
            }

            const campaigns = await CampaignModel.find(query)
                .sort({ createdAt: -1 })
                .limit(100);

            return campaigns;

        } catch (error: any) {
            log.error(`Error getting campaigns for user ${userId}:`, error);
            return [];
        }
    }

    /**
     * Check if a campaign can start based on queue and scheduling
     */
    async getNextCampaignToStart(): Promise<ICampaign | null> {
        try {
            const now = new Date();

            // Find scheduled campaigns that should start now
            const scheduledCampaign = await CampaignModel.findOne({
                status: CampaignStatus.SCHEDULED,
                scheduledStartDate: { $lte: now },
                runAfterCampaignId: { $exists: false } // Not queued behind another campaign
            }).sort({ priority: 1, scheduledStartDate: 1 });

            if (scheduledCampaign) {
                return scheduledCampaign;
            }

            // Find campaigns queued behind completed campaigns
            const queuedCampaign = await CampaignModel.findOne({
                status: CampaignStatus.SCHEDULED,
                runAfterCampaignId: { $exists: true }
            }).populate('runAfterCampaignId');

            if (queuedCampaign) {
                const parentCampaign = queuedCampaign.runAfterCampaignId as any;
                if (parentCampaign && parentCampaign.status === CampaignStatus.COMPLETED) {
                    return queuedCampaign;
                }
            }

            return null;

        } catch (error: any) {
            log.error(`Error getting next campaign to start:`, error);
            return null;
        }
    }
}

export const campaignService = new CampaignService();
