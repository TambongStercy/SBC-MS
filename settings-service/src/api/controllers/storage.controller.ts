import { Request, Response } from 'express';
import storageMonitorService from '../../services/storageMonitor.service';
import logger from '../../utils/logger';

const log = logger.getLogger('StorageController');

export class StorageController {

    /**
     * Get comprehensive storage status including usage, costs, and recommendations
     */
    async getStorageStatus(req: Request, res: Response): Promise<void> {
        try {
            const report = await storageMonitorService.getStorageReport();
            const breakdown = await storageMonitorService.getStorageBreakdown();

            // Format the response to match frontend expectations
            const response = {
                success: true,
                data: {
                    usage: {
                        used: storageMonitorService.formatBytes(report.usage.used),
                        total: "Unlimited", // Cloud Storage is virtually unlimited
                        available: "Unlimited", // Cloud Storage is virtually unlimited
                        percentage: `${report.usage.percentage.toFixed(1)}%`,
                        raw: report.usage
                    },
                    costs: {
                        storage: `${Math.round(report.costs.storage)} FCFA`,
                        bandwidth: `${Math.round(report.costs.bandwidth)} FCFA`,
                        operations: `${Math.round(report.costs.operations)} FCFA`,
                        total: `${Math.round(report.costs.total)} FCFA`,
                        raw: report.costs
                    },
                    breakdown: breakdown ? {
                        totalFiles: breakdown.totalFiles,
                        profilePictureFiles: breakdown.profilePictureFiles,
                        productFiles: breakdown.productFiles,
                        documentFiles: breakdown.documentFiles,
                        otherFiles: breakdown.otherFiles,
                        breakdown: breakdown.breakdown,
                        costs: breakdown.costs
                    } : null,
                    alert: report.alert,
                    cleanupCandidates: {
                        count: report.cleanupCandidates,
                        potentialSavings: "To be calculated", // We can enhance this later
                        note: "Only temporary/cache files are considered for cleanup. User content is always protected."
                    },
                    recommendations: report.recommendations,
                    healthStatus: this.determineHealthStatus(report.costs.total, report.alert),
                    protectionPolicy: {
                        profilePictures: "PROTECTED",
                        productImages: "PROTECTED", 
                        userGeneratedContent: "PROTECTED",
                        temporaryFiles: "CLEANABLE"
                    }
                }
            };

            res.json(response);
        } catch (error: any) {
            log.error('Error getting storage status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get storage status',
                error: error.message
            });
        }
    }

    /**
     * Run a manual storage check and return updated status
     */
    async runStorageCheck(req: Request, res: Response): Promise<void> {
        try {
            // Log current storage status (this will also run checks)
            await storageMonitorService.logStorageStatus();
            
            // Get fresh data
            const usage = await storageMonitorService.getStorageUsage();
            const alert = await storageMonitorService.checkStorageHealth();
            const costs = storageMonitorService.calculateStorageCosts(usage.used, usage.fileCount, 0);

            const response = {
                success: true,
                message: 'Storage check completed successfully',
                data: {
                    usage: {
                        used: storageMonitorService.formatBytes(usage.used),
                        fileCount: usage.fileCount.toString(),
                        totalCost: `${Math.round(costs.total)} FCFA`
                    },
                    alert,
                    timestamp: new Date().toISOString()
                }
            };

            res.json(response);
        } catch (error: any) {
            log.error('Error running storage check:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to run storage check',
                error: error.message
            });
        }
    }

    /**
     * Get cleanup candidates with potential cost savings
     */
    async getCleanupCandidates(req: Request, res: Response): Promise<void> {
        try {
            const daysOld = parseInt(req.query.daysOld as string) || 7;
            const candidates = await storageMonitorService.getCleanupCandidates(daysOld);

            // Calculate total size and potential savings
            let totalBytes = 0;
            const formattedCandidates = candidates.map(candidate => {
                const size = parseInt(candidate.size || '0', 10);
                totalBytes += size;
                
                return {
                    id: candidate.id,
                    name: candidate.name,
                    createdTime: candidate.createdTime,
                    size: storageMonitorService.formatBytes(size),
                    mimeType: candidate.mimeType
                };
            });

            // Estimate cost savings (storage cost only, as bandwidth is already used)
            const monthlyCostSavings = storageMonitorService.calculateStorageCosts(totalBytes, 0, 0).storage;

            const response = {
                success: true,
                data: {
                    totalFiles: candidates.length,
                    totalSizeToFree: storageMonitorService.formatBytes(totalBytes),
                    daysOld,
                    estimatedCostSavings: `${Math.round(monthlyCostSavings)} FCFA`,
                    candidates: formattedCandidates
                }
            };

            res.json(response);
        } catch (error: any) {
            log.error('Error getting cleanup candidates:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get cleanup candidates',
                error: error.message
            });
        }
    }

    /**
     * Determine health status based on costs and alerts
     */
    private determineHealthStatus(totalCost: number, alert: any): string {
        if (alert?.level === 'critical') return 'CRITICAL';
        if (alert?.level === 'warning') return 'WARNING';
        if (totalCost > 1000) return 'MODERATE'; // Above 1000 FCFA
        return 'HEALTHY';
    }
}

export default new StorageController(); 