/**
 * Migration script to add new fields to existing subscriptions
 * Adds: category, duration, autoRenew fields
 *
 * Run with: npx ts-node src/scripts/migrate-subscription-fields.ts
 */

import mongoose from 'mongoose';
import SubscriptionModel, { SubscriptionCategory, SubscriptionDuration } from '../database/models/subscription.model';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('SubscriptionMigration');

async function migrateExistingSubscriptions() {
    try {
        log.info('Starting subscription migration...');

        // Connect to MongoDB
        const mongoUri = config.mongodb.uri || 'mongodb://localhost:27017/sbc_user_dev';
        log.info(`Connecting to MongoDB: ${mongoUri}`);

        await mongoose.connect(mongoUri);
        log.info('Connected to MongoDB successfully');

        // Find all subscriptions that don't have the category field
        const subscriptionsToMigrate = await SubscriptionModel.find({
            category: { $exists: false }
        });

        log.info(`Found ${subscriptionsToMigrate.length} subscriptions to migrate`);

        if (subscriptionsToMigrate.length === 0) {
            log.info('No subscriptions need migration. All subscriptions are up to date.');
            await mongoose.connection.close();
            return;
        }

        // Use bulk update for better performance
        log.info('Performing bulk update...');

        const bulkUpdateResult = await SubscriptionModel.updateMany(
            { category: { $exists: false } },
            {
                $set: {
                    category: SubscriptionCategory.REGISTRATION,
                    duration: SubscriptionDuration.LIFETIME,
                    autoRenew: false
                }
            }
        );

        const migrated = bulkUpdateResult.modifiedCount;
        const errors = subscriptionsToMigrate.length - migrated;

        log.info(`Migration completed successfully!`);
        log.info(`- Total subscriptions: ${subscriptionsToMigrate.length}`);
        log.info(`- Successfully migrated: ${migrated}`);
        log.info(`- Errors: ${errors}`);

        // Verify migration
        log.info('Verifying migration...');
        const remaining = await SubscriptionModel.countDocuments({
            category: { $exists: false }
        });

        if (remaining > 0) {
            log.warn(`Warning: ${remaining} subscriptions still missing category field`);
        } else {
            log.info('Verification successful: All subscriptions have been migrated');
        }

        // Close connection
        await mongoose.connection.close();
        log.info('Database connection closed');

    } catch (error: any) {
        log.error('Migration failed:', error);
        await mongoose.connection.close();
        process.exit(1);
    }
}

// Run migration
migrateExistingSubscriptions()
    .then(() => {
        log.info('Migration script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        log.error('Migration script failed:', error);
        process.exit(1);
    });