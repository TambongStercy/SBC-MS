import { Request, Response, NextFunction } from 'express';
import storageMonitorService from '../../services/storageMonitor.service';
import storageMonitorJob from '../../jobs/storageMonitor.job';
import logger from '../../utils/logger';

const log = logger.getLogger('StorageController');

export class StorageController {
    /**
 * Get current storage status and recommendations
 */
    async getStorageStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const report = await storageMonitorService.getStorageReport();

            // Get storage breakdown for additional insights
            let breakdown = null;
            try {
                breakdown = await storageMonitorService.getStorageBreakdown();
            } catch (error) {
                log.debug('Could not get storage breakdown:', error);
            }

            // Format the response for better readability
            const formattedReport = {
                usage: {
                    used: storageMonitorService.formatBytes(report.usage.used),
                    total: storageMonitorService.formatBytes(report.usage.total),
                    available: storageMonitorService.formatBytes(report.usage.availableSpace),
                    percentage: `${report.usage.percentage}%`,
                    raw: report.usage // Include raw bytes for programmatic use
                },
                breakdown: breakdown ? {
                    totalFiles: breakdown.totalFiles,
                    userContent: {
                        profilePictures: breakdown.profilePictureFiles,
                        productImages: breakdown.productFiles,
                        note: "User content is PROTECTED and will never be automatically deleted"
                    },
                    otherFiles: breakdown.otherFiles,
                    summary: breakdown.breakdown
                } : null,
                alert: report.alert,
                cleanupCandidates: {
                    count: report.cleanupCandidates,
                    note: "Only includes safe temporary files - user content is excluded"
                },
                recommendations: report.recommendations,
                healthStatus: this.getHealthStatus(report.usage.percentage),
                protectionPolicy: {
                    profilePictures: "PROTECTED - Never deleted",
                    productImages: "PROTECTED - Never deleted",
                    userGeneratedContent: "PROTECTED - Never deleted",
                    temporaryFiles: "Safe for cleanup after 7+ days"
                }
            };

            res.status(200).json({
                success: true,
                data: formattedReport
            });

        } catch (error: any) {
            log.error('Error getting storage status:', error);
            next(error);
        }
    }

    /**
     * Manually trigger storage monitoring check
     */
    async runStorageCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            log.info('Manual storage check triggered via API');

            // Run the monitoring job immediately
            await storageMonitorJob.runNow();

            // Get the latest report
            const report = await storageMonitorService.getStorageReport();

            res.status(200).json({
                success: true,
                message: 'Storage check completed',
                data: {
                    usage: {
                        used: storageMonitorService.formatBytes(report.usage.used),
                        total: storageMonitorService.formatBytes(report.usage.total),
                        percentage: `${report.usage.percentage}%`
                    },
                    alert: report.alert,
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error: any) {
            log.error('Error running manual storage check:', error);
            next(error);
        }
    }

    /**
     * Get list of files that can be cleaned up
     */
    async getCleanupCandidates(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const daysOld = parseInt(req.query.daysOld as string) || 7;

            const candidates = await storageMonitorService.getCleanupCandidates(daysOld);

            // Calculate total size that could be freed
            const totalSize = candidates.reduce((sum, file) => {
                return sum + (parseInt(file.size || '0', 10));
            }, 0);

            res.status(200).json({
                success: true,
                data: {
                    totalFiles: candidates.length,
                    totalSizeToFree: storageMonitorService.formatBytes(totalSize),
                    daysOld,
                    files: candidates.map(file => ({
                        id: file.id,
                        name: file.name,
                        size: storageMonitorService.formatBytes(parseInt(file.size || '0', 10)),
                        createdTime: file.createdTime,
                        mimeType: file.mimeType
                    }))
                }
            });

        } catch (error: any) {
            log.error('Error getting cleanup candidates:', error);
            next(error);
        }
    }

    /**
     * Get storage health status based on percentage
     */
    private getHealthStatus(percentage: number): string {
        if (percentage >= 98) return 'EMERGENCY';
        if (percentage >= 95) return 'CRITICAL';
        if (percentage >= 80) return 'WARNING';
        if (percentage >= 60) return 'MODERATE';
        return 'HEALTHY';
    }
} 