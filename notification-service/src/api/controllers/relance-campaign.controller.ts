import { Request, Response } from 'express';
import { campaignService } from '../../services/campaign.service';
import CampaignModel, { CampaignStatus, CampaignType, TargetFilter } from '../../database/models/relance-campaign.model';
import RelanceTargetModel from '../../database/models/relance-target.model';
import RelanceConfigModel from '../../database/models/relance-config.model';
import { userServiceClient } from '../../services/clients/user.service.client';
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

            // Get all unpaid referrals for this user
            let unpaidReferrals = await userServiceClient.getUnpaidReferrals(userId);

            // Apply filters (same logic as enrollment job)
            const filter: TargetFilter = targetFilter;

            // Filter by registration date
            if (filter.registrationDateFrom || filter.registrationDateTo) {
                unpaidReferrals = unpaidReferrals.filter((ref: any) => {
                    const regDate = new Date(ref.createdAt);
                    if (filter.registrationDateFrom && regDate < filter.registrationDateFrom) return false;
                    if (filter.registrationDateTo && regDate > filter.registrationDateTo) return false;
                    return true;
                });
            }

            // Filter by country
            if (filter.countries && filter.countries.length > 0) {
                unpaidReferrals = unpaidReferrals.filter((ref: any) =>
                    filter.countries!.includes(ref.country)
                );
            }

            // Filter by gender
            if (filter.gender && filter.gender !== 'all') {
                unpaidReferrals = unpaidReferrals.filter((ref: any) =>
                    ref.gender === filter.gender
                );
            }

            // Filter by profession
            if (filter.professions && filter.professions.length > 0) {
                unpaidReferrals = unpaidReferrals.filter((ref: any) =>
                    filter.professions!.includes(ref.profession)
                );
            }

            // Filter by age
            if (filter.minAge || filter.maxAge) {
                unpaidReferrals = unpaidReferrals.filter((ref: any) => {
                    if (!ref.age) return false;
                    if (filter.minAge && ref.age < filter.minAge) return false;
                    if (filter.maxAge && ref.age > filter.maxAge) return false;
                    return true;
                });
            }

            // Exclude referrals already in active campaigns
            if (filter.excludeCurrentTargets) {
                const existingTargetIds = await RelanceTargetModel.distinct('referralUserId', {
                    status: { $in: ['active', 'paused'] }
                });

                unpaidReferrals = unpaidReferrals.filter((ref: any) =>
                    !existingTargetIds.some((id: any) => id.toString() === ref._id.toString())
                );
            }

            const totalCount = unpaidReferrals.length;

            // Get sample of 5 users
            const sampleUsers = unpaidReferrals.slice(0, 5).map((ref: any) => ({
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

            res.status(200).json({
                success: true,
                data: {
                    totalCount,
                    sampleUsers,
                    message: totalCount === 0 ? 'No users match the selected filters' :
                             totalCount === 1 ? '1 user matches the selected filters' :
                             `${totalCount} users match the selected filters`
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

            if (typeof maxMessagesPerDay === 'number' && maxMessagesPerDay >= 1 && maxMessagesPerDay <= 100) {
                config.maxMessagesPerDay = maxMessagesPerDay;
            }

            if (typeof maxTargetsPerCampaign === 'number' && maxTargetsPerCampaign >= 10 && maxTargetsPerCampaign <= 1000) {
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
}

export const relanceCampaignController = new RelanceCampaignController();
