import TombolaTicketModel, { ITombolaTicket } from '../models/tombolaTicket.model';
import { Types, FilterQuery, UpdateQuery, SortOrder } from 'mongoose';
import logger from '../../utils/logger';

// Define a type for the populated result
export interface PopulatedTombolaTicket extends Omit<ITombolaTicket, 'tombolaMonthId'> {
    tombolaMonthId: {
        _id: Types.ObjectId;
        month: number;
        year: number;
    };
}

const log = logger.getLogger('TombolaTicketRepository');

export class TombolaTicketRepository {

    /**
     * Creates a new TombolaTicket record.
     * Requires a unique ticketId to be generated beforehand.
     */
    async create(data: Partial<ITombolaTicket>): Promise<ITombolaTicket> {
        if (!data.ticketId) {
            throw new Error('Cannot create TombolaTicket without a unique ticketId.');
        }
        try {
            const newTicket = await TombolaTicketModel.create(data);
            log.info(`Created new TombolaTicket ${newTicket.ticketId} for user ${newTicket.userId}`);
            return newTicket;
        } catch (error: any) {
            log.error(`Error creating TombolaTicket: ${error.message}`, { data });
            // Handle potential duplicate ticketId error more gracefully if needed
            if (error.code === 11000 && error.keyPattern?.ticketId) {
                throw new Error(`Ticket ID ${data.ticketId} already exists.`);
            }
            throw error;
        }
    }

    /**
     * Finds a single TombolaTicket matching the query, populating month and year.
     */
    async findOne(query: FilterQuery<ITombolaTicket>): Promise<PopulatedTombolaTicket | null> {
        try {
            return await TombolaTicketModel.findOne(query)
                .populate('tombolaMonthId', 'month year _id')
                .lean() as unknown as PopulatedTombolaTicket | null;
        } catch (error: any) {
            log.error(`Error finding TombolaTicket: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Finds a TombolaTicket by its ID, populating month and year.
     */
    async findById(id: string | Types.ObjectId): Promise<PopulatedTombolaTicket | null> {
        try {
            return await TombolaTicketModel.findById(id)
                .populate('tombolaMonthId', 'month year _id')
                .lean() as unknown as PopulatedTombolaTicket | null;
        } catch (error: any) {
            log.error(`Error finding TombolaTicket by ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds all tickets for a specific TombolaMonth.
     */
    async findByMonth(tombolaMonthId: string | Types.ObjectId): Promise<ITombolaTicket[]> {
        try {
            return await TombolaTicketModel.find({ tombolaMonthId }).lean();
        } catch (error: any) {
            log.error(`Error finding tickets for TombolaMonth ${tombolaMonthId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds tickets matching a query with pagination and sorting.
     */
    async find(
        query: FilterQuery<ITombolaTicket>,
        limit: number = 10,
        skip: number = 0,
        sort: string | { [key: string]: SortOrder | { $meta: any; } } | [string, SortOrder][] | null | undefined = { purchaseTimestamp: -1 }
    ): Promise<PopulatedTombolaTicket[]> {
        try {
            return await TombolaTicketModel.find(query)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .populate('tombolaMonthId', 'month year _id')
                .lean() as unknown as PopulatedTombolaTicket[];
        } catch (error: any) {
            log.error(`Error finding TombolaTickets: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Counts documents matching a query.
     */
    async count(query: FilterQuery<ITombolaTicket>): Promise<number> {
        try {
            return await TombolaTicketModel.countDocuments(query);
        } catch (error: any) {
            log.error(`Error counting TombolaTickets: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Counts the number of tickets a specific user purchased for a specific month.
     */
    async countByUserForMonth(userId: string | Types.ObjectId, tombolaMonthId: string | Types.ObjectId): Promise<number> {
        try {
            const count = await TombolaTicketModel.countDocuments({ userId, tombolaMonthId });
            return count;
        } catch (error: any) {
            log.error(`Error counting tickets for user ${userId} in month ${tombolaMonthId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds all tickets matching the query and returns only the ticketNumber field.
     * Optimized for fetching just the numbers needed for the draw animation.
     *
     * @param tombolaMonthId The ID of the tombola month.
     * @returns A promise resolving to an array of objects containing only { ticketNumber: number }.
     */
    async findAllTicketNumbersByMonthId(tombolaMonthId: string | Types.ObjectId): Promise<{ ticketNumber: number }[]> {
        const query: FilterQuery<ITombolaTicket> = { tombolaMonthId: new Types.ObjectId(tombolaMonthId) };
        return TombolaTicketModel.find(query)
            .select({ ticketNumber: 1, _id: 0 }) // Select only ticketNumber, exclude _id
            .lean()
            .exec();
    }

    async update(id: string | Types.ObjectId, data: Partial<ITombolaTicket>): Promise<PopulatedTombolaTicket | null> {
        const populationPaths = [{ path: 'tombolaMonthId' as const }];
        return TombolaTicketModel.findByIdAndUpdate(id, data, { new: true })
            .populate(populationPaths)
            .lean() as unknown as PopulatedTombolaTicket | null;
    }

    // Note: Update/Delete operations for tickets might not be standard user actions.
    // They could be admin functions or handled internally.
    // async findByIdAndUpdate(...) { ... }
    // async findByIdAndDelete(...) { ... }
}

// Export a singleton instance
export const tombolaTicketRepository = new TombolaTicketRepository(); 