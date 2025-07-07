import { google, drive_v3 } from 'googleapis';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('StorageMonitorService');

interface StorageUsage {
    used: number;
    total: number;
    percentage: number;
    availableSpace: number;
}

interface StorageAlert {
    level: 'warning' | 'critical' | 'emergency';
    percentage: number;
    message: string;
    recommendedActions: string[];
}

class StorageMonitorService {
    private drive: drive_v3.Drive;

    constructor() {
        const jwtClient = new google.auth.JWT(
            config.googleDrive.clientEmail,
            undefined,
            config.googleDrive.privateKey,
            ['https://www.googleapis.com/auth/drive']
        );

        this.drive = google.drive({ version: 'v3', auth: jwtClient });
    }

    /**
     * Get current storage usage information
     */
    async getStorageUsage(): Promise<StorageUsage> {
        try {
            const response = await this.drive.about.get({
                fields: 'storageQuota'
            });

            const quota = response.data.storageQuota;
            const used = parseInt(quota?.usage || '0', 10);
            const total = parseInt(quota?.limit || '0', 10);

            const percentage = total > 0 ? (used / total) * 100 : 0;
            const availableSpace = Math.max(0, total - used);

            return {
                used,
                total,
                percentage: Math.round(percentage * 100) / 100, // Round to 2 decimal places
                availableSpace
            };
        } catch (error: any) {
            log.error('Error fetching storage usage:', error);
            throw new Error(`Failed to get storage usage: ${error.message}`);
        }
    }

    /**
     * Check storage health and return alerts if needed
     */
    async checkStorageHealth(): Promise<StorageAlert | null> {
        const usage = await this.getStorageUsage();

        if (usage.percentage >= 98) {
            return {
                level: 'emergency',
                percentage: usage.percentage,
                message: 'EMERGENCY: Storage almost full! Uploads will fail soon.',
                recommendedActions: [
                    'Enable billing immediately',
                    'Run emergency cleanup',
                    'Delete temporary files',
                    'Contact system administrator'
                ]
            };
        }

        if (usage.percentage >= 95) {
            return {
                level: 'critical',
                percentage: usage.percentage,
                message: 'CRITICAL: Storage critically low',
                recommendedActions: [
                    'Enable billing on Google Cloud',
                    'Run cleanup scripts',
                    'Archive old files',
                    'Monitor closely'
                ]
            };
        }

        if (usage.percentage >= 80) {
            return {
                level: 'warning',
                percentage: usage.percentage,
                message: 'WARNING: Storage getting full',
                recommendedActions: [
                    'Plan billing upgrade',
                    'Schedule cleanup',
                    'Review storage policies',
                    'Monitor trends'
                ]
            };
        }

        return null; // No alert needed
    }

    /**
     * Get files that can be cleaned up (older than specified days)
     * EXCLUDES user-generated content like profile pictures and product images
     */
    async getCleanupCandidates(daysOld: number = 7): Promise<any[]> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            const cutoffISO = cutoffDate.toISOString();

            // Get protected folder IDs (user content that should NEVER be deleted)
            const protectedFolders = [
                config.googleDrive.profilePictureFolderId, // Profile pictures
                config.googleDrive.productDocsFolderId    // Product images/docs
            ].filter(Boolean); // Remove any undefined values

            // Build query to exclude protected folders and only include safe file types
            let query = `createdTime < '${cutoffISO}' and trashed = false`;

            // Exclude files in protected folders
            if (protectedFolders.length > 0) {
                const folderExclusions = protectedFolders.map(folderId => `not parents in '${folderId}'`).join(' and ');
                query += ` and (${folderExclusions})`;
            }

            // Only include temporary/cache files that are safe to delete
            // Add file type restrictions for extra safety
            const safeFileTypes = [
                'application/json',           // Config/cache files
                'text/plain',                // Log files, temp text files
                'application/zip',           // Temporary archives
                'application/x-gzip',        // Compressed temp files
                'text/csv',                  // Export files
                'application/pdf'            // Generated reports (be careful with this)
            ];

            // Add name patterns for files that are definitely safe to clean
            const safePrefixes = [
                'temp_',
                'cache_',
                'backup_',
                'export_',
                'log_',
                'tmp_'
            ];

            // Build file type and name pattern filters
            const safeTypeQuery = safeFileTypes.map(type => `mimeType='${type}'`).join(' or ');
            const safePrefixQuery = safePrefixes.map(prefix => `name contains '${prefix}'`).join(' or ');

            // Combine all safety filters - only files that match safe patterns
            query += ` and ((${safeTypeQuery}) or (${safePrefixQuery}))`;

