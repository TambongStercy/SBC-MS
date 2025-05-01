import SettingsModel, { ISettings } from '../models/settings.model';
import logger from '../../utils/logger';

const log = logger.getLogger('SettingsRepository');

class SettingsRepository {

    /**
     * Finds the single settings document.
     * Assumes there is only one settings document in the collection.
     */
    async findSingle(): Promise<ISettings | null> {
        log.debug('Finding single settings document...');
        try {
            const settings = await SettingsModel.findOne().exec();
            log.debug('Settings document found successfully.');
            return settings;
        } catch (error: any) {
            log.error('Error finding settings document:', error);
            throw error; // Re-throw the error for the service layer to handle
        }
    }

    /**
     * Creates or updates the single settings document.
     * Uses findOneAndUpdate with upsert: true.
     * @param data The settings data to update or insert.
     */
    async upsert(data: Partial<ISettings>): Promise<ISettings> {
        log.debug('Upserting settings document...');
        const filter = {}; // An empty filter will match the first document or create one if none exists
        const update = { $set: data };
        const options = {
            new: true,          // Return the modified document rather than the original
            upsert: true,       // Create a new document if no documents match the filter
            runValidators: true, // Ensure updates adhere to the schema
            setDefaultsOnInsert: true // Apply schema defaults if inserting
        };

        try {
            // Use a type assertion as findOneAndUpdate can return null if no document is found/created,
            // but with upsert: true, it should always return a document.
            const settings = await SettingsModel.findOneAndUpdate(filter, update, options).exec() as ISettings;
            log.debug('Settings document upserted successfully.');
            return settings;
        } catch (error: any) {
            log.error('Error upserting settings document:', error);
            // Add more specific error handling if needed (e.g., validation errors)
            throw error;
        }
    }

    // Add other specific methods if needed, e.g., deleteSettings
    // async deleteSettings(): Promise<void> { ... }
}

export default SettingsRepository; 