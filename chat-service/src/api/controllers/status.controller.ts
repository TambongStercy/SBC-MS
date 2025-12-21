import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { statusService } from '../../services/status.service';
import { StatusCategory } from '../../config/status-categories';
import { StatusMediaType } from '../../database/models/status.model';
import { isVideo, isImage, validateFileSize } from '../middleware/upload.middleware';
import { settingsServiceClient } from '../../services/clients/settings.service.client';
import logger from '../../utils/logger';

const log = logger.getLogger('StatusController');

class StatusController {
    /**
     * Get status feed
     * GET /api/chat/statuses
     */
    async getStatusFeed(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const filters = {
                category: req.query.category as StatusCategory | undefined,
                country: req.query.country as string | undefined,
                city: req.query.city as string | undefined,
                search: req.query.search as string | undefined,
                sortBy: req.query.sortBy as 'recent' | 'popular' | undefined
            };

            const result = await statusService.getStatusFeed(userId, filters, page, limit);

            res.status(200).json({
                success: true,
                data: result.statuses,
                pagination: {
                    currentPage: page,
                    totalPages: result.totalPages,
                    totalCount: result.total,
                    limit
                }
            });
        } catch (error: any) {
            log.error('Error getting status feed:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get status feed'
            });
        }
    }

    /**
     * Create a new status
     * POST /api/chat/statuses
     */
    async createStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const isAdmin = req.user!.role === 'admin';
            const { category, content, country, city, region, videoDuration } = req.body;
            const file = req.file;

            if (!category || !content) {
                res.status(400).json({
                    success: false,
                    message: 'category and content are required'
                });
                return;
            }

            // Validate category
            if (!Object.values(StatusCategory).includes(category)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid category'
                });
                return;
            }

            let mediaType: StatusMediaType = StatusMediaType.TEXT;
            let mediaUrl: string | undefined;
            let mediaThumbnailUrl: string | undefined;
            let duration: number | undefined;

            // Handle file upload
            if (file) {
                // Validate file size
                const sizeValidation = validateFileSize(file);
                if (!sizeValidation.valid) {
                    res.status(400).json({
                        success: false,
                        message: sizeValidation.error
                    });
                    return;
                }

                // Determine media type
                if (isVideo(file.mimetype)) {
                    mediaType = StatusMediaType.VIDEO;
                    duration = videoDuration ? parseInt(videoDuration) : undefined;

                    // Validate video duration
                    if (duration && duration > 30) {
                        res.status(400).json({
                            success: false,
                            message: 'Video duration cannot exceed 30 seconds'
                        });
                        return;
                    }
                } else if (isImage(file.mimetype)) {
                    // Could be image or flyer based on category
                    mediaType = category === StatusCategory.BUSINESS_OPPORTUNITIES
                        ? StatusMediaType.FLYER
                        : StatusMediaType.IMAGE;
                }

                // Upload to private bucket via settings-service
                try {
                    const folder = isVideo(file.mimetype) ? 'statuses/videos' : 'statuses/images';
                    const uploadResult = await settingsServiceClient.uploadFilePrivate(
                        file.buffer,
                        file.mimetype,
                        file.originalname,
                        folder
                    );

                    // Store the GCS path (gs://bucket/path/file.ext)
                    // We'll generate signed URLs when retrieving
                    mediaUrl = uploadResult.gcsPath;

                    log.info(`File uploaded to private bucket: ${uploadResult.fileName}`);

                    // TODO: Generate video thumbnail if needed
                    // mediaThumbnailUrl = await settingsServiceClient.generateVideoThumbnail(uploadResult.fileName);
                } catch (uploadError) {
                    log.error('Failed to upload file to private bucket:', uploadError);
                    res.status(500).json({
                        success: false,
                        message: 'Failed to upload media file'
                    });
                    return;
                }
            }

            const status = await statusService.createStatus({
                authorId: userId,
                category,
                content: content.trim(),
                mediaType,
                mediaUrl,
                mediaThumbnailUrl,
                videoDuration: duration,
                country,
                city,
                region
            }, isAdmin);

            // Get full status with author info
            const statusWithAuthor = await statusService.getStatus(status._id.toString(), userId);

            res.status(201).json({
                success: true,
                data: statusWithAuthor
            });
        } catch (error: any) {
            if (error.message.includes('Only admins')) {
                res.status(403).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            if (error.message.includes('exceeds maximum')) {
                res.status(400).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            log.error('Error creating status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create status'
            });
        }
    }

    /**
     * Get status categories
     * GET /api/chat/statuses/categories
     */
    async getCategories(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const isAdmin = req.user!.role === 'admin';
            const categories = statusService.getCategories(isAdmin);

            res.status(200).json({
                success: true,
                data: categories
            });
        } catch (error: any) {
            log.error('Error getting categories:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get categories'
            });
        }
    }

    /**
     * Get statuses by user
     * GET /api/chat/statuses/user/:userId
     */
    async getUserStatuses(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const viewerId = req.user!.userId;
            const { userId } = req.params;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await statusService.getUserStatuses(userId, viewerId, page, limit);

            res.status(200).json({
                success: true,
                data: result.statuses,
                pagination: {
                    currentPage: page,
                    totalPages: result.totalPages,
                    totalCount: result.total,
                    limit
                }
            });
        } catch (error: any) {
            log.error('Error getting user statuses:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get user statuses'
            });
        }
    }

    /**
     * Get current user's own statuses
     * GET /api/chat/statuses/my-statuses
     */
    async getMyStatuses(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await statusService.getUserStatuses(userId, userId, page, limit);

            res.status(200).json({
                success: true,
                data: result.statuses,
                pagination: {
                    currentPage: page,
                    totalPages: result.totalPages,
                    totalCount: result.total,
                    limit
                }
            });
        } catch (error: any) {
            log.error('Error getting my statuses:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get your statuses'
            });
        }
    }

    /**
     * Get single status
     * GET /api/chat/statuses/:id
     */
    async getStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const status = await statusService.getStatus(id, userId);

            if (!status) {
                res.status(404).json({
                    success: false,
                    message: 'Status not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: status
            });
        } catch (error: any) {
            log.error('Error getting status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get status'
            });
        }
    }

    /**
     * Delete status
     * DELETE /api/chat/statuses/:id
     */
    async deleteStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const status = await statusService.deleteStatus(id, userId);

            if (!status) {
                res.status(404).json({
                    success: false,
                    message: 'Status not found or you are not the author'
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'Status deleted'
            });
        } catch (error: any) {
            log.error('Error deleting status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete status'
            });
        }
    }

    /**
     * Like status
     * POST /api/chat/statuses/:id/like
     */
    async likeStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const result = await statusService.likeStatus(id, userId);

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error: any) {
            log.error('Error liking status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to like status'
            });
        }
    }

    /**
     * Unlike status
     * DELETE /api/chat/statuses/:id/like
     */
    async unlikeStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const result = await statusService.unlikeStatus(id, userId);

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error: any) {
            log.error('Error unliking status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to unlike status'
            });
        }
    }

    /**
     * Repost status
     * POST /api/chat/statuses/:id/repost
     */
    async repostStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const result = await statusService.repostStatus(id, userId);

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error: any) {
            log.error('Error reposting status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to repost status'
            });
        }
    }

    /**
     * Reply to status (starts conversation)
     * POST /api/chat/statuses/:id/reply
     */
    async replyToStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const result = await statusService.replyToStatus(id, userId);

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error: any) {
            if (error.message === 'Status not found') {
                res.status(404).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            if (error.message === 'Cannot reply to your own status') {
                res.status(400).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            log.error('Error replying to status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to reply to status'
            });
        }
    }

    /**
     * Get interactions (likes/reposts)
     * GET /api/chat/statuses/:id/interactions
     */
    async getInteractions(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const type = req.query.type as 'likes' | 'reposts' || 'likes';
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;

            const result = await statusService.getInteractions(id, type, page, limit);

            res.status(200).json({
                success: true,
                data: result.interactions,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(result.total / limit),
                    totalCount: result.total,
                    limit
                }
            });
        } catch (error: any) {
            log.error('Error getting interactions:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get interactions'
            });
        }
    }

    /**
     * Increment view count for a status
     * POST /api/chat/statuses/:id/view
     */
    async incrementView(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            await statusService.incrementViewCount(id, userId);

            res.status(200).json({
                success: true,
                message: 'View recorded'
            });
        } catch (error: any) {
            log.error('Error recording view:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to record view'
            });
        }
    }
}

export const statusController = new StatusController();
