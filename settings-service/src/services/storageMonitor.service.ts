import { Storage } from '@google-cloud/storage';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('StorageMonitorService');

interface StorageUsage {
    used: number;           // Bytes used
    total: number;          // Estimated limit (Cloud Storage is virtually unlimited)
    percentage: number;     // Percentage based on cost thresholds
    availableSpace: number; // Virtually unlimited for Cloud Storage
    fileCount: number;      // Number of files
}

interface StorageCosts {
    storage: number;        // Monthly storage cost in FCFA
    bandwidth: number;      // Monthly bandwidth cost in FCFA
    operations: number;     // Monthly operations cost in FCFA
    total: number;          // Total monthly cost in FCFA
}

interface StorageAlert {
    level: 'info' | 'warning' | 'critical';
    costThreshold: number;  // Cost threshold in FCFA
    message: string;
    recommendedActions: string[];
}

class StorageMonitorService {
    private storage: Storage;
    private bucketName: string;

    // Cloud Storage pricing (in USD, converted to FCFA at ~600 FCFA per USD)
    private readonly PRICING = {
        storagePerGBMonth: 0.020 * 600,      // ~12 FCFA per GB per month
        bandwidthPerGB: 0.12 * 600,          // ~72 FCFA per GB (after 1TB free)
        operationsPer10K: 0.004 * 600,       // ~2.4 FCFA per 10K operations
        freeBandwidthGB: 1024,               // 1TB free egress per month
        exchangeRate: 600                    // USD to FCFA
    };

    constructor() {
        // Use existing Google Drive credentials for Cloud Storage
        this.storage = new Storage({
            credentials: {
                client_email: config.googleDrive.clientEmail,
                private_key: config.googleDrive.privateKey,
            },
            projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        });

        this.bucketName = process.env.CLOUD_STORAGE_BUCKET_NAME || 'sbc-file-storage';
    }

    /**
     * Get current Cloud Storage usage information
     */
    async getStorageUsage(): Promise<StorageUsage> {
        try {
            const bucket = this.storage.bucket(this.bucketName);
            const [files] = await bucket.getFiles({ autoPaginate: true });

            let totalBytes = 0;
            for (const file of files) {
                totalBytes += parseInt(String(file.metadata.size || '0'), 10);
            }

            const fileCount = files.length;

            // Cloud Storage is virtually unlimited, so we base "percentage" on cost thresholds
            const costs = this.calculateStorageCosts(totalBytes, fileCount, 0);
            const monthlyStorageCost = costs.storage;

            // Define cost thresholds in FCFA
            const warningThreshold = 5000;  // 5,000 FCFA
            const criticalThreshold = 15000; // 15,000 FCFA

            const percentage = Math.min(100, (monthlyStorageCost / criticalThreshold) * 100);

            return {
                used: totalBytes,
                total: -1, // Unlimited for Cloud Storage
                percentage: Math.round(percentage * 100) / 100,
                availableSpace: -1, // Unlimited for Cloud Storage
                fileCount
            };
        } catch (error: any) {
            log.error('Error fetching Cloud Storage usage:', error);
            throw new Error(`Failed to get storage usage: ${error.message}`);
        }
    }

    /**
     * Calculate monthly storage costs in FCFA
     */
    calculateStorageCosts(storageBytes: number, fileCount: number, bandwidthGB: number): StorageCosts {
        const storageGB = storageBytes / (1024 * 1024 * 1024);

        // Storage cost
        const storage = storageGB * this.PRICING.storagePerGBMonth;

        // Bandwidth cost (first 1TB free)
        const chargableBandwidth = Math.max(0, bandwidthGB - this.PRICING.freeBandwidthGB);
        const bandwidth = chargableBandwidth * this.PRICING.bandwidthPerGB;

        // Operations cost (rough estimate based on file count)
        const estimatedOperations = fileCount * 2; // Assume 2 operations per file on average
        const operations = (estimatedOperations / 10000) * this.PRICING.operationsPer10K;

        const total = storage + bandwidth + operations;

        return { storage, bandwidth, operations, total };
    }

