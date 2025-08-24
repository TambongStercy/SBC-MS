import AdPackModel, { IAdPack } from '../models/adPack.model';
import { Types, FilterQuery } from 'mongoose';
import logger from '../../utils/logger';

const log = logger.getLogger('AdPackRepository');

export class AdPackRepository {

    /**
     * Creates a new AdPack.
     * Typically used for seeding/admin setup, not by end-users.
     */
    async create(data: Partial<IAdPack>): Promise<IAdPack> {
        try {
            const newPack = await AdPackModel.create(data);
            log.info(`Created AdPack: ${newPack.name} (ID: ${newPack.packId})`);
            return newPack;
        } catch (error: any) {
            log.error(`Error creating AdPack: ${error.message}`, { data });
            throw error;
        }
    }

    /**
     * Finds a single AdPack by its unique packId (e.g., 'basic', 'gold').
     */
    async findByPackId(packId: string): Promise<IAdPack | null> {
        try {
            return await AdPackModel.findOne({ packId }).lean() as IAdPack | null;
        } catch (error: any) {
            log.error(`Error finding AdPack by packId ${packId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds an AdPack by its MongoDB ObjectId.
     */
    async findById(id: string | Types.ObjectId): Promise<IAdPack | null> {
        try {
            return await AdPackModel.findById(id).lean() as IAdPack | null;
        } catch (error: any) {
            log.error(`Error finding AdPack by ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds all active AdPacks available for purchase.
     */
    async findAllActive(): Promise<IAdPack[]> {
        try {
            // Use unknown assertion for array lean results
            return await AdPackModel.find({ isActive: true })
                .sort({ price: 1 }) // Sort by price ascending
                .lean() as unknown as IAdPack[];
        } catch (error: any) {
            log.error(`Error finding all active AdPacks: ${error.message}`);
            throw error;
        }
    }

    // Add other methods if needed (e.g., update, delete - likely admin only)
}

// Export a singleton instance
export const adPackRepository = new AdPackRepository(); 