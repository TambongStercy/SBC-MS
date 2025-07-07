import cron from 'node-cron';
import storageMonitorService from '../services/storageMonitor.service';
import logger from '../utils/logger';

const log = logger.getLogger('StorageMonitorJob');

class StorageMonitorJob {
    private isRunning = false;

    /**
     * Start the storage monitoring job
     * Runs every hour to check storage status
     */
    start(): void {
        // Run every hour at minute 0
        cron.schedule('0 * * * *', async () => {
            if (this.isRunning) {
                log.debug('Storage monitor job already running, skipping...');
                return;
            }

            this.isRunning = true;
            try {
                await this.runMonitoring();
            } catch (error: any) {
                log.error('Error in storage monitoring job:', error);
            } finally {
                this.isRunning = false;
            }
        });

        // Also run a daily detailed check at 2 AM
        cron.schedule('0 2 * * *', async () => {
            try {
                await this.runDetailedCheck();
            } catch (error: any) {
                log.error('Error in daily storage check:', error);
            }
        });

        log.info('Storage monitoring job started - running every hour');
    }

    /**
     * Run basic storage monitoring
     */
    private async runMonitoring(): Promise<void> {
        log.debug('Running storage monitoring check...');

        const report = await storageMonitorService.getStorageReport();

        // Log if there's an alert or high usage
        if (report.alert || report.usage.percentage > 70) {
            await storageMonitorService.logStorageStatus();
        }

        // Send notifications for critical situations
        if (report.alert && report.alert.level === 'emergency') {
            await this.sendEmergencyAlert(report);
        } else if (report.alert && report.alert.level === 'critical') {
            await this.sendCriticalAlert(report);
        }
    }

    /**
     * Run detailed daily check
     */
    private async runDetailedCheck(): Promise<void> {
        log.info('Running daily detailed storage check...');

        const report = await storageMonitorService.getStorageReport();

        // Always log detailed status daily
        await storageMonitorService.logStorageStatus();

        // Log cleanup recommendations (ONLY for safe temp files)
        if (report.cleanupCandidates > 0) {
            log.info(`Daily cleanup recommendation: ${report.cleanupCandidates} SAFE temporary files could be cleaned up to free space`);
            log.warn('NOTE: User profile pictures and product images are NEVER included in cleanup recommendations');
        }

        // Log trend analysis (if storage is consistently high)
        if (report.usage.percentage > 80) {
            log.warn('Storage consistently high - consider implementing automated cleanup or upgrading storage');
        }
    }

    /**
     * Send emergency alert for critical storage situations
     */
    private async sendEmergencyAlert(report: any): Promise<void> {
        // TODO: Integrate with notification service to send email/SMS alerts
        log.error(`EMERGENCY STORAGE ALERT: ${report.alert.message}`);
        log.error('Storage usage:', `${storageMonitorService.formatBytes(report.usage.used)} / ${storageMonitorService.formatBytes(report.usage.total)} (${report.usage.percentage}%)`);
        log.error('Immediate action required:', report.alert.recommendedActions);

        // You can extend this to send actual notifications:
        // await notificationService.sendEmergencyAlert({
        //     subject: 'EMERGENCY: Storage Full',
        //     message: report.alert.message,
        //     actions: report.alert.recommendedActions
        // });
    }

    /**
     * Send critical alert for high storage usage
     */
    private async sendCriticalAlert(report: any): Promise<void> {
        log.warn(`CRITICAL STORAGE ALERT: ${report.alert.message}`);
        log.warn('Recommended actions:', report.alert.recommendedActions);

        // You can extend this to send actual notifications:
        // await notificationService.sendCriticalAlert({
        //     subject: 'Critical Storage Warning',
        //     message: report.alert.message,
        //     actions: report.alert.recommendedActions
        // });
    }

    /**
     * Run monitoring check immediately (for testing)
     */
    async runNow(): Promise<void> {
        log.info('Running immediate storage check...');
        await this.runMonitoring();
        await this.runDetailedCheck();
    }

    /**
     * Stop the monitoring job
     */
    stop(): void {
        // Note: node-cron doesn't provide a direct stop method for specific tasks
        // In a production environment, you might want to use a job queue system
        log.info('Storage monitoring job stop requested');
    }
}

export default new StorageMonitorJob(); 