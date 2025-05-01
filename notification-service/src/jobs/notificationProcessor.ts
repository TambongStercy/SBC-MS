import { notificationService } from '../services/notification.service';
import config from '../config';
import logger from '../utils/logger';

// Create a component-specific logger
const log = logger.getLogger('NotificationProcessor');

const PROCESSING_INTERVAL = config.notification.processingIntervalMs || 60000; // Default to 1 minute
const BATCH_SIZE = config.notification.processingBatchSize || 50;

/**
 * This class handles processing of pending notifications in the background
 */
class NotificationProcessor {
    private isRunning: boolean = false;
    private intervalId: NodeJS.Timeout | null = null;

    /**
     * Start the notification processor
     */
    start(): void {
        if (this.isRunning) {
            log.info('Already running');
            return;
        }

        log.info(`Starting with interval ${PROCESSING_INTERVAL}ms and batch size ${BATCH_SIZE}`);

        this.isRunning = true;

        // Process once immediately
        this.processNotifications();

        // Then schedule periodic processing
        this.intervalId = setInterval(() => {
            this.processNotifications();
        }, PROCESSING_INTERVAL);
    }

    /**
     * Stop the notification processor
     */
    stop(): void {
        if (!this.isRunning) {
            log.info('Not running');
            return;
        }

        log.info('Stopping');

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
    }

    /**
     * Process a batch of pending notifications
     */
    private async processNotifications(): Promise<void> {
        try {
            const processedCount = await notificationService.processPendingNotifications(BATCH_SIZE);

            if (processedCount > 0) {
                log.info(`Processed ${processedCount} notifications`);
            }
        } catch (error) {
            log.error('Error processing notifications', { error });
        }
    }
}

// Export singleton instance
export const notificationProcessor = new NotificationProcessor(); 