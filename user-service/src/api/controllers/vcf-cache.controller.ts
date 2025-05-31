import { Request, Response } from 'express';
import { vcfCacheService } from '../../services/vcf-cache.service';
import { popularFiltersCacheService } from '../../services/popular-filters-cache.service';
import logger from '../../utils/logger';

const log = logger.getLogger('VCFCacheController');

export class VCFCacheController {
    /**
     * Get VCF cache status and statistics
     * @route GET /api/admin/vcf-cache/status
     */
    async getCacheStatus(req: Request, res: Response): Promise<void> {
        try {
            log.info('Admin request for VCF cache status');

            const fileExists = await vcfCacheService.fileExists();

            if (!fileExists) {
                res.status(200).json({
                    success: true,
                    data: {
                        exists: false,
                        message: 'VCF cache file does not exist'
                    }
                });
                return;
            }

            const stats = await vcfCacheService.getFileStats();
            const ageMinutes = (Date.now() - stats.mtime.getTime()) / (1000 * 60);

            res.status(200).json({
                success: true,
                data: {
                    exists: true,
                    contactCount: stats.contactCount,
                    fileSizeBytes: stats.size,
                    lastModified: stats.mtime,
                    ageMinutes: Math.round(ageMinutes * 100) / 100,
                    isStale: ageMinutes > 60 // Consider stale if older than 1 hour
                }
            });

        } catch (error: any) {
            log.error('Error getting VCF cache status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get VCF cache status',
                error: error.message
            });
        }
    }

    /**
     * Manually trigger VCF cache regeneration
     * @route POST /api/admin/vcf-cache/regenerate
     */
    async regenerateCache(req: Request, res: Response): Promise<void> {
        try {
            log.info('Admin request to regenerate VCF cache');

            const startTime = Date.now();
            await vcfCacheService.generateVCFFile();
            const endTime = Date.now();

            const stats = await vcfCacheService.getFileStats();

            res.status(200).json({
                success: true,
                message: 'VCF cache regenerated successfully',
                data: {
                    contactCount: stats.contactCount,
                    fileSizeBytes: stats.size,
                    generationTimeMs: endTime - startTime,
                    lastModified: stats.mtime
                }
            });

        } catch (error: any) {
            log.error('Error regenerating VCF cache:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to regenerate VCF cache',
                error: error.message
            });
        }
    }

    /**
     * Delete the cached VCF file
     * @route DELETE /api/admin/vcf-cache
     */
    async deleteCache(req: Request, res: Response): Promise<void> {
        try {
            log.info('Admin request to delete VCF cache');

            await vcfCacheService.deleteCachedFile();

            res.status(200).json({
                success: true,
                message: 'VCF cache deleted successfully'
            });

        } catch (error: any) {
            log.error('Error deleting VCF cache:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete VCF cache',
                error: error.message
            });
        }
    }

    /**
     * Download the current cached VCF file (for admin inspection)
     * @route GET /api/admin/vcf-cache/download
     */
    async downloadCache(req: Request, res: Response): Promise<void> {
        try {
            log.info('Admin request to download VCF cache');

            const fileExists = await vcfCacheService.fileExists();
            if (!fileExists) {
                res.status(404).json({
                    success: false,
                    message: 'VCF cache file does not exist'
                });
                return;
            }

            const vcfContent = await vcfCacheService.getVCFContent();
            const stats = await vcfCacheService.getFileStats();

            // Set headers for file download
            res.setHeader('Content-Type', 'text/vcard');
            res.setHeader('Content-Disposition', 'attachment; filename="admin-contacts-cache.vcf"');
            res.setHeader('Content-Length', Buffer.byteLength(vcfContent, 'utf8'));
            res.setHeader('X-Contact-Count', stats.contactCount.toString());
            res.setHeader('X-File-Size', stats.size.toString());
            res.setHeader('X-Last-Modified', stats.mtime.toISOString());

            res.status(200).send(vcfContent);

        } catch (error: any) {
            log.error('Error downloading VCF cache:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to download VCF cache',
                error: error.message
            });
        }
    }

    /**
     * Get popular filter cache statistics
     * @route GET /api/admin/vcf-cache/popular-filters
     */
    async getPopularFiltersStats(req: Request, res: Response): Promise<void> {
        try {
            log.info('Admin request for popular filter cache stats');

            const stats = await popularFiltersCacheService.getCacheStats();

            res.status(200).json({
                success: true,
                data: {
                    ...stats,
                    maxCacheFiles: 10,
                    maxAgeHours: 24
                }
            });

        } catch (error: any) {
            log.error('Error getting popular filter cache stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get popular filter cache stats',
                error: error.message
            });
        }
    }

    /**
     * Clear popular filter cache
     * @route DELETE /api/admin/vcf-cache/popular-filters
     */
    async clearPopularFiltersCache(req: Request, res: Response): Promise<void> {
        try {
            log.info('Admin request to clear popular filter cache');

            await popularFiltersCacheService.clearAllCache();

            res.status(200).json({
                success: true,
                message: 'Popular filter cache cleared successfully'
            });

        } catch (error: any) {
            log.error('Error clearing popular filter cache:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to clear popular filter cache',
                error: error.message
            });
        }
    }
}

// Export controller instance
export const vcfCacheController = new VCFCacheController();
