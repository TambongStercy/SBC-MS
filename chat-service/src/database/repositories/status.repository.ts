import { Types, FilterQuery } from 'mongoose';
import StatusModel, { IStatus, StatusMediaType } from '../models/status.model';
import { StatusCategory } from '../../config/status-categories';
import logger from '../../utils/logger';

const log = logger.getLogger('StatusRepository');

export interface StatusFilters {
    category?: StatusCategory;
    country?: string;
    city?: string;
    search?: string;
    authorId?: string | Types.ObjectId;
    sortBy?: 'recent' | 'popular';
}

export class StatusRepository {
    /**
     * Create a new status
     */
    async create(data: Partial<IStatus>): Promise<IStatus> {
        const status = new StatusModel(data);
        return status.save();
    }

    /**
     * Find status by ID
     */
    async findById(statusId: string | Types.ObjectId): Promise<IStatus | null> {
        return StatusModel.findById(statusId).exec();
    }

    /**
     * Get status feed with filters and pagination
     */
    async getStatusFeed(
        filters: StatusFilters,
        page: number = 1,
        limit: number = 20
    ): Promise<{ statuses: IStatus[]; total: number }> {
        const skip = (page - 1) * limit;
        const now = new Date();

        const query: FilterQuery<IStatus> = {
            deleted: false,
            isApproved: true,
            expiresAt: { $gt: now }
        };

        // Apply filters
        if (filters.category) {
            query.category = filters.category;
        }
        if (filters.country) {
            query.country = filters.country;
        }
        if (filters.city) {
            query.city = filters.city;
        }
        if (filters.authorId) {
            query.authorId = filters.authorId;
        }
        if (filters.search) {
            query.$text = { $search: filters.search };
        }

        // Determine sort order
        let sort: Record<string, 1 | -1> = { createdAt: -1 }; // Default: recent
        if (filters.sortBy === 'popular') {
            sort = { likesCount: -1, viewsCount: -1, createdAt: -1 };
        }

        const [statuses, total] = await Promise.all([
            StatusModel.find(query)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .exec(),
            StatusModel.countDocuments(query).exec()
        ]);

        return { statuses, total };
    }

    /**
     * Get user's statuses
     */
    async getUserStatuses(
        userId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 20
    ): Promise<{ statuses: IStatus[]; total: number }> {
        const skip = (page - 1) * limit;

        const query: FilterQuery<IStatus> = {
            authorId: userId,
            deleted: false
        };

        const [statuses, total] = await Promise.all([
            StatusModel.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            StatusModel.countDocuments(query).exec()
        ]);

        return { statuses, total };
    }

    /**
     * Increment like count
     */
    async incrementLikeCount(statusId: string | Types.ObjectId): Promise<IStatus | null> {
        return StatusModel.findByIdAndUpdate(
            statusId,
            { $inc: { likesCount: 1 } },
            { new: true }
        ).exec();
    }

    /**
     * Decrement like count
     */
    async decrementLikeCount(statusId: string | Types.ObjectId): Promise<IStatus | null> {
        return StatusModel.findByIdAndUpdate(
            statusId,
            { $inc: { likesCount: -1 } },
            { new: true }
        ).exec();
    }

    /**
     * Increment repost count
     */
    async incrementRepostCount(statusId: string | Types.ObjectId): Promise<IStatus | null> {
        return StatusModel.findByIdAndUpdate(
            statusId,
            { $inc: { repostsCount: 1 } },
            { new: true }
        ).exec();
    }

    /**
     * Increment reply count
     */
    async incrementReplyCount(statusId: string | Types.ObjectId): Promise<IStatus | null> {
        return StatusModel.findByIdAndUpdate(
            statusId,
            { $inc: { repliesCount: 1 } },
            { new: true }
        ).exec();
    }

    /**
     * Increment view count
     */
    async incrementViewCount(statusId: string | Types.ObjectId): Promise<void> {
        await StatusModel.findByIdAndUpdate(
            statusId,
            { $inc: { viewsCount: 1 } }
        ).exec();
    }

    /**
     * Soft delete a status
     */
    async softDelete(
        statusId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<IStatus | null> {
        return StatusModel.findOneAndUpdate(
            {
                _id: statusId,
                authorId: userId
            },
            {
                deleted: true,
                deletedAt: new Date()
            },
            { new: true }
        ).exec();
    }

    /**
     * Flag a status
     */
    async flagStatus(
        statusId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        reason: string
    ): Promise<IStatus | null> {
        return StatusModel.findByIdAndUpdate(
            statusId,
            {
                flagged: true,
                flagReason: reason,
                $addToSet: { flaggedBy: userId }
            },
            { new: true }
        ).exec();
    }

    /**
     * Update status approval
     */
    async updateApproval(
        statusId: string | Types.ObjectId,
        isApproved: boolean
    ): Promise<IStatus | null> {
        return StatusModel.findByIdAndUpdate(
            statusId,
            { isApproved },
            { new: true }
        ).exec();
    }

    /**
     * Get expired statuses for cleanup
     */
    async getExpiredStatuses(limit: number = 100): Promise<IStatus[]> {
        const now = new Date();
        return StatusModel.find({
            expiresAt: { $lt: now },
            deleted: false
        })
            .limit(limit)
            .exec();
    }

    /**
     * Bulk soft delete expired statuses
     */
    async bulkSoftDeleteExpired(): Promise<number> {
        const now = new Date();
        const result = await StatusModel.updateMany(
            {
                expiresAt: { $lt: now },
                deleted: false
            },
            {
                deleted: true,
                deletedAt: now
            }
        ).exec();
        return result.modifiedCount;
    }
}

export const statusRepository = new StatusRepository();
