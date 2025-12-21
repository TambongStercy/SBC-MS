import EntrepreneurModel, { IEntrepreneur } from '../models/entrepreneur.model';
import { Types, FilterQuery, UpdateQuery, SortOrder } from 'mongoose';
import logger from '../../utils/logger';

const log = logger.getLogger('EntrepreneurRepository');

export class EntrepreneurRepository {

    /**
     * Creates a new Entrepreneur record.
     */
    async create(data: Partial<IEntrepreneur>): Promise<IEntrepreneur> {
        try {
            const newEntrepreneur = await EntrepreneurModel.create(data);
            log.info(`Created new Entrepreneur: ${newEntrepreneur.name} for challenge ${newEntrepreneur.challengeId}`);
            return newEntrepreneur;
        } catch (error: any) {
            log.error(`Error creating Entrepreneur: ${error.message}`, { data });
            throw error;
        }
    }

    /**
     * Finds a single Entrepreneur matching the query.
     */
    async findOne(query: FilterQuery<IEntrepreneur>): Promise<IEntrepreneur | null> {
        try {
            return await EntrepreneurModel.findOne(query).lean() as IEntrepreneur | null;
        } catch (error: any) {
            log.error(`Error finding Entrepreneur: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Finds an Entrepreneur by its ID.
     */
    async findById(id: string | Types.ObjectId): Promise<IEntrepreneur | null> {
        try {
            return await EntrepreneurModel.findById(id).lean() as IEntrepreneur | null;
        } catch (error: any) {
            log.error(`Error finding Entrepreneur by ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds multiple Entrepreneurs matching a query with pagination and sorting.
     */
    async find(
        query: FilterQuery<IEntrepreneur>,
        limit: number = 10,
        skip: number = 0,
        sort: string | { [key: string]: SortOrder | { $meta: any; } } | [string, SortOrder][] | null | undefined = { voteCount: -1 }
    ): Promise<IEntrepreneur[]> {
        try {
            return await EntrepreneurModel.find(query)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean() as unknown as IEntrepreneur[];
        } catch (error: any) {
            log.error(`Error finding Entrepreneurs: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Counts documents matching a query.
     */
    async count(query: FilterQuery<IEntrepreneur>): Promise<number> {
        try {
            return await EntrepreneurModel.countDocuments(query);
        } catch (error: any) {
            log.error(`Error counting Entrepreneurs: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Updates an Entrepreneur by its ID.
     */
    async findByIdAndUpdate(id: string | Types.ObjectId, update: UpdateQuery<IEntrepreneur>): Promise<IEntrepreneur | null> {
        try {
            const updateData = update.$set || update.$inc ? update : { $set: update };
            const updatedEntrepreneur = await EntrepreneurModel.findByIdAndUpdate(id, updateData, { new: true }).lean() as IEntrepreneur | null;
            if (updatedEntrepreneur) {
                log.info(`Updated Entrepreneur ${id}`);
            }
            return updatedEntrepreneur;
        } catch (error: any) {
            log.error(`Error updating Entrepreneur ${id}: ${error.message}`, { update });
            throw error;
        }
    }

    /**
     * Deletes an Entrepreneur by its ID.
     */
    async deleteById(id: string | Types.ObjectId): Promise<IEntrepreneur | null> {
        try {
            log.info(`Repository: Attempting to delete Entrepreneur with ID: ${id}`);
            const result = await EntrepreneurModel.findByIdAndDelete(id).exec();
            if (result) {
                log.info(`Repository: Successfully deleted Entrepreneur with ID: ${id}`);
            } else {
                log.warn(`Repository: Entrepreneur with ID: ${id} not found for deletion.`);
            }
            return result;
        } catch (error: any) {
            log.error(`Repository: Error deleting Entrepreneur with ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds entrepreneurs for a challenge sorted by vote count (leaderboard).
     */
    async findLeaderboardByChallenge(challengeId: string | Types.ObjectId, approved: boolean = true): Promise<IEntrepreneur[]> {
        try {
            return await EntrepreneurModel.find({
                challengeId,
                approved
            })
                .sort({ voteCount: -1 })
                .lean() as IEntrepreneur[];
        } catch (error: any) {
            log.error(`Error finding leaderboard for challenge ${challengeId}: ${error.message}`);
            throw error;
        }
    }
}

// Export a singleton instance
export const entrepreneurRepository = new EntrepreneurRepository();