            log.debug(`Cleanup query: ${query}`);

            const response = await this.drive.files.list({
                q: query,
                fields: 'files(id, name, createdTime, size, mimeType, parents)',
                orderBy: 'createdTime asc',
                pageSize: 50 // Reduced for safety
            });

            const candidates = response.data.files || [];

            // Additional safety check: Log what we're considering for cleanup
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
     * Get storage statistics and recommendations
     */
    async getStorageReport(): Promise<{
        usage: StorageUsage;
        alert: StorageAlert | null;
        cleanupCandidates: number;
        recommendations: string[];
    }> {
        const usage = await this.getStorageUsage();
        const alert = await this.checkStorageHealth();
        const cleanupFiles = await this.getCleanupCandidates();

        const recommendations: string[] = [];

        if (usage.percentage > 50) {
            recommendations.push('Consider enabling Google Cloud billing for unlimited storage (~$1-2/month)');
        }

        if (usage.percentage > 70) {
            recommendations.push('Plan storage upgrade - user content should never be deleted');
        }

        if (usage.percentage > 85) {
            recommendations.push('URGENT: Enable Google Cloud billing or migrate to Cloud Storage');
        }

        if (usage.percentage > 95) {
            recommendations.push('CRITICAL: Immediate billing upgrade required to prevent upload failures');
        }

        if (cleanupFiles.length > 0) {
            recommendations.push(`${cleanupFiles.length} safe temporary files could be cleaned up (user content excluded)`);
        }

        return {
            usage,
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
 * Get storage breakdown by folder and file type
 */
    async getStorageBreakdown(): Promise<{
        totalFiles: number;
        profilePictureFiles: number;
        productFiles: number;
        otherFiles: number;
        breakdown: string[];
    }> {
        try {
            const profilePictureFolderId = config.googleDrive.profilePictureFolderId;
            const productDocsFolderId = config.googleDrive.productDocsFolderId;

            let profilePictureFiles = 0;
            let productFiles = 0;
            let otherFiles = 0;
            const breakdown: string[] = [];

            // Count files in profile pictures folder
            if (profilePictureFolderId) {
                const ppResponse = await this.drive.files.list({
                    q: `parents in '${profilePictureFolderId}' and trashed = false`,
                    fields: 'files(id)',
                    pageSize: 1000
                });
                profilePictureFiles = ppResponse.data.files?.length || 0;
                breakdown.push(`Profile Pictures: ${profilePictureFiles} files`);
            }

            // Count files in product docs folder  
            if (productDocsFolderId) {
                const pdResponse = await this.drive.files.list({
                    q: `parents in '${productDocsFolderId}' and trashed = false`,
                    fields: 'files(id)',
                    pageSize: 1000
                });
                productFiles = pdResponse.data.files?.length || 0;
                breakdown.push(`Product Images/Docs: ${productFiles} files`);
            }

            // Count other files
            let otherQuery = 'trashed = false';
            if (profilePictureFolderId || productDocsFolderId) {
                const excludeFolders = [profilePictureFolderId, productDocsFolderId]
                    .filter(Boolean)
                    .map(id => `not parents in '${id}'`)
                    .join(' and ');
                otherQuery += ` and (${excludeFolders})`;
            }

            const otherResponse = await this.drive.files.list({
                q: otherQuery,
                fields: 'files(id)',
                pageSize: 1000
            });
            otherFiles = otherResponse.data.files?.length || 0;
            breakdown.push(`Other Files: ${otherFiles} files`);

            const totalFiles = profilePictureFiles + productFiles + otherFiles;

            return {
                totalFiles,
                profilePictureFiles,
                productFiles,
                otherFiles,
                breakdown
            };
        } catch (error: any) {
            log.error('Error getting storage breakdown:', error);
            throw new Error(`Failed to get storage breakdown: ${error.message}`);
        }
    }

    /**
     * Log current storage status
     */
    async logStorageStatus(): Promise<void> {
        try {
            const report = await this.getStorageReport();

            log.info(`Storage Status: ${this.formatBytes(report.usage.used)} / ${this.formatBytes(report.usage.total)} (${report.usage.percentage}%)`);

            // Add file breakdown for better insights
            try {
                const breakdown = await this.getStorageBreakdown();
                log.info(`File Breakdown: ${breakdown.breakdown.join(', ')} (Total: ${breakdown.totalFiles} files)`);
            } catch (error) {
                log.debug('Could not get detailed file breakdown:', error);
            }

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
            log.error('Error logging storage status:', error);
        }
    }
}

export default new StorageMonitorService(); 