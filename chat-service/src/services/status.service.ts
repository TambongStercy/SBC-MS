import { Types } from 'mongoose';
import { statusRepository, StatusFilters } from '../database/repositories/status.repository';
import { statusInteractionRepository } from '../database/repositories/status-interaction.repository';
import { IStatus, StatusMediaType } from '../database/models/status.model';
import { InteractionType } from '../database/models/status-interaction.model';
import { StatusCategory, isAdminCategory, getAllCategories, getCategoryDefinition } from '../config/status-categories';
import { conversationService } from './conversation.service';
import { userServiceClient } from './clients/user.service.client';
import { settingsServiceClient } from './clients/settings.service.client';
import { contentModerationService } from './content-moderation.service';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('StatusService');

export interface CreateStatusData {
    authorId: string;
    category: StatusCategory;
    content: string;
    mediaType?: StatusMediaType;
    mediaUrl?: string;
    mediaThumbnailUrl?: string;
    videoDuration?: number;
    country?: string;
    city?: string;
    region?: string;
}

export interface StatusWithAuthor extends IStatus {
    author?: {
        _id: string;
        name: string;
        avatar?: string;
    };
    categoryInfo?: {
        name: string;
        badge: string;
        badgeColor: string;
        icon: string;
    };
    isLiked?: boolean;
    isReposted?: boolean;
}

class StatusService {
    /**
     * Create a new status
     */
    async createStatus(data: CreateStatusData, isAdmin: boolean = false): Promise<IStatus> {
        // Validate content length
        if (data.content.length > config.status.maxContentLength) {
            throw new Error(`Status content exceeds maximum length of ${config.status.maxContentLength} characters`);
        }

        // Validate category permissions
        if (isAdminCategory(data.category) && !isAdmin) {
            throw new Error('Only admins can post in this category');
        }

        // Validate video duration
        if (data.mediaType === StatusMediaType.VIDEO && data.videoDuration) {
            if (data.videoDuration > config.status.maxVideoSeconds) {
                throw new Error(`Video duration exceeds maximum of ${config.status.maxVideoSeconds} seconds`);
            }
        }

        // Content moderation check for images and videos
        let moderationResult;
        if (data.mediaUrl && (data.mediaType === StatusMediaType.IMAGE || data.mediaType === StatusMediaType.VIDEO)) {
            try {
                if (data.mediaType === StatusMediaType.IMAGE) {
                    moderationResult = await contentModerationService.moderateImage(data.mediaUrl);
                } else if (data.mediaType === StatusMediaType.VIDEO) {
                    moderationResult = await contentModerationService.moderateVideo(data.mediaUrl);
                }

                // Block if content is blocked
                if (moderationResult && moderationResult.action === 'block') {
                    throw new Error(
                        `Your content has been blocked due to: ${moderationResult.reason}. ` +
                        'Pornographic, violent, or offensive content is not allowed on this platform.'
                    );
                }

                // Warn if content is inappropriate but not blocked
                if (moderationResult && moderationResult.action === 'warn') {
                    log.warn(`User ${data.authorId} uploaded potentially inappropriate content: ${moderationResult.reason}`);
                    // Continue creating status but flag it
                }
            } catch (error: any) {
                // If moderation throws an error with message containing "blocked", throw it
                if (error.message && error.message.includes('blocked')) {
                    throw error;
                }
                // Otherwise log and continue (don't block legitimate content due to service errors)
                log.error('Content moderation error:', error);
            }
        }

        // Calculate expiry
        const expiresAt = new Date(Date.now() + config.status.defaultExpiryHours * 60 * 60 * 1000);

        // Create status
        const status = await statusRepository.create({
            authorId: new Types.ObjectId(data.authorId),
            category: data.category,
            content: data.content,
            mediaType: data.mediaType || StatusMediaType.TEXT,
            mediaUrl: data.mediaUrl,
            mediaThumbnailUrl: data.mediaThumbnailUrl,
            videoDuration: data.videoDuration,
            country: data.country,
            city: data.city,
            region: data.region,
            expiresAt,
            isApproved: true, // Auto-approve unless blocked
            contentModerationChecked: !!moderationResult,
            contentModerationResult: moderationResult ? {
                action: moderationResult.action,
                reason: moderationResult.reason,
                checkedAt: new Date(),
                scores: moderationResult.details
            } : undefined,
            contentWarned: moderationResult?.action === 'warn',
            contentWarnedAt: moderationResult?.action === 'warn' ? new Date() : undefined
        });

        // If content was warned, log it for admin review
        if (moderationResult?.action === 'warn') {
            log.warn(
                `Status ${status._id} flagged with warning: ${moderationResult.reason}. ` +
                `Scores: ${JSON.stringify(moderationResult.details)}`
            );
        }

        log.info(`Status created by ${data.authorId} in category ${data.category}`);

        return status;
    }

