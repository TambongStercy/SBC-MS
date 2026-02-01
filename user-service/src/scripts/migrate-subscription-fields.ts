/**
 * Migration script to add new fields to existing subscriptions
 * Adds: category, duration, autoRenew fields
 *
 * Rules:
 * - CLASSIQUE / CIBLE → category: 'registration', duration: 'lifetime', autoRenew: false
 * - RELANCE → category: 'feature', duration: 'monthly', autoRenew: true
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

        // Count subscriptions missing category
        const totalToMigrate = await SubscriptionModel.countDocuments({
            category: { $exists: false }
        });

        log.info(`Found ${totalToMigrate} subscriptions missing category field`);

        if (totalToMigrate === 0) {
            log.info('No subscriptions need migration. All subscriptions are up to date.');
            await mongoose.connection.close();
            return;
        }

        // 1. Migrate CLASSIQUE and CIBLE → registration / lifetime
        log.info('Migrating CLASSIQUE and CIBLE subscriptions...');
        const registrationResult = await SubscriptionModel.updateMany(
            {
                category: { $exists: false },
                subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] }
            },
            {
                $set: {
                    category: SubscriptionCategory.REGISTRATION,
                    duration: SubscriptionDuration.LIFETIME,
                    autoRenew: false
                }
            }
        );
        log.info(`  Migrated ${registrationResult.modifiedCount} CLASSIQUE/CIBLE subscriptions → registration/lifetime`);

        // 2. Migrate RELANCE → feature / monthly
        log.info('Migrating RELANCE subscriptions...');
        const featureResult = await SubscriptionModel.updateMany(
            {
                category: { $exists: false },
                subscriptionType: 'RELANCE'
            },
            {
                $set: {
                    category: SubscriptionCategory.FEATURE,
                    duration: SubscriptionDuration.MONTHLY,
                    autoRenew: true
                }
            }
        );
        log.info(`  Migrated ${featureResult.modifiedCount} RELANCE subscriptions → feature/monthly`);

        // 3. Handle any remaining (unknown subscriptionType) - default to registration
        const remainingResult = await SubscriptionModel.updateMany(
            {
                category: { $exists: false }
            },
            {
                $set: {
                    category: SubscriptionCategory.REGISTRATION,
                    duration: SubscriptionDuration.LIFETIME,
                    autoRenew: false
                }
            }
        );
        if (remainingResult.modifiedCount > 0) {
            log.warn(`  Migrated ${remainingResult.modifiedCount} subscriptions with unknown type → registration/lifetime (fallback)`);
        }

        const totalMigrated = registrationResult.modifiedCount + featureResult.modifiedCount + remainingResult.modifiedCount;

        log.info(`Migration completed!`);
        log.info(`- Total found: ${totalToMigrate}`);
        log.info(`- CLASSIQUE/CIBLE → registration: ${registrationResult.modifiedCount}`);
        log.info(`- RELANCE → feature: ${featureResult.modifiedCount}`);
        log.info(`- Fallback: ${remainingResult.modifiedCount}`);
        log.info(`- Total migrated: ${totalMigrated}`);

        // Verify
        const remaining = await SubscriptionModel.countDocuments({
            category: { $exists: false }
        });

        if (remaining > 0) {
            log.warn(`Warning: ${remaining} subscriptions still missing category field`);
        } else {
            log.info('Verification: All subscriptions have been migrated');
        }

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
