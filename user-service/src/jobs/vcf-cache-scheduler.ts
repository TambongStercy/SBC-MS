import cron from 'node-cron';
import { vcfCacheService } from '../services/vcf-cache.service';
import logger from '../utils/logger';

const log = logger.getLogger('VCFCacheScheduler');

export class VCFCacheScheduler {
    private isRunning: boolean = false;

    /**
     * Starts the VCF cache regeneration scheduler
     * Runs every hour to ensure the cache is fresh
     */
    start(): void {
        if (this.isRunning) {
            log.warn('VCF cache scheduler is already running');
            return;
        }

        log.info('Starting VCF cache scheduler...');

        // Schedule to run every hour at minute 0
        // Format: minute hour day month dayOfWeek
        cron.schedule('0 * * * *', async () => {
            try {
                log.info('Scheduled VCF cache regeneration starting...');
                const startTime = Date.now();

                // Check if file needs regeneration (older than 55 minutes)
                await vcfCacheService.ensureFreshVCFFile(55);

                const endTime = Date.now();
                log.info(`Scheduled VCF cache check completed in ${endTime - startTime}ms`);

            } catch (error: any) {
                log.error('Error in scheduled VCF cache regeneration:', error);
            }
        }, {
            timezone: "UTC" // Use UTC to avoid timezone issues
        });

        // Also schedule a daily full regeneration at 2 AM UTC
        cron.schedule('0 2 * * *', async () => {
            try {
                log.info('Daily VCF cache full regeneration starting...');
                const startTime = Date.now();

                // Force regeneration regardless of file age
                await vcfCacheService.generateVCFFile();

                const endTime = Date.now();
                const stats = await vcfCacheService.getFileStats();
                log.info(`Daily VCF cache regeneration completed in ${endTime - startTime}ms. Contacts: ${stats.contactCount}, Size: ${stats.size} bytes`);

            } catch (error: any) {
                log.error('Error in daily VCF cache regeneration:', error);
            }
        }, {
            timezone: "UTC"
        });

        this.isRunning = true;
        log.info('VCF cache scheduler started successfully');
        log.info('- Hourly cache freshness check: 0 * * * * (every hour at minute 0)');
        log.info('- Daily full regeneration: 0 2 * * * (every day at 2:00 AM UTC)');
    }

    /**
     * Stops the VCF cache scheduler
     */
    stop(): void {
        if (!this.isRunning) {
            log.warn('VCF cache scheduler is not running');
            return;
        }

        // Note: node-cron doesn't provide a direct way to stop specific tasks
        // In a production environment, you might want to keep references to the tasks
        log.info('VCF cache scheduler stop requested');
        this.isRunning = false;
    }

    /**
     * Gets the current status of the scheduler
     */
    getStatus(): { isRunning: boolean } {
        return { isRunning: this.isRunning };
    }

    /**
     * Manually trigger an immediate cache regeneration
     */
    async triggerImmediate(): Promise<void> {
        log.info('Manual VCF cache regeneration triggered');
        try {
            const startTime = Date.now();
            await vcfCacheService.generateVCFFile();
            const endTime = Date.now();

            const stats = await vcfCacheService.getFileStats();
            log.info(`Manual VCF cache regeneration completed in ${endTime - startTime}ms. Contacts: ${stats.contactCount}, Size: ${stats.size} bytes`);
        } catch (error: any) {
            log.error('Error in manual VCF cache regeneration:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const vcfCacheScheduler = new VCFCacheScheduler();
