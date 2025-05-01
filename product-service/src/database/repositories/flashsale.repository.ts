import FlashSaleModel, { IFlashSale } from '../models/flashsale.model';
import { Types, FilterQuery, UpdateQuery, SortOrder, Query, PopulateOptions } from 'mongoose';
import logger from '../../utils/logger';

const log = logger.getLogger('FlashSaleRepository');

// Input for creating (subset of IFlashSale, handled by service)
// type CreateFlashSaleInput = Partial<IFlashSale>; 

// Update input (subset of IFlashSale)
// type UpdateFlashSaleInput = Partial<Pick<IFlashSale, 'discountedPrice' | 'startTime' | 'endTime' | 'status' | 'feePaymentStatus'>>;

export class FlashSaleRepository {

    /**
     * Create a new flash sale record
     */
    async create(input: Partial<IFlashSale>): Promise<IFlashSale> {
        try {
            const flashSale = await FlashSaleModel.create(input);
            log.info(`Created flash sale ${flashSale._id}`);
            return flashSale;
        } catch (error: any) {
            log.error(`Error creating flash sale: ${error.message}`, { input });
            throw error;
        }
    }

    /**
     * Find a single flash sale by query
     * @param query Mongoose query object
     * @param select Fields to select (optional)
     * @param populate Options for population (optional)
     */
    async findOne(
        query: FilterQuery<IFlashSale>,
        select?: string,
        populate?: string | string[] | PopulateOptions | PopulateOptions[]
    ): Promise<IFlashSale | null> {
        try {
            let queryBuilder: Query<(IFlashSale & { _id: Types.ObjectId }) | null, IFlashSale & { _id: Types.ObjectId }, {}, IFlashSale> = FlashSaleModel.findOne(query);

            if (select) {
                queryBuilder = queryBuilder.select(select);
            }
            if (populate) {
                queryBuilder = queryBuilder.populate(populate as any);
            }
            return await queryBuilder.lean<IFlashSale>().exec();
        } catch (error: any) {
            log.error(`Error finding flash sale: ${error.message}`, { query });
            throw error;
        }
    }

    /**
    * Find a flash sale by its ID
    */
    async findById(id: string | Types.ObjectId): Promise<IFlashSale | null> {
        try {
            return await FlashSaleModel.findById(id).lean();
        } catch (error: any) {
            log.error(`Error finding flash sale by ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find multiple flash sales matching a query with pagination and sorting
     */
    async find(
        query: FilterQuery<IFlashSale>,
        limit: number = 20,
        skip: number = 0,
        sort: string | { [key: string]: SortOrder | { $meta: any; } } | [string, SortOrder][] | null | undefined = { createdAt: -1 }
    ): Promise<IFlashSale[]> {
        try {
            return await FlashSaleModel.find(query)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean();
        } catch (error: any) {
            log.error(`Error finding flash sales: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Count documents matching a query
     */
    async count(query: FilterQuery<IFlashSale>): Promise<number> {
        try {
            return await FlashSaleModel.countDocuments(query);
        } catch (error: any) {
            log.error(`Error counting flash sales: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Find a flash sale by ID and update it
     */
    async findByIdAndUpdate(id: string | Types.ObjectId, update: UpdateQuery<IFlashSale>): Promise<IFlashSale | null> {
        try {
            const updatedFlashSale = await FlashSaleModel.findByIdAndUpdate(
                id,
                { $set: update }, // Use $set to apply updates
                { new: true } // Return the updated document
            ).lean();

            if (updatedFlashSale) {
                log.info(`Updated flash sale ${id}`);
            }
            return updatedFlashSale;
        } catch (error: any) {
            log.error(`Error updating flash sale ${id}: ${error.message}`, { update });
            throw error;
        }
    }

    /**
     * Atomically increments the view count for a flash sale.
     */
    async incrementViewCount(flashSaleId: string | Types.ObjectId): Promise<void> {
        try {
            await FlashSaleModel.findByIdAndUpdate(flashSaleId, { $inc: { viewCount: 1 } });
            log.debug(`Incremented view count for flash sale ${flashSaleId}`);
        } catch (error: any) {
            log.error(`Error incrementing view count for flash sale ${flashSaleId}: ${error.message}`);
            // Don't throw here, tracking failure shouldn't block user action
        }
    }

    /**
     * Atomically increments the WhatsApp click count for a flash sale.
     */
    async incrementWhatsappClickCount(flashSaleId: string | Types.ObjectId): Promise<void> {
        try {
            await FlashSaleModel.findByIdAndUpdate(flashSaleId, { $inc: { whatsappClickCount: 1 } });
            log.debug(`Incremented WhatsApp click count for flash sale ${flashSaleId}`);
        } catch (error: any) {
            log.error(`Error incrementing WhatsApp click count for flash sale ${flashSaleId}: ${error.message}`);
            // Don't throw here
        }
    }

    // Add other necessary methods (e.g., delete, aggregate)
}

// Export singleton instance
export const flashSaleRepository = new FlashSaleRepository(); 