    /**
     * Get status feed with filters
     */
    async getStatusFeed(
        userId: string,
        filters: StatusFilters,
        page: number = 1,
        limit: number = 20
    ): Promise<{ statuses: StatusWithAuthor[]; total: number; totalPages: number }> {
        const { statuses, total } = await statusRepository.getStatusFeed(filters, page, limit);

        // Get author details
        const authorIds = [...new Set(statuses.map(s => s.authorId.toString()))];
        const userDetails = await userServiceClient.getMultipleUsers(authorIds);

        // Get user's interactions with these statuses
        const statusIds = statuses.map(s => s._id);
        const userInteractions = await statusInteractionRepository.getUserInteractionsForStatuses(
            userId,
            statusIds
        );

        // Build response with author info and interaction status
        const statusesWithAuthors: StatusWithAuthor[] = statuses.map(status => {
            const s = status.toObject() as StatusWithAuthor;
            const author = userDetails.get(status.authorId.toString());
            const categoryDef = getCategoryDefinition(status.category);
            const interactions = userInteractions.get(status._id.toString());

            s.author = author ? {
                _id: author._id,
                name: author.name,
                avatar: author.avatar
            } : undefined;

            s.categoryInfo = categoryDef ? {
                name: categoryDef.name,
                badge: categoryDef.badge,
                badgeColor: categoryDef.badgeColor,
                icon: categoryDef.icon
            } : undefined;

            s.isLiked = interactions?.liked || false;
            s.isReposted = interactions?.reposted || false;

            return s;
        });

        // Generate signed URLs for private media files via settings-service
        const statusesWithMedia = statusesWithAuthors.filter(s => s.mediaUrl && s.mediaUrl.startsWith('gs://'));
        if (statusesWithMedia.length > 0) {
            try {
                // Collect all GCS paths
                const allPaths: string[] = [];
                statusesWithMedia.forEach(status => {
                    if (status.mediaUrl && status.mediaUrl.startsWith('gs://')) {
                        allPaths.push(status.mediaUrl);
                    }
                    if (status.mediaThumbnailUrl && status.mediaThumbnailUrl.startsWith('gs://')) {
                        allPaths.push(status.mediaThumbnailUrl);
                    }
                });

                // Batch generate signed URLs via settings-service
                if (allPaths.length > 0) {
                    const signedUrls = await settingsServiceClient.getSignedUrls(allPaths, 3600); // 1 hour

                    // Replace GCS paths with signed URLs
                    statusesWithAuthors.forEach(status => {
                        if (status.mediaUrl && status.mediaUrl.startsWith('gs://')) {
                            const signedUrl = signedUrls.get(status.mediaUrl);
                            if (signedUrl) {
                                status.mediaUrl = signedUrl;
                            }
                        }
                        if (status.mediaThumbnailUrl && status.mediaThumbnailUrl.startsWith('gs://')) {
                            const signedUrl = signedUrls.get(status.mediaThumbnailUrl);
                            if (signedUrl) {
                                status.mediaThumbnailUrl = signedUrl;
                            }
                        }
                    });
                }
            } catch (error) {
                log.error('Error generating signed URLs for status feed:', error);
                // Continue without signed URLs - clients will handle missing media
            }
        }

        return {
            statuses: statusesWithAuthors,
            total,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * Get user's statuses
     */
    async getUserStatuses(
        authorId: string,
        viewerId: string,
        page: number = 1,
        limit: number = 20
    ): Promise<{ statuses: StatusWithAuthor[]; total: number; totalPages: number }> {
        const { statuses, total } = await statusRepository.getUserStatuses(authorId, page, limit);

        // Get author details
        const author = await userServiceClient.getUserDetails(authorId);

        // Get viewer's interactions
        const statusIds = statuses.map(s => s._id);
        const userInteractions = await statusInteractionRepository.getUserInteractionsForStatuses(
            viewerId,
            statusIds
        );

        const statusesWithAuthors: StatusWithAuthor[] = statuses.map(status => {
            const s = status.toObject() as StatusWithAuthor;
            const categoryDef = getCategoryDefinition(status.category);
            const interactions = userInteractions.get(status._id.toString());

            s.author = author ? {
                _id: author._id,
                name: author.name,
                avatar: author.avatar
            } : undefined;

            s.categoryInfo = categoryDef ? {
                name: categoryDef.name,
                badge: categoryDef.badge,
                badgeColor: categoryDef.badgeColor,
                icon: categoryDef.icon
            } : undefined;

            s.isLiked = interactions?.liked || false;
            s.isReposted = interactions?.reposted || false;

            return s;
        });

        // Generate signed URLs for private media files via settings-service
        const statusesWithMedia = statusesWithAuthors.filter(s => s.mediaUrl && s.mediaUrl.startsWith('gs://'));
        if (statusesWithMedia.length > 0) {
            try {
                // Collect all GCS paths
                const allPaths: string[] = [];
                statusesWithMedia.forEach(status => {
                    if (status.mediaUrl && status.mediaUrl.startsWith('gs://')) {
                        allPaths.push(status.mediaUrl);
                    }
                    if (status.mediaThumbnailUrl && status.mediaThumbnailUrl.startsWith('gs://')) {
                        allPaths.push(status.mediaThumbnailUrl);
                    }
                });

                // Batch generate signed URLs via settings-service
                if (allPaths.length > 0) {
                    const signedUrls = await settingsServiceClient.getSignedUrls(allPaths, 3600); // 1 hour

                    // Replace GCS paths with signed URLs
                    statusesWithAuthors.forEach(status => {
                        if (status.mediaUrl && status.mediaUrl.startsWith('gs://')) {
                            const signedUrl = signedUrls.get(status.mediaUrl);
                            if (signedUrl) {
                                status.mediaUrl = signedUrl;
                            }
                        }
                        if (status.mediaThumbnailUrl && status.mediaThumbnailUrl.startsWith('gs://')) {
                            const signedUrl = signedUrls.get(status.mediaThumbnailUrl);
                            if (signedUrl) {
                                status.mediaThumbnailUrl = signedUrl;
                            }
                        }
                    });
                }
            } catch (error) {
                log.error('Error generating signed URLs for user statuses:', error);
                // Continue without signed URLs - clients will handle missing media
            }
        }

        return {
            statuses: statusesWithAuthors,
            total,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * Get single status
     */
    async getStatus(statusId: string, viewerId: string): Promise<StatusWithAuthor | null> {
        const status = await statusRepository.findById(statusId);

        if (!status || status.deleted) {
            return null;
        }

        const author = await userServiceClient.getUserDetails(status.authorId.toString());
        const categoryDef = getCategoryDefinition(status.category);

        const [isLiked, isReposted] = await Promise.all([
            statusInteractionRepository.hasLiked(statusId, viewerId),
            statusInteractionRepository.hasReposted(statusId, viewerId)
        ]);

        const statusWithAuthor = status.toObject() as StatusWithAuthor;
        statusWithAuthor.author = author ? {
            _id: author._id,
            name: author.name,
            avatar: author.avatar
        } : undefined;

        statusWithAuthor.categoryInfo = categoryDef ? {
            name: categoryDef.name,
            badge: categoryDef.badge,
            badgeColor: categoryDef.badgeColor,
            icon: categoryDef.icon
        } : undefined;

        statusWithAuthor.isLiked = isLiked;
        statusWithAuthor.isReposted = isReposted;

        // Generate signed URLs for private media files via settings-service
        try {
            if (statusWithAuthor.mediaUrl && statusWithAuthor.mediaUrl.startsWith('gs://')) {
                statusWithAuthor.mediaUrl = await settingsServiceClient.getSignedUrl(statusWithAuthor.mediaUrl, 3600);
            }
            if (statusWithAuthor.mediaThumbnailUrl && statusWithAuthor.mediaThumbnailUrl.startsWith('gs://')) {
                statusWithAuthor.mediaThumbnailUrl = await settingsServiceClient.getSignedUrl(statusWithAuthor.mediaThumbnailUrl, 3600);
            }
        } catch (error) {
            log.error('Error generating signed URL for single status:', error);
            // Continue without signed URLs - client will handle missing media
        }

        return statusWithAuthor;
    }

    /**
     * Like a status
     */
    async likeStatus(statusId: string, userId: string): Promise<{ likesCount: number; authorId: string }> {
        // Check if already liked
        const alreadyLiked = await statusInteractionRepository.hasLiked(statusId, userId);
        if (alreadyLiked) {
            const status = await statusRepository.findById(statusId);
            return {
                likesCount: status?.likesCount || 0,
                authorId: status?.authorId.toString() || ''
            };
        }

        // Create interaction
        await statusInteractionRepository.create({
            statusId: new Types.ObjectId(statusId),
            userId: new Types.ObjectId(userId),
            type: InteractionType.LIKE
        });

        // Increment count
        const status = await statusRepository.incrementLikeCount(statusId);

        log.debug(`User ${userId} liked status ${statusId}`);

        return {
            likesCount: status?.likesCount || 0,
            authorId: status?.authorId.toString() || ''
        };
    }

    /**
     * Unlike a status
     */
    async unlikeStatus(statusId: string, userId: string): Promise<{ likesCount: number }> {
        // Delete interaction
        const deleted = await statusInteractionRepository.deleteInteraction(
            statusId,
            userId,
            InteractionType.LIKE
        );

        if (deleted) {
            // Decrement count
            const status = await statusRepository.decrementLikeCount(statusId);
            log.debug(`User ${userId} unliked status ${statusId}`);
            return { likesCount: status?.likesCount || 0 };
        }

        const status = await statusRepository.findById(statusId);
        return { likesCount: status?.likesCount || 0 };
    }

    /**
     * Repost a status
     */
    async repostStatus(statusId: string, userId: string): Promise<{ repostsCount: number }> {
        // Check if already reposted
        const alreadyReposted = await statusInteractionRepository.hasReposted(statusId, userId);
        if (alreadyReposted) {
            const status = await statusRepository.findById(statusId);
            return { repostsCount: status?.repostsCount || 0 };
        }

        // Create interaction
        await statusInteractionRepository.create({
            statusId: new Types.ObjectId(statusId),
            userId: new Types.ObjectId(userId),
            type: InteractionType.REPOST
        });

        // Increment count
        const status = await statusRepository.incrementRepostCount(statusId);

        log.debug(`User ${userId} reposted status ${statusId}`);

        return { repostsCount: status?.repostsCount || 0 };
    }

    /**
     * Record view and increment count
     */
    async incrementViewCount(statusId: string, userId: string): Promise<void> {
        await statusInteractionRepository.recordView(statusId, userId);
        await statusRepository.incrementViewCount(statusId);
    }

    /**
     * Reply to a status (creates conversation)
     */
    async replyToStatus(statusId: string, replyerId: string): Promise<{ conversationId: string }> {
        const status = await statusRepository.findById(statusId);

        if (!status) {
            throw new Error('Status not found');
        }

        // Can't reply to your own status
        if (status.authorId.toString() === replyerId) {
            throw new Error('Cannot reply to your own status');
        }

        // Get or create conversation
        const conversation = await conversationService.getOrCreateStatusReplyConversation(
            statusId,
            replyerId,
            status.authorId.toString()
        );

        // Increment reply count
        await statusRepository.incrementReplyCount(statusId);

        return { conversationId: conversation._id.toString() };
    }

    /**
     * Delete a status
     */
    async deleteStatus(statusId: string, userId: string): Promise<IStatus | null> {
        const status = await statusRepository.softDelete(statusId, userId);

        if (status) {
            log.info(`User ${userId} deleted status ${statusId}`);
        }

        return status;
    }

    /**
     * Get status categories
     */
    getCategories(isAdmin: boolean = false) {
        const categories = getAllCategories();
        if (!isAdmin) {
            return categories.filter(cat => !cat.adminOnly);
        }
        return categories;
    }

    /**
     * Get interactions for a status
     */
    async getInteractions(
        statusId: string,
        type: 'likes' | 'reposts',
        page: number = 1,
        limit: number = 50
    ) {
        if (type === 'likes') {
            return statusInteractionRepository.getLikes(statusId, page, limit);
        }
        return statusInteractionRepository.getReposts(statusId, page, limit);
    }
}

export const statusService = new StatusService();
