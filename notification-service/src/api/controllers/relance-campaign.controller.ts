import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { campaignService } from '../../services/campaign.service';
import CampaignModel, { CampaignStatus, CampaignType, TargetFilter } from '../../database/models/relance-campaign.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../../database/models/relance-target.model';
import RelanceConfigModel from '../../database/models/relance-config.model';
import RelanceMessageModel from '../../database/models/relance-message.model';
import { userServiceClient } from '../../services/clients/user.service.client';
import { emailRelanceService } from '../../services/email.relance.service';
import logger from '../../utils/logger';

const log = logger.getLogger('RelanceCampaignController');

/**
 * Campaign Controller
 * Handles campaign management API endpoints
 */
class RelanceCampaignController {

    /**
     * Preview filter results
     * Returns estimated count and sample of 5 matching users
     * POST /api/relance/campaigns/preview
     */
    async previewFilterResults(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId || req.body.userId;
            const { targetFilter } = req.body;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            if (!targetFilter) {
                res.status(400).json({
                    success: false,
                    message: 'Target filter is required'
                });
                return;
            }

            // Apply filters (same logic as enrollment job)
            const filter: TargetFilter = targetFilter;
            log.info(`Preview filters: ${JSON.stringify(filter)}`);

            // Get referrals for this user - pass date filters to DB level for performance
            // This prevents fetching 20k+ referrals when only a small date range is needed
            // Default to last 1 year if no date filter specified (performance optimization for users with many referrals)
            let dateFrom = filter.registrationDateFrom ? new Date(filter.registrationDateFrom).toISOString() : undefined;
            const dateTo = filter.registrationDateTo ? new Date(filter.registrationDateTo).toISOString() : undefined;
            let usedDefaultDateRange = false;

            // If no dateFrom specified, default to 1 year ago for performance
            // Users with 20k+ referrals would timeout without this limit
            if (!dateFrom) {
                const oneYearAgo = new Date();
                oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
                dateFrom = oneYearAgo.toISOString();
                usedDefaultDateRange = true;
                log.info(`Preview: No dateFrom specified, defaulting to 1 year ago: ${dateFrom}`);
            }

            let allReferrals = await userServiceClient.getReferralsForCampaign(userId, dateFrom, dateTo);
            log.info(`Preview: fetched ${allReferrals.length} referrals for user ${userId} (dateFrom: ${dateFrom}, dateTo: ${dateTo})`);

            // Note: date filter already applied at DB level, no need to filter again in memory

            // Filter by country
            if (filter.countries && filter.countries.length > 0) {
                allReferrals = allReferrals.filter((ref: any) =>
                    filter.countries!.includes(ref.country)
                );
                log.info(`Preview: after country filter: ${allReferrals.length} referrals`);
            }

            // Filter by subscription status (CLASSIQUE/CIBLE inscription payment)
            if (filter.subscriptionStatus && filter.subscriptionStatus !== 'all') {
                allReferrals = allReferrals.filter((ref: any) => {
                    const hasSubscription = ref.activeSubscriptionTypes &&
                        ref.activeSubscriptionTypes.length > 0 &&
                        (ref.activeSubscriptionTypes.includes('CLASSIQUE') ||
                         ref.activeSubscriptionTypes.includes('CIBLE'));

                    if (filter.subscriptionStatus === 'subscribed') {
                        return hasSubscription;
                    } else { // 'non-subscribed'
                        return !hasSubscription;
                    }
                });
                log.info(`Preview: after subscriptionStatus (${filter.subscriptionStatus}) filter: ${allReferrals.length} referrals`);
            }

            // Filter by gender
            if (filter.gender && filter.gender !== 'all') {
                allReferrals = allReferrals.filter((ref: any) =>
                    ref.gender === filter.gender
                );
                log.info(`Preview: after gender filter: ${allReferrals.length} referrals`);
            }

            // Filter by profession
            if (filter.professions && filter.professions.length > 0) {
                allReferrals = allReferrals.filter((ref: any) =>
                    filter.professions!.includes(ref.profession)
                );
                log.info(`Preview: after profession filter: ${allReferrals.length} referrals`);
            }

            // Filter by age
            if (filter.minAge || filter.maxAge) {
                allReferrals = allReferrals.filter((ref: any) => {
                    if (!ref.age) return false;
                    if (filter.minAge && ref.age < filter.minAge) return false;
                    if (filter.maxAge && ref.age > filter.maxAge) return false;
                    return true;
                });
                log.info(`Preview: after age filter: ${allReferrals.length} referrals`);
            }

            // Exclude referrals already in active campaigns
            if (filter.excludeCurrentTargets) {
                const existingTargetIds = await RelanceTargetModel.distinct('referralUserId', {
                    status: { $in: ['active', 'paused'] }
                });
                log.info(`Preview: found ${existingTargetIds.length} existing active targets to exclude`);

                allReferrals = allReferrals.filter((ref: any) =>
                    !existingTargetIds.some((id: any) => id.toString() === ref._id.toString())
                );
                log.info(`Preview: after excludeCurrentTargets filter: ${allReferrals.length} referrals`);
            }

            const totalCount = allReferrals.length;

            // Get sample of 5 users
            const sampleUsers = allReferrals.slice(0, 5).map((ref: any) => ({
                _id: ref._id,
                name: ref.name,
                email: ref.email,
                phoneNumber: ref.phoneNumber,
                country: ref.country,
                gender: ref.gender,
                profession: ref.profession,
                age: ref.age,
                createdAt: ref.createdAt
            }));

            // Build response message
            let message = totalCount === 0 ? 'No users match the selected filters' :
                         totalCount === 1 ? '1 user matches the selected filters' :
                         `${totalCount} users match the selected filters`;

            // Add note if default date range was used
            if (usedDefaultDateRange) {
                message += ' (showing referrals from last 12 months - set a date range to see older referrals)';
            }

            res.status(200).json({
                success: true,
                data: {
                    totalCount,
                    sampleUsers,
                    message,
                    usedDefaultDateRange // Let frontend know if default was applied
                }
            });

        } catch (error: any) {
            log.error('Error previewing filter results:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to preview filter results',
                error: error.message
            });
        }
    }

    /**
     * Create a new campaign
     * POST /api/relance/campaigns
     */
    async createCampaign(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId || req.body.userId;
            const { name, targetFilter, scheduledStartDate, runAfterCampaignId, customMessages, maxMessagesPerDay } = req.body;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            if (!name || !targetFilter) {
                res.status(400).json({
                    success: false,
                    message: 'Campaign name and target filter are required'
                });
                return;
            }

            const result = await campaignService.createCampaign(
                userId,
                name,
                targetFilter,
                {
                    scheduledStartDate: scheduledStartDate ? new Date(scheduledStartDate) : undefined,
                    runAfterCampaignId,
                    customMessages,
                    maxMessagesPerDay
                }
            );

            if (result.success) {
                res.status(201).json({
                    success: true,
                    message: 'Campaign created successfully',
                    data: result.campaign
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.error || 'Failed to create campaign'
                });
            }

        } catch (error: any) {
            log.error('Error creating campaign:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create campaign',
                error: error.message
            });
        }
    }

    /**
     * Get all campaigns for a user
     * GET /api/relance/campaigns (user)
     * GET /api/relance/admin/campaigns (admin)
     */
    async getCampaigns(req: Request, res: Response): Promise<void> {
        try {
            const authenticatedUserId = (req as any).user?.userId;
            const queryUserId = req.query.userId as string;
            const { status, type, page = '1', limit = '20' } = req.query;

            // For admin routes, userId is optional (can query all campaigns)
            const userId = queryUserId || authenticatedUserId;

            const filters: any = {};
            if (userId) filters.userId = userId;
            if (status) filters.status = status as CampaignStatus;
            if (type) filters.type = type as CampaignType;

            // Pagination
            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const skip = (pageNum - 1) * limitNum;

            const campaigns = await CampaignModel.find(filters)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum);

            const total = await CampaignModel.countDocuments(filters);
            const totalPages = Math.ceil(total / limitNum);

            res.status(200).json({
                success: true,
                data: {
                    campaigns,
                    total,
                    page: pageNum,
                    totalPages
                }
            });

        } catch (error: any) {
            log.error('Error getting campaigns:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get campaigns',
                error: error.message
            });
        }
    }

    /**
     * Get campaign details
     * GET /api/relance/campaigns/:id
     */
    async getCampaignById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.userId;

            const campaign = await CampaignModel.findOne({
                _id: id,
                ...(userId ? { userId } : {}) // Only filter by userId if authenticated
            });

            if (!campaign) {
                res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
                return;
            }

            // Get targets for this campaign
            const targets = await RelanceTargetModel.find({ campaignId: id })
                .sort({ createdAt: -1 })
                .limit(100);

            res.status(200).json({
                success: true,
                data: {
                    campaign,
                    targets
                }
            });

        } catch (error: any) {
            log.error('Error getting campaign:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get campaign',
                error: error.message
            });
        }
    }

    /**
     * Get campaign targets
     * GET /api/relance/campaigns/:id/targets
     */
    async getCampaignTargets(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.userId;
            const { page = 1, limit = 50, status } = req.query;

            const campaign = await CampaignModel.findOne({
                _id: id,
                ...(userId ? { userId } : {})
            });

            if (!campaign) {
                res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
                return;
            }

            const query: any = { campaignId: id };
            if (status) query.status = status;

            const targets = await RelanceTargetModel.find(query)
                .sort({ createdAt: -1 })
                .skip((Number(page) - 1) * Number(limit))
                .limit(Number(limit));

            const total = await RelanceTargetModel.countDocuments(query);

            res.status(200).json({
                success: true,
                data: {
                    targets,
                    pagination: {
                        page: Number(page),
                        limit: Number(limit),
                        total,
                        pages: Math.ceil(total / Number(limit))
                    }
                }
            });

        } catch (error: any) {
            log.error('Error getting campaign targets:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get campaign targets',
                error: error.message
            });
        }
    }

    /**
     * Start a campaign
     * POST /api/relance/campaigns/:id/start
     */
    async startCampaign(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.userId || req.body.userId;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            const result = await campaignService.startCampaign(id, userId);

            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: 'Campaign started successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.error || 'Failed to start campaign'
                });
            }

        } catch (error: any) {
            log.error('Error starting campaign:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to start campaign',
                error: error.message
            });
        }
    }

    /**
     * Pause a campaign
     * POST /api/relance/campaigns/:id/pause
     */
    async pauseCampaign(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.userId || req.body.userId;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            const result = await campaignService.pauseCampaign(id, userId);

            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: 'Campaign paused successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.error || 'Failed to pause campaign'
                });
            }

        } catch (error: any) {
            log.error('Error pausing campaign:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to pause campaign',
                error: error.message
            });
        }
    }

    /**
     * Resume a campaign
     * POST /api/relance/campaigns/:id/resume
     */
    async resumeCampaign(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.userId || req.body.userId;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            const result = await campaignService.resumeCampaign(id, userId);

            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: 'Campaign resumed successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.error || 'Failed to resume campaign'
                });
            }

        } catch (error: any) {
            log.error('Error resuming campaign:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to resume campaign',
                error: error.message
            });
        }
    }

    /**
     * Cancel a campaign
     * POST /api/relance/campaigns/:id/cancel
     */
    async cancelCampaign(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.userId || req.body.userId;
            const { reason } = req.body;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            const result = await campaignService.cancelCampaign(id, userId, reason);

            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: 'Campaign cancelled successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.error || 'Failed to cancel campaign'
                });
            }

        } catch (error: any) {
            log.error('Error cancelling campaign:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to cancel campaign',
                error: error.message
            });
        }
    }

    /**
     * Delete a campaign
     * DELETE /api/relance/campaigns/:id
     */
    async deleteCampaign(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.userId || req.body.userId;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            // Find campaign
            const campaign = await CampaignModel.findOne({ _id: id, userId });

            if (!campaign) {
                res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
                return;
            }

            // Only allow deletion of draft, cancelled, or completed campaigns
            if (campaign.status === CampaignStatus.ACTIVE || campaign.status === CampaignStatus.PAUSED) {
                res.status(400).json({
                    success: false,
                    message: 'Cannot delete active or paused campaigns. Please cancel the campaign first.'
                });
                return;
            }

            // Delete all targets associated with this campaign
            const deletedTargets = await RelanceTargetModel.deleteMany({ campaignId: id });

            // Delete the campaign
            await CampaignModel.deleteOne({ _id: id });

            log.info(`Deleted campaign ${id} for user ${userId} (removed ${deletedTargets.deletedCount} targets)`);

            res.status(200).json({
                success: true,
                message: 'Campaign deleted successfully',
                data: {
                    campaignId: id,
                    targetsDeleted: deletedTargets.deletedCount
                }
            });

        } catch (error: any) {
            log.error('Error deleting campaign:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete campaign',
                error: error.message
            });
        }
    }

    /**
     * Update relance config
     * PATCH /api/relance/config
     */
    async updateConfig(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId || req.body.userId;
            const { defaultCampaignPaused, allowSimultaneousCampaigns, maxMessagesPerDay, maxTargetsPerCampaign } = req.body;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            const config = await RelanceConfigModel.findOne({ userId });

            if (!config) {
                res.status(404).json({
                    success: false,
                    message: 'Relance configuration not found'
                });
                return;
            }

            // Update fields if provided
            if (typeof defaultCampaignPaused === 'boolean') {
                config.defaultCampaignPaused = defaultCampaignPaused;
            }

            if (typeof allowSimultaneousCampaigns === 'boolean') {
                config.allowSimultaneousCampaigns = allowSimultaneousCampaigns;
            }

            if (typeof maxMessagesPerDay === 'number' && maxMessagesPerDay >= 1 && maxMessagesPerDay <= 5000) {
                config.maxMessagesPerDay = maxMessagesPerDay;
            }

            // Allow up to 50,000 targets per campaign for users with large referral networks
            if (typeof maxTargetsPerCampaign === 'number' && maxTargetsPerCampaign >= 10 && maxTargetsPerCampaign <= 50000) {
                config.maxTargetsPerCampaign = maxTargetsPerCampaign;
            }

            await config.save();

            res.status(200).json({
                success: true,
                message: 'Configuration updated successfully',
                data: config
            });

        } catch (error: any) {
            log.error('Error updating config:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update configuration',
                error: error.message
            });
        }
    }

    // ===== ADMIN ENDPOINTS =====

    /**
     * Get default relance statistics (targets without campaignId)
     * GET /api/relance/default/stats
     */
    async getDefaultRelanceStats(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            // Convert to ObjectId for matching against stored ObjectId fields
            const userObjectId = new mongoose.Types.ObjectId(userId);

            // Get config to check pause status
            const config = await RelanceConfigModel.findOne({ userId });

            // Count targets without campaignId (default enrollment)
            // Use $in [null] to match both null values and missing fields
            const defaultFilter = { $in: [null, undefined] };

            const activeTargets = await RelanceTargetModel.countDocuments({
                referrerUserId: userObjectId,
                campaignId: defaultFilter,
                status: TargetStatus.ACTIVE
            });

            const completedTargets = await RelanceTargetModel.countDocuments({
                referrerUserId: userObjectId,
                campaignId: defaultFilter,
                status: TargetStatus.COMPLETED
            });

            const totalTargets = activeTargets + completedTargets;

            // Get all default targets for detailed stats
            const targets = await RelanceTargetModel.find({
                referrerUserId: userObjectId,
                campaignId: defaultFilter
            });

            // Calculate overall message stats including open and click rates
            let totalMessagesSent = 0;
            let totalMessagesDelivered = 0;
            let totalMessagesOpened = 0;
            let totalMessagesClicked = 0;
            let totalOpens = 0;
            let totalClicks = 0;

            targets.forEach(target => {
                target.messagesDelivered.forEach(m => {
                    totalMessagesSent++;
                    if (m.status === 'delivered') {
                        totalMessagesDelivered++;
                    }
                    if (m.opened) {
                        totalMessagesOpened++;
                        totalOpens += m.openCount || 0;
                    }
                    if (m.clicked) {
                        totalMessagesClicked++;
                        totalClicks += m.clickCount || 0;
                    }
                });
            });

            const deliveryPercentage = totalMessagesSent > 0
                ? (totalMessagesDelivered / totalMessagesSent) * 100
                : 0;

            const openRate = totalMessagesDelivered > 0
                ? (totalMessagesOpened / totalMessagesDelivered) * 100
                : 0;

            const clickRate = totalMessagesDelivered > 0
                ? (totalMessagesClicked / totalMessagesDelivered) * 100
                : 0;

            const clickThroughRate = totalMessagesOpened > 0
                ? (totalMessagesClicked / totalMessagesOpened) * 100
                : 0;

            // Calculate day-by-day progression (Day 1 through Day 7)
            const dayProgression = [];
            for (let day = 1; day <= 7; day++) {
                const targetsOnDay = targets.filter(target => target.currentDay === day && target.status === TargetStatus.ACTIVE);
                dayProgression.push({
                    day,
                    count: targetsOnDay.length
                });
            }

            // Count completed relance (those who finished 7 days without paying)
            const completedRelance = targets.filter(
                target => target.status === TargetStatus.COMPLETED && target.exitReason === ExitReason.COMPLETED_7_DAYS
            ).length;

            // Count conversions (those who paid during relance)
            const targetsConverted = targets.filter(
                target => target.status === TargetStatus.COMPLETED && target.exitReason === ExitReason.PAID
            ).length;

            // Count other exits (manual, referrer inactive)
            const targetsExited = targets.filter(
                target => target.status === TargetStatus.COMPLETED &&
                    target.exitReason !== ExitReason.PAID &&
                    target.exitReason !== ExitReason.COMPLETED_7_DAYS
            ).length;

            // Count enrolled (total ever enrolled in default relance)
            const totalEnrolled = targets.length;

            res.status(200).json({
                success: true,
                data: {
                    isPaused: config?.defaultCampaignPaused || false,
                    totalEnrolled,
                    activeTargets,
                    completedRelance,
                    targetsConverted,
                    targetsExited,
                    totalMessagesSent,
                    totalMessagesDelivered,
                    deliveryPercentage: parseFloat(deliveryPercentage.toFixed(2)),
                    // Email engagement metrics
                    totalMessagesOpened,
                    totalMessagesClicked,
                    totalOpens,
                    totalClicks,
                    openRate: parseFloat(openRate.toFixed(2)),
                    clickRate: parseFloat(clickRate.toFixed(2)),
                    clickThroughRate: parseFloat(clickThroughRate.toFixed(2)),
                    dayProgression,
                    // Legacy fields for backward compatibility
                    completedTargets,
                    totalTargets,
                    successRate: parseFloat(deliveryPercentage.toFixed(2))
                }
            });

        } catch (error: any) {
            log.error('Error getting default relance stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get default relance statistics',
                error: error.message
            });
        }
    }

    /**
     * Get default relance targets (enrolled referrals without campaign)
     * GET /api/relance/default/targets
     */
    async getDefaultRelanceTargets(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId;
            const { page = '1', limit = '20', status } = req.query;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const skip = (pageNum - 1) * limitNum;
            const userObjectId = new mongoose.Types.ObjectId(userId);

            const filter: any = {
                referrerUserId: userObjectId,
                campaignId: { $in: [null, undefined] }
            };

            if (status) {
                filter.status = status;
            }

            const targets = await RelanceTargetModel.find(filter)
                .sort({ enteredLoopAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean();

            const total = await RelanceTargetModel.countDocuments(filter);
            const totalPages = Math.ceil(total / limitNum);

            // Fetch user details from user-service for all referral users in this page
            const referralUserIds = [...new Set(targets.map(t => t.referralUserId.toString()))];
            let userDetailsMap: Record<string, any> = {};

            if (referralUserIds.length > 0) {
                try {
                    const userDetails = await userServiceClient.getBatchUserDetails(referralUserIds);
                    userDetails.forEach((u: any) => {
                        userDetailsMap[u._id.toString()] = {
                            _id: u._id,
                            name: u.name,
                            email: u.email,
                            phoneNumber: u.phoneNumber,
                            avatar: u.avatar
                        };
                    });
                } catch (err: any) {
                    log.warn(`Failed to fetch user details for targets: ${err.message}`);
                }
            }

            // Attach referralUser to each target
            const targetsWithUsers = targets.map(t => ({
                ...t,
                referralUser: userDetailsMap[t.referralUserId.toString()] || null
            }));

            res.status(200).json({
                success: true,
                data: {
                    targets: targetsWithUsers,
                    total,
                    page: pageNum,
                    totalPages
                }
            });

        } catch (error: any) {
            log.error('Error getting default relance targets:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get default relance targets',
                error: error.message
            });
        }
    }

    /**
     * Get campaign statistics (Admin)
     * GET /api/relance/admin/campaigns/stats
     */
    async getCampaignStats(req: Request, res: Response): Promise<void> {
        try {
            const totalCampaigns = await CampaignModel.countDocuments();
            const activeCampaigns = await CampaignModel.countDocuments({ status: CampaignStatus.ACTIVE });
            const completedCampaigns = await CampaignModel.countDocuments({ status: CampaignStatus.COMPLETED });

            const campaigns = await CampaignModel.find();
            const totalTargetsEnrolled = campaigns.reduce((sum, c) => sum + c.targetsEnrolled, 0);
            const totalMessagesSent = campaigns.reduce((sum, c) => sum + c.messagesSent, 0);
            const totalMessagesDelivered = campaigns.reduce((sum, c) => sum + c.messagesDelivered, 0);

            const averageSuccessRate = totalMessagesSent > 0
                ? (totalMessagesDelivered / totalMessagesSent) * 100
                : 0;

            res.status(200).json({
                success: true,
                data: {
                    totalCampaigns,
                    activeCampaigns,
                    completedCampaigns,
                    totalTargetsEnrolled,
                    totalMessagesSent,
                    averageSuccessRate: parseFloat(averageSuccessRate.toFixed(2))
                }
            });

        } catch (error: any) {
            log.error('Error getting campaign stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get campaign statistics',
                error: error.message
            });
        }
    }

    /**
     * Get recent messages sent for user's relance/campaigns
     * GET /api/relance/messages/recent?limit=10
     */
    async getRecentMessages(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId;
            const { limit = '10' } = req.query;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            const limitNum = Math.min(parseInt(limit as string) || 10, 50);
            const userObjectId = new mongoose.Types.ObjectId(userId);

            // Find all targets for this user in DEFAULT RELANCE ONLY (campaignId is null)
            // Use $in [null] to match both null values and missing fields
            const defaultFilter = { $in: [null, undefined] };
            const targets = await RelanceTargetModel.find({
                referrerUserId: userObjectId,
                campaignId: defaultFilter,  // ONLY default relance, not filtered campaigns
                'messagesDelivered.0': { $exists: true } // Has at least one message
            })
                .select('referralUserId campaignId messagesDelivered')
                .lean();

            // Flatten all messages with target context
            const allMessages: Array<{
                day: number;
                sentAt: Date;
                status: string;
                errorMessage?: string;
                referralUserId: string;
                campaignId: string | null;
            }> = [];

            for (const target of targets) {
                for (const msg of target.messagesDelivered) {
                    allMessages.push({
                        day: msg.day,
                        sentAt: msg.sentAt,
                        status: msg.status,
                        errorMessage: msg.errorMessage,
                        referralUserId: target.referralUserId.toString(),
                        campaignId: target.campaignId?.toString() || null
                    });
                }
            }

            // Sort by sentAt descending and take the limit
            allMessages.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
            const recentMessages = allMessages.slice(0, limitNum);

            // Fetch user details for all unique referral users
            const referralUserIds = [...new Set(recentMessages.map(m => m.referralUserId))];
            let userDetailsMap: Record<string, any> = {};

            if (referralUserIds.length > 0) {
                try {
                    const userDetails = await userServiceClient.getBatchUserDetails(referralUserIds);
                    userDetails.forEach((u: any) => {
                        userDetailsMap[u._id.toString()] = {
                            _id: u._id,
                            name: u.name,
                            email: u.email,
                            phoneNumber: u.phoneNumber,
                            avatar: u.avatar
                        };
                    });
                } catch (err: any) {
                    log.warn(`Failed to fetch user details for recent messages: ${err.message}`);
                }
            }

            // Fetch campaign names for any campaign-linked messages
            const campaignIds = [...new Set(recentMessages.filter(m => m.campaignId).map(m => m.campaignId!))];
            let campaignNameMap: Record<string, string> = {};

            if (campaignIds.length > 0) {
                try {
                    const campaigns = await CampaignModel.find({
                        _id: { $in: campaignIds.map(id => new mongoose.Types.ObjectId(id)) }
                    }).select('name').lean();
                    campaigns.forEach(c => {
                        campaignNameMap[c._id.toString()] = c.name;
                    });
                } catch (err: any) {
                    log.warn(`Failed to fetch campaign names: ${err.message}`);
                }
            }

            // Fetch message templates for all unique days to reconstruct emails
            const uniqueDays = [...new Set(recentMessages.map(m => m.day))];
            const messageTemplates = await RelanceMessageModel.find({
                dayNumber: { $in: uniqueDays }
            }).lean();
            const templateMap: Record<number, any> = {};
            messageTemplates.forEach(t => {
                templateMap[t.dayNumber] = t;
            });

            // Also fetch campaign custom messages for campaign-linked messages
            const campaignCustomMsgMap: Record<string, Record<number, any>> = {};
            if (campaignIds.length > 0) {
                const campaignsWithMsgs = await CampaignModel.find({
                    _id: { $in: campaignIds.map(id => new mongoose.Types.ObjectId(id)) }
                }).select('customMessages').lean();
                campaignsWithMsgs.forEach(c => {
                    if (c.customMessages && c.customMessages.length > 0) {
                        campaignCustomMsgMap[c._id.toString()] = {};
                        c.customMessages.forEach((cm: any) => {
                            campaignCustomMsgMap[c._id.toString()][cm.dayNumber] = cm;
                        });
                    }
                });
            }

            // Build final response with rendered HTML
            const messages = recentMessages.map(m => {
                const referralUser = userDetailsMap[m.referralUserId] || null;
                const recipientName = referralUser?.name || 'Utilisateur';

                // Determine which template to use: campaign custom > default template
                let messageTemplate = templateMap[m.day];
                if (m.campaignId && campaignCustomMsgMap[m.campaignId]?.[m.day]) {
                    messageTemplate = campaignCustomMsgMap[m.campaignId][m.day];
                }

                // Reconstruct rendered HTML if template exists
                let renderedHtml: string | null = null;
                if (messageTemplate?.messageTemplate?.fr) {
                    try {
                        let msgText = messageTemplate.messageTemplate.fr
                            .replace(/\{\{name\}\}/g, recipientName)
                            .replace(/\{\{referrerName\}\}/g, 'Parrain SBC')
                            .replace(/\{\{day\}\}/g, m.day.toString());

                        renderedHtml = emailRelanceService.createRelanceTemplate(
                            msgText,
                            m.day,
                            recipientName,
                            'Parrain SBC',
                            messageTemplate.mediaUrls,
                            messageTemplate.buttons,
                            messageTemplate.subject
                        );
                    } catch (err) {
                        // Skip if template rendering fails
                    }
                }

                return {
                    day: m.day,
                    sentAt: m.sentAt,
                    status: m.status,
                    errorMessage: m.errorMessage || undefined,
                    referralUser,
                    campaignId: m.campaignId,
                    campaignName: m.campaignId ? (campaignNameMap[m.campaignId] || null) : null,
                    renderedHtml
                };
            });

            res.status(200).json({
                success: true,
                data: {
                    messages,
                    total: allMessages.length
                }
            });

        } catch (error: any) {
            log.error('Error getting recent messages:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get recent messages',
                error: error.message
            });
        }
    }

    /**
     * Get stats for a specific campaign
     * GET /api/relance/campaigns/:id/stats
     */
    async getCampaignStatsById(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId;
            const campaignId = req.params.id;

            if (!userId) {
                res.status(400).json({ success: false, message: 'User ID is required' });
                return;
            }

            if (!campaignId) {
                res.status(400).json({ success: false, message: 'Campaign ID is required' });
                return;
            }

            // Get campaign and verify ownership
            const campaign = await CampaignModel.findById(campaignId);
            if (!campaign) {
                res.status(404).json({ success: false, message: 'Campaign not found' });
                return;
            }

            const campaignObjectId = new mongoose.Types.ObjectId(campaignId);

            const activeTargets = await RelanceTargetModel.countDocuments({
                campaignId: campaignObjectId,
                status: TargetStatus.ACTIVE
            });

            const completedTargets = await RelanceTargetModel.countDocuments({
                campaignId: campaignObjectId,
                status: TargetStatus.COMPLETED
            });

            // Get all targets for detailed stats
            const targets = await RelanceTargetModel.find({
                campaignId: campaignObjectId
            });

            let totalMessagesSent = 0;
            let totalMessagesDelivered = 0;
            let totalMessagesFailed = 0;
            let totalMessagesOpened = 0;
            let totalMessagesClicked = 0;
            let totalOpens = 0;
            let totalClicks = 0;

            targets.forEach(target => {
                target.messagesDelivered.forEach(m => {
                    totalMessagesSent++;
                    if (m.status === 'delivered') {
                        totalMessagesDelivered++;
                    }
                    if (m.status === 'failed') {
                        totalMessagesFailed++;
                    }
                    if (m.opened) {
                        totalMessagesOpened++;
                        totalOpens += m.openCount || 0;
                    }
                    if (m.clicked) {
                        totalMessagesClicked++;
                        totalClicks += m.clickCount || 0;
                    }
                });
            });

            const deliveryPercentage = totalMessagesSent > 0
                ? (totalMessagesDelivered / totalMessagesSent) * 100
                : 0;

            const openRate = totalMessagesDelivered > 0
                ? (totalMessagesOpened / totalMessagesDelivered) * 100
                : 0;

            const clickRate = totalMessagesDelivered > 0
                ? (totalMessagesClicked / totalMessagesDelivered) * 100
                : 0;

            const clickThroughRate = totalMessagesOpened > 0
                ? (totalMessagesClicked / totalMessagesOpened) * 100
                : 0;

            // Day-by-day progression
            const dayProgression = [];
            for (let day = 1; day <= 7; day++) {
                const targetsOnDay = targets.filter(
                    target => target.currentDay === day && target.status === TargetStatus.ACTIVE
                );
                dayProgression.push({ day, count: targetsOnDay.length });
            }

            const totalEnrolled = targets.length;

            // Count completed relance (those who finished 7 days without paying)
            const completedRelance = targets.filter(
                target => target.status === TargetStatus.COMPLETED && target.exitReason === ExitReason.COMPLETED_7_DAYS
            ).length;

            // Count conversions (those who paid during relance)
            const targetsConverted = targets.filter(
                target => target.status === TargetStatus.COMPLETED && target.exitReason === ExitReason.PAID
            ).length;

            // Count other exits (manual, referrer inactive)
            const targetsExited = targets.filter(
                target => target.status === TargetStatus.COMPLETED &&
                    target.exitReason !== ExitReason.PAID &&
                    target.exitReason !== ExitReason.COMPLETED_7_DAYS
            ).length;

            // Exit reason breakdown
            const exitReasons: Record<string, number> = {};
            targets.forEach(target => {
                if (target.exitReason) {
                    exitReasons[target.exitReason] = (exitReasons[target.exitReason] || 0) + 1;
                }
            });

            res.status(200).json({
                success: true,
                data: {
                    campaign: {
                        _id: campaign._id,
                        name: campaign.name,
                        status: campaign.status,
                        type: campaign.type,
                        actualStartDate: campaign.actualStartDate,
                        actualEndDate: campaign.actualEndDate
                    },
                    totalEnrolled,
                    activeTargets,
                    completedRelance,
                    targetsConverted,
                    targetsExited,
                    totalMessagesSent,
                    totalMessagesDelivered,
                    totalMessagesFailed,
                    deliveryPercentage: parseFloat(deliveryPercentage.toFixed(2)),
                    // Email engagement metrics
                    totalMessagesOpened,
                    totalMessagesClicked,
                    totalOpens,
                    totalClicks,
                    openRate: parseFloat(openRate.toFixed(2)),
                    clickRate: parseFloat(clickRate.toFixed(2)),
                    clickThroughRate: parseFloat(clickThroughRate.toFixed(2)),
                    dayProgression,
                    exitReasons
                }
            });

        } catch (error: any) {
            log.error('Error getting campaign stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get campaign statistics',
                error: error.message
            });
        }
    }

    /**
     * Get recent messages for a specific campaign
     * GET /api/relance/campaigns/:id/messages/recent?limit=10
     */
    async getCampaignRecentMessages(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId;
            const campaignId = req.params.id;
            const { limit = '10' } = req.query;

            if (!userId) {
                res.status(400).json({ success: false, message: 'User ID is required' });
                return;
            }

            if (!campaignId) {
                res.status(400).json({ success: false, message: 'Campaign ID is required' });
                return;
            }

            const limitNum = Math.min(parseInt(limit as string) || 10, 50);
            const campaignObjectId = new mongoose.Types.ObjectId(campaignId);

            // Get campaign name
            const campaign = await CampaignModel.findById(campaignId).select('name').lean();

            const targets = await RelanceTargetModel.find({
                campaignId: campaignObjectId,
                'messagesDelivered.0': { $exists: true }
            })
                .select('referralUserId messagesDelivered')
                .lean();

            // Flatten messages
            const allMessages: Array<{
                day: number;
                sentAt: Date;
                status: string;
                errorMessage?: string;
                referralUserId: string;
            }> = [];

            for (const target of targets) {
                for (const msg of target.messagesDelivered) {
                    allMessages.push({
                        day: msg.day,
                        sentAt: msg.sentAt,
                        status: msg.status,
                        errorMessage: msg.errorMessage,
                        referralUserId: target.referralUserId.toString()
                    });
                }
            }

            allMessages.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
            const recentMessages = allMessages.slice(0, limitNum);

            // Fetch user details
            const referralUserIds = [...new Set(recentMessages.map(m => m.referralUserId))];
            let userDetailsMap: Record<string, any> = {};

            if (referralUserIds.length > 0) {
                try {
                    const userDetails = await userServiceClient.getBatchUserDetails(referralUserIds);
                    userDetails.forEach((u: any) => {
                        userDetailsMap[u._id.toString()] = {
                            _id: u._id,
                            name: u.name,
                            email: u.email,
                            phoneNumber: u.phoneNumber,
                            avatar: u.avatar
                        };
                    });
                } catch (err: any) {
                    log.warn(`Failed to fetch user details: ${err.message}`);
                }
            }

            // Fetch message templates and campaign custom messages for rendering
            const uniqueDays = [...new Set(recentMessages.map(m => m.day))];
            const defaultTemplates = await RelanceMessageModel.find({
                dayNumber: { $in: uniqueDays }
            }).lean();
            const defaultTemplateMap: Record<number, any> = {};
            defaultTemplates.forEach(t => {
                defaultTemplateMap[t.dayNumber] = t;
            });

            // Get campaign custom messages
            const fullCampaign = await CampaignModel.findById(campaignId).select('customMessages').lean();
            const customMsgMap: Record<number, any> = {};
            if (fullCampaign?.customMessages) {
                fullCampaign.customMessages.forEach((cm: any) => {
                    customMsgMap[cm.dayNumber] = cm;
                });
            }

            const messages = recentMessages.map(m => {
                const referralUser = userDetailsMap[m.referralUserId] || null;
                const recipientName = referralUser?.name || 'Utilisateur';

                // Use campaign custom message if available, else default template
                const messageTemplate = customMsgMap[m.day] || defaultTemplateMap[m.day];

                let renderedHtml: string | null = null;
                if (messageTemplate?.messageTemplate?.fr) {
                    try {
                        let msgText = messageTemplate.messageTemplate.fr
                            .replace(/\{\{name\}\}/g, recipientName)
                            .replace(/\{\{referrerName\}\}/g, 'Parrain SBC')
                            .replace(/\{\{day\}\}/g, m.day.toString());

                        renderedHtml = emailRelanceService.createRelanceTemplate(
                            msgText,
                            m.day,
                            recipientName,
                            'Parrain SBC',
                            messageTemplate.mediaUrls,
                            messageTemplate.buttons,
                            messageTemplate.subject
                        );
                    } catch (err) {
                        // Skip if template rendering fails
                    }
                }

                return {
                    day: m.day,
                    sentAt: m.sentAt,
                    status: m.status,
                    errorMessage: m.errorMessage || undefined,
                    referralUser,
                    renderedHtml
                };
            });

            res.status(200).json({
                success: true,
                data: {
                    campaignName: campaign?.name || null,
                    messages,
                    total: allMessages.length
                }
            });

        } catch (error: any) {
            log.error('Error getting campaign recent messages:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get campaign recent messages',
                error: error.message
            });
        }
    }
}

export const relanceCampaignController = new RelanceCampaignController();
