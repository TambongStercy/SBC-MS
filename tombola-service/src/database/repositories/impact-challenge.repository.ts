import ImpactChallengeModel, { IImpactChallenge, ChallengeStatus } from '../models/impact-challenge.model';
import { Types, FilterQuery, UpdateQuery, SortOrder } from 'mongoose';
import logger from '../../utils/logger';

const log = logger.getLogger('ImpactChallengeRepository');

export class ImpactChallengeRepository {

    /**
     * Creates a new ImpactChallenge record.
     */
    async create(data: Partial<IImpactChallenge>): Promise<IImpactChallenge> {
        try {
            const newChallenge = await ImpactChallengeModel.create(data);
            log.info(`Created new ImpactChallenge: ${newChallenge.campaignName} (${newChallenge.year}-${newChallenge.month})`);
            return newChallenge;
        } catch (error: any) {
            log.error(`Error creating ImpactChallenge: ${error.message}`, { data });
            throw error;
        }
    }

    /**
     * Finds a single ImpactChallenge matching the query.
     */
    async findOne(query: FilterQuery<IImpactChallenge>): Promise<IImpactChallenge | null> {
        try {
            return await ImpactChallengeModel.findOne(query).lean() as IImpactChallenge | null;
        } catch (error: any) {
            log.error(`Error finding ImpactChallenge: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Finds an ImpactChallenge by its ID.
     */
    async findById(id: string | Types.ObjectId): Promise<IImpactChallenge | null> {
        try {
            return await ImpactChallengeModel.findById(id).lean() as IImpactChallenge | null;
        } catch (error: any) {
            log.error(`Error finding ImpactChallenge by ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds the currently active ImpactChallenge.
     */
    async findCurrentActive(): Promise<IImpactChallenge | null> {
        try {
            const now = new Date();
            return await ImpactChallengeModel.findOne({
                status: ChallengeStatus.ACTIVE,
                startDate: { $lte: now },
                endDate: { $gte: now }
            })
                .sort({ startDate: -1 })
                .lean() as IImpactChallenge | null;
        } catch (error: any) {
            log.error(`Error finding current active ImpactChallenge: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds multiple ImpactChallenges matching a query with pagination and sorting.
     */
    async find(
        query: FilterQuery<IImpactChallenge>,
        limit: number = 10,
        skip: number = 0,
        sort: string | { [key: string]: SortOrder | { $meta: any; } } | [string, SortOrder][] | null | undefined = { year: -1, month: -1 }
    ): Promise<IImpactChallenge[]> {
        try {
            return await ImpactChallengeModel.find(query)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean() as unknown as IImpactChallenge[];
        } catch (error: any) {
            log.error(`Error finding ImpactChallenges: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Counts documents matching a query.
     */
    async count(query: FilterQuery<IImpactChallenge>): Promise<number> {
        try {
            return await ImpactChallengeModel.countDocuments(query);
        } catch (error: any) {
            log.error(`Error counting ImpactChallenges: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Updates an ImpactChallenge by its ID.
     */
    async findByIdAndUpdate(id: string | Types.ObjectId, update: UpdateQuery<IImpactChallenge>): Promise<IImpactChallenge | null> {
        try {
            const updateData = update.$set || update.$inc ? update : { $set: update };
            const updatedChallenge = await ImpactChallengeModel.findByIdAndUpdate(id, updateData, { new: true }).lean() as IImpactChallenge | null;
            if (updatedChallenge) {
                log.info(`Updated ImpactChallenge ${id}`);
            }
            return updatedChallenge;
        } catch (error: any) {
            log.error(`Error updating ImpactChallenge ${id}: ${error.message}`, { update });
            throw error;
        }
    }

    /**
     * Finds an ImpactChallenge by month and year.
     */
    async findByMonthYear(month: number, year: number): Promise<IImpactChallenge | null> {
        const query = { month, year };
        log.debug('Repository: Finding challenge by month and year', { query });
        try {
            return await ImpactChallengeModel.findOne(query).lean() as IImpactChallenge | null;
        } catch (error: any) {
            log.error(`Repository: Error finding ImpactChallenge by month ${month}, year ${year}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Deletes an ImpactChallenge by its ID.
     */
    async deleteById(id: string | Types.ObjectId): Promise<IImpactChallenge | null> {
        try {
            log.info(`Repository: Attempting to delete ImpactChallenge with ID: ${id}`);
            const result = await ImpactChallengeModel.findByIdAndDelete(id).exec();
            if (result) {
                log.info(`Repository: Successfully deleted ImpactChallenge with ID: ${id}`);
            } else {
                log.warn(`Repository: ImpactChallenge with ID: ${id} not found for deletion.`);
            }
            return result;
        } catch (error: any) {
            log.error(`Repository: Error deleting ImpactChallenge with ID ${id}: ${error.message}`);
            throw error;
        }
    }
}

// Export a singleton instance
export const impactChallengeRepository = new ImpactChallengeRepository();
