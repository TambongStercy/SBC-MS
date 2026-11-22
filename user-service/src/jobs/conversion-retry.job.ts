import cron, { type ScheduledTask } from 'node-cron';
import { retryPendingConversions } from '../services/wallet-conversion.service';
import logger from '../utils/logger';
import { timeJob } from '../utils/metrics';

const log = logger.getLogger('ConversionRetry');

/** Every 10 min: finishes currency conversions whose credit leg did not land. */
class ConversionRetryJob {
    private task: ScheduledTask | null = null;
    private running = false;

    start(): void {
        this.task = cron.schedule('*/10 * * * *', async () => {
            if (this.running) return;
            this.running = true;
            try {
                await timeJob('conversion_retry', () => retryPendingConversions());
            } catch (err: any) {
                log.error(`Conversion retry failed: ${err?.message ?? err}`);
            } finally {
                this.running = false;
            }
        });
        log.info('Conversion retry scheduled (every 10 min)');
    }

    stop(): void {
        this.task?.stop();
        this.task = null;
    }
}

export const conversionRetryJob = new ConversionRetryJob();
