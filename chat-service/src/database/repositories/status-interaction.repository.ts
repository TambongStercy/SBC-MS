import { Types, FilterQuery } from 'mongoose';
import StatusInteractionModel, { IStatusInteraction, InteractionType } from '../models/status-interaction.model';
import logger from '../../utils/logger';

const log = logger.getLogger('StatusInteractionRepository');

export class StatusInteractionRepository {
    /**
     * Create a new interaction
     */
    async create(data: Partial<IStatusInteraction>): Promise<IStatusInteraction> {
        const interaction = new StatusInteractionModel(data);
        return interaction.save();
    }

    /**
     * Find interaction
     */
    async findInteraction(
        statusId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        type: InteractionType
    ): Promise<IStatusInteraction | null> {
        return StatusInteractionModel.findOne({
            statusId,
            userId,
            type
        }).exec();
    }

    /**
     * Check if user has liked a status
     */
    async hasLiked(
        statusId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<boolean> {
        const interaction = await StatusInteractionModel.findOne({
            statusId,
            userId,
            type: InteractionType.LIKE
        }).exec();
        return !!interaction;
    }

    /**
     * Check if user has reposted a status
     */
    async hasReposted(
        statusId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<boolean> {
        const interaction = await StatusInteractionModel.findOne({
            statusId,
            userId,
            type: InteractionType.REPOST
        }).exec();
        return !!interaction;
    }

    /**
     * Delete an interaction (unlike, unrepost)
     */
    async deleteInteraction(
        statusId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        type: InteractionType
    ): Promise<boolean> {
        const result = await StatusInteractionModel.deleteOne({
            statusId,
            userId,
            type
        }).exec();
        return result.deletedCount > 0;
    }

    /**
     * Get users who liked a status
     */
    async getLikes(
        statusId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 50
    ): Promise<{ interactions: IStatusInteraction[]; total: number }> {
        const skip = (page - 1) * limit;

        const query: FilterQuery<IStatusInteraction> = {
            statusId,
            type: InteractionType.LIKE
        };

        const [interactions, total] = await Promise.all([
            StatusInteractionModel.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            StatusInteractionModel.countDocuments(query).exec()
        ]);

        return { interactions, total };
    }

    /**
     * Get users who reposted a status
     */
    async getReposts(
        statusId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 50
    ): Promise<{ interactions: IStatusInteraction[]; total: number }> {
        const skip = (page - 1) * limit;

        const query: FilterQuery<IStatusInteraction> = {
            statusId,
            type: InteractionType.REPOST
        };

        const [interactions, total] = await Promise.all([
            StatusInteractionModel.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            StatusInteractionModel.countDocuments(query).exec()
        ]);

        return { interactions, total };
    }

    /**
     * Get user's interactions with multiple statuses (for feed display)
     */
    async getUserInteractionsForStatuses(
        userId: string | Types.ObjectId,
        statusIds: (string | Types.ObjectId)[]
    ): Promise<Map<string, { liked: boolean; reposted: boolean }>> {
        const interactions = await StatusInteractionModel.find({
            userId,
            statusId: { $in: statusIds },
            type: { $in: [InteractionType.LIKE, InteractionType.REPOST] }
        }).exec();

        const result = new Map<string, { liked: boolean; reposted: boolean }>();

        // Initialize all status IDs with false
        for (const id of statusIds) {
            result.set(id.toString(), { liked: false, reposted: false });
        }

        // Set actual interactions
        for (const interaction of interactions) {
            const statusKey = interaction.statusId.toString();
            const current = result.get(statusKey) || { liked: false, reposted: false };

            if (interaction.type === InteractionType.LIKE) {
                current.liked = true;
            } else if (interaction.type === InteractionType.REPOST) {
                current.reposted = true;
            }

            result.set(statusKey, current);
        }

        return result;
    }

    /**
     * Record a view (no uniqueness constraint)
     */
    async recordView(
        statusId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<void> {
        // Check if viewed in last hour (to avoid spam)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentView = await StatusInteractionModel.findOne({
            statusId,
            userId,
            type: InteractionType.VIEW,
            createdAt: { $gt: oneHourAgo }
        }).exec();

        if (!recentView) {
            await StatusInteractionModel.create({
                statusId,
                userId,
                type: InteractionType.VIEW
            });
        }
    }

    /**
     * Get view count for a status
     */
    async getViewCount(statusId: string | Types.ObjectId): Promise<number> {
        return StatusInteractionModel.countDocuments({
            statusId,
            type: InteractionType.VIEW
        }).exec();
    }

    /**
     * Delete all interactions for a status
     */
    async deleteAllForStatus(statusId: string | Types.ObjectId): Promise<number> {
        const result = await StatusInteractionModel.deleteMany({
            statusId
        }).exec();
        return result.deletedCount;
    }
}

export const statusInteractionRepository = new StatusInteractionRepository();