    /**
     * Check storage health based on cost thresholds
     */
    async checkStorageHealth(): Promise<StorageAlert | null> {
        const usage = await this.getStorageUsage();
        const costs = this.calculateStorageCosts(usage.used, usage.fileCount, 0);

        // Cost thresholds in FCFA
        const warningCost = 5000;   // 5,000 FCFA
        const criticalCost = 15000; // 15,000 FCFA

        if (costs.total >= criticalCost) {
            return {
                level: 'critical',
                costThreshold: criticalCost,
                message: `CRITICAL: Monthly storage cost is ${Math.round(costs.total)} FCFA (above ${criticalCost} FCFA threshold)`,
                recommendedActions: [
                    'Review and optimize file storage',
                    'Implement file cleanup policies',
                    'Monitor storage growth trends',
                    'Consider archiving old files'
                ]
            };
        }

        if (costs.total >= warningCost) {
            return {
                level: 'warning',
                costThreshold: warningCost,
                message: `WARNING: Monthly storage cost is ${Math.round(costs.total)} FCFA (above ${warningCost} FCFA threshold)`,
                recommendedActions: [
                    'Monitor storage usage trends',
                    'Plan for potential cleanup',
                    'Review file retention policies',
                    'Consider cost optimization'
                ]
            };
        }

        // Info level for normal usage
        return {
            level: 'info',
            costThreshold: 0,
            message: `Storage costs are within normal range: ${Math.round(costs.total)} FCFA/month`,
            recommendedActions: [
                'Continue monitoring usage',
                'Maintain current storage practices'
            ]
        };
    }

