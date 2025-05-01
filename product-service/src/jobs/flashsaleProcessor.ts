import { flashSaleRepository } from '../database/repositories/flashsale.repository';
import { FlashSaleStatus } from '../database/models/flashsale.model';
import logger from '../utils/logger';

const log = logger.getLogger('FlashSaleProcessor');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // Default check interval: 5 minutes


class FlashSaleProcessor {
    private running: boolean = false;
    private interval: NodeJS.Timeout | null = null;
    private processingInterval: number = DEFAULT_INTERVAL_MS;

    /**
     * Start the flash sale processor.
     * @param interval Optional processing interval in milliseconds.
     */
    start(interval: number = DEFAULT_INTERVAL_MS): void {
        if (this.running) {
            log.warn('Flash sale processor is already running');
            return;
        }

        this.processingInterval = interval;
        this.running = true;

        log.info(`Starting flash sale processor with interval of ${interval}ms`);

        // Schedule the processing job
        this.interval = setInterval(() => this.processScheduledFlashSales(), this.processingInterval);

        // Optionally, run the first check immediately upon start
        // this.processScheduledFlashSales(); 
    }

    /**
     * Stop the flash sale processor.
     */
    stop(): void {
        if (!this.running) {
            log.warn('Flash sale processor is not running');
            return;
        }

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        this.running = false;
        log.info('Flash sale processor stopped');
    }

    /**
     * Finds scheduled flash sales whose start time has passed and updates their status to ACTIVE.
     */
    private async processScheduledFlashSales(): Promise<void> {
        log.info('Running scheduled flash sale check...');
        try {
            const now = new Date();
            const query = {
                status: FlashSaleStatus.SCHEDULED,
                startTime: { $lte: now }
            };

            const salesToActivate = await flashSaleRepository.find(query, 100); // Limit batch size

            if (salesToActivate.length === 0) {
                log.info('No scheduled flash sales found to activate.');
                return;
            }

            log.info(`Found ${salesToActivate.length} scheduled flash sales to activate.`);

            for (const sale of salesToActivate) {
                try {
                    await flashSaleRepository.findByIdAndUpdate(sale._id, { status: FlashSaleStatus.ACTIVE });
                    log.info(`Activated flash sale ${sale._id}`);
                    // Optionally: Send notification that the sale is now active?
                } catch (error) {
                    log.error(`Error activating flash sale ${sale._id}:`, error);
                    // Continue processing other sales
                }
            }

            log.info('Finished processing scheduled flash sales.');
        } catch (error) {
            log.error(`Error during scheduled flash sale processing:`, error);
        }
    }
}

// Create and export a singleton instance
export const flashSaleProcessor = new FlashSaleProcessor(); 