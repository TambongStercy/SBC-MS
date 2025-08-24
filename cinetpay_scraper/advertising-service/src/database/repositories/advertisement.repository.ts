import AdvertisementModel, { IAdvertisement, AdStatus } from '../models/advertisement.model';
import { Types, FilterQuery, UpdateQuery, SortOrder } from 'mongoose';
import logger from '../../utils/logger';

const log = logger.getLogger('AdvertisementRepository');

// Interface for query options with pagination
interface FindOptions {
    limit?: number;
    skip?: number;
    sort?: string | { [key: string]: SortOrder | { $meta: any; } } | [string, SortOrder][] | null | undefined;
}

export class AdvertisementRepository {

    /**
     * Creates a new Advertisement record.
     * Requires a unique advertisementId.
     */
    async create(data: Partial<IAdvertisement>): Promise<IAdvertisement> {
        if (!data.advertisementId) {
            throw new Error('Cannot create Advertisement without a unique advertisementId.');
        }
        try {
            const newAd = await AdvertisementModel.create(data);
            log.info(`Created Advertisement ${newAd.advertisementId} for user ${newAd.userId}`);
            return newAd;
        } catch (error: any) {
            log.error(`Error creating Advertisement: ${error.message}`, { data });
            if (error.code === 11000 && error.keyPattern?.advertisementId) {
                throw new Error(`Advertisement ID ${data.advertisementId} already exists.`);
            }
            throw error;
        }
    }

    /**
     * Finds a single Advertisement by its unique advertisementId.
     */
    async findByAdvertisementId(advertisementId: string): Promise<IAdvertisement | null> {
        try {
            return await AdvertisementModel.findOne({ advertisementId }).lean() as IAdvertisement | null;
        } catch (error: any) {
            log.error(`Error finding Advertisement by advertisementId ${advertisementId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds an Advertisement by its MongoDB ObjectId.
     */
    async findById(id: string | Types.ObjectId): Promise<IAdvertisement | null> {
        try {
            return await AdvertisementModel.findById(id).lean() as IAdvertisement | null;
        } catch (error: any) {
            log.error(`Error finding Advertisement by ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds advertisements matching a query with pagination and sorting.
     */
    async find(query: FilterQuery<IAdvertisement>, options: FindOptions = {}): Promise<IAdvertisement[]> {
        const { limit = 20, skip = 0, sort = { createdAt: -1 } } = options;
        try {
            return await AdvertisementModel.find(query)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean() as unknown as IAdvertisement[]; // Use unknown assertion
        } catch (error: any) {
            log.error(`Error finding Advertisements: ${error.message}`, { query });
            throw error;
        }
    }

    /**
    * Finds all active advertisements suitable for public display.
    * Can add more complex filtering/sorting for rotation later.
    */
    async findActiveForDisplay(limit: number = 10): Promise<IAdvertisement[]> {
        try {
            // Simple query for active ads, maybe randomize or sort by feature status later
            return await AdvertisementModel.find({
                status: AdStatus.ACTIVE,
                startDate: { $lte: new Date() }, // Started
                endDate: { $gte: new Date() }    // Not yet ended
            })
                .limit(limit)
                // TODO: Implement better sorting/randomization for display fairness
                .sort({ isFeatured: -1, createdAt: -1 }) // Example: Featured first
                .lean() as unknown as IAdvertisement[];
        } catch (error: any) {
            log.error(`Error finding active Advertisements for display: ${error.message}`);
            throw error;
        }
    }

    /**
     * Counts documents matching a query.
     */
    async count(query: FilterQuery<IAdvertisement>): Promise<number> {
        try {
            return await AdvertisementModel.countDocuments(query);
        } catch (error: any) {
            log.error(`Error counting Advertisements: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Updates an Advertisement by its MongoDB ObjectId.
     */
    async findByIdAndUpdate(id: string | Types.ObjectId, update: UpdateQuery<IAdvertisement>): Promise<IAdvertisement | null> {
        try {
            const updateData = update.$set ? update : { $set: update };
            const updatedAd = await AdvertisementModel.findByIdAndUpdate(id, updateData, { new: true }).lean() as IAdvertisement | null;
            if (updatedAd) {
                log.info(`Updated Advertisement ${id}`);
            }
            return updatedAd;
        } catch (error: any) {
            log.error(`Error updating Advertisement ${id}: ${error.message}`, { update });
            throw error;
        }
    }

    /**
     * Updates an Advertisement by its unique advertisementId.
     */
    async findByAdvertisementIdAndUpdate(advertisementId: string, update: UpdateQuery<IAdvertisement>): Promise<IAdvertisement | null> {
        try {
            const updateData = update.$set ? update : { $set: update };
            const updatedAd = await AdvertisementModel.findOneAndUpdate({ advertisementId }, updateData, { new: true }).lean() as IAdvertisement | null;
            if (updatedAd) {
                log.info(`Updated Advertisement by advertisementId ${advertisementId}`);
            }
            return updatedAd;
        } catch (error: any) {
            log.error(`Error updating Advertisement by advertisementId ${advertisementId}: ${error.message}`, { update });
            throw error;
        }
    }

    // Add other specific finders if needed (e.g., find by userId, find expiring soon)
}

// Export a singleton instance
export const advertisementRepository = new AdvertisementRepository(); 