    /**
     * Get files that can be cleaned up (older than specified days)
     * EXCLUDES user-generated content like profile pictures and product images
     */
    async getCleanupCandidates(daysOld: number = 7): Promise<any[]> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);

            const bucket = this.storage.bucket(this.bucketName);
            const [files] = await bucket.getFiles({ autoPaginate: true });

            const candidates = [];

            // Safe prefixes for temporary/cache files that can be deleted
            const safePrefixes = [
                'temp_',
                'cache_',
                'backup_',
                'export_',
                'log_',
                'tmp_'
            ];

            for (const file of files) {
                const createdDate = new Date(file.metadata.timeCreated as string);

                // Skip if file is newer than cutoff
                if (createdDate > cutoffDate) continue;

                // Only include files with safe prefixes (exclude user content)
                const fileName = file.name;
                const hasSafePrefix = safePrefixes.some(prefix => fileName.startsWith(prefix));

                // Additional safety: exclude user content folders
                const isUserContent = fileName.startsWith('avatars/') ||
                    fileName.startsWith('products/') ||
                    fileName.startsWith('documents/');

                if (hasSafePrefix && !isUserContent) {
                    candidates.push({
                        id: file.name,
                        name: file.name,
                        createdTime: file.metadata.timeCreated,
                        size: file.metadata.size,
                        mimeType: file.metadata.contentType
                    });
                }
            }

            // Log what we're considering for cleanup
            if (candidates.length > 0) {
                log.info(`Found ${candidates.length} cleanup candidates (safe files only):`);
                candidates.forEach(file => {
                    log.debug(`- ${file.name} (${file.mimeType}) - ${file.createdTime}`);
                });
            }

            return candidates;
        } catch (error: any) {
            log.error('Error getting cleanup candidates:', error);
            throw new Error(`Failed to get cleanup candidates: ${error.message}`);
        }
    }

    /**
     * Get storage statistics and cost recommendations
     */
    async getStorageReport(): Promise<{
        usage: StorageUsage;
        costs: StorageCosts;
        alert: StorageAlert | null;
        cleanupCandidates: number;
        recommendations: string[];
    }> {
        const usage = await this.getStorageUsage();
        const costs = this.calculateStorageCosts(usage.used, usage.fileCount, 0);
        const alert = await this.checkStorageHealth();
        const cleanupFiles = await this.getCleanupCandidates();

        const recommendations: string[] = [];

        if (costs.total > 1000) {
            recommendations.push(`Current monthly cost: ${Math.round(costs.total)} FCFA (${Math.round(costs.total / 600)} USD)`);
        }

        if (costs.total > 5000) {
            recommendations.push('Consider implementing file cleanup policies to reduce costs');
        }

        if (costs.total > 10000) {
            recommendations.push('Review file retention policies - archive old files to reduce storage costs');
        }

        if (costs.total > 20000) {
            recommendations.push('URGENT: High storage costs detected. Implement aggressive cleanup strategies');
        }

        if (cleanupFiles.length > 0) {
            recommendations.push(`${cleanupFiles.length} safe temporary files could be cleaned up (user content excluded)`);
        }

        if (costs.total < 1000) {
            recommendations.push('Storage costs are low and manageable');
        }

        return {
            usage,
            costs,
            alert,
            cleanupCandidates: cleanupFiles.length,
            recommendations
        };
    }

    /**
     * Format storage size in human-readable format
     */
    formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Get storage breakdown by folder and file type for Cloud Storage
 */
    async getStorageBreakdown(): Promise<{
        totalFiles: number;
        profilePictureFiles: number;
        productFiles: number;
        documentFiles: number;
        otherFiles: number;
        breakdown: string[];
        costs: StorageCosts;
    }> {
        try {
            const bucket = this.storage.bucket(this.bucketName);
            const [files] = await bucket.getFiles({ autoPaginate: true });

            let profilePictureFiles = 0;
            let productFiles = 0;
            let documentFiles = 0;
            let otherFiles = 0;
            let totalBytes = 0;
            const breakdown: string[] = [];

            // Categorize files by folder structure
            for (const file of files) {
                totalBytes += parseInt(String(file.metadata.size || '0'), 10);

                if (file.name.startsWith('avatars/')) {
                    profilePictureFiles++;
                } else if (file.name.startsWith('products/')) {
                    productFiles++;
                } else if (file.name.startsWith('documents/')) {
                    documentFiles++;
                } else {
                    otherFiles++;
                }
            }

            breakdown.push(`Profile Pictures (avatars/): ${profilePictureFiles} files`);
            breakdown.push(`Product Images (products/): ${productFiles} files`);
            breakdown.push(`Documents: ${documentFiles} files`);
            breakdown.push(`Other Files: ${otherFiles} files`);

            const totalFiles = profilePictureFiles + productFiles + documentFiles + otherFiles;
            const costs = this.calculateStorageCosts(totalBytes, totalFiles, 0);

            return {
                totalFiles,
                profilePictureFiles,
                productFiles,
                documentFiles,
                otherFiles,
                breakdown,
                costs
            };
        } catch (error: any) {
            log.error('Error getting storage breakdown:', error);
            throw new Error(`Failed to get storage breakdown: ${error.message}`);
        }
    }

    /**
     * Log current Cloud Storage status with costs
     */
    async logStorageStatus(): Promise<void> {
        try {
            const report = await this.getStorageReport();
            const breakdown = await this.getStorageBreakdown();

            log.info(`Cloud Storage Status: ${this.formatBytes(report.usage.used)} (${report.usage.fileCount} files)`);
            log.info(`Monthly Cost Estimate: ${Math.round(report.costs.total)} FCFA (~${Math.round(report.costs.total / 600)} USD)`);
            log.info(`Cost Breakdown: Storage: ${Math.round(report.costs.storage)} FCFA, Bandwidth: ${Math.round(report.costs.bandwidth)} FCFA, Operations: ${Math.round(report.costs.operations)} FCFA`);

            // File breakdown
            log.info(`File Breakdown: ${breakdown.breakdown.join(', ')}`);

            if (report.alert) {
                log.warn(`Storage Alert [${report.alert.level.toUpperCase()}]: ${report.alert.message}`);
                log.info('Recommended actions:', report.alert.recommendedActions);
            }

            if (report.cleanupCandidates > 0) {
                log.info(`Found ${report.cleanupCandidates} SAFE temporary files that could be cleaned up (USER CONTENT EXCLUDED)`);
            }

            if (report.recommendations.length > 0) {
                log.info('Storage recommendations:', report.recommendations);
            }
        } catch (error: any) {
            log.error('Error logging Cloud Storage status:', error);
        }
    }

}

export default new StorageMonitorService(); 