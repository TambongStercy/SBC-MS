import TombolaMonthModel, { ITombolaMonth, TombolaStatus } from '../models/tombolaMonth.model';
import { Types, FilterQuery, UpdateQuery, SortOrder } from 'mongoose';
import logger from '../../utils/logger';

const log = logger.getLogger('TombolaMonthRepository');

// Define the structure for winner data input
interface IWinnerInput {
    userId: Types.ObjectId;
    prize: string;
    rank: number;
}

export class TombolaMonthRepository {

    /**
     * Creates a new TombolaMonth record.
     */
    async create(data: Partial<ITombolaMonth>): Promise<ITombolaMonth> {
        try {
            const newMonth = await TombolaMonthModel.create(data);
            log.info(`Created new TombolaMonth: ${newMonth.year}-${newMonth.month}`);
            return newMonth;
        } catch (error: any) {
            log.error(`Error creating TombolaMonth: ${error.message}`, { data });
            throw error;
        }
    }

    /**
     * Finds a single TombolaMonth matching the query.
     */
    async findOne(query: FilterQuery<ITombolaMonth>): Promise<ITombolaMonth | null> {
        try {
            return await TombolaMonthModel.findOne(query).lean() as ITombolaMonth | null;
        } catch (error: any) {
            log.error(`Error finding TombolaMonth: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Finds a TombolaMonth by its ID.
     */
    async findById(id: string | Types.ObjectId): Promise<ITombolaMonth | null> {
        try {
            return await TombolaMonthModel.findById(id).lean() as ITombolaMonth | null;
        } catch (error: any) {
            log.error(`Error finding TombolaMonth by ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds the currently open TombolaMonth (status=OPEN), ordered by most recent start date.
     * Assumes only one should be OPEN at a time, but returns the latest if multiple exist.
     */
    async findCurrentOpen(): Promise<ITombolaMonth | null> {
        try {
            return await TombolaMonthModel.findOne({ status: TombolaStatus.OPEN })
                .sort({ month: -1, year: -1 })
                .lean() as ITombolaMonth | null;
        } catch (error: any) {
            log.error(`Error finding current open TombolaMonth: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds multiple TombolaMonths matching a query with pagination and sorting.
     */
    async find(
        query: FilterQuery<ITombolaMonth>,
        limit: number = 10,
        skip: number = 0,
        sort: string | { [key: string]: SortOrder | { $meta: any; } } | [string, SortOrder][] | null | undefined = { year: -1, month: -1 }
    ): Promise<ITombolaMonth[]> {
        try {
            return await TombolaMonthModel.find(query)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean() as unknown as ITombolaMonth[];
        } catch (error: any) {
            log.error(`Error finding TombolaMonths: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Counts documents matching a query.
     */
    async count(query: FilterQuery<ITombolaMonth>): Promise<number> {
        try {
            return await TombolaMonthModel.countDocuments(query);
        } catch (error: any) {
            log.error(`Error counting TombolaMonths: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Updates a TombolaMonth by its ID.
     */
    async findByIdAndUpdate(id: string | Types.ObjectId, update: UpdateQuery<ITombolaMonth>): Promise<ITombolaMonth | null> {
        try {
            // Use $set to avoid overwriting the entire document unless intended
            const updateData = update.$set ? update : { $set: update };
            const updatedMonth = await TombolaMonthModel.findByIdAndUpdate(id, updateData, { new: true }).lean() as ITombolaMonth | null;
            if (updatedMonth) {
                log.info(`Updated TombolaMonth ${id}`);
            }
            return updatedMonth;
        } catch (error: any) {
            log.error(`Error updating TombolaMonth ${id}: ${error.message}`, { update });
            throw error;
        }
    }

    /**
     * Adds a winner to the winners array of a specific TombolaMonth.
     */
    async addWinner(tombolaMonthId: string | Types.ObjectId, winnerData: IWinnerInput): Promise<ITombolaMonth | null> {
        try {
            const updatedMonth = await TombolaMonthModel.findByIdAndUpdate(
                tombolaMonthId,
                { $push: { winners: winnerData } },
                { new: true }
            ).lean() as ITombolaMonth | null;
            if (updatedMonth) {
                log.info(`Added winner (Rank ${winnerData.rank}) to TombolaMonth ${tombolaMonthId}`);
            }
            return updatedMonth;
        } catch (error: any) {
            log.error(`Error adding winner to TombolaMonth ${tombolaMonthId}: ${error.message}`, { winnerData });
            throw error;
        }
    }

    /**
     * Finds a TombolaMonth by its specific month and year.
     *
     * @param month - The month number (1-12).
     * @param year - The full year (e.g., 2024).
     * @returns The matching TombolaMonth document or null.
     */
    async findByMonthYear(month: number, year: number): Promise<ITombolaMonth | null> {
        const query = { month, year };
        log.debug('Repository: Finding tombola by month and year', { query });
        try {
            return await TombolaMonthModel.findOne(query).lean() as ITombolaMonth | null;
        } catch (error: any) {
            log.error(`Repository: Error finding TombolaMonth by month ${month}, year ${year}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Deletes a TombolaMonth document by its ID.
     *
     * @param id - The ID of the document to delete.
     * @returns The deleted document, or null if not found.
     */
    async deleteById(id: string | Types.ObjectId): Promise<ITombolaMonth | null> {
        try {
            log.info(`Repository: Attempting to delete TombolaMonth with ID: ${id}`);
            const result = await TombolaMonthModel.findByIdAndDelete(id).exec();
            if (result) {
                log.info(`Repository: Successfully deleted TombolaMonth with ID: ${id}`);
            } else {
                log.warn(`Repository: TombolaMonth with ID: ${id} not found for deletion.`);
            }
            return result;
        } catch (error: any) {
            log.error(`Repository: Error deleting TombolaMonth with ID ${id}: ${error.message}`);
            throw error; // Re-throw the error for the service layer to handle
        }
    }

    /**
     * Updates all TombolaMonth documents with status OPEN to CLOSED.
     *
     * @returns The result of the update operation (e.g., { acknowledged: true, modifiedCount: N }).
     */
    async closeAllOpenTombolas(): Promise<{ acknowledged: boolean; modifiedCount: number; upsertedId: any; upsertedCount: number; matchedCount: number; }> {
        try {
            const query = { status: TombolaStatus.OPEN };
            const update = { $set: { status: TombolaStatus.CLOSED } };
            log.info('Repository: Closing all currently open tombolas...');
            const result = await TombolaMonthModel.updateMany(query, update).exec();
            log.info(`Repository: Closed ${result.modifiedCount} open tombolas.`);
            return result;
        } catch (error: any) {
            log.error(`Repository: Error closing open tombolas: ${error.message}`);
            throw error;
        }
    }

    /**
     * Atomically increments the lastTicketNumber for a given TombolaMonth
     * and returns the *new* ticket number.
     *
     * @param tombolaMonthId - The ID of the TombolaMonth to update.
     * @returns The new sequential ticket number for that month.
     * @throws Error if the TombolaMonth is not found or the update fails.
     */
    async incrementAndGetTicketNumber(tombolaMonthId: string | Types.ObjectId): Promise<number> {
        try {
            const updatedMonth = await TombolaMonthModel.findByIdAndUpdate(
                tombolaMonthId,
                { $inc: { lastTicketNumber: 1 } },
                { new: true, select: 'lastTicketNumber' } // Increment and return only the new number
            ).lean();

            if (!updatedMonth) {
                log.error(`Failed to increment ticket number: TombolaMonth ${tombolaMonthId} not found.`);
                throw new Error(`TombolaMonth ${tombolaMonthId} not found.`);
            }

            log.info(`Incremented ticket number for TombolaMonth ${tombolaMonthId} to ${updatedMonth.lastTicketNumber}`);
            return updatedMonth.lastTicketNumber;
        } catch (error: any) {
            log.error(`Error incrementing ticket number for TombolaMonth ${tombolaMonthId}: ${error.message}`);
            throw error;
        }
    }
}

// Export a singleton instance
export const tombolaMonthRepository = new TombolaMonthRepository(); 