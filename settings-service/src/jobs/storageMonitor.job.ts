import * as cron from 'node-cron';
import storageMonitorService from '../services/storageMonitor.service';
import logger from '../utils/logger';

const log = logger.getLogger('StorageMonitorJob');

class StorageMonitorJob {
    private quickCheckJob: cron.ScheduledTask | null = null;
    private dailyCheckJob: cron.ScheduledTask | null = null;

    /**
     * Start the storage monitoring jobs
     */
    start(): void {
        // Quick check every hour
        this.quickCheckJob = cron.schedule('0 * * * *', async () => {
            await this.runQuickCheck();
        });

        // Detailed check daily at 2 AM
        this.dailyCheckJob = cron.schedule('0 2 * * *', async () => {
            await this.runDetailedCheck();
        });

        log.info('Storage monitoring jobs started');
        log.info('- Quick check: Every hour');
        log.info('- Detailed check: Daily at 2 AM');

        // Run initial check
        setImmediate(() => this.runQuickCheck());
    }

    /**
     * Stop the storage monitoring jobs
     */
    stop(): void {
        if (this.quickCheckJob) {
            this.quickCheckJob.stop();
            this.quickCheckJob = null;
        }
        if (this.dailyCheckJob) {
            this.dailyCheckJob.stop();
            this.dailyCheckJob = null;
        }
        log.info('Storage monitoring jobs stopped');
    }

    /**
     * Run a quick check (hourly)
     */
    private async runQuickCheck(): Promise<void> {
        try {
            log.debug('Running quick storage check...');
            const report = await storageMonitorService.getStorageReport();

            // Log if there's an alert or costs are rising
            if (report.alert || report.costs.total > 1000) {
                await storageMonitorService.logStorageStatus();
            }

            // Send notifications for critical cost situations
            if (report.alert && report.alert.level === 'critical') {
                await this.sendCriticalAlert(report);
            } else if (report.alert && report.alert.level === 'warning') {
                await this.sendWarningAlert(report);
            }
        } catch (error: any) {
            log.error('Error in quick storage check:', error);
        }
    }

    /**
     * Run detailed daily check
     */
    private async runDetailedCheck(): Promise<void> {
        log.info('Running daily detailed storage check...');

        try {
            // Always log detailed status daily
            await storageMonitorService.logStorageStatus();

            // Get cleanup candidates
            const cleanupCandidates = await storageMonitorService.getCleanupCandidates(7);
            if (cleanupCandidates.length > 0) {
                log.info(`Daily cleanup report: ${cleanupCandidates.length} safe temporary files found for cleanup`);
            }

            // Get storage breakdown for insights
            const breakdown = await storageMonitorService.getStorageBreakdown();
            log.info(`Daily file breakdown: ${breakdown.breakdown.join(', ')}`);
            log.info(`Daily cost breakdown: Storage ${Math.round(breakdown.costs.storage)} FCFA, Total ${Math.round(breakdown.costs.total)} FCFA/month`);

        } catch (error: any) {
            log.error('Error in detailed storage check:', error);
        }
    }

    /**
     * Run storage check immediately (for manual triggers)
     */
    async runNow(): Promise<void> {
        log.info('Manual storage check triggered');
        await this.runDetailedCheck();
    }

    /**
     * Send critical cost alert
     */
    private async sendCriticalAlert(report: any): Promise<void> {
        try {
            log.warn('CRITICAL COST ALERT:', {
                message: report.alert.message,
                totalCost: `${Math.round(report.costs.total)} FCFA/month`,
                costThreshold: `${report.alert.costThreshold} FCFA`,
                recommendations: report.alert.recommendedActions
            });

            // Here you could add notification service integration
            // await notificationService.sendAlert('storage-critical', { ... });

        } catch (error: any) {
            log.error('Error sending critical storage alert:', error);
        }
    }

    /**
     * Send warning cost alert
     */
    private async sendWarningAlert(report: any): Promise<void> {
        try {
            log.warn('STORAGE COST WARNING:', {
                message: report.alert.message,
                totalCost: `${Math.round(report.costs.total)} FCFA/month`,
                costThreshold: `${report.alert.costThreshold} FCFA`,
                recommendations: report.alert.recommendedActions
            });

            // Here you could add notification service integration
            // await notificationService.sendAlert('storage-warning', { ... });

        } catch (error: any) {
            log.error('Error sending warning storage alert:', error);
        }
    }
}

export default new StorageMonitorJob(); 