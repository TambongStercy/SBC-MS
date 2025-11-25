import { Request, Response } from 'express';
import logger from '../../utils/logger';
import RelanceConfigModel from '../../database/models/relance-config.model';
import RelanceMessageModel from '../../database/models/relance-message.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../../database/models/relance-target.model';

const log = logger.getLogger('RelanceController');

interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        role?: string;
    };
}

class RelanceController {
    /**
     * GET /api/relance/status
     * Check relance configuration status (email-based)
     */
    async getStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Unauthorized' });
                return;
            }

            const config = await RelanceConfigModel.findOne({ userId });

            res.status(200).json({
                success: true,
                data: {
                    channel: config?.channel || 'email',
                    enabled: config?.enabled || false,
                    enrollmentPaused: config?.enrollmentPaused || false,
                    sendingPaused: config?.sendingPaused || false,
                    messagesSentToday: config?.messagesSentToday || 0,
                    maxMessagesPerDay: config?.maxMessagesPerDay || 60
                }
            });
        } catch (error: any) {
            log.error('Error in getStatus:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get status'
            });
        }
    }

    /**
     * PUT /api/relance/settings
     * Update pause settings
     */
    async updateSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Unauthorized' });
                return;
            }

            const { enabled, enrollmentPaused, sendingPaused } = req.body;

            const updates: any = {};
            if (typeof enabled === 'boolean') updates.enabled = enabled;
            if (typeof enrollmentPaused === 'boolean') updates.enrollmentPaused = enrollmentPaused;
            if (typeof sendingPaused === 'boolean') updates.sendingPaused = sendingPaused;

            const config = await RelanceConfigModel.findOneAndUpdate(
                { userId },
                { $set: updates },
                { new: true, upsert: true }
            );

            res.status(200).json({
                success: true,
                data: config
            });
        } catch (error: any) {
            log.error('Error in updateSettings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update settings'
            });
        }
    }

    /**
     * GET /api/relance/targets
     * Get user's active relance targets
     */
    async getMyTargets(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Unauthorized' });
                return;
            }

            const targets = await RelanceTargetModel.find({
                referrerUserId: userId,
                status: TargetStatus.ACTIVE
            }).sort({ createdAt: -1 }).limit(100);

            res.status(200).json({
                success: true,
                data: targets
            });
        } catch (error: any) {
            log.error('Error in getMyTargets:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get targets'
            });
        }
    }

    // ===== ADMIN METHODS =====

    /**
     * GET /api/relance/admin/messages
     * Get all relance messages
     */
    async getAllMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const messages = await RelanceMessageModel.find().sort({ dayNumber: 1 });

            res.status(200).json({
                success: true,
                data: messages
            });
        } catch (error: any) {
            log.error('Error in getAllMessages:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get messages'
            });
        }
    }

    /**
     * GET /api/relance/admin/messages/:day
     * Get specific day message
     */
    async getMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const day = parseInt(req.params.day);

            if (day < 1 || day > 7) {
                res.status(400).json({
                    success: false,
                    message: 'Day must be between 1 and 7'
                });
                return;
            }

            const message = await RelanceMessageModel.findOne({ dayNumber: day });

            if (!message) {
                res.status(404).json({
                    success: false,
                    message: 'Message not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: message
            });
        } catch (error: any) {
            log.error('Error in getMessage:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get message'
            });
        }
    }

    /**
     * POST /api/relance/admin/messages
     * Create/update relance message
     */
    async upsertMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { dayNumber, messageTemplate, mediaUrls, active } = req.body;

            if (!dayNumber || dayNumber < 1 || dayNumber > 7) {
                res.status(400).json({
                    success: false,
                    message: 'Valid dayNumber (1-7) is required'
                });
                return;
            }

            if (!messageTemplate || !messageTemplate.fr) {
                res.status(400).json({
                    success: false,
                    message: 'messageTemplate.fr is required'
                });
                return;
            }

            const message = await RelanceMessageModel.findOneAndUpdate(
                { dayNumber },
                {
                    messageTemplate,
                    mediaUrls: mediaUrls || [],
                    active: active !== undefined ? active : true
                },
                { new: true, upsert: true }
            );

            res.status(200).json({
                success: true,
                data: message
            });
        } catch (error: any) {
            log.error('Error in upsertMessage:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to save message'
            });
        }
    }

    /**
     * DELETE /api/relance/admin/messages/:day
     * Deactivate message
     */
    async deactivateMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const day = parseInt(req.params.day);

            await RelanceMessageModel.updateOne(
                { dayNumber: day },
                { active: false }
            );

            res.status(200).json({
                success: true,
                message: 'Message deactivated'
            });
        } catch (error: any) {
            log.error('Error in deactivateMessage:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to deactivate message'
            });
        }
    }

    /**
     * GET /api/relance/admin/stats
     * Get relance statistics
     */
    async getStats(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            const [
                totalActiveTargets,
                totalCompletedTargets,
                activeConfigsCount,
                targetsEnrolledToday,
                messagesSentToday,
                allTargets,
                exitReasonsPaid,
                exitReasonsCompleted,
                exitReasonsExpired,
                exitReasonsManual
            ] = await Promise.all([
                RelanceTargetModel.countDocuments({ status: TargetStatus.ACTIVE }),
                RelanceTargetModel.countDocuments({ status: TargetStatus.COMPLETED }),
                RelanceConfigModel.countDocuments({ enabled: true }),
                RelanceTargetModel.countDocuments({ enteredLoopAt: { $gte: todayStart } }),
                RelanceConfigModel.aggregate([
                    { $match: { lastResetDate: { $gte: todayStart } } },
                    { $group: { _id: null, total: { $sum: '$messagesSentToday' } } }
                ]),
                RelanceTargetModel.aggregate([
                    { $unwind: '$messagesDelivered' },
                    { $group: { _id: null, total: { $sum: 1 }, successful: { $sum: { $cond: ['$messagesDelivered.success', 1, 0] } } } }
                ]),
                RelanceTargetModel.countDocuments({ exitReason: ExitReason.PAID }),
                RelanceTargetModel.countDocuments({ exitReason: ExitReason.COMPLETED_7_DAYS }),
                RelanceTargetModel.countDocuments({ exitReason: ExitReason.REFERRER_INACTIVE }),
                RelanceTargetModel.countDocuments({ exitReason: ExitReason.MANUAL })
            ]);

            const totalMessagesSent = allTargets[0]?.total || 0;
            const successfulMessages = allTargets[0]?.successful || 0;
            const totalSuccessRate = totalMessagesSent > 0 ? (successfulMessages / totalMessagesSent) * 100 : 0;

            res.status(200).json({
                success: true,
                data: {
                    totalActiveTargets,
                    totalCompletedTargets,
                    totalMessagesSent,
                    totalSuccessRate,
                    activeConfigsCount,
                    targetsEnrolledToday,
                    messagesSentToday: messagesSentToday[0]?.total || 0,
                    exitReasons: {
                        paid: exitReasonsPaid,
                        completed_7_days: exitReasonsCompleted,
                        subscription_expired: exitReasonsExpired,
                        manual: exitReasonsManual
                    }
                }
            });
        } catch (error: any) {
            log.error('Error in getStats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get stats'
            });
        }
    }

    /**
     * GET /api/relance/admin/logs
     * Get relance logs (recent targets)
     */
    async getLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;
            const skip = (page - 1) * limit;

            const [logs, total] = await Promise.all([
                RelanceTargetModel.find()
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                RelanceTargetModel.countDocuments()
            ]);

            res.status(200).json({
                success: true,
                data: {
                    logs,
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error: any) {
            log.error('Error in getLogs:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get logs'
            });
        }
    }

    /**
     * GET /api/relance/admin/targets
     * Get active targets with pagination
     */
    async getActiveTargets(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const status = req.query.status as string || TargetStatus.ACTIVE;
            const skip = (page - 1) * limit;

            const [targets, total] = await Promise.all([
                RelanceTargetModel.find({ status })
                    .sort({ enteredLoopAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                RelanceTargetModel.countDocuments({ status })
            ]);

            res.status(200).json({
                success: true,
                data: {
                    targets,
                    total,
                    page,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error: any) {
            log.error('Error in getActiveTargets:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get active targets'
            });
        }
    }

    /**
     * GET /api/relance/admin/configs
     * Get all active relance configs
     */
    async getActiveConfigs(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const configs = await RelanceConfigModel.find({ enabled: true })
                .sort({ updatedAt: -1 })
                .lean();

            res.status(200).json({
                success: true,
                data: configs
            });
        } catch (error: any) {
            log.error('Error in getActiveConfigs:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get active configs'
            });
        }
    }

    /**
     * POST /api/relance/admin/upload-media
     * Upload media file for relance messages
     */
    async uploadMedia(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            if (!req.file) {
                res.status(400).json({
                    success: false,
                    message: 'No file uploaded'
                });
                return;
            }

            // Generate public URL for the uploaded file
            const protocol = req.protocol;
            const host = req.get('host');
            const fileUrl = `${protocol}://${host}/api/relance/media/${req.file.filename}`;

            // Determine media type from mimetype
            let mediaType: 'image' | 'video' | 'pdf' = 'image';
            if (req.file.mimetype.startsWith('video/')) {
                mediaType = 'video';
            } else if (req.file.mimetype === 'application/pdf') {
                mediaType = 'pdf';
            }

            res.status(200).json({
                success: true,
                data: {
                    url: fileUrl,
                    type: mediaType,
                    filename: req.file.filename,
                    originalName: req.file.originalname,
                    size: req.file.size
                }
            });
        } catch (error: any) {
            log.error('Error in uploadMedia:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to upload media'
            });
        }
    }

    // ===== INTERNAL METHOD =====

    /**
     * POST /api/relance/internal/exit-user
     * Remove user from relance loop (when they pay)
     */
    async exitUserFromLoop(req: Request, res: Response): Promise<void> {
        try {
            const { userId } = req.body;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'userId is required'
                });
                return;
            }

            // Find active target for this user
            const target = await RelanceTargetModel.findOne({
                referralUserId: userId,
                status: TargetStatus.ACTIVE
            });

            if (target) {
                target.status = TargetStatus.COMPLETED;
                target.exitReason = ExitReason.PAID;
                target.exitedLoopAt = new Date();
                await target.save();

                log.info(`User ${userId} exited relance loop (paid subscription)`);
            }

            res.status(200).json({
                success: true,
                message: 'User removed from relance loop'
            });
        } catch (error: any) {
            log.error('Error in exitUserFromLoop:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to exit user from loop'
            });
        }
    }
}

export const relanceController = new RelanceController();